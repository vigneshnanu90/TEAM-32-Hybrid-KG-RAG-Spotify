import React, { useCallback, useEffect, useState } from "react";
import WorkspaceHeader from "./components/WorkspaceHeader";
import PdfSidebar from "./components/PdfSidebar";
import ComparisonChatTurn from "./components/ComparisonChatTurn";
import RetrievalTracePanel from "./components/RetrievalTracePanel";
import ArchitectureExplorerView from "./views/ArchitectureExplorerView";
import DocumentManagerView from "./views/DocumentManagerView";

const SESSION_STORAGE_KEY = "spotify_architect_rag_turns_v1";
const MAX_PROMPT_CHARS = 1000;
const REQUEST_TIMEOUT_MS = 120000;

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

function buildTraceFromResponse(data, mode) {
  const rt = data?.retrieval_trace || {};
  const chunksCount = Number(
    rt.chunks_retrieved ?? data?.vector_section?.chunks_retrieved ?? 0
  );
  const triplesCount = Number(
    rt.triples_retrieved ?? data?.graph_section?.triples_retrieved ?? 0
  );
  const triples = Array.isArray(rt.triples)
    ? rt.triples
    : Array.isArray(data?.graph_section?.triples)
    ? data.graph_section.triples
    : [];

  return {
    mode,
    vectorScore: Number(rt.vector_score ?? 0),
    bm25Score: Number(rt.bm25_score ?? 0),
    chunksRetrieved: chunksCount,
    triplesRetrieved: triplesCount,
    hops: Number(rt.graph_hops ?? 0),
    topMatches: Array.isArray(rt.top_matches) ? rt.top_matches : [],
    triples,
  };
}

