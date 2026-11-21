# Spotify Hybrid RAG Framework

A full-stack retrieval-augmented generation application combining **FAISS** dense vector search, **BM25** lexical retrieval, and **Neo4j** Knowledge Graph relationships behind a **FastAPI** backend and **React + Vite + Tailwind** frontend.

## Architecture & Pipeline

- **Data Ingestion & Cleanup (`backend/ingest.py`)**
  - Extracts text from uploaded `.pdf` documents and splits into chunks.
  - Indexes embeddings into **FAISS** and token records into **BM25** (`bm25_docs.pkl`) with `doc_id` metadata.
  - Extracts structured `(subject, relation, object)` triples and stores them in **Neo4j** tagged by `doc_id`.
  - Deletes a PDF's uploaded file, BM25 records, Neo4j relationships/orphaned entities, and rebuilds or clears the FAISS store when removed.
- **Guardrails & Hybrid Retrieval (`backend/guardrails.py`, `backend/retriever.py`)**
  - Validates queries up to `1,000` characters, blocks prompt-injection attempts, and checks index availability.
  - Combines **FAISS** + **BM25** via Reciprocal Rank Fusion (RRF) with keyword reranking alongside **Neo4j** graph queries.
  - Augments context (`S.P + U.Q + R.C`) and synthesizes human-readable responses at `temperature=0.5`.
- **Frontend Workspace (`frontend/src/`)**
  - Multi-view navigation across **AI Architect Chat**, **Tech Stack & Services**, and **Indexed PDFs**.
  - Dynamic upload progress percentage (`0%`–`100%`) during PDF uploads and one-click PDF deletion.
  - Parses structured/escaped responses into readable text and persists session chat history in `sessionStorage`.

## Project Structure

```text
Hybrid-Rag-Framework/
├── backend/
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
│   │   │   └── WorkspaceHeader.jsx
│   │   ├── views/
│   │   │   ├── ArchitectureExplorerView.jsx
│   │   │   └── DocumentManagerView.jsx
│   │   └── App.jsx
│   ├── nginx.conf
│   ├── nginx.local.conf
│   ├── Dockerfile
│   └── package.json
├── docker-compose.yml
├── docker-compose.override.yml   # Local-only HTTP override (gitignored)
└── README.md