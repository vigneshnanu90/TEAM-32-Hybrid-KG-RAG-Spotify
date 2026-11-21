import React, { useRef, useState } from "react";
import {
  Home,
  Search,
  Library,
  Upload,
  FileText,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  Disc3,
} from "lucide-react";

export default function PdfSidebar({
  apiBaseUrl,
  documents,
  activeNav,
  onSelectNav,
  onUploadSuccess,
}) {
  const fileInputRef = useRef(null);
  const [uploading, setUploading] = useState(false);
  const [statusMsg, setStatusMsg] = useState(null);

  const handleFile = async (file) => {
    if (!file) return;
    setStatusMsg(null);

    if (!file.name.toLowerCase().endsWith(".pdf")) {
      setStatusMsg({ type: "error", text: "Only .pdf files are supported." });
      return;
    }

    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);

      const res = await fetch(`${apiBaseUrl}/api/upload-pdf`, {
        method: "POST",
        body: formData,
      });
      const rawText = await res.text();
      let data = {};
      try {
        data = rawText ? JSON.parse(rawText) : {};
      } catch {
        throw new Error(`Server returned HTTP ${res.status} (non-JSON response).`);
      }

      if (!res.ok) throw new Error(data.detail || `Upload failed (HTTP ${res.status}).`);

      onUploadSuccess?.({
        id: data.doc_id,
        name: data.filename,
        pages: data.pages_indexed,
        chunks: data.chunks_indexed,
        triples: data.triples_stored,
      });

      if (data.neo4j_warning) {
        setStatusMsg({
          type: "warn",
          text: `Indexed ${data.chunks_indexed} chunks in FAISS/BM25. Neo4j warning: ${data.neo4j_warning}`,
        });
      } else {
        setStatusMsg({
          type: "ok",
          text: `Indexed ${data.pages_indexed} pages, ${data.chunks_indexed} chunks & ${data.triples_stored} graph triples.`,
        });
      }
    } catch (err) {
      setStatusMsg({
        type: "error",
        text: err.message || "Backend error while uploading PDF.",
      });
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const navItems = [
    { id: "chat", label: "AI Architect Chat", icon: Home },
    { id: "stack", label: "Tech Stack & Services", icon: Search },
    { id: "library", label: "Indexed PDFs", icon: Library },
  ];

  return (
    <aside className="w-72 bg-[#000000] p-2 flex flex-col gap-2 shrink-0 select-none">
      {/* Top Spotify Navigation Card */}
      <div className="bg-[#121212] rounded-xl p-4 space-y-4">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-full bg-[#1DB954] flex items-center justify-center text-black">
            <Disc3 className="w-5 h-5" />
          </div>
          <div>
            <span className="text-sm font-bold text-white tracking-tight block">
              Spotify Architect RAG
            </span>
            <span className="text-[11px] text-zinc-400">
              Vector + BM25 + Graph
            </span>
          </div>
        </div>

        <nav className="space-y-1">
          {navItems.map(({ id, label, icon: Icon }) => {
            const active = activeNav === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => onSelectNav(id)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-semibold transition ${
                  active
                    ? "bg-[#282828] text-white"
                    : "text-zinc-400 hover:text-white hover:bg-[#1a1a1a]"
                }`}
              >
                <Icon className={`w-5 h-5 ${active ? "text-[#1DB954]" : ""}`} />
                <span>{label}</span>
              </button>
            );
          })}
        </nav>
      </div>

      {/* Bottom Library & PDF Source Uploader Card */}
      <div className="flex-1 bg-[#121212] rounded-xl p-4 flex flex-col justify-between overflow-y-auto">
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-zinc-400">
              Your Knowledge Library
            </span>
            <span className="text-[11px] px-2 py-0.5 rounded-full bg-[#1f1f1f] text-zinc-300">
              {documents.length} PDF{documents.length === 1 ? "" : "s"}
            </span>
          </div>

          {/* Upload Button / Dropzone */}
          <div
            onClick={() => fileInputRef.current?.click()}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") fileInputRef.current?.click();
            }}
            className="cursor-pointer rounded-xl bg-[#181818] hover:bg-[#222222] border border-dashed border-zinc-700 hover:border-[#1DB954] p-4 text-center transition space-y-1.5"
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,application/pdf"
              className="hidden"
              onChange={(e) => handleFile(e.target.files?.[0])}
            />
            {uploading ? (
              <Loader2 className="w-6 h-6 text-[#1DB954] animate-spin mx-auto" />
            ) : (
              <Upload className="w-6 h-6 text-[#1DB954] mx-auto" />
            )}
            <p className="text-xs font-semibold text-white">
              {uploading ? "Indexing into FAISS, BM25 & Neo4j..." : "Upload Architecture PDF"}
            </p>
            <p className="text-[11px] text-zinc-400">
              Click to select a .pdf document
            </p>
          </div>

          {statusMsg && (
            <div
              className={`p-2.5 rounded-lg text-[11px] flex items-start gap-2 border ${
                statusMsg.type === "ok"
                  ? "bg-emerald-950/40 border-emerald-800/60 text-emerald-200"
                  : statusMsg.type === "warn"
                  ? "bg-amber-950/40 border-amber-700/60 text-amber-200"
                  : "bg-red-950/40 border-red-800/60 text-red-200"
              }`}
            >
              {statusMsg.type === "ok" ? (
                <CheckCircle2 className="w-4 h-4 text-[#1DB954] shrink-0 mt-0.5" />
              ) : (
                <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
              )}
              <span>{statusMsg.text}</span>
            </div>
          )}

          {/* Indexed Documents List */}
          <div className="space-y-1.5 pt-1">
            {documents.length === 0 ? (
              <p className="text-xs text-zinc-500 px-1">
                No PDF indexed yet. Upload <code className="text-zinc-300">spotify_web_app_architecture.pdf</code> above.
              </p>
            ) : (
              documents.map((doc) => (
                <div
                  key={doc.id}
                  className="flex items-center justify-between gap-2 p-2.5 rounded-lg bg-[#181818] hover:bg-[#242424] transition"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="w-8 h-8 rounded bg-[#282828] flex items-center justify-center shrink-0">
                      <FileText className="w-4 h-4 text-[#1DB954]" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-white truncate">{doc.name}</p>
                      <p className="text-[11px] text-zinc-400">
                        {doc.chunks} chunks • {doc.triples} triples
                      </p>
                    </div>
                  </div>
                  <CheckCircle2 className="w-4 h-4 text-[#1DB954] shrink-0" />
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </aside>
  );
}