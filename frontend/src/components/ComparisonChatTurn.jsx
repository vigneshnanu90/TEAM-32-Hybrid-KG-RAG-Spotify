import React, { useState } from "react";

function FormattedText({ text }) {
  if (!text) return null;
  const lines = text.split("\n");

  return (
    <div className="space-y-2 text-sm leading-relaxed text-emerald-50/95">
      {lines.map((line, index) => {
        const trimmed = line.trim();
        if (!trimmed) {
          return <div key={index} className="h-1" />;
        }
        if (trimmed.startsWith("- ") || trimmed.startsWith("* ")) {
          return (
            <div key={index} className="flex items-start gap-2 pl-1">
              <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400" />
              <span>{trimmed.slice(2)}</span>
            </div>
          );
        }
        return <p key={index}>{trimmed}</p>;
      })}
    </div>
  );
}

export default function ComparisonChatTurn({ turn, onRetry }) {
  const [copied, setCopied] = useState(false);
  const [activeTab, setActiveTab] = useState("Summary");

  if (!turn) return null;

  const tabs = [
    turn.summaryText && { id: "Summary", label: "Summary", text: turn.summaryText },
    turn.matchesText && { id: "Matches", label: "Matches", text: turn.matchesText },
    turn.graphText && { id: "Graph", label: "Graph", text: turn.graphText },
  ].filter(Boolean);

  const displayedText =
    tabs.find((t) => t.id === activeTab)?.text || turn.answer || "";

  const handleCopy = async () => {
    if (!displayedText) return;
    try {
      await navigator.clipboard.writeText(displayedText);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Ignore clipboard restrictions
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl border border-emerald-800/60 bg-[#0d261a] px-4 py-2.5 text-sm font-medium text-white shadow">
          {turn.question}
        </div>
      </div>

      <article className="space-y-3 rounded-2xl border border-emerald-900/70 bg-[#081710]/95 p-4 shadow-lg sm:p-5">
        {turn.loading ? (
          <div className="flex items-center gap-2.5 py-2 text-sm text-emerald-200/75">
            <span className="h-2 w-2 animate-ping rounded-full bg-emerald-400" />
            <span>Retrieving architecture answer...</span>
          </div>
        ) : turn.error ? (
          <div className="space-y-3">
            <p className="text-sm leading-relaxed text-rose-300">{turn.answer}</p>
            {typeof onRetry === "function" && (
              <button
                type="button"
                onClick={() => onRetry(turn.question)}
                className="rounded-lg border border-emerald-700/70 bg-emerald-950/80 px-3 py-1.5 text-xs font-medium text-emerald-200 hover:text-white"
              >
                Retry
              </button>
            )}
          </div>
        ) : (
          <>
            {tabs.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5">
                {tabs.map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setActiveTab(tab.id)}
                    className={`rounded-full px-3 py-1 text-xs font-semibold transition ${
                      activeTab === tab.id
                        ? "bg-emerald-400 text-slate-950"
                        : "border border-emerald-800/60 bg-[#0c2117] text-emerald-200/80 hover:text-white"
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            )}

            <FormattedText text={displayedText} />

            <div className="flex flex-wrap items-center gap-1.5 pt-1">
              {(turn.pageChips || []).map((chip) => (
                <span
                  key={chip}
                  className="rounded-md border border-emerald-700/50 bg-emerald-950/90 px-2 py-0.5 text-[11px] font-medium text-emerald-300"
                >
                  {chip}
                </span>
              ))}
              {turn.hops > 0 && (
                <span className="rounded-md border border-amber-700/50 bg-amber-950/70 px-2 py-0.5 text-[11px] font-medium text-amber-300">
                  Graph: {turn.hops} {turn.hops === 1 ? "hop" : "hops"}
                </span>
              )}
            </div>

            <div className="flex items-center gap-4 border-t border-emerald-900/50 pt-2.5 text-xs text-emerald-200/80">
              <button
                type="button"
                onClick={handleCopy}
                className="transition hover:text-white"
              >
                {copied ? "Copied" : "Copy"}
              </button>
              {typeof onRetry === "function" && (
                <button
                  type="button"
                  onClick={() => onRetry(turn.question)}
                  className="transition hover:text-white"
                >
                  Retry
                </button>
              )}
            </div>
          </>
        )}
      </article>
    </div>
  );
}