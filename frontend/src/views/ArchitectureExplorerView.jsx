// frontend/src/views/ArchitectureExplorerView.jsx
import React, { useState } from "react";

export default function ArchitectureExplorerView({ onAskPrompt }) {
  const [topicQuery, setTopicQuery] = useState("");
  const [error, setError] = useState("");

  const handleSubmit = (e) => {
    e.preventDefault();
    const trimmed = topicQuery.trim();
    if (!trimmed) {
      setError("Enter a question or topic to query.");
      return;
    }
    setError("");
    onAskPrompt(trimmed);
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-4 md:p-6">
      <div className="rounded-2xl border border-emerald-900/70 bg-[#0b1d14]/90 p-6">
        <h2 className="text-lg font-semibold text-white">Tech Stack &amp; Services</h2>
        <p className="mt-1 text-sm text-emerald-200/75">
          Ask a custom question to query your connected Vector DB, BM25, and Neo4j GraphRAG pipeline.
        </p>

        <form onSubmit={handleSubmit} className="mt-4 space-y-3">
          <input
            type="text"
            value={topicQuery}
            onChange={(e) => {
              setTopicQuery(e.target.value);
              if (error) setError("");
            }}
            placeholder="Type your architecture question..."
            className="w-full rounded-xl border border-emerald-800/70 bg-[#07140e] px-3.5 py-2.5 text-sm text-white placeholder-emerald-200/45 focus:border-emerald-400 focus:outline-none"
          />
          {error && <p className="text-xs text-rose-400">{error}</p>}
          <button
            type="submit"
            className="rounded-lg bg-emerald-500 px-4 py-2 text-xs font-semibold text-slate-950 transition hover:bg-emerald-400"
          >
            Run in AI Architect Chat
          </button>
        </form>
      </div>
    </div>
  );
}