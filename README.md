# Spotify-Like Web App — Triple-Hybrid RAG Framework (`FAISS + BM25 + Neo4j`)

A full-stack, Spotify-inspired AI Architecture & Music Assistant powered by **Triple-Hybrid Retrieval-Augmented Generation (RAG)**—combining **Dense Vector Search (FAISS)**, **Sparse Lexical Search (BM25)** with **Reciprocal Rank Fusion (RRF)**, and a **Neo4j Knowledge Graph**, protected by **Input Guardrails** and evaluated by an **LLM-as-a-Judge** synthesizer.

## 1. System Architecture & Tech Stack

| Layer | Technology | Role & Responsibility | 
| ----- | ----- | ----- | 
| **Frontend UI** | React.js (Vite + Tailwind CSS v4 + Lucide Icons + `react-markdown` + `react-force-graph-2d`) | Spotify-inspired dark UI (`#121212` / `#181818` surfaces, `#1DB954` emerald accents), PDF Knowledge Library uploader, persistent bottom telemetry bar, and 3-section comparison chat cards with an expandable interactive Knowledge Graph modal. | 
| **Backend API** | Python 3.13 + FastAPI + Uvicorn | Async REST API (`/api/upload-pdf`, `/api/chat`, `/api/health`), parallel retrieval execution via `asyncio.gather()`, and structured Pydantic outputs. | 
| **Input Guardrails** | Regex Injection Filter + OpenAI Structured Output Classifier | Blocks prompt injections, oversized inputs, empty queries, and off-topic/harmful requests before touching retrieval engines. | 
| **Vector DB (Dense)** | FAISS (`langchain-community` + `text-embedding-3-small`) | Semantic similarity search across chunked PDF passages. | 
| **Keyword Search (Sparse)** | `rank_bm25` (`BM25Okapi`) | Exact lexical term matching combined with FAISS via **Reciprocal Rank Fusion (RRF)**. | 
| **Knowledge Graph** | Neo4j (`neo4j` Python Driver — AuraDB or Local Docker) | Stores extracted `(Subject)-[RELATION]->(Object)` triples with document and page metadata for relationship traversal. | 
| **Judge & Synthesis** | OpenAI (`gpt-4o-mini` Structured Outputs) | Generates isolated answers from Vector+BM25 and Knowledge Graph in parallel, compares both, declares a winner, and synthesizes the **Best Recommended Answer**. | 
| **Containerization** | Docker & Docker Compose + Nginx | Multi-container deployment (`frontend` on port `3000`, `backend` on port `8000`) with Nginx reverse-proxy and persistent Docker volumes. | 

## 2. Core Features

1. **Dual-Pipeline PDF Ingestion (`POST /api/upload-pdf`):**

   * Extracts text page-by-page using `pypdf`.

   * Splits pages into overlapping chunks (`RecursiveCharacterTextSplitter`, `chunk_size=700`, `chunk_overlap=120`) and indexes them into **FAISS** and **BM25** (`bm25_docs.pkl`).

   * Extracts structured `(subject, relation, object)` triples via OpenAI Structured Outputs and writes them into **Neo4j** (`MERGE`) with resilient fallback warning handling if Neo4j is paused or unreachable.

2. **Three-Section Parallel Query & Judge Pipeline (`POST /api/chat`):**

   * **Input Guardrail Check:** Validates query safety, relevance to uploaded PDFs/architecture docs, and document availability.

   * **Section 1 — Vector DB + BM25:** Retrieves top passages using RRF ($\text{RRF Score}(d) = \sum \frac{1}{60 + \text{rank}_r(d)}$) and generates a passage-grounded answer with source page badges.

   * **Section 2 — Knowledge Graph:** Queries Neo4j relationships matching query entities, generates a relationship-grounded answer, and surfaces structured triple flow badges plus an **Expand Graph** interactive node-link modal.

   * **Section 3 — Best Recommended Answer (LLM Judge):** Compares both sections, explains why the winning approach excelled, and produces a unified best answer.

