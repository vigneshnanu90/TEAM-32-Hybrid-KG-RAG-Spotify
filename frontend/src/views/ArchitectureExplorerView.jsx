import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

/* ------------------------------------------------------------------ */
/* Config                                                              */
/* ------------------------------------------------------------------ */
const WIDTH = 900;
const HEIGHT = 560;
const MAX_NODES = 50; // matches the `limit` sent to /api/graph
const MIN_ZOOM = 0.35;
const MAX_ZOOM = 4;
const LABEL_ZOOM = 1.6; // show every label once zoomed past this
const ALPHA_MIN = 0.012;
const ALPHA_DECAY = 0.972;

// Colour per node type. Unknown types cycle through FALLBACK_COLORS.
const TYPE_COLORS = {
  Hub: "#34d399",
  Service: "#34d399",
  Component: "#a78bfa",
  Feature: "#a78bfa",
  Data: "#fbbf24",
  Database: "#fbbf24",
  API: "#38bdf8",
};
const FALLBACK_COLORS = ["#38bdf8", "#f472b6", "#fb923c", "#22d3ee", "#c084fc"];

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const nodeRadius = (degree) => 7 + Math.sqrt(degree) * 3.6;
const truncate = (text, max = 26) =>
  text.length > max ? `${text.slice(0, max - 1)}…` : text;

const typeOf = (node, degree) =>
  node.type ||
  node.group ||
  node.category ||
  node.kind ||
  (degree >= 3 ? "Hub" : "Component");

const edgeKey = (edge, i) => edge.id ?? `${edge.source}-${edge.relation}-${edge.target}-${i}`;

function svgPoint(svg, clientX, clientY) {
  const pt = svg.createSVGPoint();
  pt.x = clientX;
  pt.y = clientY;
  return pt.matrixTransform(svg.getScreenCTM().inverse());
}

function zoomAbout(t, p, nextK) {
  const k = clamp(nextK, MIN_ZOOM, MAX_ZOOM);
  return {
    k,
    x: p.x - ((p.x - t.x) * k) / t.k,
    y: p.y - ((p.y - t.y) * k) / t.k,
  };
}

/**
 * Splits the graph into connected groups and packs them as separate "islands"
 * (largest in the middle) so groups never pile on top of each other.
 */
function layoutIslands(nodes, edges) {
  const parent = new Map(nodes.map((n) => [n.id, n.id]));
  const find = (x) => {
    while (parent.get(x) !== x) {
      parent.set(x, parent.get(parent.get(x)));
      x = parent.get(x);
    }
    return x;
  };
  edges.forEach((e) => {
    if (parent.has(e.source) && parent.has(e.target)) {
      parent.set(find(e.source), find(e.target));
    }
  });

  const groups = new Map();
  nodes.forEach((n) => {
    const root = find(n.id);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(n);
  });

  const islands = [...groups.entries()]
    .map(([id, members]) => ({
      id,
      members: members.sort((a, b) => b.degree - a.degree),
      R: members.length === 1 ? 26 : 26 + 24 * Math.sqrt(members.length),
      ax: WIDTH / 2,
      ay: HEIGHT / 2,
    }))
    .sort((a, b) => b.members.length - a.members.length);

  const placed = [];
  islands.forEach((isl, idx) => {
    if (idx > 0) {
      let ang = 0;
      let rad = 0;
      for (let step = 0; step < 4000; step += 1) {
        const x = WIDTH / 2 + Math.cos(ang) * rad * 1.7; // wider than tall
        const y = HEIGHT / 2 + Math.sin(ang) * rad;
        isl.ax = x;
        isl.ay = y;
        if (placed.every((p) => Math.hypot(p.ax - x, p.ay - y) >= p.R + isl.R + 18)) {
          break;
        }
        ang += 0.5;
        rad += 1.2;
      }
    }
    placed.push(isl);
  });
  return islands;
}

/**
 * One step of a small force simulation (d3-force style):
 * repulsion between all nodes, springs along edges, light gravity,
 * and collision so circles never overlap.
 */
