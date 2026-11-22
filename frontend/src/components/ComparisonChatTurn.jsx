import React, { useEffect, useMemo, useState } from "react";

function FormattedText({ text }) {
  if (!text) return null;
  const lines = String(text).split("\n");

  return (
    <div className="space-y-2 text-sm leading-relaxed text-emerald-50/95">
      {lines.map((line, idx) => {
        const trimmed = line.trim();
        if (!trimmed) {
          return <div key={idx} className="h-1" />;
        }
        if (/^#{1,3}\s+/.test(trimmed)) {
          return (
            <h4
              key={idx}
              className="pt-1 text-sm font-semibold text-emerald-300"
            >
              {trimmed.replace(/^#{1,3}\s+/, "")}
            </h4>
          );
        }
        if (/^[-*•]\s+/.test(trimmed)) {
          return (
            <div key={idx} className="flex items-start gap-2 pl-1">
              <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400" />
              <span>{trimmed.replace(/^[-*•]\s+/, "")}</span>
            </div>
          );
        }
        return <p key={idx}>{trimmed}</p>;
      })}
    </div>
  );
}

function normalizeMode(mode) {
  const m = String(mode || "hybrid").toLowerCase();
  if (m.includes("vector")) return "vector";
  if (m.includes("graph")) return "graph";
  return "hybrid";
}

function getLoadingMessage(mode) {
  const normalized = normalizeMode(mode);
  if (normalized === "vector") {
    return "Running Vector + BM25 search across indexed chunks...";
  }
  if (normalized === "graph") {
    return "Running Neo4j GraphRAG search across entity relationships...";
  }
  return "Running Hybrid RAG search across Vector, BM25, and Graph...";
}

export default function ComparisonChatTurn({ turn, onRetry }) {
  const mode = normalizeMode(turn.mode);
  const [copied, setCopied] = useState(false);

  const availableTabs = useMemo(() => {
    if (mode === "vector") {
      return [
        {
          id: "vector",
          label: "Vector",
          content:
            turn.matchesText ||
            "No vector/BM25 chunk answer was returned for this query.",
        },
      ];
    }
    if (mode === "graph") {
      return [
        {
          id: "graph",
          label: "Graph",
          content:
            turn.graphText ||
            "No knowledge graph answer was returned for this query.",
        },
      ];
    }
    return [
      {
        id: "best",
        label: "Best Match",
        content: turn.summaryText || turn.answer || "",
      },
      {
        id: "vector",
        label: "Vector",
        content: turn.matchesText || turn.summaryText || turn.answer || "",
      },
      {
        id: "graph",
        label: "Graph",
        content: turn.graphText || turn.summaryText || turn.answer || "",
      },
    ];
  }, [mode, turn]);

  const [activeTab, setActiveTab] = useState(() => availableTabs[0].id);

  useEffect(() => {
    if (!availableTabs.some((t) => t.id === activeTab)) {
      setActiveTab(availableTabs[0].id);
    }
  }, [availableTabs, activeTab]);

  const currentTab =
    availableTabs.find((t) => t.id === activeTab) || availableTabs[0];

  const showPageChips =
    mode !== "graph" && Array.isArray(turn.pageChips) && turn.pageChips.length > 0;
  const showHopsBadge = mode !== "vector" && Number(turn.hops) > 0;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(currentTab.content || "");
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="space-y-3">
      {turn.question && (
        <div className="flex justify-end">
          <div className="max-w-[85%] rounded-2xl border border-emerald-700/60 bg-[#0b2016] px-4 py-2.5 text-sm font-medium text-white shadow-sm">
            {turn.question}
          </div>
        </div>
      )}

      <div className="rounded-2xl border border-emerald-900/70 bg-[#081710]/95 p-4 shadow-md sm:p-5">
        {turn.loading ? (
          <div className="flex items-center gap-2.5 py-3 text-sm text-emerald-200/80">
            <span className="h-2.5 w-2.5 animate-ping rounded-full bg-emerald-400" />
            <span>{getLoadingMessage(mode)}</span>
          </div>
        ) : turn.error ? (
          <div className="space-y-3">
            <p className="text-sm text-rose-300">{turn.answer}</p>
            {typeof onRetry === "function" && turn.question && (
              <button
                type="button"
                onClick={() => onRetry(turn.question)}
                className="rounded-lg border border-emerald-700/70 bg-[#0b1d14] px-3 py-1.5 text-xs font-semibold text-emerald-300 hover:text-white"
              >
                Retry
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              {availableTabs.map((tab) => {
                const selected = activeTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setActiveTab(tab.id)}
                    className={`rounded-full px-3.5 py-1 text-xs font-semibold transition ${
                      selected
                        ? "bg-emerald-400 text-slate-950"
                        : "border border-emerald-800/70 bg-[#0b1d14] text-emerald-200/80 hover:border-emerald-500/60 hover:text-white"
                    }`}
                  >
                    {tab.label}
                  </button>
                );
              })}
            </div>

            <FormattedText text={currentTab.content} />

            {(showPageChips || showHopsBadge) && (
              <div className="flex flex-wrap items-center gap-1.5 pt-1">
                {showPageChips &&
                  turn.pageChips.map((chip, idx) => (
                    <span
                      key={`${chip}-${idx}`}
                      className="rounded-md border border-emerald-800/60 bg-emerald-950/90 px-2 py-0.5 text-[11px] font-medium text-emerald-300"
                    >
                      {chip}
                    </span>
                  ))}
                {showHopsBadge && (
                  <span className="rounded-md border border-amber-700/50 bg-amber-950/70 px-2 py-0.5 text-[11px] font-medium text-amber-300">
                    Graph: {turn.hops}{" "}
                    {Number(turn.hops) === 1 ? "hop" : "hops"}
                  </span>
                )}
              </div>
            )}

            <div className="flex items-center gap-4 border-t border-emerald-900/60 pt-2.5 text-xs text-emerald-200/70">
              <button
                type="button"
                onClick={handleCopy}
                className="hover:text-emerald-300"
              >
                {copied ? "Copied" : "Copy"}
              </button>
              {typeof onRetry === "function" && turn.question && (
                <button
                  type="button"
                  onClick={() => onRetry(turn.question)}
                  className="hover:text-emerald-300"
                >
                  Retry
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}