3. **Spotify-Inspired UI:**

   * Left navigation sidebar (`AI Architect Chat`, `Tech Stack & Services`, `Indexed PDFs`) + **Your Knowledge Library** PDF dropzone.

   * Compact single-row header with one-click architecture prompt pills.

   * Clean Markdown rendering (`react-markdown`) and persistent Spotify-style bottom player/telemetry bar.

## 3. Project Structure

```text
Hybrid-Rag-Framework/
├── .gitignore                         # Excludes .env, venv, node_modules, storage, build artifacts
├── docker-compose.yml                 # Multi-container orchestration (frontend + backend + volumes)
├── .vscode/
│   └── settings.json                  # Points VS Code Pylance to backend/venv
├── backend/
│   ├── Dockerfile                     # Python 3.13-slim FastAPI image
│   ├── .env                           # API keys & Neo4j connection credentials (gitignored)
│   ├── requirements.txt               # Python dependencies
│   ├── config.py                      # Pydantic settings & storage paths
│   ├── guardrails.py                  # Regex + LLM input guardrail
│   ├── ingest.py                      # PDF parsing, FAISS, BM25 & Neo4j ingestion
│   ├── retriever.py                   # Parallel RRF + Graph retrieval & LLM Judge
│   ├── main.py                        # FastAPI app & endpoints
│   └── storage/                       # Persisted uploads, faiss_index/, bm25_docs.pkl (gitignored)
├── frontend/
│   ├── Dockerfile                     # Multi-stage Node 20 -> Nginx 1.27 Alpine image
│   ├── nginx.conf                     # Reverse-proxies /api/ to backend:8000 & serves React SPA
│   ├── .env                           # VITE_API_BASE_URL=http://localhost:8000 (gitignored)
│   ├── index.html
│   ├── package.json
│   ├── vite.config.js                 # Vite + React + @tailwindcss/vite
│   └── src/
│       ├── index.css                  # Tailwind v4 import & custom scrollbars
│       ├── main.jsx                   # React root mount
│       ├── App.jsx                    # Spotify-like shell, chat stream & player bar
│       └── components/
│           ├── PdfSidebar.jsx         # Navigation + PDF upload & library list
│           └── ComparisonChatTurn.jsx # 3-section comparison cards + Graph modal
└── README.md                          # Architecture, setup, Docker guide, Q&A log & error ledger
```

## 4. Step-by-Step Setup & Running Locally (Windows `cmd`)

### Step 1: Backend Setup (`FastAPI`)

1. Navigate to `backend/` and create a Python virtual environment:

   ```cmd
   cd backend
   python -m venv venv
   venv\Scripts\activate
   ```

2. Upgrade `pip` and install dependencies:

   ```cmd
   python -m pip install --upgrade pip
   pip install -r requirements.txt
   ```

3. Configure `backend/.env`:

   ```env
   OPENAI_API_KEY=sk-your-openai-api-key
   OPENAI_CHAT_MODEL=gpt-4o-mini
   OPENAI_EMBED_MODEL=text-embedding-3-small

   # Neo4j AuraDB (Cloud) OR Local Docker Neo4j (bolt://localhost:7687)
   NEO4J_URI=neo4j+ssc://your-instance.databases.neo4j.io
   NEO4J_USERNAME=neo4j
   NEO4J_PASSWORD=your-password
   NEO4J_DATABASE=neo4j

   DATA_DIR=./storage
   ```

4. *(Optional)* Start a local Neo4j instance via Docker if not using Neo4j AuraDB:

   ```cmd
   docker run -d --name soundpulse-neo4j -p 7474:7474 -p 7687:7687 -e NEO4J_AUTH=neo4j/password123 neo4j:5
   ```

5. Start the FastAPI server:

   ```cmd
   uvicorn main:app --reload --host 0.0.0.0 --port 8000
   ```

   * Interactive API docs available at: `http://localhost:8000/docs`