function tickSimulation(nodes, links, alpha) {
  for (let i = 0; i < nodes.length; i += 1) {
    for (let j = i + 1; j < nodes.length; j += 1) {
      const a = nodes[i];
      const b = nodes[j];
      if (a.comp !== b.comp) continue; // separate groups are kept apart by their anchors
      let dx = b.x - a.x;
      let dy = b.y - a.y;
      let d2 = dx * dx + dy * dy;
      if (d2 < 1) {
        dx = (i - j) * 0.5 + 0.1;
        dy = 0.1;
        d2 = dx * dx + dy * dy;
      }
      const d = Math.sqrt(d2);
      if (d < 460) {
        const k = (450 * alpha) / d2;
        a.vx -= dx * k;
        a.vy -= dy * k;
        b.vx += dx * k;
        b.vy += dy * k;
      }
    }
  }

  for (const { s, t } of links) {
    const dx = t.x - s.x;
    const dy = t.y - s.y;
    const d = Math.sqrt(dx * dx + dy * dy) || 1;
    const ideal = 70 + s.r + t.r + 5 * Math.sqrt(Math.max(s.degree, t.degree));
    const f = ((d - ideal) / d) * 0.3 * alpha;
    s.vx += dx * f;
    s.vy += dy * f;
    t.vx -= dx * f;
    t.vy -= dy * f;
  }

  for (const n of nodes) {
    n.vx += (n.ax - n.x) * 0.06 * alpha;
    n.vy += (n.ay - n.y) * 0.06 * alpha;
  }

  for (let i = 0; i < nodes.length; i += 1) {
    for (let j = i + 1; j < nodes.length; j += 1) {
      const a = nodes[i];
      const b = nodes[j];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const d = Math.sqrt(dx * dx + dy * dy) || 1;
      const minD = a.r + b.r + 30;
      if (d < minD) {
        const p = ((minD - d) / d) * 0.5;
        if (a.fx == null) {
          a.x -= dx * p;
          a.y -= dy * p;
        }
        if (b.fx == null) {
          b.x += dx * p;
          b.y += dy * p;
        }
      }
    }
  }

  for (const n of nodes) {
    if (n.fx != null) {
      n.x = n.fx;
      n.y = n.fy;
      n.vx = 0;
      n.vy = 0;
    } else {
      n.vx *= 0.6;
      n.vy *= 0.6;
      n.x += n.vx;
      n.y += n.vy;
    }
  }
}

