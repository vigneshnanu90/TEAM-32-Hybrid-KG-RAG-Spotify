import React, { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import ForceGraph2D from "react-force-graph-2d";
import {
  Search,
  Share2,
  Trophy,
  Database,
  User,
  ArrowRight,
  Maximize2,
  X,
  FileText,
  Sparkles,
} from "lucide-react";

function extractVectorTags(answer = "", sources = []) {
  const tags = new Set();
  (sources || []).forEach((s) => tags.add(s));

  const keywords = [
    "Next.js",
    "React",
    "TypeScript",
    "Tailwind",
    "Zustand",
    "HLS.js",
    "Node.js",
    "NestJS",
    "Kafka",
    "gRPC",
    "PostgreSQL",
    "Redis",
    "Elasticsearch",
    "OpenSearch",
    "ClickHouse",
    "Docker",
    "Kubernetes",
    "Prometheus",
    "Grafana",
    "OpenTelemetry",
  ];
  keywords.forEach((kw) => {
    if (answer.toLowerCase().includes(kw.toLowerCase())) {
      tags.add(kw);
    }
  });

  return Array.from(tags).slice(0, 6);
}

function buildGraphData(triples = []) {
  const nodesMap = new Map();
  const links = [];

  triples.forEach((t, idx) => {
    const src = (t.subject || "").trim();
    const tgt = (t.object || "").trim();
    const rel = (t.relation || "RELATED_TO").trim();
    if (!src || !tgt) return;

    if (!nodesMap.has(src)) {
      nodesMap.set(src, { id: src, label: src });
    }
    if (!nodesMap.has(tgt)) {
      nodesMap.set(tgt, { id: tgt, label: tgt });
    }
    links.push({
      id: `${idx}-${src}-${tgt}`,
      source: src,
      target: tgt,
      label: rel,
      page: t.page,
    });
  });

  return { nodes: Array.from(nodesMap.values()), links };
}

function GraphModal({ isOpen, onClose, triples, graphData }) {
  const fgRef = useRef(null);

  useEffect(() => {
    if (isOpen && fgRef.current) {
      fgRef.current.d3Force("charge")?.strength(-320);
      fgRef.current.d3Force("link")?.distance(150);
    }
  }, [isOpen, graphData]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-4xl bg-[#121212] border border-white/15 rounded-2xl overflow-hidden shadow-2xl">
        <div className="px-5 py-3.5 border-b border-white/10 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Share2 className="w-4 h-4 text-[#1DB954]" />
            <h3 className="text-sm font-bold text-white">
              Knowledge Graph Explorer ({triples.length} relationships)
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-white/10 transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="h-[420px] w-full bg-[#090d0b]">
          <ForceGraph2D
            ref={fgRef}
            graphData={graphData}
            width={860}
            height={420}
            backgroundColor="#090d0b"
            linkDirectionalArrowLength={6}
            linkDirectionalArrowRelPos={1}
            linkCanvasObject={(link, ctx, globalScale) => {
              const s = link.source;
              const t = link.target;
              if (
                typeof s !== "object" ||
                typeof t !== "object" ||
                s.x == null ||
                t.x == null
              ) {
                return;
              }
              ctx.save();
              ctx.strokeStyle = "rgba(29, 185, 84, 0.45)";
              ctx.lineWidth = 1.5 / globalScale;
              ctx.beginPath();
              ctx.moveTo(s.x, s.y);
              ctx.lineTo(t.x, t.y);
              ctx.stroke();

              const midX = (s.x + t.x) / 2;
              const midY = (s.y + t.y) / 2;
              const fontSize = Math.max(9, 11 / globalScale);
              ctx.font = `600 ${fontSize}px Inter, sans-serif`;
              const textW = ctx.measureText(link.label || "").width + 10;
              const boxH = fontSize + 6;

              ctx.fillStyle = "#142219";
              ctx.fillRect(midX - textW / 2, midY - boxH / 2, textW, boxH);
              ctx.fillStyle = "#86efac";
              ctx.textAlign = "center";
              ctx.textBaseline = "middle";
              ctx.fillText(link.label || "", midX, midY);
              ctx.restore();
            }}
            nodeCanvasObject={(node, ctx, globalScale) => {
              if (node.x == null || node.y == null) return;
              const label = node.label || "";
              const fontSize = Math.max(10, 12 / globalScale);
              ctx.save();
              ctx.font = `600 ${fontSize}px Inter, sans-serif`;
              const padX = 10;
              const w = ctx.measureText(label).width + padX * 2;
              const h = fontSize + 10;

              ctx.fillStyle = "#181818";
              ctx.strokeStyle = "#1DB954";
              ctx.lineWidth = 1.5 / globalScale;
              ctx.beginPath();
              ctx.roundRect(node.x - w / 2, node.y - h / 2, w, h, 8);
              ctx.fill();
              ctx.stroke();

              ctx.fillStyle = "#ffffff";
              ctx.textAlign = "center";
              ctx.textBaseline = "middle";
              ctx.fillText(label, node.x, node.y);
              ctx.restore();
            }}
          />
        </div>
      </div>
    </div>
  );
}

export default function ComparisonChatTurn({ turn }) {
  const [modalOpen, setModalOpen] = useState(false);

  const triples = turn.graph_section?.triples || [];
  const graphData = useMemo(() => buildGraphData(triples), [triples]);
  const vectorTags = useMemo(
    () =>
      extractVectorTags(
        turn.vector_section?.answer || "",
        turn.vector_section?.sources || []
      ),
    [turn.vector_section]
  );

  if (turn.role === "user") {
    return (
      <div className="flex items-center justify-end gap-2.5">
        <div className="max-w-xl bg-[#242424] border border-white/10 rounded-2xl rounded-br-sm px-4 py-2.5">
          <div className="flex items-center justify-end gap-2 mb-0.5">
            <span className="text-[10px] text-zinc-400">{turn.timestamp}</span>
          </div>
          <p className="text-sm text-white leading-relaxed">{turn.text}</p>
        </div>
        <div className="w-8 h-8 rounded-full bg-[#282828] border border-white/10 flex items-center justify-center text-zinc-300 shrink-0">
          <User className="w-4 h-4" />
        </div>
      </div>
    );
  }

  if (turn.blocked) {
    return (
      <div className="flex items-start gap-2.5">
        <div className="w-8 h-8 rounded-full bg-[#1DB954]/20 border border-[#1DB954]/40 flex items-center justify-center text-xs font-bold text-[#1ed760] shrink-0">
          AI
        </div>
        <div className="max-w-2xl bg-amber-950/30 border border-amber-700/50 rounded-2xl px-4 py-3 text-sm text-amber-200">
          {turn.guardrail_reason}
        </div>
      </div>
    );
  }

  const { best_answer, comparison_section, vector_section, graph_section } = turn;

  return (
    <div className="flex items-start gap-2.5">
      <div className="w-8 h-8 rounded-full bg-[#1DB954]/20 border border-[#1DB954]/50 flex items-center justify-center text-xs font-bold text-[#1ed760] shrink-0 mt-1">
        AI
      </div>

      <div className="flex-1 min-w-0 space-y-3">
        {/* 1. Best Recommended Answer Card */}
        <div className="rounded-2xl bg-[#181818] border border-[#1DB954]/50 p-4 space-y-2.5 shadow-lg">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Trophy className="w-4 h-4 text-[#1DB954]" />
              <h3 className="text-xs font-bold uppercase tracking-wider text-[#1ed760]">
                Best Recommended Answer
              </h3>
            </div>
            {comparison_section?.winner && (
              <span className="text-[11px] font-semibold px-2.5 py-0.5 rounded-full bg-[#1DB954]/15 text-[#4ade80] border border-[#1DB954]/30">
                Winner: {comparison_section.winner}
              </span>
            )}
          </div>

          <div className="prose prose-invert prose-sm max-w-none text-zinc-100 prose-p:my-1.5 prose-ul:my-1.5 prose-li:my-0.5 prose-headings:text-white prose-headings:text-sm prose-headings:mt-2.5 prose-headings:mb-1">
            <ReactMarkdown>{best_answer || ""}</ReactMarkdown>
          </div>

          {comparison_section?.comparison && (
            <div className="pt-2.5 border-t border-white/10 flex items-start gap-2 text-xs text-zinc-300">
              <Sparkles className="w-3.5 h-3.5 text-[#1DB954] shrink-0 mt-0.5" />
              <p>
                <span className="font-semibold text-white">Why this won: </span>
                {comparison_section.comparison}
              </p>
            </div>
          )}
        </div>

        {/* 2. Two-Column Comparison: Vector DB + BM25 vs. Knowledge Graph */}
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
          {/* Vector DB + BM25 Card */}
          <div className="rounded-2xl bg-[#181818] border border-white/10 p-4 flex flex-col justify-between space-y-3">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Search className="w-4 h-4 text-sky-400" />
                  <h4 className="text-xs font-bold uppercase tracking-wider text-sky-300">
                    Vector DB + BM25
                  </h4>
                </div>
                <span className="inline-flex items-center gap-1 text-[11px] text-zinc-400">
                  <Database className="w-3 h-3 text-sky-400" />
                  {vector_section?.chunks_retrieved ?? 0} chunks
                </span>
              </div>

              <div className="prose prose-invert prose-xs max-w-none text-zinc-200 prose-p:my-1 prose-ul:my-1 prose-li:my-0.5 prose-headings:text-white prose-headings:text-xs prose-headings:mt-2 prose-headings:mb-1">
                <ReactMarkdown>{vector_section?.answer || ""}</ReactMarkdown>
              </div>
            </div>

            {vectorTags.length > 0 && (
              <div className="pt-2.5 border-t border-white/10 space-y-1.5">
                <div className="flex items-center gap-1.5 text-[11px] text-zinc-400">
                  <FileText className="w-3 h-3 text-sky-400" />
                  <span>Sources &amp; Matched Terms</span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {vectorTags.map((tag) => (
                    <span
                      key={tag}
                      className="text-[11px] px-2 py-0.5 rounded-md bg-sky-950/50 text-sky-200 border border-sky-700/40"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Knowledge Graph Card (Clean Relationship Flow + Expandable Canvas) */}
          <div className="rounded-2xl bg-[#181818] border border-white/10 p-4 flex flex-col justify-between space-y-3">
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Share2 className="w-4 h-4 text-violet-400" />
                  <h4 className="text-xs font-bold uppercase tracking-wider text-violet-300">
                    Knowledge Graph
                  </h4>
                </div>

                {triples.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setModalOpen(true)}
                    className="inline-flex items-center gap-1 text-[11px] font-medium px-2.5 py-1 rounded-lg bg-white/10 hover:bg-white/15 text-zinc-200 transition"
                  >
                    <Maximize2 className="w-3 h-3 text-[#1DB954]" />
                    <span>Expand Graph</span>
                  </button>
                )}
              </div>

              <div className="prose prose-invert prose-xs max-w-none text-zinc-200 prose-p:my-1 prose-ul:my-1 prose-li:my-0.5 prose-headings:text-white prose-headings:text-xs prose-headings:mt-2 prose-headings:mb-1">
                <ReactMarkdown>{graph_section?.answer || ""}</ReactMarkdown>
              </div>
            </div>

            {/* Clean Visual Triple Flow Cards */}
            <div className="pt-2.5 border-t border-white/10 space-y-1.5">
              <div className="flex items-center justify-between text-[11px] text-zinc-400">
                <span>Extracted Entity Relations ({triples.length})</span>
                {triples.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setModalOpen(true)}
                    className="text-[#1ed760] hover:underline"
                  >
                    Open node canvas
                  </button>
                )}
              </div>

              {triples.length === 0 ? (
                <p className="text-[11px] text-zinc-500">
                  No direct graph relationships matched this query.
                </p>
              ) : (
                <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
                  {triples.slice(0, 6).map((t, i) => (
                    <div
                      key={i}
                      className="flex flex-wrap items-center gap-1.5 text-[11px] bg-[#121212] border border-white/5 rounded-lg px-2.5 py-1.5"
                    >
                      <span className="font-semibold text-white bg-white/10 px-2 py-0.5 rounded">
                        {t.subject}
                      </span>
                      <span className="inline-flex items-center gap-1 text-violet-300 font-mono text-[10px]">
                        <ArrowRight className="w-3 h-3" />
                        {t.relation}
                        <ArrowRight className="w-3 h-3" />
                      </span>
                      <span className="font-semibold text-[#4ade80] bg-[#1DB954]/10 px-2 py-0.5 rounded">
                        {t.object}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <GraphModal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
        triples={triples}
        graphData={graphData}
      />
    </div>
  );
}