### Step 2: Frontend Setup (`React + Vite + Tailwind v4`)

1. Open a second `cmd` terminal and navigate to `frontend/`:

   ```cmd
   cd frontend
   npm install
   npm install lucide-react react-markdown react-force-graph-2d
   npm install -D @tailwindcss/vite
   ```

2. Ensure `frontend/.env` is configured:

   ```env
   VITE_API_BASE_URL=http://localhost:8000
   ```

3. Start the Vite development server:

   ```cmd
   npm run dev
   ```

   * Open `http://localhost:5173` in your browser, upload `spotify_web_app_architecture.pdf`, and ask questions in the chatbox.

## 5. Docker Hosting Guide

The project includes production-ready Docker configurations (`backend/Dockerfile`, `frontend/Dockerfile`, `frontend/nginx.conf`, and `docker-compose.yml`).

### 1. Build & Start Containers

From the project root (`Hybrid-Rag-Framework/`) in `cmd`:

```cmd
docker compose up --build -d
```

### 2. Service Endpoints

* **Frontend Web App (Nginx):** `http://localhost:3000`
* **Backend FastAPI & Swagger Docs:** `http://localhost:8000/docs`
* **Health Check:** `http://localhost:8000/api/health`
* **Persistent Storage Volume:** `rag_storage` preserves `/app/storage` (`faiss_index/`, `bm25_docs.pkl`, and `uploads/`) across container restarts.

### 3. Manage Containers

```cmd
# View logs
docker compose logs -f

# Stop and remove containers (preserves rag_storage volume)
docker compose down
```

## 6. Development Q&A Audit Trail

| \# | User Query / Requirement | Architectural & Implementation Answer | 
| ----- | ----- | ----- | 
| **Q1** | *Build a hybrid RAG framework for a Spotify-like Web App using VectorDB, Knowledge Graph, BM25, FastAPI, Guardrails, React.js, and Docker, with full documentation.* | Designed a 5-phase monorepo architecture combining FastAPI async orchestration, FAISS + `rank_bm25` (RRF) + Neo4j GraphRAG, input guardrails, a Spotify-themed React UI, and Docker Compose deployment. | 
| **Q2** | *Does Vector DB (Dense) & Knowledge Graph use `Data Load -> Text Splitter -> Embeddings -> Store in DB`?* | **Yes** for Dense Vector DB (load $\rightarrow$ chunk $\rightarrow$ embed $\rightarrow$ store). **Mostly No** for Knowledge Graphs, which use **Entity & Relationship Extraction** (`(Subject)-[RELATION]->(Object)`) rather than flat text chunking, though embeddings can optionally be added on top in hybrid GraphRAG. | 
| **Q3** | *Upload a PDF in the UI and return separate sections for Vector DB, Knowledge Graph, and a Judge comparison suggesting the best answer.* | Implemented dual-pipeline PDF ingestion (`POST /api/upload-pdf`) and a parallel fan-out/fan-in query endpoint (`POST /api/chat`) running isolated Vector+BM25 and Knowledge Graph generators followed by an LLM-as-a-Judge evaluator. | 
| **Q4** | *Generate complete FastAPI backend code and Windows `venv` installation steps.* | Delivered modular backend (`config.py`, `guardrails.py`, `ingest.py`, `retriever.py`, `main.py`) with `requirements.txt` and `cmd` setup commands (`python -m venv venv`, `pip install -r requirements.txt`, `uvicorn`). | 
| **Q5** | *Design a chat-first Spotify UI with PDF uploader and 3-section comparison cards, then align it to `spotify_web_app_architecture.pdf`.* | Built a Spotify-inspired dark layout (`PdfSidebar.jsx`, `ComparisonChatTurn.jsx`, `App.jsx`) with left library navigation, quick prompt pills, persistent bottom bar, and architecture-aware triple extraction. | 
| **Q6** | *Can we display the Knowledge Graph in the UI and give Vector DB + BM25 a clean visual structure?* | Added clean relationship flow cards (`Subject -> RELATION -> Object`) plus an expandable `react-force-graph-2d` node-link modal for Knowledge Graph, and structured source-page & matched-keyword badges for Vector DB + BM25. | 
| **Q7** | *Generate `README.md`, Docker hosting setup (`Dockerfile`, `nginx.conf`, `docker-compose.yml`), and `.gitignore`.* | Created `backend/Dockerfile`, `frontend/Dockerfile`, `frontend/nginx.conf`, `docker-compose.yml` with persistent `rag_storage` volume, `.gitignore`, and documented all steps in `README.md`. | 

