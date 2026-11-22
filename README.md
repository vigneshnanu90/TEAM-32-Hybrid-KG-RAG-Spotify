# Spotify Hybrid RAG Framework

A full-stack, mobile-responsive Retrieval-Augmented Generation (RAG) application combining **FAISS** dense vector search, **BM25** lexical retrieval, and **Neo4j** Knowledge Graph relationships behind a **FastAPI** backend and **React + Vite + Tailwind CSS** frontend.

## Core Architecture & Features

### 1. Ingestion & Cascading Cleanup (`backend/ingest.py`)
- **PDF Extraction & Chunking:** Parses uploaded `.pdf` documents page-by-page (`pypdf`) and splits text using `RecursiveCharacterTextSplitter(chunk_size=700, chunk_overlap=120)`.
- **Multi-Store Indexing:**
  - **FAISS:** Embeds chunks via OpenAI Embeddings (`OpenAIEmbeddings`) and persists them to `storage/faiss_index`.
  - **BM25:** Stores tokenized chunk records in `storage/bm25_docs.pkl` for fast lexical keyword scoring (`BM25Okapi`).
  - **Neo4j Knowledge Graph:** Extracts structured `(subject, relation, object)` triples via LLM (`TripleExtractionResult`) and merges `:Entity` nodes and `[:RELATES]` edges tagged with `doc_id` and `page`.
- **Complete Lifecycle Deletion:** Deleting an uploaded PDF purges its file, removes its BM25 records, rebuilds/clears the FAISS index, and deletes its Neo4j relationships and orphaned entity nodes.

### 2. Guardrails & Hybrid Retrieval (`backend/guardrails.py`, `backend/retriever.py`)
- **Input Guardrails:** Validates query length (`<= 1,000` chars), blocks prompt-injection patterns, checks store readiness, and runs a zero-temperature policy classifier.
- **Hybrid Search & Reranking:** Executes parallel **FAISS + BM25** search fused via Reciprocal Rank Fusion (RRF, $k=60$) with query-term reranking alongside **Neo4j** Cypher graph traversal.
- **Augmented Synthesis (`S.P + U.Q + R.C`):** Combines System Prompt (`S.P`), User Query (`U.Q`), and Retrieved Context (`R.C`) at `temperature=0.5` with a judge step (`JudgeVerdict`) and returns live `retrieval_trace` telemetry (vector/BM25 scores, matched chunk previews, relation hops, and triples).

### 3. Responsive Frontend Workspace (`frontend/src/`)
- **AI Architect Chat (`App.jsx`, `ComparisonChatTurn.jsx`, `RetrievalTracePanel.jsx`):**
  - Mode toggles (`Hybrid`, `Vector`, `Graph`), interactive `Summary` / `Matches` / `Graph` answer tabs, source page badges, hop counters, and `Copy` / `Retry` controls.
  - **Per-Query Retrieval Trace:** Displays live FAISS Vector and BM25 score bars, matched text snippets, and a Neo4j triple diagram beside each individual chat turn on desktop and stacked cleanly on mobile.
  - **Mobile Resilience:** Single-line sticky header (`WorkspaceHeader.jsx`), slide-out navigation drawer, and `120s` `AbortController` timeout handling.
- **Live Knowledge Graph Explorer (`ArchitectureExplorerView.jsx`, `GET /api/graph`):**
  - Interactive radial SVG node-and-edge graph backed by live Neo4j data with keyword filtering, node selection highlighting, relationship inspection, and one-click **Ask in Chat** prompts.
- **PDF Manager (`PdfSidebar.jsx`, `DocumentManagerView.jsx`):**
  - Real-time upload percentage progress (`0%`–`100%` via `XMLHttpRequest`) and one-click PDF deletion.

## Project Structure

```text
Hybrid-Rag-Framework/
├── backend/
│   ├── config.py
│   ├── guardrails.py
│   ├── ingest.py
│   ├── main.py
│   ├── requirements.txt
│   └── retriever.py
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   │   ├── ComparisonChatTurn.jsx
│   │   │   ├── PdfSidebar.jsx
│   │   │   ├── RetrievalTracePanel.jsx
│   │   │   └── WorkspaceHeader.jsx
│   │   ├── views/
│   │   │   ├── ArchitectureExplorerView.jsx
│   │   │   └── DocumentManagerView.jsx
│   │   └── App.jsx
│   ├── nginx.conf
│   ├── nginx.local.conf          # Local-only HTTP Nginx config (gitignored)
│   ├── Dockerfile
│   └── package.json
├── .github/workflows/deploy.yml  # Automated VPS deployment on push to main
├── docker-compose.yml
├── docker-compose.override.yml   # Local-only HTTP override (gitignored)
└── README.md
```

## Local Development with Docker

1. Start **Docker Desktop** and confirm the Linux engine is running.
2. Configure `backend/.env` with your `OPENAI_API_KEY`, `NEO4J_URI`, `NEO4J_USERNAME`, `NEO4J_PASSWORD`, and storage paths.
3. Build and start the stack (Docker Compose automatically merges `docker-compose.override.yml` on port `80` without requiring `/etc/letsencrypt`):

```cmd
docker compose up --build -d
docker compose ps
```

4. Open **`http://localhost`** in your browser.

## Production Deployment (VPS)

Pushing changes to `main` triggers `.github/workflows/deploy.yml` (or manual `git pull && docker compose up --build -d` on the VPS), serving `vickycore.io` and `team-32.vickycore.io` over HTTPS via Nginx and Let's Encrypt SSL.