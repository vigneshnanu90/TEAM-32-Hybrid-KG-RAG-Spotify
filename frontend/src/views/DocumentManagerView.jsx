import React, { useState } from "react";

const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024;

export default function DocumentManagerView({
  documents = [],
  isUploading = false,
  uploadProgress = 0,
  deletingDocId = null,
  statusMessage = "",
  onUploadPdf,
  onDeleteDocument,
  onBackToChat,
}) {
  const [validationError, setValidationError] = useState("");

  const handleFileChange = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    const isPdf =
      file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
    if (!isPdf) {
      setValidationError("Please choose a valid .pdf file.");
      return;
    }
    if (file.size > MAX_FILE_SIZE_BYTES) {
      setValidationError("File size exceeds the 50 MB upload limit.");
      return;
    }

    setValidationError("");
    if (typeof onUploadPdf === "function") {
      await onUploadPdf(file);
    }
  };

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-4 md:p-6">
      <div className="rounded-xl border border-emerald-900/70 bg-[#0b1d14]/90 p-6">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-base font-semibold text-white">PDF Upload &amp; Indexing</h2>
          {isUploading && (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/50 bg-emerald-950 px-3 py-1 text-xs font-bold text-emerald-300">
              <span className="h-2 w-2 animate-ping rounded-full bg-emerald-400" />
              {uploadProgress}%
            </span>
          )}
        </div>

        <label className="mt-4 flex cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-emerald-700/70 bg-emerald-950/30 px-4 py-8 text-center transition hover:border-emerald-400">
          {isUploading ? (
            <div className="w-full max-w-xs space-y-2">
              <div className="text-sm font-semibold text-emerald-300">
                Uploading &amp; Indexing: {uploadProgress}%
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-emerald-950">
                <div
                  className="h-full bg-emerald-400 transition-all duration-150"
                  style={{ width: `${Math.min(100, Math.max(0, uploadProgress))}%` }}
                />
              </div>
            </div>
          ) : (
            <>
              <span className="text-sm font-medium text-emerald-200">
                Choose a .pdf file to upload
              </span>
              <span className="mt-1 text-xs text-emerald-300/70">PDF only • Max 50 MB</span>
            </>
          )}
          <input
            type="file"
            accept=".pdf,application/pdf"
            disabled={isUploading}
            onChange={handleFileChange}
            className="hidden"
          />
        </label>

        {validationError && (
          <p role="alert" className="mt-3 text-xs font-medium text-rose-400">
            {validationError}
          </p>
        )}
        {statusMessage && (
          <p className="mt-3 text-xs font-medium text-emerald-300">{statusMessage}</p>
        )}
      </div>

      <div className="rounded-xl border border-emerald-900/70 bg-[#0b1d14]/90 p-6">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-white">
            Uploaded PDFs ({documents.length})
          </h3>
          <button
            type="button"
            onClick={onBackToChat}
            className="text-xs font-medium text-emerald-300 hover:underline"
          >
            Back to Chat
          </button>
        </div>

        {documents.length === 0 ? (
          <p className="mt-3 text-sm text-emerald-200/70">
            No PDFs uploaded yet.
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-emerald-900/60 text-sm">
            {documents.map((doc) => {
              const isDeleting = deletingDocId === doc.doc_id;
              return (
                <li
                  key={doc.doc_id}
                  className="flex items-center justify-between gap-3 py-3 text-emerald-100"
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium text-white">{doc.filename}</p>
                    <p className="text-xs text-emerald-300/70">
                      {doc.pages_indexed || 0} pages • {doc.chunks_indexed || 0} chunks •{" "}
                      {doc.triples_stored || 0} graph links
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={isDeleting || isUploading}
                    onClick={() => onDeleteDocument && onDeleteDocument(doc.doc_id)}
                    className="shrink-0 rounded-lg border border-rose-500/40 bg-rose-500/15 px-3 py-1.5 text-xs font-semibold text-rose-200 transition hover:bg-rose-500/30 disabled:opacity-50"
                  >
                    {isDeleting ? "Deleting..." : "Delete PDF"}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}