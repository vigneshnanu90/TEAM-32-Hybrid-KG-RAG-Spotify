import React, { useState } from "react";

const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024;

const NAV_ITEMS = [
  { id: "chat", label: "AI Architect Chat", hint: "Query & compare retrieval" },
  { id: "architecture", label: "Tech Stack & Services", hint: "Explore architecture topics" },
  { id: "documents", label: "Indexed PDFs", hint: "Upload & delete PDF sources" },
];

export default function PdfSidebar({
  activeView,
  onSelectView,
  documents = [],
  isUploading = false,
  uploadProgress = 0,
  deletingDocId = null,
  onUploadPdf,
  onDeleteDocument,
  mobileOpen = false,
  onCloseMobile,
}) {
  const [uploadError, setUploadError] = useState("");

  const handleFileInput = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    const isPdf =
      file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
    if (!isPdf) {
      setUploadError("Please select a valid .pdf file.");
      return;
    }
    if (file.size > MAX_FILE_SIZE_BYTES) {
      setUploadError("PDF exceeds the 50 MB upload limit.");
      return;
    }

    setUploadError("");
    if (typeof onUploadPdf === "function") {
      await onUploadPdf(file);
    }
  };

  const sidebarBody = (
    <aside className="flex h-full w-72 flex-col justify-between border-r border-emerald-900/60 bg-[#07140e] p-4 text-slate-100">
      <div className="space-y-5">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-sm font-semibold tracking-tight text-white">
              Spotify Architect RAG
            </p>
            <p className="text-xs text-emerald-300/75">Vector + BM25 + Graph</p>
          </div>

          {typeof onCloseMobile === "function" && (
            <button
              type="button"
              onClick={onCloseMobile}
              aria-label="Close navigation menu"
              className="rounded-md border border-emerald-800/60 px-2 py-1 text-xs text-emerald-200 hover:bg-emerald-900/50 lg:hidden"
            >
              Close
            </button>
          )}
        </div>

        <nav aria-label="Workspace views" className="space-y-1">
          {NAV_ITEMS.map((item) => {
            const isActive = activeView === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onSelectView(item.id)}
                className={`w-full rounded-xl border px-3 py-2.5 text-left transition ${
                  isActive
                    ? "border-emerald-500/60 bg-emerald-500/15 text-white"
                    : "border-transparent text-emerald-100/75 hover:border-emerald-900/70 hover:bg-emerald-950/50 hover:text-white"
                }`}
              >
                <div className="text-xs font-semibold">{item.label}</div>
                <div className="mt-0.5 text-[11px] text-emerald-200/55">
                  {item.hint}
                </div>
              </button>
            );
          })}
        </nav>

        <div className="space-y-3 rounded-xl border border-emerald-900/70 bg-[#0a1b13] p-3.5">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-emerald-300/80">
              PDF Library
            </span>
            <span className="rounded-full bg-emerald-950 px-2 py-0.5 text-[11px] font-medium text-emerald-300">
              {documents.length} {documents.length === 1 ? "PDF" : "PDFs"}
            </span>
          </div>

          <label className="flex cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed border-emerald-700/70 bg-[#07140e]/80 px-3 py-3.5 text-center transition hover:border-emerald-400">
            {isUploading ? (
              <div className="flex flex-col items-center gap-1.5">
                <div className="flex items-center gap-2 text-xs font-semibold text-emerald-300">
                  <span className="inline-flex h-7 w-7 items-center justify-center rounded-full border-2 border-emerald-400 bg-emerald-950 text-[10px] font-bold text-emerald-200">
                    {uploadProgress}%
                  </span>
                  <span>Uploading PDF...</span>
                </div>
                <div className="h-1.5 w-40 overflow-hidden rounded-full bg-emerald-950">
                  <div
                    className="h-full bg-emerald-400 transition-all duration-150"
                    style={{ width: `${Math.min(100, Math.max(0, uploadProgress))}%` }}
                  />
                </div>
              </div>
            ) : (
              <>
                <span className="text-xs font-semibold text-white">Upload PDF</span>
                <span className="mt-1 text-[11px] text-emerald-200/65">
                  Select a .pdf file (max 50 MB)
                </span>
              </>
            )}
            <input
              type="file"
              accept=".pdf,application/pdf"
              disabled={isUploading}
              onChange={handleFileInput}
              className="hidden"
            />
          </label>

          {uploadError && (
            <p role="alert" className="text-[11px] font-medium text-rose-400">
              {uploadError}
            </p>
          )}

          {documents.length > 0 && (
            <ul className="max-h-40 space-y-1.5 overflow-y-auto text-xs">
              {documents.map((doc) => {
                const isDeleting = deletingDocId === doc.doc_id;
                return (
                  <li
                    key={doc.doc_id}
                    className="flex items-center justify-between gap-2 rounded-md bg-emerald-950/60 px-2.5 py-1.5 text-emerald-100"
                  >
                    <span className="truncate" title={doc.filename}>
                      {doc.filename}
                    </span>
                    <button
                      type="button"
                      disabled={isDeleting || isUploading}
                      onClick={() => onDeleteDocument && onDeleteDocument(doc.doc_id)}
                      className="shrink-0 rounded bg-rose-500/15 px-2 py-0.5 text-[10px] font-medium text-rose-300 transition hover:bg-rose-500/30 disabled:opacity-50"
                    >
                      {isDeleting ? "..." : "Delete"}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>

      <div className="border-t border-emerald-900/60 pt-3 text-[11px] text-emerald-200/55">
        FAISS + BM25 + Neo4j GraphRAG Pipeline
      </div>
    </aside>
  );

  return (
    <>
      <div className="hidden lg:block lg:shrink-0">{sidebarBody}</div>

      {mobileOpen && (
        <div className="fixed inset-0 z-40 flex lg:hidden">
          <div className="relative z-10 h-full">{sidebarBody}</div>
          <button
            type="button"
            aria-label="Dismiss navigation menu"
            onClick={onCloseMobile}
            className="flex-1 bg-black/60 backdrop-blur-[1px]"
          />
        </div>
      )}
    </>
  );
}