/* ------------------------------------------------------------------ */
/* Component                                                           */
/* ------------------------------------------------------------------ */
export default function ArchitectureExplorerView({
  documents = [],
  onAskPrompt,
}) {
  const [filterText, setFilterText] = useState("");
  const [nodes, setNodes] = useState([]);
  const [edges, setEdges] = useState([]);
  const [simNodes, setSimNodes] = useState([]);
  const [selectedNode, setSelectedNode] = useState("");
  const [hoveredNode, setHoveredNode] = useState("");
  const [hiddenTypes, setHiddenTypes] = useState([]);
  const [transform, setTransform] = useState({ k: 1, x: 0, y: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [customQuestion, setCustomQuestion] = useState("");

  const svgRef = useRef(null);
  const simRef = useRef([]);
  const posRef = useRef(new Map());
  const alphaRef = useRef(0);
  const restartRef = useRef(() => {});
  const autoFitRef = useRef(true);
  const pointersRef = useRef(new Map());
  const gestureRef = useRef(null);
  const transformRef = useRef(transform);
  transformRef.current = transform;

  /* ---------- data loading ---------- */
  const loadGraph = useCallback(async (query = "") => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ limit: "50" });
      if (query.trim()) {
        params.set("q", query.trim());
      }
      const res = await fetch(`/api/graph?${params.toString()}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.detail || `Failed to load graph (${res.status})`);
      }

      const nextNodes = Array.isArray(data.nodes)
        ? data.nodes.slice(0, MAX_NODES)
        : [];
      const nodeIds = new Set(nextNodes.map((n) => n.id));
      const nextEdges = (Array.isArray(data.edges) ? data.edges : []).filter(
        (e) => nodeIds.has(e.source) && nodeIds.has(e.target)
      );

      const degree = {};
      nextEdges.forEach((e) => {
        degree[e.source] = (degree[e.source] || 0) + 1;
        degree[e.target] = (degree[e.target] || 0) + 1;
      });
      const busiest = [...nextNodes].sort(
        (a, b) => (degree[b.id] || 0) - (degree[a.id] || 0)
      )[0];

      autoFitRef.current = true;
      setNodes(nextNodes);
      setEdges(nextEdges);
      setSelectedNode((prev) =>
        prev && nextNodes.some((n) => n.id === prev) ? prev : busiest?.id || ""
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
    loadGraph(filterText);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documents.length, loadGraph]);

  /* ---------- derived graph data ---------- */
  const degreeMap = useMemo(() => {
    const map = {};
    edges.forEach((e) => {
      map[e.source] = (map[e.source] || 0) + 1;
      map[e.target] = (map[e.target] || 0) + 1;
    });
    return map;
  }, [edges]);

  const enrichedNodes = useMemo(
    () =>
      nodes.map((n) => {
        const degree = degreeMap[n.id] || 0;
        return {
          ...n,
          label: n.label ?? String(n.id),
          degree,
          type: typeOf(n, degree),
          r: nodeRadius(degree),
        };
      }),
    [nodes, degreeMap]
  );

  const typeList = useMemo(() => {
    const counts = {};
    enrichedNodes.forEach((n) => {
      counts[n.type] = (counts[n.type] || 0) + 1;
    });
    return Object.keys(counts)
      .sort()
      .map((type) => ({ type, count: counts[type] }));
  }, [enrichedNodes]);

  const colorOf = useMemo(() => {
    const map = {};
    let fallbackIdx = 0;
    typeList.forEach(({ type }) => {
      map[type] =
        TYPE_COLORS[type] ||
        FALLBACK_COLORS[fallbackIdx++ % FALLBACK_COLORS.length];
    });
    return (type) => map[type] || "#34d399";
  }, [typeList]);

  const visibleNodes = useMemo(
    () => enrichedNodes.filter((n) => !hiddenTypes.includes(n.type)),
    [enrichedNodes, hiddenTypes]
  );
  const visibleEdges = useMemo(() => {
    const ids = new Set(visibleNodes.map((n) => n.id));
    return edges.filter((e) => ids.has(e.source) && ids.has(e.target));
  }, [edges, visibleNodes]);

  const nodeById = useMemo(() => {
    const map = {};
    enrichedNodes.forEach((n) => {
      map[n.id] = n;
    });
    return map;
  }, [enrichedNodes]);

  const hubThreshold = useMemo(() => {
    const sorted = visibleNodes.map((n) => n.degree).sort((a, b) => b - a);
    return Math.max(3, sorted[Math.floor(sorted.length * 0.2)] ?? 3);
  }, [visibleNodes]);

  /* ---------- fit to screen ---------- */
  const fitToNodes = useCallback((list) => {
    if (!list.length) return;
    const pad = 70;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    list.forEach((n) => {
      minX = Math.min(minX, n.x - n.r);
      maxX = Math.max(maxX, n.x + n.r);
      minY = Math.min(minY, n.y - n.r);
      maxY = Math.max(maxY, n.y + n.r);
    });
    const bw = Math.max(maxX - minX, 1);
    const bh = Math.max(maxY - minY, 1);
    const k = clamp(
      Math.min((WIDTH - pad * 2) / bw, (HEIGHT - pad * 2) / bh),
      MIN_ZOOM,
      1.8
    );
    setTransform({
      k,
      x: WIDTH / 2 - ((minX + maxX) / 2) * k,
      y: HEIGHT / 2 - ((minY + maxY) / 2) * k,
    });
  }, []);

  /* ---------- force simulation ---------- */
  useEffect(() => {
    if (!visibleNodes.length) {
      simRef.current = [];
      setSimNodes([]);
      return undefined;
    }

    const prev = posRef.current;
    const sim = [];
    layoutIslands(visibleNodes, visibleEdges).forEach((isl, c) => {
      isl.members.forEach((node, i) => {
        const known = prev.get(node.id);
        const angle = i * 2.399963; // golden angle spiral: hubs start in the middle
        const radius = 24 * Math.sqrt(i + 0.5);
        sim.push({
          ...node,
          comp: c,
          ax: isl.ax,
          ay: isl.ay,
          x: known ? known.x : isl.ax + Math.cos(angle) * radius,
          y: known ? known.y : isl.ay + Math.sin(angle) * radius,
          vx: 0,
          vy: 0,
        });
      });
    });
    simRef.current = sim;

    const byId = new Map(sim.map((n) => [n.id, n]));
    const links = visibleEdges
      .map((e) => ({ s: byId.get(e.source), t: byId.get(e.target) }))
      .filter((l) => l.s && l.t);

    alphaRef.current = prev.size ? 0.5 : 1;
    let frame = null;
    let ticks = 0;

    const run = () => {
      const alpha = alphaRef.current;
      if (alpha < ALPHA_MIN) {
        frame = null;
        setSimNodes(sim.map((n) => ({ ...n })));
        if (autoFitRef.current) fitToNodes(sim);
        return;
      }
      tickSimulation(sim, links, alpha);
      alphaRef.current = alpha * ALPHA_DECAY;
      ticks += 1;
      sim.forEach((n) => posRef.current.set(n.id, { x: n.x, y: n.y }));
      setSimNodes(sim.map((n) => ({ ...n })));
      if (autoFitRef.current && ticks % 10 === 0) fitToNodes(sim);
      frame = requestAnimationFrame(run);
    };

    restartRef.current = (alpha = 0.35) => {
      alphaRef.current = Math.max(alphaRef.current, alpha);
      if (frame == null) frame = requestAnimationFrame(run);
    };

    frame = requestAnimationFrame(run);
    return () => {
      if (frame != null) cancelAnimationFrame(frame);
    };
  }, [visibleNodes, visibleEdges, fitToNodes]);

  /* ---------- zoom / pan / drag ---------- */
  const hasGraph = !loading && !error && nodes.length > 0;

  useEffect(() => {
    const el = svgRef.current;
    if (!el) return undefined;
    const onWheel = (e) => {
      e.preventDefault();
      autoFitRef.current = false;
      const p = svgPoint(el, e.clientX, e.clientY);
      const factor = Math.exp(-e.deltaY * 0.0015);
      setTransform((t) => zoomAbout(t, p, t.k * factor));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [hasGraph]);

  const zoomBy = (factor) => {
    autoFitRef.current = false;
    setTransform((t) =>
      zoomAbout(t, { x: WIDTH / 2, y: HEIGHT / 2 }, t.k * factor)
    );
  };

  const handlePointerDown = (e) => {
    const svg = svgRef.current;
    if (!svg) return;
    svg.setPointerCapture?.(e.pointerId);
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointersRef.current.size === 2) {
      const [a, b] = [...pointersRef.current.values()];
      gestureRef.current = {
        type: "pinch",
        startDist: Math.hypot(a.x - b.x, a.y - b.y) || 1,
        startT: transformRef.current,
      };
      autoFitRef.current = false;
      return;
    }

    const nodeEl = e.target.closest?.("[data-node-id]");
    gestureRef.current = {
      type: nodeEl ? "node" : "pan",
      id: nodeEl?.getAttribute("data-node-id") || null,
      startX: e.clientX,
      startY: e.clientY,
      lastX: e.clientX,
      lastY: e.clientY,
      moved: false,
    };
  };

  const handlePointerMove = (e) => {
    const svg = svgRef.current;
    const g = gestureRef.current;
    if (!svg || !g) return;
    if (pointersRef.current.has(e.pointerId)) {
      pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    }

    if (g.type === "pinch" && pointersRef.current.size >= 2) {
      const [a, b] = [...pointersRef.current.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      const mid = svgPoint(svg, (a.x + b.x) / 2, (a.y + b.y) / 2);
      const t0 = g.startT;
      setTransform(zoomAbout(t0, mid, (t0.k * dist) / g.startDist));
      return;
    }

    if (Math.hypot(e.clientX - g.startX, e.clientY - g.startY) > 4) {
      g.moved = true;
    }
    if (!g.moved) return;

    if (g.type === "node" && g.id) {
      const p = svgPoint(svg, e.clientX, e.clientY);
      const t = transformRef.current;
      const node = simRef.current.find((n) => n.id === g.id);
      if (node) {
        node.fx = (p.x - t.x) / t.k;
        node.fy = (p.y - t.y) / t.k;
        autoFitRef.current = false;
        restartRef.current(0.3);
      }
    } else if (g.type === "pan") {
      const scale = svg.getScreenCTM()?.a || 1;
      const dx = (e.clientX - g.lastX) / scale;
      const dy = (e.clientY - g.lastY) / scale;
      g.lastX = e.clientX;
      g.lastY = e.clientY;
      autoFitRef.current = false;
      setTransform((t) => ({ ...t, x: t.x + dx, y: t.y + dy }));
    }
  };

  const handlePointerUp = (e) => {
    pointersRef.current.delete(e.pointerId);
    const g = gestureRef.current;
    if (!g) return;
    if (g.type === "pinch") {
      if (pointersRef.current.size < 2) gestureRef.current = null;
      return;
    }
    if (g.type === "node" && g.id) {
      const node = simRef.current.find((n) => n.id === g.id);
      if (node) {
        node.fx = null;
        node.fy = null;
      }
      if (!g.moved) setSelectedNode(g.id);
    } else if (g.type === "pan" && !g.moved) {
      setSelectedNode("");
    }
    gestureRef.current = null;
  };

  /* ---------- selection, search, filters ---------- */
  const query = filterText.trim().toLowerCase();
  const matchIds = useMemo(() => {
    if (!query) return null;
    return new Set(
      visibleNodes
        .filter((n) => n.label.toLowerCase().includes(query))
        .map((n) => n.id)
    );
  }, [query, visibleNodes]);

  const connectedEdges = useMemo(
    () =>
      selectedNode
        ? visibleEdges.filter(
            (e) => e.source === selectedNode || e.target === selectedNode
          )
        : [],
    [visibleEdges, selectedNode]
  );

  const neighborIds = useMemo(() => {
    const ids = new Set(selectedNode ? [selectedNode] : []);
    connectedEdges.forEach((e) => {
      ids.add(e.source);
      ids.add(e.target);
    });
    return ids;
  }, [connectedEdges, selectedNode]);

  const topHubs = useMemo(
    () => [...enrichedNodes].sort((a, b) => b.degree - a.degree).slice(0, 6),
    [enrichedNodes]
  );

  const selected = selectedNode ? nodeById[selectedNode] : null;

  const toggleType = (type) =>
    setHiddenTypes((prev) =>
      prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type]
    );

  const handleSearchSubmit = (e) => {
    e.preventDefault();
    loadGraph(filterText);
  };

  const handleQuestionSubmit = (e) => {
    e.preventDefault();
    const q =
      customQuestion.trim() ||
      (selected
        ? `How does ${selected.label} connect to the rest of the architecture?`
        : "");
    if (!q || typeof onAskPrompt !== "function") return;
    onAskPrompt(q);
  };

  const positionMap = useMemo(() => {
    const map = {};
    simNodes.forEach((n) => {
      map[n.id] = n;
    });
    return map;
  }, [simNodes]);

  const labelScale = Math.min(1 / transform.k, 1.6);

  /* ---------- render ---------- */
  return (
    <div className="mx-auto max-w-6xl space-y-5 px-3 py-4 sm:px-6 sm:py-6">
      <div className="rounded-2xl border border-emerald-900/70 bg-[#081710]/95 p-4 shadow-lg sm:p-6">
        {/* header */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-base font-semibold text-white sm:text-lg">
              Live Knowledge Graph Architecture
            </h2>
            <p className="mt-0.5 text-xs text-emerald-200/75 sm:text-sm">
              Live Neo4j nodes and relationships synced with your uploaded PDFs.
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

        {/* toolbar: search + type filters */}
        <form
          onSubmit={handleSearchSubmit}
          className="mt-4 flex flex-col gap-2 sm:flex-row"
        >
          <input
            type="text"
            value={filterText}
            onChange={(e) => setFilterText(e.target.value)}
            placeholder="Search nodes, press Enter to query Neo4j"
            className="w-full rounded-xl border border-emerald-800/70 bg-[#07140e] px-3.5 py-2 text-sm text-white placeholder-emerald-200/45 focus:border-emerald-400 focus:outline-none"
          />
          <button
            type="submit"
            className="shrink-0 rounded-xl border border-emerald-700/70 bg-[#0b1d14] px-4 py-2 text-xs font-semibold text-emerald-200 transition hover:text-white"
          >
            Search graph
          </button>
        </form>

        {typeList.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {typeList.map(({ type, count }) => {
              const off = hiddenTypes.includes(type);
              return (
                <button
                  key={type}
                  type="button"
                  onClick={() => toggleType(type)}
                  aria-pressed={!off}
                  className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition ${
                    off
                      ? "border-emerald-900/60 text-emerald-200/40 line-through"
                      : "border-emerald-700/60 bg-[#0c2117] text-emerald-100 hover:border-emerald-400/70"
                  }`}
                >
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{ background: off ? "#2f4a3d" : colorOf(type) }}
                  />
                  {type} {count}
                </button>
              );
            })}
          </div>
        )}

        {loading ? (
          <div className="flex items-center gap-2 py-8 text-sm text-emerald-200/75">
            <span className="h-2 w-2 animate-ping rounded-full bg-emerald-400" />
            <span>Syncing live Neo4j graph...</span>
          </div>
        ) : error ? (
          <p className="mt-4 text-sm text-rose-300">{error}</p>
        ) : nodes.length === 0 ? (
          <div className="mt-4 rounded-xl border border-emerald-900/60 bg-[#07140e]/80 p-6 text-center text-sm text-emerald-200/70">
            No active PDF graph data. Upload a PDF to view live nodes and relationships.
          </div>
        ) : (
          <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
            {/* ---------- graph canvas ---------- */}
            <div className="relative overflow-hidden rounded-xl border border-emerald-900/70 bg-[#050e0b]">
              <svg
                ref={svgRef}
                viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
                className="h-[62vh] min-h-[380px] w-full cursor-grab touch-none select-none active:cursor-grabbing"
                role="img"
                aria-label="Live knowledge graph. Drag to pan, scroll to zoom, click a node to inspect it."
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerCancel={handlePointerUp}
              >
                <g
                  transform={`translate(${transform.x} ${transform.y}) scale(${transform.k})`}
                >
                  {/* edges */}
                  {visibleEdges.map((edge, i) => {
                    const p1 = positionMap[edge.source];
                    const p2 = positionMap[edge.target];
                    if (!p1 || !p2) return null;
                    const highlighted =
                      selectedNode &&
                      (edge.source === selectedNode ||
                        edge.target === selectedNode);
                    const dimmed =
                      (matchIds &&
                        !(matchIds.has(edge.source) || matchIds.has(edge.target))) ||
                      (!matchIds && selectedNode && !highlighted);
                    const midX = (p1.x + p2.x) / 2;
                    const midY = (p1.y + p2.y) / 2;
                    const relation = edge.relation || "";
                    const pillW = relation.length * 6.4 + 14;

                    return (
                      <g key={edgeKey(edge, i)}>
                        <line
                          x1={p1.x}
                          y1={p1.y}
                          x2={p2.x}
                          y2={p2.y}
                          stroke={highlighted ? "#34d399" : "#2a6a50"}
                          strokeWidth={(highlighted ? 2.4 : 1.2) / Math.sqrt(transform.k)}
                          strokeOpacity={dimmed ? 0.2 : highlighted ? 0.95 : 0.5}
                        />
                        {highlighted &&
                          relation &&
                          (transform.k >= 1.1 ||
                            connectedEdges.length <= 3 ||
                            hoveredNode === edge.source ||
                            hoveredNode === edge.target) && (
                          <g
                            transform={`translate(${midX} ${midY}) scale(${labelScale})`}
                          >
                            <rect
                              x={-pillW / 2}
                              y={-9}
                              width={pillW}
                              height={18}
                              rx={9}
                              fill="#2a2410"
                              stroke="#fbbf24"
                              strokeWidth="0.6"
                            />
                            <text
                              textAnchor="middle"
                              y="4"
                              fill="#fbbf24"
                              fontSize="11"
                              fontWeight="600"
                            >
                              {relation}
                            </text>
                          </g>
                        )}
                      </g>
                    );
                  })}

                  {/* nodes */}
                  {simNodes.map((node) => {
                    const isSelected = selectedNode === node.id;
                    const isNeighbor = neighborIds.has(node.id);
                    const isMatch = matchIds ? matchIds.has(node.id) : false;
                    const dimmed = matchIds
                      ? !isMatch
                      : Boolean(selectedNode) && !isNeighbor;
                    const isHub = node.degree >= hubThreshold;
                    const showLabel =
                      isSelected ||
                      isMatch ||
                      hoveredNode === node.id ||
                      (!matchIds && selectedNode && isNeighbor) ||
                      (!dimmed && isHub) ||
                      transform.k >= LABEL_ZOOM;
                    const color = colorOf(node.type);

                    return (
                      <g
                        key={node.id}
                        data-node-id={node.id}
                        transform={`translate(${node.x} ${node.y})`}
                        opacity={dimmed ? 0.38 : 1}
                        className="cursor-pointer"
                        onPointerEnter={() => setHoveredNode(node.id)}
                        onPointerLeave={() => setHoveredNode("")}
                      >
                        {isSelected && (
                          <circle
                            r={node.r + 7}
                            fill="none"
                            stroke={color}
                            strokeWidth="1.5"
                            strokeDasharray="4 3"
                          />
                        )}
                        <circle
                          r={node.r}
                          fill={isSelected ? color : `${color}33`}
                          stroke={color}
                          strokeWidth={isSelected ? 2.5 : 1.8}
                        />
                        {showLabel && (
                          <g
                            transform={`translate(0 ${node.r}) scale(${labelScale})`}
                            pointerEvents="none"
                          >
                            <text
                              y="16"
                              textAnchor="middle"
                              fill={isSelected ? "#ffffff" : "#d1fae5"}
                              fontSize="12"
                              fontWeight={isSelected || isHub ? "600" : "500"}
                              stroke="#050e0b"
                              strokeWidth="3.5"
                              paintOrder="stroke"
                            >
                              {truncate(node.label)}
                            </text>
                          </g>
                        )}
                      </g>
                    );
                  })}
                </g>
              </svg>

              <div className="pointer-events-none absolute left-3 top-3 text-[11px] text-emerald-200/50">
                Drag to pan · scroll or pinch to zoom · click a node
              </div>

              <div className="absolute bottom-3 right-3 flex flex-col gap-1.5">
                {[
                  { label: "Zoom in", text: "+", onClick: () => zoomBy(1.3) },
                  { label: "Zoom out", text: "−", onClick: () => zoomBy(1 / 1.3) },
                  {
                    label: "Fit graph to screen",
                    text: "⤢",
                    onClick: () => {
                      autoFitRef.current = true;
                      fitToNodes(simRef.current);
                    },
                  },
                ].map((btn) => (
                  <button
                    key={btn.label}
                    type="button"
                    aria-label={btn.label}
                    onClick={btn.onClick}
                    className="h-8 w-8 rounded-lg border border-emerald-800/70 bg-[#0b1d14]/95 text-sm font-semibold text-emerald-200 transition hover:border-emerald-400 hover:text-white"
                  >
                    {btn.text}
                  </button>
                ))}
              </div>
            </div>

            {/* ---------- inspector ---------- */}
            <aside className="flex min-w-0 flex-col gap-3 rounded-xl border border-emerald-900/60 bg-[#07140e]/85 p-3.5 lg:max-h-[62vh] lg:min-h-[380px]">
              {selected ? (
                <>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h3 className="break-words text-sm font-semibold text-white">
                        {selected.label}
                      </h3>
                      <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs">
                        <span
                          className="rounded-full px-2 py-0.5 font-medium"
                          style={{
                            background: `${colorOf(selected.type)}26`,
                            color: colorOf(selected.type),
                          }}
                        >
                          {selected.type}
                        </span>
                        <span className="text-emerald-200/60">
                          {selected.degree}{" "}
                          {selected.degree === 1 ? "connection" : "connections"}
                        </span>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setSelectedNode("")}
                      className="shrink-0 text-[11px] text-emerald-300 hover:underline"
                    >
                      Clear
                    </button>
                  </div>

                  <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
                    {connectedEdges.length === 0 && (
                      <p className="text-xs text-emerald-200/60">
                        This node has no visible relationships.
                      </p>
                    )}
                    {connectedEdges.map((edge, i) => {
                      const outgoing = edge.source === selected.id;
                      const otherId = outgoing ? edge.target : edge.source;
                      const other = nodeById[otherId];
                      return (
                        <button
                          key={edgeKey(edge, i)}
                          type="button"
                          onClick={() => setSelectedNode(otherId)}
                          className="w-full rounded-lg border border-emerald-900/60 bg-[#0b1d14] px-3 py-2 text-left text-xs transition hover:border-emerald-500/60"
                        >
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="rounded bg-amber-500/15 px-1.5 py-0.5 font-mono text-[11px] text-amber-300">
                              {edge.relation}
                            </span>
                            <span className="text-emerald-200/60">
                              {outgoing ? "to" : "from"}
                            </span>
                            <span className="font-medium text-white">
                              {other?.label ?? otherId}
                            </span>
                          </div>
                          {edge.page && (
                            <div className="mt-1 text-[11px] text-emerald-200/55">
                              Source: p.{edge.page}
                            </div>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </>
              ) : (
                <div className="min-h-0 flex-1 space-y-2 overflow-y-auto">
                  <h3 className="text-sm font-semibold text-white">
                    Select a node
                  </h3>
                  <p className="text-xs text-emerald-200/60">
                    Click a node to see its relationships, or start with the
                    most connected components.
                  </p>
                  <div className="flex flex-col gap-1.5 pt-1">
                    {topHubs.map((n) => (
                      <button
                        key={n.id}
                        type="button"
                        onClick={() => setSelectedNode(n.id)}
                        className="flex items-center justify-between gap-2 rounded-lg border border-emerald-900/60 bg-[#0b1d14] px-3 py-2 text-left text-xs text-emerald-100 transition hover:border-emerald-500/60"
                      >
                        <span className="flex min-w-0 items-center gap-2">
                          <span
                            className="h-2 w-2 shrink-0 rounded-full"
                            style={{ background: colorOf(n.type) }}
                          />
                          <span className="truncate">{n.label}</span>
                        </span>
                        <span className="shrink-0 text-emerald-200/50">
                          {n.degree}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <form
                onSubmit={handleQuestionSubmit}
                className="space-y-2 border-t border-emerald-900/60 pt-3"
              >
                <input
                  type="text"
                  value={customQuestion}
                  onChange={(e) => setCustomQuestion(e.target.value)}
                  placeholder={
                    selected
                      ? `Ask about ${truncate(selected.label, 22)}`
                      : "Ask about these connections"
                  }
                  aria-label="Question to send to chat"
                  className="w-full rounded-xl border border-emerald-800/70 bg-[#07140e] px-3 py-2 text-sm text-white placeholder-emerald-200/45 focus:border-emerald-400 focus:outline-none"
                />
                <button
                  type="submit"
                  className="w-full rounded-xl bg-emerald-400 px-4 py-2 text-xs font-semibold text-slate-950 transition hover:bg-emerald-300"
                >
                  {selected ? "Ask AI about this node" : "Ask in Chat"}
                </button>
              </form>
            </aside>
          </div>
        )}
      </div>
    </div>
  );
}
