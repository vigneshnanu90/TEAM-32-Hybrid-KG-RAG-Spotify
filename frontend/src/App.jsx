import React, { useEffect, useRef, useState } from "react";
import {
  Send,
  Loader2,
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Volume2,
  Layers,
  Server,
  HardDrive,
  Sparkles,
} from "lucide-react";
import PdfSidebar from "./components/PdfSidebar";
import ComparisonChatTurn from "./components/ComparisonChatTurn";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "";

const QUICK_PROMPTS = [
  "What is the Tech Stack Overview?",
  "List all 17 microservices and their roles",
  "How is data stored across PostgreSQL, Redis, Elasticsearch, and ClickHouse?",
  "What are the main Frontend routes and global UI components?",
];

const ARCHITECTURE_CARDS = [
  {
    title: "Frontend Stack",
    subtitle: "Next.js • React + TS • Tailwind • Zustand • HLS.js",
    icon: Layers,
  },
  {
    title: "Backend & Bus",
    subtitle: "Node.js + TS • NestJS • REST & gRPC / Kafka • API Gateway",
    icon: Server,
  },
  {
    title: "Databases & CDN",
    subtitle: "PostgreSQL • Redis • OpenSearch • ClickHouse • S3 + CDN",
    icon: HardDrive,
  },
];

