# Spotify Hybrid RAG Framework

A full-stack, mobile-responsive Retrieval-Augmented Generation (RAG) application combining **FAISS** dense vector search, **BM25** lexical retrieval, and **Neo4j** Knowledge Graph relationships behind a **FastAPI** backend and **React + Vite + Tailwind CSS** frontend.

## Core Architecture & Features

### 1. Multi-Format Ingestion, Real-Time Stage Telemetry & Cascading Cleanup (`backend/ingest.py`, `backend/main.py`)

* **Multi-Format File Support:** Accepts `.pdf`, `.md`, `.json`, `.xml`, `.txt`, and `.csv` uploads across the FastAPI upload endpoints (`POST /api/upload-pdf` and `POST /api/upload`), sidebar, and Document Manager file pickers.
* **Format-Aware Parsing & Chunking:**
  * **`.pdf`:** Extracts text page-by-page using `pypdf.PdfReader`.
  * **`.json`:** Pretty-prints structured JSON payloads before splitting.
  * **`.xml`:** Parses XML elements/attributes into structured readable lines (with raw fallback if needed).
  * **`.md`, `.txt`, `.csv`:** Splits Markdown sections by headings (`#`–`###`) or reads UTF-8 text blocks, then chunks via `RecursiveCharacterTextSplitter`.
* **Live Backend Ingestion Progress (`GET /api/upload-status/{job_id}`):** Tracks multi-stage server progress (`0%`–`100%`) across file validation, text extraction & chunking, FAISS embedding generation, BM25 indexing, and Neo4j Knowledge Graph triple extraction.
* **Multi-Store Indexing (`RAG_STORAGE_DIR`):**
  * **FAISS:** Embeds chunks via OpenAI Embeddings and persists the index under `$RAG_STORAGE_DIR/faiss_index`.
  * **BM25:** Stores tokenized chunk records in `$RAG_STORAGE_DIR/bm25_docs.pkl` for fast lexical keyword scoring (`BM25Okapi`).
  * **Neo4j Knowledge Graph:** Extracts structured `(subject, relation, object)` triples via LLM (`TripleExtractionResult`) and merges `:Entity` nodes and `[:RELATES]` edges tagged with `doc_id`, `filename`, and `page`.
* **Complete Lifecycle Deletion:** Deleting an uploaded document purges its stored file, removes its BM25 records (by `doc_id` and `filename`), rebuilds or clears the FAISS index, and deletes its Neo4j relationships and orphaned entity nodes.

### 2. Guardrails, Citation Verification & Deterministic Hybrid Retrieval (`backend/guardrails.py`, `backend/retriever.py`)

* **Input Guardrails:** Validates query length (`<= 1,000` chars), blocks prompt-injection patterns, checks store readiness (`has_documents`), and enforces strict input policies.
* **Post-Generation Citation Verification (`verify_citations`):** Automatically inspects generated answers to verify bracketed numeric references (`[1]`, `[2]`) and page citations (`p.X`, `(p. X)`) against the retrieved source records, stripping any hallucinated or out-of-range references.
* **Hybrid Search & Reranking:** Executes parallel **FAISS + BM25** search fused via Reciprocal Rank Fusion (RRF, $k=60$) with query-term reranking alongside **Neo4j** Cypher graph traversal.
* **Deterministic Document-Grounded Synthesis (`S.P + U.Q + R.C`):** Uses `temperature=0.0` across section synthesis and judge evaluation (`JudgeVerdict`) with deterministic winner selection (`Hybrid (Both)`, `Vector + BM25`, or `Knowledge Graph`) so repeated identical queries produce consistent answers grounded strictly in the uploaded files.
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
  * **Strict Active-File Sync:** Automatically updates whenever files are uploaded or deleted, clearing to `0 Nodes` / `0 Edges` when no indexed files remain.
* **Document & File Manager (`PdfSidebar.jsx`, `DocumentManagerView.jsx`):**
  * Real-time stage progress (`Upload`, `Split Text`, `Graph Nodes`, `FAISS & BM25`) synced with backend job polling and one-click document deletion.

### 4. Automated Testing & Retrieval Evaluation (`backend/tests/`, `backend/eval_rag.py`, `docs/EVAL.md`)

* **Unit Test Suite (`pytest`):** Covers empty-store blocking, prompt-injection detection, valid domain queries, post-generation citation stripping (`verify_citations`), tokenization normalization, and cascading multi-store deletion (`delete_document_by_id`).
* **Ground-Truth Benchmark (`eval_rag.py` & `docs/EVAL.md`):** Evaluates hybrid retrieval against `backend/tests/eval_questions.json` and logs **Hit@3 (`100.00%`)**, **Hit@5 (`100.00%`)**, and **MRR (`0.8889`)** directly into `docs/EVAL.md`.

## Project Structure

```text
Hybrid-Rag-Framework/
├── backend/
│   ├── storage/                  # Active local RAG storage (faiss_index, bm25_docs.pkl, uploads)
│   ├── tests/
│   │   ├── __init__.py
│   │   ├── eval_questions.json
│   │   └── test_rag_pipeline.py
│   ├── config.py
│   ├── eval_rag.py
│   ├── guardrails.py
│   ├── ingest.py
│   ├── main.py
│   ├── requirements.txt
│   └── retriever.py
├── docs/
│   └── EVAL.md
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

## Local Development, Testing & Evaluation

1. Start **Docker Desktop** and confirm the Linux engine is running.
2. Configure `backend/.env` with `OPENAI_API_KEY`, `NEO4J_URI`, `NEO4J_USERNAME`, `NEO4J_PASSWORD`, and `RAG_STORAGE_DIR` (pointing to your local `backend/storage` directory on Windows, or `/app/storage` / `/app/data` matching your container volume).
3. Build and start the stack:

```bash
docker compose up --build -d
docker compose ps
```

4. Run unit tests and refresh the retrieval evaluation report from `backend/` (ensure `RAG_STORAGE_DIR` points to `backend/storage`):

```bash
pytest -v
python eval_rag.py
```

5. Open **`http://localhost`** in your browser.

## Production Deployment (VPS)

Pushing changes to `main` triggers `.github/workflows/deploy.yml` (or manual `git pull && docker compose up --build -d` on the VPS), serving `vickycore.io` and `team-32.vickycore.io` over HTTPS via Nginx and Let's Encrypt SSL.