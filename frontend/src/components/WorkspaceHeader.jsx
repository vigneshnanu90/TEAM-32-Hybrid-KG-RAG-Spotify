import React from "react";

const MODES = [
  { id: "hybrid", label: "Hybrid" },
  { id: "vector_bm25", label: "Vector + BM25" },
  { id: "graph_rag", label: "GraphRAG" },
];

const VIEW_TITLES = {
  chat: "AI Architect Chat",
  architecture: "Tech Stack & Services",
  documents: "Indexed PDFs",
};

export default function WorkspaceHeader({
  activeView,
  retrievalMode,
  onChangeMode,
  onClearChat,
  onOpenMobileMenu,
}) {
  return (
    <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b border-emerald-900/50 bg-[#07130d]/95 px-4 backdrop-blur md:px-6">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onOpenMobileMenu}
          aria-label="Open navigation menu"
          className="rounded-lg border border-emerald-800/60 bg-emerald-950/60 px-2.5 py-1.5 text-sm text-emerald-200 hover:bg-emerald-900/60 lg:hidden"
        >
          Menu
        </button>
        <div>
          <h1 className="text-base font-semibold text-white md:text-lg">
            {VIEW_TITLES[activeView] || "Spotify Architect RAG"}
          </h1>
        </div>
      </div>

      <div className="flex items-center gap-2 sm:gap-3">
        <div
          role="group"
          aria-label="Retrieval mode"
          className="flex items-center rounded-lg border border-emerald-800/60 bg-[#0b1d14] p-0.5 text-xs"
        >
          {MODES.map((mode) => {
            const active = retrievalMode === mode.id;
            return (
              <button
                key={mode.id}
                type="button"
                onClick={() => onChangeMode(mode.id)}
                className={`rounded-md px-2.5 py-1 font-medium transition ${
                  active
                    ? "bg-emerald-500 text-slate-950"
                    : "text-emerald-200/80 hover:text-white"
                }`}
              >
                {mode.label}
              </button>
            );
          })}
        </div>

        {activeView === "chat" && (
          <button
            type="button"
            onClick={onClearChat}
            className="rounded-lg border border-emerald-800/60 bg-emerald-950/50 px-3 py-1.5 text-xs font-medium text-emerald-200 transition hover:border-emerald-600 hover:text-white"
          >
            New Chat
          </button>
        )}
      </div>
    </header>
  );
}