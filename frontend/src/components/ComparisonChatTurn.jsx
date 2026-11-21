import React, { useState } from "react";

const MODE_LABELS = {
  hybrid: "Hybrid",
  vector_bm25: "Vector + BM25",
  graph_rag: "GraphRAG",
};

function FormattedText({ text }) {
  if (!text) return null;
  const lines = text.split("\n");

  return (
    <div className="space-y-2 text-sm leading-relaxed text-emerald-50/95">
      {lines.map((line, index) => {
        const trimmed = line.trim();
        if (!trimmed) {
          return <div key={index} className="h-1.5" />;
        }
        if (trimmed.startsWith("- ") || trimmed.startsWith("* ")) {
          return (
            <div key={index} className="flex items-start gap-2.5 pl-1">
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

export default function ComparisonChatTurn({ turn }) {
  const [copied, setCopied] = useState(false);
  const [activeTab, setActiveTab] = useState("all");

  if (!turn) return null;

  const modeBadge = MODE_LABELS[turn.mode] || "Hybrid";
  const sections = Array.isArray(turn.sections) ? turn.sections : [];

  const handleCopy = async () => {
    if (!turn.answer) return;
    try {
      await navigator.clipboard.writeText(turn.answer);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Ignore clipboard restrictions
    }
  };

  const activeContent =
    activeTab === "all"
      ? turn.answer
      : sections.find((s) => s.label === activeTab)?.content || turn.answer;

  return (
    <article className="space-y-3.5 rounded-2xl border border-emerald-900/60 bg-gradient-to-b from-[#0c2117]/95 to-[#08160f]/95 p-4 shadow-lg md:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-emerald-400">
          Your Question
        </span>
        <span className="rounded-full border border-emerald-700/60 bg-emerald-950/90 px-2.5 py-0.5 text-[11px] font-medium text-emerald-200">
          {modeBadge}
        </span>
      </div>

      <p className="text-sm font-medium leading-relaxed text-white md:text-base">
        {turn.question}
      </p>

      <div className="border-t border-emerald-900/50 pt-3.5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="mr-1 text-[11px] font-semibold uppercase tracking-wider text-emerald-300/80">
              Answer
            </span>
            {sections.length > 1 && (
              <>
                <button
                  type="button"
                  onClick={() => setActiveTab("all")}
                  className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium transition ${
                    activeTab === "all"
                      ? "bg-emerald-500 text-slate-950"
                      : "bg-emerald-950/80 text-emerald-200/80 hover:text-white"
                  }`}
                >
                  Full Summary
                </button>
                {sections.map((sec) => (
                  <button
                    key={sec.label}
                    type="button"
                    onClick={() => setActiveTab(sec.label)}
                    className={`rounded-full px-2.5 py-0.5 text-[11px] font-medium transition ${
                      activeTab === sec.label
                        ? "bg-emerald-500 text-slate-950"
                        : "bg-emerald-950/80 text-emerald-200/80 hover:text-white"
                    }`}
                  >
                    {sec.label}
                  </button>
                ))}
              </>
            )}
          </div>

          {!turn.loading && turn.answer && !turn.error && (
            <button
              type="button"
              onClick={handleCopy}
              className="rounded-lg border border-emerald-800/60 bg-emerald-950/60 px-2.5 py-1 text-[11px] font-medium text-emerald-200 transition hover:border-emerald-500/60 hover:text-white"
            >
              {copied ? "Copied" : "Copy"}
            </button>
          )}
        </div>

        {turn.loading ? (
          <div className="flex items-center gap-2.5 py-2 text-sm text-emerald-200/75">
            <span className="h-2 w-2 animate-ping rounded-full bg-emerald-400" />
            <span>Putting together a clear answer...</span>
          </div>
        ) : turn.error ? (
          <p className="text-sm leading-relaxed text-rose-300">{turn.answer}</p>
        ) : (
          <FormattedText text={activeContent} />
        )}
      </div>
    </article>
  );
}