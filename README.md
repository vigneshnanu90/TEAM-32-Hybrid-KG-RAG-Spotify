# Spotify Hybrid RAG Framework

A full-stack, mobile-responsive Retrieval-Augmented Generation (RAG) application combining **FAISS** dense vector search, **BM25** lexical retrieval, and **Neo4j** Knowledge Graph relationships behind a **FastAPI** backend and **React + Vite + Tailwind CSS** frontend.

## Core Architecture & Features

### 1. Ingestion, Real-Time Stage Telemetry & Cascading Cleanup (`backend/ingest.py`, `backend/main.py`)

* **PDF Extraction & Chunking:** Parses uploaded `.pdf` documents page-by-page (`pypdf`) and splits text using `RecursiveCharacterTextSplitter(chunk_size=700, chunk_overlap=120)`.
* **Live Backend Ingestion Progress (`GET /api/upload-status/{job_id}`):** Tracks multi-stage server progress (`0%`–`100%`) across PDF upload, text extraction & splitting, page-by-page Knowledge Graph extraction, FAISS embedding generation, and BM25 lexical indexing.
* **Multi-Store Indexing:**
  * **FAISS:** Embeds chunks via OpenAI Embeddings (`OpenAIEmbeddings`) and persists them to `storage/faiss_index`.
  * **BM25:** Stores tokenized chunk records in `storage/bm25_docs.pkl` for fast lexical keyword scoring (`BM25Okapi`).
  * **Neo4j Knowledge Graph:** Extracts structured `(subject, relation, object)` triples via LLM (`TripleExtractionResult`) and merges `:Entity` nodes and `[:RELATES]` edges tagged with `doc_id`, `filename`, and `page`.
* **Complete Lifecycle Deletion:** Deleting an uploaded PDF purges its file, removes its BM25 records (by `doc_id` and `filename`), rebuilds/clears the FAISS index, and deletes its Neo4j relationships and orphaned entity nodes.

### 2. Guardrails, Deterministic Grounding & Hybrid Retrieval (`backend/guardrails.py`, `backend/retriever.py`)

* **Input Guardrails:** Validates query length (`<= 1,000` chars), blocks prompt-injection patterns, checks store readiness (`has_documents`), and runs a zero-temperature policy classifier.
* **Hybrid Search & Reranking:** Executes parallel **FAISS + BM25** search fused via Reciprocal Rank Fusion (RRF, $k=60$) with query-term reranking alongside **Neo4j** Cypher graph traversal.
* **Deterministic Document-Grounded Synthesis (`S.P + U.Q + R.C`):** Uses `temperature=0.0` across section synthesis and judge evaluation (`JudgeVerdict`) with deterministic winner selection (`Hybrid (Both)`, `Vector + BM25`, or `Knowledge Graph`) so repeated identical queries produce consistent answers grounded strictly in the uploaded PDF.
* **Per-Query Retrieval Trace:** Returns live `retrieval_trace` telemetry (FAISS vector score, BM25 score, matched chunk previews, distinct relation hops, and triples).

### 3. Mode-Isolated Frontend Workspace (`frontend/src/`)

* **Mode-Aware Header & Chat (`WorkspaceHeader.jsx`, `App.jsx`, `ComparisonChatTurn.jsx`):**
  * Custom browser tab title (`Spotify Architect RAG — Hybrid Vector, BM25 & Graph`) and dynamic workspace headers (`Hybrid RAG — Vector, BM25 & Graph`, `Vector + BM25 Retrieval`, `Neo4j GraphRAG Explorer`) paired with mode-specific loading indicators.
  * **Strict Mode Isolation:**
    * **Hybrid Mode:** Displays interactive `Best Match`, `Vector`, and `Graph` tabs with `Best Match` active by default.
    * **Vector Mode:** Displays only the **Vector** result and source page chips, ignoring graph answers and hop badges.
    * **Graph Mode:** Displays only the **Graph** result and relationship hops, ignoring vector chunk answers.
  * **Per-Query Retrieval Trace (`RetrievalTracePanel.jsx`):** Displays live FAISS Vector and BM25 score bars, matched text snippets, and a Neo4j triple diagram beside each individual chat turn on desktop and stacked cleanly on mobile.
  * **Mobile Resilience:** Sticky header, slide-out navigation drawer, and `120s` `AbortController` timeout handling with `Retry` actions.
* **Interactive Knowledge Graph Explorer (`ArchitectureExplorerView.jsx`, `GET /api/graph`):**
  * **Island-Packed Force Simulation (`layoutIslands` + `tickSimulation`):** Separates connected subgraphs into non-overlapping islands with golden-angle spiral initialization, pairwise repulsion, collision avoidance, and edge springs so dense graphs never clump.
  * **Pan, Zoom, Drag & Type Filtering:** Supports pointer drag on individual nodes, canvas panning, wheel/pinch zooming (`0.35x`–`4x`) with zoom-to-fit (`⤢`), dynamic type filter pills (`Hub`, `Service`, `Component`, `Data`, `API`, etc.), hub-aware label decluttering, and a side inspector panel with top-hub shortcuts and one-click **Ask AI about this node** prompts.
  * **Strict Active-PDF Sync:** Automatically updates whenever PDFs are uploaded or deleted, clearing to `0 Nodes` / `0 Edges` when no indexed PDFs remain.
* **PDF Manager (`PdfSidebar.jsx`, `DocumentManagerView.jsx`):**
  * Real-time stage progress (`Upload`, `Split Text`, `Graph Nodes`, `FAISS & BM25`) synced with backend job polling and one-click PDF deletion.

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
│   ├── index.html
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

```bash
docker compose up --build -d
docker compose ps
```

4. Open **`http://localhost`** in your browser.

## Production Deployment (VPS)

Pushing changes to `main` triggers `.github/workflows/deploy.yml` (or manual `git pull && docker compose up --build -d` on the VPS), serving `vickycore.io` and `team-32.vickycore.io` over HTTPS via Nginx and Let's Encrypt SSL.