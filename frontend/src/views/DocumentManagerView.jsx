import React, { useRef } from "react";

const PIPELINE_STEPS = [
  { label: "Upload", minPct: 1 },
  { label: "Split Text", minPct: 18 },
  { label: "Graph Nodes", minPct: 30 },
  { label: "FAISS & BM25", minPct: 75 },
];

export default function DocumentManagerView({
  documents = [],
  isUploading = false,
  uploadProgress = 0,
  uploadStage = "",
  deletingDocId = null,
  statusMessage = "",
  onUploadPdf,
  onDeleteDocument,
  onBackToChat,
}) {
  const fileInputRef = useRef(null);

  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    if (file && typeof onUploadPdf === "function") {
      onUploadPdf(file);
    }
    e.target.value = "";
  };

  return (
    <div className="mx-auto max-w-4xl space-y-5 px-3 py-4 sm:px-6 sm:py-6">
      <div className="rounded-2xl border border-emerald-900/70 bg-[#081710]/95 p-4 shadow-lg sm:p-6">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-base font-semibold text-white sm:text-lg">
            PDF Upload & Indexing
          </h2>
          {isUploading && (
            <span className="rounded-full border border-emerald-500/40 bg-emerald-950 px-3 py-0.5 font-mono text-xs font-semibold text-emerald-300">
              {uploadProgress}%
            </span>
          )}
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,application/pdf"
          onChange={handleFileChange}
          disabled={isUploading}
          className="hidden"
        />

        <div className="mt-4 rounded-xl border border-dashed border-emerald-700/70 bg-[#06130d] p-5 text-center">
          {isUploading ? (
            <div className="mx-auto max-w-md space-y-3">
              <div className="text-sm font-semibold text-emerald-300">
                {uploadStage || "Processing document..."} ({uploadProgress}%)
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-emerald-950">
                <div
                  className="h-full rounded-full bg-emerald-400 transition-all duration-300"
                  style={{ width: `${uploadProgress}%` }}
                />
              </div>
              <div className="grid grid-cols-2 gap-1.5 pt-1 text-[11px] sm:grid-cols-4">
                {PIPELINE_STEPS.map((step) => {
                  const active = uploadProgress >= step.minPct;
                  return (
                    <span
                      key={step.label}
                      className={`rounded-md border px-2 py-1 font-medium ${
                        active
                          ? "border-emerald-500/50 bg-emerald-950/90 text-emerald-300"
                          : "border-emerald-900/50 bg-[#07140e] text-emerald-200/45"
                      }`}
                    >
                      {step.label}
                    </span>
                  );
                })}
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="w-full py-2"
            >
              <div className="text-sm font-semibold text-white">
                Choose a .pdf file to upload
              </div>
              <div className="mt-1 text-xs text-emerald-200/60">
                PDF only • Max 50 MB
              </div>
            </button>
          )}
        </div>

        {statusMessage && (
          <p className="mt-3 text-xs font-medium text-emerald-300 sm:text-sm">
            {statusMessage}
          </p>
        )}
      </div>

      <div className="rounded-2xl border border-emerald-900/70 bg-[#081710]/95 p-4 shadow-lg sm:p-6">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-white sm:text-base">
            Uploaded PDFs ({documents.length})
          </h3>
          {typeof onBackToChat === "function" && (
            <button
              type="button"
              onClick={onBackToChat}
              className="text-xs font-medium text-emerald-300 hover:underline"
            >
              Back to Chat
            </button>
          )}
        </div>

        {documents.length === 0 ? (
          <p className="mt-3 text-xs text-emerald-200/65 sm:text-sm">
            No PDFs uploaded yet.
          </p>
        ) : (
          <div className="mt-3 space-y-2.5">
            {documents.map((doc) => (
              <div
                key={doc.doc_id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-emerald-900/60 bg-[#0b1f15] px-4 py-3"
              >
                <div>
                  <div className="text-sm font-semibold text-white">
                    {doc.filename}
                  </div>
                  <div className="mt-0.5 text-xs text-emerald-200/65">
                    {doc.pages_indexed || 0} pages • {doc.chunks_indexed || 0} chunks •{" "}
                    {doc.triples_stored || 0} graph links
                  </div>
                </div>
                <button
                  type="button"
                  disabled={deletingDocId === doc.doc_id}
                  onClick={() => onDeleteDocument(doc.doc_id)}
                  className="rounded-lg border border-rose-800/60 bg-rose-950/70 px-3 py-1.5 text-xs font-medium text-rose-300 transition hover:bg-rose-900/80 disabled:opacity-50"
                >
                  {deletingDocId === doc.doc_id ? "Deleting..." : "Delete PDF"}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}