function uploadPdfWithProgress(file, onUpdate) {
  return new Promise((resolve, reject) => {
    const jobId = `job_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    let pollTimer = null;

    const startPolling = () => {
      if (pollTimer) return;
      pollTimer = setInterval(async () => {
        try {
          const res = await fetch(`/api/upload-status/${encodeURIComponent(jobId)}`);
          if (!res.ok) return;
          const st = await res.json();
          if (typeof st.percent === "number") {
            onUpdate({
              percent: Math.min(99, st.percent),
              stage: st.stage || "Processing document...",
            });
          }
        } catch {
          // Ignore transient polling errors
        }
      }, 700);
    };

    const stopPolling = () => {
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
    };

    const xhr = new XMLHttpRequest();
    xhr.open("POST", `/api/upload-pdf?job_id=${encodeURIComponent(jobId)}`);

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        const netPct = Math.max(
          1,
          Math.min(15, Math.round((event.loaded / event.total) * 15))
        );
        onUpdate({ percent: netPct, stage: "Uploading PDF..." });
        if (event.loaded >= event.total) {
          startPolling();
        }
      }
    };

    xhr.upload.onload = () => {
      onUpdate({ percent: 16, stage: "Extracting text from PDF pages..." });
      startPolling();
    };

    xhr.onload = () => {
      stopPolling();
      let data = {};
      try {
        data = JSON.parse(xhr.responseText || "{}");
      } catch {
        data = {};
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        onUpdate({ percent: 100, stage: "Indexing complete" });
        resolve(data);
      } else {
        reject(new Error(data.detail || data.message || `Upload failed (${xhr.status})`));
      }
    };

    xhr.onerror = () => {
      stopPolling();
      reject(new Error("Network error while uploading PDF."));
    };

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
  const [uploadStage, setUploadStage] = useState("");
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
    setUploadProgress(1);
    setUploadStage("Uploading PDF...");
    setStatusMessage("");
    try {
      const summary = await uploadPdfWithProgress(file, ({ percent, stage }) => {
        setUploadProgress(percent);
        setUploadStage(stage);
      });
      await refreshDocuments();
      setStatusMessage(
        `Indexed "${summary.filename || file.name}" (${summary.chunks_indexed || 0} chunks, ${summary.triples_stored || 0} graph links).`
      );
    } catch (err) {
      setStatusMessage(err.message || "Unable to upload PDF.");
    } finally {
      setIsUploading(false);
      setTimeout(() => {
        setUploadProgress(0);
        setUploadStage("");
      }, 900);
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

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: cleaned,
          mode: retrievalMode,
        }),
        signal: controller.signal,
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

      const summaryText = extractReadableText(
        data.comparison_section?.best_answer || data.answer || data.response
      );
      const matchesText = extractReadableText(data.vector_section);
      const graphText = extractReadableText(data.graph_section);

      const pageChips = Array.from(
        new Set(
          [
            ...(Array.isArray(data?.vector_section?.sources) ? data.vector_section.sources : []),
            ...(Array.isArray(data?.graph_section?.sources) ? data.graph_section.sources : []),
          ].map((s) => {
            const match = String(s).match(/p\.\s*([0-9]+)/i);
            return match ? `p.${match[1]}` : String(s);
          })
        )
      ).slice(0, 4);

      const trace = buildTraceFromResponse(data, retrievalMode);

      const combinedAnswer =
        summaryText ||
        [matchesText, graphText].filter(Boolean).join("\n\n") ||
        "No response content was returned for this query.";

      setTurns((prev) =>
        prev.map((t) =>
          t.id === turnId
            ? {
                ...t,
                answer: combinedAnswer,
                summaryText: summaryText || combinedAnswer,
                matchesText,
                graphText,
                pageChips,
                hops: trace.hops,
                trace,
                loading: false,
              }
            : t
        )
      );
    } catch (err) {
      const friendlyMessage =
        err?.name === "AbortError"
          ? "Request timed out while generating the response. Please tap Retry."
          : "Connection interrupted while fetching the response. Please check your signal and tap Retry.";

      setTurns((prev) =>
        prev.map((t) =>
          t.id === turnId
            ? {
                ...t,
                answer: friendlyMessage,
                error: true,
                loading: false,
              }
            : t
        )
      );
    } finally {
      clearTimeout(timeoutId);
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
        uploadStage={uploadStage}
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

        <main className="min-w-0 flex-1 overflow-y-auto">
          {activeView === "chat" && (
            <div className="mx-auto flex h-full max-w-6xl flex-col justify-between px-3 py-4 sm:px-6 sm:py-6">
              {turns.length === 0 ? (
                <div className="my-auto space-y-2 py-8 text-center">
                  <h2 className="text-lg font-semibold text-white sm:text-xl">
                    AI Architect Chat
                  </h2>
                  <p className="mx-auto max-w-md text-xs text-emerald-200/75 sm:text-sm">
                    Upload a PDF in the sidebar or ask a question to inspect Summary, Matches, and Graph results.
                  </p>
                </div>
              ) : (
                <div className="space-y-6 pb-4">
                  {turns.map((turn) => (
                    <div
                      key={turn.id}
                      className="flex flex-col gap-3 xl:flex-row xl:items-start xl:gap-4"
                    >
                      <div className="min-w-0 flex-1">
                        <ComparisonChatTurn
                          turn={turn}
                          onRetry={(q) => submitQuestion(q)}
                        />
                      </div>

                      {!turn.loading && !turn.error && turn.trace && (
                        <div className="w-full xl:w-64 xl:shrink-0">
                          <RetrievalTracePanel trace={turn.trace} compact />
                        </div>
                      )}
                    </div>
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
                <div className="flex items-center gap-2 rounded-2xl border border-emerald-800/70 bg-[#0b1d14] p-1.5 sm:p-2">
                  <input
                    type="text"
                    value={promptInput}
                    maxLength={MAX_PROMPT_CHARS}
                    disabled={isSending}
                    onChange={(e) => {
                      setPromptInput(e.target.value);
                      if (inputError) setInputError("");
                    }}
                    placeholder="Ask about your uploaded PDF..."
                    className="w-full bg-transparent px-2.5 py-1.5 text-sm text-white placeholder-emerald-200/45 focus:outline-none"
                  />
                  <button
                    type="submit"
                    disabled={isSending || !promptInput.trim()}
                    aria-label="Send question"
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-emerald-400 text-sm font-bold text-slate-950 transition hover:bg-emerald-300 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {isSending ? "…" : "→"}
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
              uploadStage={uploadStage}
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