export default function App() {
  const [activeNav, setActiveNav] = useState("chat");
  const [documents, setDocuments] = useState([]);
  const [turns, setTurns] = useState([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [playing, setPlaying] = useState(true);
  const endRef = useRef(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [turns, sending]);

  const submitQuery = async (questionText) => {
    const text = questionText.trim();
    if (!text || sending) return;

    const timestamp = new Date().toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });

    setActiveNav("chat");
    setTurns((prev) => [
      ...prev,
      { id: `u-${Date.now()}`, role: "user", timestamp, text },
    ]);
    setInput("");
    setSending(true);

    try {
      const res = await fetch(`${API_BASE_URL}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: text, session_id: "spotify-arch-rag" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Request failed.");

      if (data.blocked) {
        setTurns((prev) => [
          ...prev,
          {
            id: `a-${Date.now()}`,
            role: "assistant",
            blocked: true,
            guardrail_reason: data.guardrail_reason,
          },
        ]);
      } else {
        setTurns((prev) => [
          ...prev,
          {
            id: `a-${Date.now()}`,
            role: "assistant",
            best_answer: data.comparison_section?.best_answer || "",
            comparison_section: data.comparison_section,
            vector_section: data.vector_section,
            graph_section: data.graph_section,
          },
        ]);
      }
    } catch (err) {
      setTurns((prev) => [
        ...prev,
        {
          id: `a-${Date.now()}`,
          role: "assistant",
          blocked: true,
          guardrail_reason:
            err.message || "Could not reach FastAPI server on port 8000.",
        },
      ]);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="h-screen w-screen overflow-hidden bg-[#000000] text-zinc-100 flex flex-col">
      {/* Main Split Workspace */}
      <div className="flex-1 flex min-h-0">
        <PdfSidebar
          apiBaseUrl={API_BASE_URL}
          documents={documents}
          activeNav={activeNav}
          onSelectNav={setActiveNav}
          onUploadSuccess={(doc) => setDocuments((prev) => [doc, ...prev])}
        />

        {/* Center Spotify Content + Hybrid RAG Chat Panel */}
        <main className="flex-1 my-2 mr-2 rounded-xl bg-gradient-to-b from-[#1f3b28] via-[#121212] to-[#121212] flex flex-col min-w-0 overflow-hidden">
          {/* Compact Single-Row Header */}
          <header className="px-5 py-3 border-b border-white/10 flex items-center justify-between gap-4 shrink-0">
            <div className="flex items-center gap-2.5 min-w-0">
              <h1 className="text-sm sm:text-base font-bold text-white truncate">
                Spotify Architecture RAG
              </h1>
              <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full bg-[#1DB954] text-black shrink-0">
                Hybrid
              </span>
            </div>

            <div className="flex items-center gap-1.5 overflow-x-auto">
              {QUICK_PROMPTS.map((q) => (
                <button
                  key={q}
                  type="button"
                  onClick={() => submitQuery(q)}
                  className="text-[11px] px-2.5 py-1 rounded-full bg-white/10 hover:bg-white/20 text-zinc-200 whitespace-nowrap transition shrink-0"
                >
                  {q}
                </button>
              ))}
            </div>
          </header>

          {/* Body: Architecture Overview Cards (when selected) + Chat Stream */}
          <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
            {activeNav === "stack" && (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {ARCHITECTURE_CARDS.map(({ title, subtitle, icon: Icon }) => (
                  <div
                    key={title}
                    className="bg-[#181818] hover:bg-[#222222] border border-white/5 rounded-xl p-4 space-y-2 transition"
                  >
                    <div className="w-10 h-10 rounded-lg bg-[#1DB954]/20 text-[#1DB954] flex items-center justify-center">
                      <Icon className="w-5 h-5" />
                    </div>
                    <h3 className="text-sm font-bold text-white">{title}</h3>
                    <p className="text-xs text-zinc-400 leading-relaxed">
                      {subtitle}
                    </p>
                  </div>
                ))}
              </div>
            )}

            {turns.length === 0 ? (
              <div className="py-12 text-center max-w-xl mx-auto space-y-3">
                <Sparkles className="w-8 h-8 text-[#1DB954] mx-auto" />
                <h2 className="text-base font-bold text-white">
                  Upload your PDF &amp; ask any architecture question
                </h2>
                <p className="text-xs text-zinc-400 leading-relaxed">
                  Click one of the quick prompt pills in the header or type a
                  question below to compare Vector DB + BM25 against Knowledge
                  Graph retrieval.
                </p>
              </div>
            ) : (
              turns.map((turn) => (
                <ComparisonChatTurn key={turn.id} turn={turn} />
              ))
            )}

            {sending && (
              <div className="flex items-center gap-2 text-xs text-zinc-300 pl-11">
                <Loader2 className="w-4 h-4 animate-spin text-[#1DB954]" />
                <span>
                  Retrieving from FAISS + BM25 and Neo4j Knowledge Graph...
                </span>
              </div>
            )}
            <div ref={endRef} />
          </div>

          {/* Bottom Chat Composer */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              submitQuery(input);
            }}
            className="px-6 py-3.5 bg-[#181818] border-t border-white/10 flex items-center gap-3 shrink-0"
          >
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask about Next.js, NestJS, microservices, storage, or features..."
              disabled={sending}
              className="flex-1 bg-[#242424] focus:bg-[#2a2a2a] border border-transparent focus:border-[#1DB954] rounded-full px-4 py-2.5 text-sm text-white placeholder:text-zinc-400 focus:outline-none transition"
            />
            <button
              type="submit"
              disabled={!input.trim() || sending}
              className="px-5 py-2.5 rounded-full bg-[#1DB954] hover:bg-[#1ed760] disabled:opacity-40 text-black text-xs font-bold inline-flex items-center gap-1.5 transition"
            >
              <Send className="w-3.5 h-3.5" />
              <span>Send</span>
            </button>
          </form>
        </main>
      </div>

      {/* Persistent Spotify-Style Bottom Player / Telemetry Bar */}
      <footer className="h-16 bg-[#000000] border-t border-white/10 px-4 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 rounded bg-gradient-to-br from-[#1DB954] to-emerald-900 flex items-center justify-center text-black font-bold text-xs shrink-0">
            RAG
          </div>
          <div className="min-w-0">
            <p className="text-xs font-semibold text-white truncate">
              {documents[0]?.name || "No PDF Loaded"}
            </p>
            <p className="text-[11px] text-zinc-400 truncate">
              FAISS + BM25 + Neo4j GraphRAG Pipeline
            </p>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <SkipBack className="w-4 h-4 text-zinc-400 hover:text-white cursor-pointer" />
          <button
            type="button"
            onClick={() => setPlaying((p) => !p)}
            className="w-8 h-8 rounded-full bg-white text-black flex items-center justify-center hover:scale-105 transition"
          >
            {playing ? (
              <Pause className="w-4 h-4" />
            ) : (
              <Play className="w-4 h-4 ml-0.5" />
            )}
          </button>
          <SkipForward className="w-4 h-4 text-zinc-400 hover:text-white cursor-pointer" />
        </div>

        <div className="hidden sm:flex items-center gap-2 text-xs text-zinc-400">
          <Volume2 className="w-4 h-4" />
          <div className="w-24 h-1 rounded-full bg-zinc-700 overflow-hidden">
            <div className="w-3/4 h-full bg-[#1DB954]" />
          </div>
        </div>
      </footer>
    </div>
  );
}