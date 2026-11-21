import React, { useCallback, useEffect, useState } from "react";
import WorkspaceHeader from "./components/WorkspaceHeader";
import PdfSidebar from "./components/PdfSidebar";
import ComparisonChatTurn from "./components/ComparisonChatTurn";
import ArchitectureExplorerView from "./views/ArchitectureExplorerView";
import DocumentManagerView from "./views/DocumentManagerView";

const SESSION_STORAGE_KEY = "spotify_architect_rag_turns_v1";
const MAX_PROMPT_CHARS = 1000;

function extractReadableText(section) {
  if (!section) return "";

  let parsed = section;
  if (typeof section === "string") {
    const trimmed = section.trim();
    if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
      try {
        parsed = JSON.parse(trimmed);
      } catch {
        parsed = section;
      }
    }
  }

  let rawText = "";
  if (typeof parsed === "string") {
    rawText = parsed;
  } else if (parsed && typeof parsed === "object") {
    rawText =
      parsed.answer ||
      parsed.summary ||
      parsed.response ||
      parsed.text ||
      "";
  }

  return String(rawText)
    .replace(/\\n/g, "\n")
    .replace(/\*\*/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function uploadPdfWithProgress(file, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/upload-pdf");

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && typeof onProgress === "function") {
        const pct = Math.min(100, Math.round((event.loaded / event.total) * 100));
        onProgress(pct);
      }
    };

    xhr.onload = () => {
      let data = {};
      try {
        data = JSON.parse(xhr.responseText || "{}");
      } catch {
        data = {};
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        if (typeof onProgress === "function") onProgress(100);
        resolve(data);
      } else {
        reject(new Error(data.detail || data.message || `Upload failed (${xhr.status})`));
      }
    };

    xhr.onerror = () => reject(new Error("Network error while uploading PDF."));

    const formData = new FormData();
    formData.append("file", file);
    xhr.send(formData);
  });
}

