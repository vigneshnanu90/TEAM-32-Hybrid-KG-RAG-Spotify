import React, { useCallback, useEffect, useMemo, useState } from "react";

function computeNodePositions(nodes, width = 640, height = 300) {
  if (!nodes.length) return {};
  if (nodes.length === 1) {
    return { [nodes[0].id]: { x: width / 2, y: height / 2 } };
  }

  const center = nodes[0];
  const others = nodes.slice(1);
  const positions = {
    [center.id]: { x: width / 2, y: height / 2 },
  };

  const radiusX = Math.max(110, width * 0.34);
  const radiusY = Math.max(75, height * 0.34);

  others.forEach((node, idx) => {
    const angle = (2 * Math.PI * idx) / others.length - Math.PI / 2;
    positions[node.id] = {
      x: width / 2 + radiusX * Math.cos(angle),
      y: height / 2 + radiusY * Math.sin(angle),
    };
  });

  return positions;
}

export default function ArchitectureExplorerView({ onAskPrompt }) {
  const [filterText, setFilterText] = useState("");
  const [nodes, setNodes] = useState([]);
  const [edges, setEdges] = useState([]);
  const [selectedNode, setSelectedNode] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [customQuestion, setCustomQuestion] = useState("");

  const loadGraph = useCallback(async (query = "") => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ limit: "30" });
      if (query.trim()) {
        params.set("q", query.trim());
      }
      const res = await fetch(`/api/graph?${params.toString()}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.detail || `Failed to load graph (${res.status})`);
      }
      const nextNodes = Array.isArray(data.nodes) ? data.nodes.slice(0, 18) : [];
      const nodeIds = new Set(nextNodes.map((n) => n.id));
      const nextEdges = (Array.isArray(data.edges) ? data.edges : []).filter(
        (e) => nodeIds.has(e.source) && nodeIds.has(e.target)
      );
      setNodes(nextNodes);
      setEdges(nextEdges);
      setSelectedNode((prev) =>
        prev && nextNodes.some((n) => n.id === prev) ? prev : nextNodes[0]?.id || ""
      );
    } catch (err) {
      setError(err.message || "Unable to fetch live graph data.");
      setNodes([]);
      setEdges([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadGraph("");
  }, [loadGraph]);

  const positions = useMemo(() => computeNodePositions(nodes, 640, 300), [nodes]);

  const connectedEdges = useMemo(() => {
    if (!selectedNode) return edges;
    return edges.filter(
      (e) => e.source === selectedNode || e.target === selectedNode
    );
  }, [edges, selectedNode]);

  const connectedNodeIds = useMemo(() => {
    if (!selectedNode) return new Set();
    const ids = new Set([selectedNode]);
    connectedEdges.forEach((e) => {
      ids.add(e.source);
      ids.add(e.target);
    });
    return ids;
  }, [connectedEdges, selectedNode]);

  const handleSearchSubmit = (e) => {
    e.preventDefault();
    loadGraph(filterText);
  };

  const handleQuestionSubmit = (e) => {
    e.preventDefault();
    const q =
      customQuestion.trim() ||
      (selectedNode
        ? `How does ${selectedNode} connect to the rest of the architecture?`
        : "");
    if (!q || typeof onAskPrompt !== "function") return;
    onAskPrompt(q);
  };

  return (
    <div className="mx-auto max-w-4xl space-y-5 px-3 py-4 sm:px-6 sm:py-6">
      <div className="rounded-2xl border border-emerald-900/70 bg-[#081710]/95 p-4 shadow-lg sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-base font-semibold text-white sm:text-lg">
              Live Knowledge Graph Architecture
            </h2>
            <p className="mt-0.5 text-xs text-emerald-200/75 sm:text-sm">
              Interactive Neo4j nodes and relationships from your indexed sources.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="rounded-full border border-emerald-700/60 bg-emerald-950/90 px-2.5 py-1 font-medium text-emerald-300">
              {nodes.length} Nodes
            </span>
            <span className="rounded-full border border-amber-700/50 bg-amber-950/70 px-2.5 py-1 font-medium text-amber-300">
              {edges.length} Edges
            </span>
            <button
              type="button"
              onClick={() => loadGraph(filterText)}
              className="rounded-lg border border-emerald-700/70 bg-[#0b1d14] px-3 py-1 font-medium text-emerald-200 transition hover:text-white"
            >
              Refresh
            </button>
          </div>
        </div>

        <form
          onSubmit={handleSearchSubmit}
          className="mt-4 flex flex-col gap-2 sm:flex-row"
        >
          <input
            type="text"
            value={filterText}
            onChange={(e) => setFilterText(e.target.value)}
            placeholder="Filter nodes or relationships (e.g., Next.js, API, database)..."
            className="w-full rounded-xl border border-emerald-800/70 bg-[#07140e] px-3.5 py-2 text-sm text-white placeholder-emerald-200/45 focus:border-emerald-400 focus:outline-none"
          />
          <button
            type="submit"
            className="shrink-0 rounded-xl bg-emerald-400 px-4 py-2 text-xs font-semibold text-slate-950 transition hover:bg-emerald-300"
          >
            Filter Graph
          </button>
        </form>

        {loading ? (
          <div className="flex items-center gap-2 py-8 text-sm text-emerald-200/75">
            <span className="h-2 w-2 animate-ping rounded-full bg-emerald-400" />
            <span>Loading live Neo4j graph...</span>
          </div>
        ) : error ? (
          <p className="mt-4 text-sm text-rose-300">{error}</p>
        ) : nodes.length === 0 ? (
          <div className="mt-4 rounded-xl border border-emerald-900/60 bg-[#07140e]/80 p-5 text-center text-sm text-emerald-200/70">
            No graph nodes found yet. Upload a PDF in Indexed PDFs to populate Neo4j triples.
          </div>
        ) : (
          <>
            <div className="mt-4 overflow-hidden rounded-xl border border-emerald-900/70 bg-[#05100b] p-2">
              <svg
                viewBox="0 0 640 300"
                className="h-60 w-full sm:h-72"
                role="img"
                aria-label="Interactive Knowledge Graph"
              >
                {edges.map((edge) => {
                  const p1 = positions[edge.source];
                  const p2 = positions[edge.target];
                  if (!p1 || !p2) return null;
                  const highlighted =
                    selectedNode &&
                    (edge.source === selectedNode || edge.target === selectedNode);

                  return (
                    <line
                      key={edge.id}
                      x1={p1.x}
                      y1={p1.y}
                      x2={p2.x}
                      y2={p2.y}
                      stroke={highlighted ? "#34d399" : "#1f4d38"}
                      strokeWidth={highlighted ? 2.2 : 1.1}
                      strokeOpacity={selectedNode ? (highlighted ? 0.95 : 0.25) : 0.65}
                    />
                  );
                })}

                {nodes.map((node) => {
                  const pt = positions[node.id];
                  if (!pt) return null;
                  const isSelected = selectedNode === node.id;
                  const isNeighbor = connectedNodeIds.has(node.id);
                  const dimmed = Boolean(selectedNode) && !isNeighbor;
                  const shortLabel =
                    node.label.length > 16
                      ? `${node.label.slice(0, 15)}…`
                      : node.label;

                  return (
                    <g
                      key={node.id}
                      transform={`translate(${pt.x}, ${pt.y})`}
                      onClick={() => setSelectedNode(node.id)}
                      className="cursor-pointer"
                      opacity={dimmed ? 0.35 : 1}
                    >
                      {isSelected && (
                        <circle
                          r="22"
                          fill="none"
                          stroke="#34d399"
                          strokeWidth="1.5"
                          strokeDasharray="3 2"
                        />
                      )}
                      <circle
                        r={isSelected ? 15 : 12}
                        fill={isSelected ? "#34d399" : isNeighbor ? "#fbbf24" : "#0d291c"}
                        stroke={isSelected ? "#a7f3d0" : "#34d399"}
                        strokeWidth="1.5"
                      />
                      <text
                        y="26"
                        textAnchor="middle"
                        fill={isSelected ? "#ffffff" : "#d1fae5"}
                        fontSize="10"
                        fontWeight={isSelected ? "700" : "500"}
                      >
                        {shortLabel}
                      </text>
                    </g>
                  );
                })}
              </svg>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="space-y-2.5 rounded-xl border border-emerald-900/60 bg-[#07140e]/85 p-3.5">
                <div className="text-xs font-semibold uppercase tracking-wider text-emerald-300/80">
                  Architecture Nodes
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {nodes.map((node) => {
                    const active = selectedNode === node.id;
                    return (
                      <button
                        key={node.id}
                        type="button"
                        onClick={() => setSelectedNode(node.id)}
                        className={`rounded-full px-3 py-1 text-xs font-medium transition ${
                          active
                            ? "bg-emerald-400 text-slate-950"
                            : "border border-emerald-800/60 bg-[#0c2117] text-emerald-100 hover:border-emerald-500/60"
                        }`}
                      >
                        {node.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="space-y-2.5 rounded-xl border border-emerald-900/60 bg-[#07140e]/85 p-3.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold uppercase tracking-wider text-emerald-300/80">
                    Relationships {selectedNode ? `for ${selectedNode}` : ""}
                  </span>
                  {selectedNode && (
                    <button
                      type="button"
                      onClick={() => setSelectedNode("")}
                      className="text-[11px] text-emerald-300 hover:underline"
                    >
                      Show all
                    </button>
                  )}
                </div>

                <div className="max-h-56 space-y-2 overflow-y-auto pr-1">
                  {connectedEdges.map((edge) => (
                    <div
                      key={edge.id}
                      className="rounded-lg border border-emerald-900/60 bg-[#0b1d14] px-3 py-2 text-xs"
                    >
                      <div className="flex flex-wrap items-center gap-1.5 font-medium text-white">
                        <span className="text-emerald-300">{edge.source}</span>
                        <span className="rounded bg-amber-500/15 px-1.5 py-0.5 font-mono text-[10px] text-amber-300">
                          {edge.relation}
                        </span>
                        <span className="text-emerald-200">{edge.target}</span>
                      </div>
                      {edge.page && (
                        <div className="mt-1 text-[11px] text-emerald-200/55">
                          Source page: p.{edge.page}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </>
        )}

        <form
          onSubmit={handleQuestionSubmit}
          className="mt-5 border-t border-emerald-900/60 pt-4"
        >
          <label className="block text-xs font-medium text-emerald-200/80">
            Ask about {selectedNode ? `"${selectedNode}"` : "the architecture"} in Chat
          </label>
          <div className="mt-2 flex flex-col gap-2 sm:flex-row">
            <input
              type="text"
              value={customQuestion}
              onChange={(e) => setCustomQuestion(e.target.value)}
              placeholder={
                selectedNode
                  ? `How does ${selectedNode} interact with other components?`
                  : "Ask a question about these graph connections..."
              }
              className="w-full rounded-xl border border-emerald-800/70 bg-[#07140e] px-3.5 py-2 text-sm text-white placeholder-emerald-200/45 focus:border-emerald-400 focus:outline-none"
            />
            <button
              type="submit"
              className="shrink-0 rounded-xl bg-emerald-400 px-4 py-2 text-xs font-semibold text-slate-950 transition hover:bg-emerald-300"
            >
              Ask in Chat
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}