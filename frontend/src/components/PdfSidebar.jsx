import React, { useRef } from "react";

const NAV_ITEMS = [
  {
    id: "chat",
    label: "AI Architect Chat",
    subtitle: "Query & compare retrieval",
  },
  {
    id: "architecture",
    label: "Tech Stack & Services",
    subtitle: "Live Knowledge Graph nodes",
  },
  {
    id: "documents",
    label: "Indexed PDFs",
    subtitle: "Upload & delete PDF sources",
  },
];

export default function PdfSidebar({
  activeView,
  onSelectView,
  documents = [],
  isUploading = false,
  uploadProgress = 0,
  uploadStage = "",
  deletingDocId = null,
  onUploadPdf,
  onDeleteDocument,
  mobileOpen = false,
  onCloseMobile,
}) {
  const fileInputRef = useRef(null);

  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    if (file && typeof onUploadPdf === "function") {
      onUploadPdf(file);
    }
    e.target.value = "";
  };

  const content = (
    <aside className="flex h-full w-64 shrink-0 flex-col justify-between border-r border-emerald-900/60 bg-[#07140e] p-4">
      <div className="space-y-5">
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="text-sm font-bold tracking-tight text-white">
              Spotify Architect RAG
            </div>
            <div className="mt-0.5 text-[11px] font-medium text-emerald-400">
              Vector + BM25 + Graph
            </div>
          </div>
          {mobileOpen && (
            <button
              type="button"
              onClick={onCloseMobile}
              className="rounded-lg border border-emerald-800/60 bg-emerald-950/70 px-2 py-1 text-xs text-emerald-200 lg:hidden"
            >
              Close
            </button>
          )}
        </div>

        <nav className="space-y-1.5" aria-label="Workspace navigation">
          {NAV_ITEMS.map((item) => {
            const active = activeView === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onSelectView(item.id)}
                className={`w-full rounded-xl border px-3 py-2.5 text-left transition ${
                  active
                    ? "border-emerald-500/50 bg-[#0d291c] text-white"
                    : "border-transparent text-emerald-100/80 hover:border-emerald-900/70 hover:bg-[#0a1d14]"
                }`}
              >
                <div className="text-xs font-semibold">{item.label}</div>
                <div className="mt-0.5 text-[11px] text-emerald-200/55">
                  {item.subtitle}
                </div>
              </button>
            );
          })}
        </nav>

        <div className="space-y-2.5 rounded-2xl border border-emerald-900/70 bg-[#081911] p-3">
          <div className="flex items-center justify-between text-[11px]">
            <span className="font-semibold uppercase tracking-wider text-emerald-300/80">
              PDF Library
            </span>
            <span className="rounded-full bg-emerald-950 px-2 py-0.5 font-medium text-emerald-300">
              {documents.length} {documents.length === 1 ? "PDF" : "PDFs"}
            </span>
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,application/pdf"
            onChange={handleFileChange}
            disabled={isUploading}
            className="hidden"
          />

          <button
            type="button"
            disabled={isUploading}
            onClick={() => fileInputRef.current?.click()}
            className="w-full rounded-xl border border-dashed border-emerald-700/70 bg-[#06130d] px-3 py-3 text-center transition hover:border-emerald-400 disabled:cursor-not-allowed disabled:opacity-75"
          >
            {isUploading ? (
              <div className="space-y-1.5">
                <div className="text-xs font-semibold text-emerald-300">
                  {uploadProgress}% • {uploadStage || "Processing..."}
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-emerald-950">
                  <div
                    className="h-full rounded-full bg-emerald-400 transition-all duration-300"
                    style={{ width: `${uploadProgress}%` }}
                  />
                </div>
              </div>
            ) : (
              <>
                <div className="text-xs font-semibold text-white">Upload PDF</div>
                <div className="mt-0.5 text-[10px] text-emerald-200/55">
                  Select a .pdf file (max 50 MB)
                </div>
              </>
            )}
          </button>

          {documents.length > 0 && (
            <div className="max-h-40 space-y-1.5 overflow-y-auto pr-0.5">
              {documents.map((doc) => (
                <div
                  key={doc.doc_id}
                  className="flex items-center justify-between gap-2 rounded-lg border border-emerald-900/60 bg-[#0b1f15] px-2.5 py-1.5 text-xs"
                >
                  <span className="truncate text-emerald-100" title={doc.filename}>
                    {doc.filename}
                  </span>
                  <button
                    type="button"
                    disabled={deletingDocId === doc.doc_id}
                    onClick={() => onDeleteDocument(doc.doc_id)}
                    className="shrink-0 rounded bg-rose-950/80 px-2 py-0.5 text-[10px] font-medium text-rose-300 hover:bg-rose-900/80 disabled:opacity-50"
                  >
                    {deletingDocId === doc.doc_id ? "..." : "Delete"}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="border-t border-emerald-900/50 pt-3 text-[10px] text-emerald-200/50">
        FAISS + BM25 + Neo4j GraphRAG Pipeline
      </div>
    </aside>
  );

  return (
    <>
      <div className="hidden lg:block">{content}</div>
      {mobileOpen && (
        <div className="fixed inset-0 z-40 flex lg:hidden">
          <div className="relative z-10 h-full">{content}</div>
          <button
            type="button"
            aria-label="Close sidebar"
            onClick={onCloseMobile}
            className="flex-1 bg-black/60"
          />
        </div>
      )}
    </>
  );
}