## 7. Error & Resolution Ledger

| \# | Error / Issue Encountered | Root Cause | Resolution Applied | 
| ----- | ----- | ----- | ----- | 
| **E1** | `npm error could not determine executable to run` when running `npx tailwindcss init -p` | `npm install -D tailwindcss` installed **Tailwind CSS v4**, which removed the v3 `tailwindcss init` CLI binary. | Installed `@tailwindcss/vite`, registered `tailwindcss()` in `frontend/vite.config.js`, and replaced `@tailwind` directives with `@import "tailwindcss";` in `src/index.css`. | 
| **E2** | Browser rendered the default Vite starter page (`Count is 0` / `Edit src/App.jsx`) instead of the chat UI | Default `src/App.jsx` had not been overwritten yet and Vite's default `src/App.css` constrained layout styles. | Removed `src/App.css` and replaced `src/App.jsx` with the custom Spotify Hybrid RAG chat application. | 
| **E3** | `Cannot resolve address e2039786.databases.neo4j.io:7687` during PDF upload & `"No PDF has been uploaded yet"` in chat | Neo4j AuraDB instance hostname could not be resolved (paused instance or local DNS/network restriction), causing `ingest_pdf()` to abort before saving FAISS/BM25 records while the frontend `catch` block showed a misleading preview entry. | Wrapped Neo4j ingestion in `try/except` in `backend/ingest.py` so FAISS + BM25 still persist with a warning if Neo4j is unreachable, removed the fake preview fallback in `PdfSidebar.jsx`, and documented local Docker Neo4j (`bolt://localhost:7687`) as an alternative. | 
| **E4** | Guardrail blocked `"what is the Tech Stack Overview"` with `"This request is unrelated to music or uploaded PDF content."` | Initial guardrail system prompt only allowed music/track/artist questions and rejected software architecture queries from `spotify_web_app_architecture.pdf`. | Updated `backend/guardrails.py` to allow all legitimate questions covering uploaded PDF content (system architecture, tech stack, microservices, storage, routes, and features). | 
| **E5** | VS Code Pylance import squiggles (`11 problems`) across `guardrails.py` and `ingest.py` | VS Code's Python language server was pointing to the global interpreter instead of `backend/venv/Scripts/python.exe`. | Created `.vscode/settings.json` setting `"python.defaultInterpreterPath": "${workspaceFolder}/backend/venv/Scripts/python.exe"` and restarted Pylance. | 
| **E6** | Pylance type error on `OpenAIEmbeddings(..., api_key=settings.openai_api_key)` in `backend/ingest.py` | `langchain-openai==0.2.14` type annotations expect `SecretStr` for `api_key`. | Imported `SecretStr` from `pydantic` and passed `api_key=SecretStr(settings.openai_api_key)`. | 
| **E7** | Inline force-graph labels overlapped (`Prometheus` / `BELONGS_TO_GENRE`) and raw `**markdown**` asterisks appeared in answers | Small inline graph containers cluster small node sets together, and plain text rendering did not parse Markdown formatting. | Installed `react-markdown` for formatted lists/headings and redesigned the Knowledge Graph card with clean structured triple flow pills + a full-width `Expand Graph` modal with higher charge repulsion (`-320`). | 