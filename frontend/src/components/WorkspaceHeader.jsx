import React from "react";

const MODES = [
  { id: "hybrid", label: "Hybrid" },
  { id: "vector", label: "Vector" },
  { id: "graph", label: "Graph" },
];

function getHeaderTitle(mode) {
  const normalized = String(mode || "hybrid").toLowerCase();
  if (normalized.includes("vector")) {
    return "Vector + BM25 Retrieval";
  }
  if (normalized.includes("graph")) {
    return "Neo4j GraphRAG Explorer";
  }
  return "Hybrid RAG — Vector, BM25 & Graph";
}

export default function WorkspaceHeader({
  activeView = "chat",
  retrievalMode = "hybrid",
  onChangeMode,
  onClearChat,
  onOpenMobileMenu,
}) {
  const normalizedMode = String(retrievalMode || "hybrid").toLowerCase();
  const titleText =
    activeView === "architecture"
      ? "Live Knowledge Graph — Nodes & Edges"
      : activeView === "documents"
      ? "Document Indexer — FAISS, BM25 & Neo4j"
      : getHeaderTitle(retrievalMode);

  return (
    <header className="sticky top-0 z-20 flex flex-wrap items-center justify-between gap-3 border-b border-emerald-900/60 bg-[#06100b]/95 px-3 py-2.5 backdrop-blur sm:px-6">
      <div className="flex min-w-0 items-center gap-2.5">
        <button
          type="button"
          onClick={onOpenMobileMenu}
          aria-label="Open menu"
          className="rounded-lg border border-emerald-800/70 bg-[#0b1d14] px-2.5 py-1.5 text-xs font-semibold text-emerald-200 hover:border-emerald-500/60 lg:hidden"
        >
          Menu
        </button>
        <h1 className="truncate text-sm font-semibold text-white sm:text-base">
          {titleText}
        </h1>
      </div>

      <div className="flex items-center gap-2">
        <div
          className="flex items-center rounded-xl border border-emerald-800/70 bg-[#081710] p-0.5"
          role="group"
          aria-label="Retrieval mode"
        >
          {MODES.map((m) => {
            const isActive =
              normalizedMode === m.id || normalizedMode.startsWith(m.id);
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => onChangeMode?.(m.id)}
                className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition ${
                  isActive
                    ? "bg-emerald-400 text-slate-950"
                    : "text-emerald-200/80 hover:text-white"
                }`}
              >
                {m.label}
              </button>
            );
          })}
        </div>

        {activeView === "chat" && (
          <button
            type="button"
            onClick={onClearChat}
            className="rounded-xl border border-emerald-800/70 bg-[#0b1d14] px-3 py-1.5 text-xs font-semibold text-emerald-200 transition hover:border-emerald-500/60 hover:text-white"
          >
            New Chat
          </button>
        )}
      </div>
    </header>
  );
}