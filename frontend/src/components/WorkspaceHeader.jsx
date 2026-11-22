import React from "react";

const MODES = [
  { id: "hybrid", label: "Hybrid" },
  { id: "vector_bm25", label: "Vector" },
  { id: "graph_rag", label: "Graph" },
];

const VIEW_TITLES = {
  chat: "AI Architect Chat",
  architecture: "Tech Stack",
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
    <header className="sticky top-0 z-20 flex h-14 items-center justify-between gap-2 border-b border-emerald-900/50 bg-[#07130d]/95 px-3 backdrop-blur sm:h-16 sm:px-6">
      <div className="flex min-w-0 items-center gap-2 sm:gap-3">
        <button
          type="button"
          onClick={onOpenMobileMenu}
          aria-label="Open navigation menu"
          className="shrink-0 rounded-lg border border-emerald-800/60 bg-emerald-950/60 px-2.5 py-1.5 text-xs font-medium text-emerald-200 hover:bg-emerald-900/60 lg:hidden"
        >
          Menu
        </button>
        <h1 className="truncate text-sm font-semibold text-white sm:text-lg">
          {VIEW_TITLES[activeView] || "AI Architect Chat"}
        </h1>
      </div>

      <div className="flex shrink-0 items-center gap-1.5 sm:gap-2.5">
        <div
          role="group"
          aria-label="Retrieval mode"
          className="flex items-center rounded-lg border border-emerald-800/60 bg-[#0b1d14] p-0.5 text-[11px] sm:text-xs"
        >
          {MODES.map((mode) => {
            const active = retrievalMode === mode.id;
            return (
              <button
                key={mode.id}
                type="button"
                onClick={() => onChangeMode(mode.id)}
                className={`whitespace-nowrap rounded-md px-2 py-1 font-medium transition sm:px-2.5 ${
                  active
                    ? "bg-emerald-400 text-slate-950"
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
            className="whitespace-nowrap rounded-lg border border-emerald-800/60 bg-emerald-950/50 px-2.5 py-1.5 text-[11px] font-medium text-emerald-200 transition hover:border-emerald-600 hover:text-white sm:px-3 sm:text-xs"
          >
            New Chat
          </button>
        )}
      </div>
    </header>
  );
}