import React from "react";

export default function RetrievalTracePanel({ trace, compact = false }) {
  const vectorVal = Math.max(0, Math.min(1, Number(trace?.vectorScore ?? 0)));
  const bm25Val = Math.max(0, Math.min(1, Number(trace?.bm25Score ?? 0)));
  const chunksCount = Number(trace?.chunksRetrieved ?? 0);
  const triplesCount = Number(trace?.triplesRetrieved ?? 0);
  const hops = Number(trace?.hops ?? 0);
  const triples = Array.isArray(trace?.triples) ? trace.triples : [];
  const topMatches = Array.isArray(trace?.topMatches) ? trace.topMatches : [];
  const topTriple = triples[0] || null;

  return (
    <div
      className={`space-y-3 rounded-2xl border border-emerald-900/70 bg-[#081710]/95 ${
        compact ? "p-3.5" : "p-4"
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-emerald-200">
          Retrieval trace
        </h2>
        <span className="rounded bg-emerald-950/90 px-1.5 py-0.5 font-mono text-[10px] text-emerald-300">
          {chunksCount} chunks • {triplesCount} edges
        </span>
      </div>

      <div className="space-y-1">
        <div className="flex items-center justify-between text-xs">
          <span className="text-emerald-200/80">Vector (FAISS)</span>
          <span className="font-mono text-emerald-300">{vectorVal.toFixed(2)}</span>
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-emerald-950">
          <div
            className="h-full rounded-full bg-emerald-400 transition-all duration-300"
            style={{ width: `${Math.round(vectorVal * 100)}%` }}
          />
        </div>
      </div>

      <div className="space-y-1">
        <div className="flex items-center justify-between text-xs">
          <span className="text-emerald-200/80">BM25 (Lexical)</span>
          <span className="font-mono text-amber-300">{bm25Val.toFixed(2)}</span>
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-emerald-950">
          <div
            className="h-full rounded-full bg-amber-400 transition-all duration-300"
            style={{ width: `${Math.round(bm25Val * 100)}%` }}
          />
        </div>
      </div>

      {topMatches.length > 0 && (
        <div className="space-y-1.5 border-t border-emerald-900/60 pt-2.5">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-emerald-300/80">
            Vector + BM25 Hits
          </div>
          <div className="space-y-1">
            {topMatches.slice(0, 2).map((m, idx) => (
              <div
                key={`${m.filename}-${m.page}-${idx}`}
                className="rounded-lg bg-[#0b1d14] px-2.5 py-1.5 text-[11px] text-emerald-100/90"
              >
                <div className="font-medium text-emerald-300">
                  {m.filename || "Source"} {m.page ? `(p.${m.page})` : ""}
                </div>
                {m.preview && (
                  <p className="mt-0.5 line-clamp-2 text-[10px] text-emerald-200/65">
                    {m.preview}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="space-y-1.5 border-t border-emerald-900/60 pt-2.5">
        <div className="flex items-center justify-between text-xs font-medium text-emerald-200/80">
          <span>Neo4j Graph</span>
          {hops > 0 && (
            <span className="font-mono text-[10px] text-amber-300">
              {hops} {hops === 1 ? "hop" : "hops"}
            </span>
          )}
        </div>

        <div className="flex flex-col items-center gap-1 py-1">
          <span className="max-w-full truncate rounded-full border border-emerald-500/60 bg-emerald-950 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-200">
            {topTriple?.subject || "No entity match"}
          </span>
          <span className="h-2 w-px bg-emerald-700/70" />
          <span className="rounded bg-amber-500/15 px-2 py-0.5 font-mono text-[10px] text-amber-300">
            {topTriple?.relation || "RELATES"}
          </span>
          <span className="h-2 w-px bg-emerald-700/70" />
          <span className="max-w-full truncate rounded-full border border-emerald-700/60 bg-[#0b1d14] px-2.5 py-0.5 text-[11px] text-emerald-200/85">
            {topTriple?.object || "No target node"}
          </span>
        </div>
      </div>
    </div>
  );
}