export default function App() {
  const [activeView, setActiveView] = useState("chat");
  const [retrievalMode, setRetrievalMode] = useState("hybrid");
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const [documents, setDocuments] = useState([]);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [deletingDocId, setDeletingDocId] = useState(null);
  const [statusMessage, setStatusMessage] = useState("");

  const [promptInput, setPromptInput] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [inputError, setInputError] = useState("");
  const [turns, setTurns] = useState(() => {
    try {
      const saved = sessionStorage.getItem(SESSION_STORAGE_KEY);
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  const refreshDocuments = useCallback(async () => {
    try {
      const res = await fetch("/api/documents");
      if (!res.ok) return;
      const data = await res.json();
      if (Array.isArray(data.documents)) {
        setDocuments(data.documents);
      }
    } catch {
      // Ignore transient network errors
    }
  }, []);

  useEffect(() => {
    refreshDocuments();
  }, [refreshDocuments]);

  useEffect(() => {
    try {
      sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(turns));
    } catch {
      // Ignore storage errors
    }
  }, [turns]);

  const handleUploadPdf = async (file) => {
    setIsUploading(true);
    setUploadProgress(0);
    setStatusMessage("");
    try {
      const summary = await uploadPdfWithProgress(file, (pct) => {
        setUploadProgress(pct);
      });
      await refreshDocuments();
      setStatusMessage(
        `Indexed "${summary.filename || file.name}" (${summary.chunks_indexed || 0} chunks, ${summary.triples_stored || 0} graph links).`
      );
    } catch (err) {
      setStatusMessage(err.message || "Unable to upload PDF.");
    } finally {
      setIsUploading(false);
      setTimeout(() => setUploadProgress(0), 600);
    }
  };

  const handleDeleteDocument = async (docId) => {
    if (!docId) return;
    setDeletingDocId(docId);
    setStatusMessage("");
    try {
      const res = await fetch(`/api/documents/${encodeURIComponent(docId)}`, {
        method: "DELETE",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.detail || `Delete failed (${res.status})`);
      }
      setDocuments((prev) => prev.filter((d) => d.doc_id !== docId));
      setStatusMessage("Deleted PDF and removed its indexed vector, keyword, and graph data.");
    } catch (err) {
      setStatusMessage(err.message || "Unable to delete PDF.");
    } finally {
      setDeletingDocId(null);
    }
  };

  const submitQuestion = async (rawQuestion) => {
    const cleaned = (rawQuestion || "").trim();
    if (!cleaned) {
      setInputError("Enter a question before sending.");
      return;
    }
    if (cleaned.length > MAX_PROMPT_CHARS) {
      setInputError(`Question must be ${MAX_PROMPT_CHARS} characters or fewer.`);
      return;
    }

    setInputError("");
    setActiveView("chat");
    setIsSending(true);
    setPromptInput("");

    const turnId = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    setTurns((prev) => [
      ...prev,
      {
        id: turnId,
        question: cleaned,
        mode: retrievalMode,
        answer: "",
        loading: true,
      },
    ]);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: cleaned,
          mode: retrievalMode,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.detail || data.message || `Request failed (${res.status})`);
      }

      if (data.blocked) {
        setTurns((prev) =>
          prev.map((t) =>
            t.id === turnId
              ? {
                  ...t,
                  answer: data.guardrail_reason || "Query was blocked by input guardrails.",
                  error: true,
                  loading: false,
                }
              : t
          )
        );
        return;
      }

      const vectorText = extractReadableText(data.vector_section);
      const graphText = extractReadableText(data.graph_section);
      const comparisonText = extractReadableText(data.comparison_section);
      const directAnswer = extractReadableText(data.answer || data.response);

      const sections = [
        vectorText && { label: "Vector & Keyword Match", content: vectorText },
        graphText && { label: "Connected Architecture", content: graphText },
        comparisonText && { label: "Key Takeaway", content: comparisonText },
      ].filter(Boolean);

      const combinedAnswer =
        directAnswer ||
        sections.map((s) => `${s.label}:\n${s.content}`).join("\n\n") ||
        "No response content was returned for this query.";

      setTurns((prev) =>
        prev.map((t) =>
          t.id === turnId
            ? {
                ...t,
                answer: combinedAnswer,
                sections,
                loading: false,
              }
            : t
        )
      );
    } catch (err) {
      setTurns((prev) =>
        prev.map((t) =>
          t.id === turnId
            ? {
                ...t,
                answer: `Unable to fetch response: ${err.message}`,
                error: true,
                loading: false,
              }
            : t
        )
      );
    } finally {
      setIsSending(false);
    }
  };

  const handleClearChat = () => {
    setTurns([]);
    setInputError("");
    try {
      sessionStorage.removeItem(SESSION_STORAGE_KEY);
    } catch {
      // Ignore storage errors
    }
  };

  return (
    <div className="flex min-h-screen bg-[#06100b] text-slate-100">
      <PdfSidebar
        activeView={activeView}
        onSelectView={(view) => {
          setActiveView(view);
          setMobileMenuOpen(false);
        }}
        documents={documents}
        isUploading={isUploading}
        uploadProgress={uploadProgress}
        deletingDocId={deletingDocId}
        onUploadPdf={handleUploadPdf}
        onDeleteDocument={handleDeleteDocument}
        mobileOpen={mobileMenuOpen}
        onCloseMobile={() => setMobileMenuOpen(false)}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <WorkspaceHeader
          activeView={activeView}
          retrievalMode={retrievalMode}
          onChangeMode={setRetrievalMode}
          onClearChat={handleClearChat}
          onOpenMobileMenu={() => setMobileMenuOpen(true)}
        />

        <main className="flex-1 overflow-y-auto">
          {activeView === "chat" && (
            <div className="mx-auto flex h-full max-w-5xl flex-col justify-between px-4 py-6 md:px-6">
              {turns.length === 0 ? (
                <div className="my-auto space-y-2 py-8 text-center">
                  <h2 className="text-xl font-semibold text-white">
                    AI Architect Chat
                  </h2>
                  <p className="mx-auto max-w-xl text-sm text-emerald-200/75">
                    Upload a PDF in the sidebar or Indexed PDFs view, then ask your question.
                  </p>
                </div>
              ) : (
                <div className="space-y-5 pb-6">
                  {turns.map((turn) => (
                    <ComparisonChatTurn key={turn.id} turn={turn} />
                  ))}
                </div>
              )}

              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  submitQuestion(promptInput);
                }}
                className="sticky bottom-0 z-10 border-t border-emerald-900/60 bg-[#06100b]/95 pt-3 pb-2 backdrop-blur"
              >
                <div className="flex items-center gap-2 rounded-xl border border-emerald-800/70 bg-[#0b1d14] p-2">
                  <input
                    type="text"
                    value={promptInput}
                    maxLength={MAX_PROMPT_CHARS}
                    disabled={isSending}
                    onChange={(e) => {
                      setPromptInput(e.target.value);
                      if (inputError) setInputError("");
                    }}
                    placeholder="Ask a question about your uploaded PDF..."
                    className="w-full bg-transparent px-2 py-1.5 text-sm text-white placeholder-emerald-200/45 focus:outline-none"
                  />
                  <button
                    type="submit"
                    disabled={isSending || !promptInput.trim()}
                    className="shrink-0 rounded-lg bg-emerald-500 px-4 py-2 text-xs font-semibold text-slate-950 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {isSending ? "Sending..." : "Send"}
                  </button>
                </div>
                <div className="mt-1.5 flex items-center justify-between px-1 text-[11px] text-emerald-200/55">
                  <span>
                    {inputError ? (
                      <span className="text-rose-400">{inputError}</span>
                    ) : (
                      `Mode: ${retrievalMode}`
                    )}
                  </span>
                  <span>
                    {promptInput.length}/{MAX_PROMPT_CHARS}
                  </span>
                </div>
              </form>
            </div>
          )}

          {activeView === "architecture" && (
            <ArchitectureExplorerView onAskPrompt={submitQuestion} />
          )}

          {activeView === "documents" && (
            <DocumentManagerView
              documents={documents}
              isUploading={isUploading}
              uploadProgress={uploadProgress}
              deletingDocId={deletingDocId}
              statusMessage={statusMessage}
              onUploadPdf={handleUploadPdf}
              onDeleteDocument={handleDeleteDocument}
              onBackToChat={() => setActiveView("chat")}
            />
          )}
        </main>
      </div>
    </div>
  );
}