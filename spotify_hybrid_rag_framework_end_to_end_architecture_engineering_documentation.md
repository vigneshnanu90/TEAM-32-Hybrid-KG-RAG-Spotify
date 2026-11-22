# Spotify Hybrid RAG Framework: End-to-End Technical & Engineering Documentation

## 1. Executive Summary & System Overview

The **Spotify Hybrid RAG Framework** is a full-stack, mobile-responsive Retrieval-Augmented Generation (RAG) web application engineered to ingest unstructured/semi-structured PDF documents, index them across dense vector, lexical keyword, and property graph stores, and synthesize accurate, human-readable architectural answers.

### High-Level Tech Stack
* **Frontend:** React 18, Vite, Tailwind CSS, `XMLHttpRequest` (for real-time upload progress), `AbortController` (for resilient mobile timeouts).
* **Backend:** Python 3.11+, FastAPI, Pydantic (Structured Outputs), `pypdf`, `langchain-text-splitters`.
* **Hybrid Storage & Retrieval Layer:**
  * **Dense Vector Store:** FAISS (`IndexFlatL2`) with OpenAI Embeddings.
  * **Lexical Search Store:** `rank-bm25` (`BM25Okapi`) persisted via pickle (`bm25_docs.pkl`).
  * **Knowledge Graph:** Neo4j Graph Database (`Entity` nodes and `RELATES` directed edges).
* **LLM & Synthesis:** OpenAI Chat Completions API (`temperature=0.5`) utilizing structured output parsing (`SectionAnswer`, `JudgeVerdict`, `TripleExtractionResult`, `GuardrailDecision`).
* **Deployment & Infrastructure:** Docker & Docker Compose, Nginx reverse proxy with Let's Encrypt SSL/TLS hosted on a Hostinger VPS (`vickycore.io` and `team-32.vickycore.io`), integrated with GitHub CI/CD (`main` branch).

---

## 2. Alignment with Architectural Design Requirements

The system strictly implements all three architectural blueprints defined during project scoping:

1. **Data Ingestion & Storage Pipeline:**
   * Supports dynamic PDF upload without hardcoded or pre-seeded sample data.
   * Splits extracted text into overlapping chunks (`chunk_size=700`, `chunk_overlap=120`), generates embeddings for **FAISS**, tokenizes text for **BM25**, and extracts `(subject, relation, object)` triples via LLM for **Neo4j** (`EE -> RM -> GS`).
   * Enforces complete data lifecycle management: deleting a PDF purges its chunks from BM25, rebuilds/clears the FAISS index, removes tagged relationships and orphaned nodes in Neo4j, and deletes the raw file from disk.
2. **Hybrid Retrieval, Reranking & Augmentation (`S.P + U.Q + R.C`):**
   * Executes parallel **Vector + BM25** search (fused via Reciprocal Rank Fusion and keyword reranking) alongside **Neo4j Cypher traversal**.
   * Combines `{Chunks + Node Ref}` with the System Prompt (`S.P`), User Query (`U.Q`), and Retrieved Context (`R.C`) at `temperature=0.5` to produce grounded, natural-language responses.
3. **Production Deployment:**
   * Version-controlled in GitHub, containerized via multi-stage Docker builds, and served over HTTPS via Nginx on a Linux VPS.

---

## 3. Backend Technical Implementation Details

### 3.1 Document Ingestion & Lifecycle Management (`backend/ingest.py`)
When a user uploads a `.pdf` via `POST /api/upload-pdf` (max 50 MB), the backend executes a deterministic indexing pipeline:

1. **Extraction & Chunking:**
   * `extract_pdf_pages()` parses text page-by-page using `pypdf.PdfReader`.
   * `RecursiveCharacterTextSplitter(chunk_size=700, chunk_overlap=120)` breaks page text into semantically coherent chunks tagged with `chunk_id`, `doc_id`, `filename`, and `page`.
2. **Dense Vector Indexing (FAISS):**
   * Chunks are wrapped as LangChain `Document` objects and embedded using `OpenAIEmbeddings`.
   * If an existing FAISS index exists on disk (`storage/faiss_index`), new documents are appended via `aadd_documents()`; otherwise, `FAISS.afrom_documents()` initializes a new store and persists it locally.
3. **Lexical Indexing (BM25):**
   * Chunks are appended to `bm25_docs.pkl`. At query time, `tokenize()` normalizes lowercase alphanumeric tokens (`[a-z0-9]+`) to construct an in-memory `BM25Okapi` corpus.
4. **Knowledge Graph Extraction (Neo4j):**
   * `extract_triples_from_chunk()` prompts OpenAI (`temperature=0`) with Pydantic schema `TripleExtractionResult` to extract entities (`subject`, `subject_type`, `object`, `object_type`) and normalized `UPPER_SNAKE_CASE` relations (e.g., `USES_TECH`, `PART_OF_LAYER`, `HANDLES`).
   * `write_triples_to_neo4j()` executes an idempotent `UNWIND` Cypher query using `MERGE` to create `:Entity` nodes and `[:RELATES {type, doc_id, page}]` edges.
5. **Cascading Deletion (`delete_document_by_id`):**
   * Filters out `doc_id` records from `bm25_docs.pkl`.
   * Wipes `faiss_index` and rebuilds it cleanly from remaining BM25 records (or leaves it empty if zero documents remain).
   * Runs Cypher `MATCH ()-[rel:RELATES {doc_id: $doc_id}]-() DELETE rel` followed by `MATCH (n:Entity) WHERE NOT (n)--() DELETE n` to eliminate orphaned nodes.

### 3.2 Input Guardrails (`backend/guardrails.py`)
Before running expensive retrieval or LLM calls, `check_input_guardrail()` validates every incoming query:
* **Length & Empty Validation:** Rejects empty strings and enforces a strict `1,000`-character limit aligned with the frontend input field.
* **Regex Prompt-Injection Defense:** Blocks instruction-override patterns (e.g., `"ignore previous instructions"`, `"reveal system prompt"`, `"act as root/DAN"`).
* **Index Readiness Check:** Verifies `has_documents` (`len(load_bm25_records()) > 0`) and returns a human-readable prompt instructing the user to upload a PDF if the store is empty.
* **Semantic Policy Gate:** Uses a zero-temperature LLM classifier (`GuardrailDecision`) to permit legitimate system architecture queries while blocking harmful, medical, financial, or legal requests.

### 3.3 Hybrid Retrieval, RRF Fusion & Synthesis (`backend/retriever.py`)
`run_three_section_query(query)` orchestrates parallel retrieval and three-stage synthesis:

1. **Vector + BM25 Hybrid Search & Reranking (`_vector_and_bm25_search`):**
   * **Dense Retrieval:** Queries `FAISS.similarity_search(query, k=5)`.
   * **Sparse Retrieval:** Scores tokenized query terms against `BM25Okapi` and selects the top 5 positive-scoring chunks.
   * **Reciprocal Rank Fusion (RRF):** Combines dense and sparse rankings using:
     $$\text{Score}_{\text{RRF}}(d) = \sum_{r \in \{\text{FAISS}, \text{BM25}\}} \frac{1}{k + \text{rank}_r(d)}, \quad k = 60$$
   * **Keyword Reranking:** Applies a relevance boost (`+0.02` per matching query token > 2 characters) to reorder fused candidates before selecting the top `k=5` chunks.
2. **Knowledge Graph Traversal (`_graph_search`):**
   * Extracts up to 6 meaningful keywords (`len > 2`) from the query and runs a case-insensitive Cypher match across `s.name`, `o.name`, and `r.type` to retrieve up to 20 matching `(subject, relation, object)` triples with source page metadata.
3. **Augmented Synthesis (`S.P + U.Q + R.C`) & Judge Evaluation:**
   * `_answer_from_vector_bm25` and `_answer_from_graph` run concurrently via `asyncio.gather()` at `temperature=0.5`, formatting prompts explicitly into `[S.P - System Prompt]`, `[U.Q - User Query]`, and `[R.C - Retrieved Context]`.
   * A final judge step (`JudgeVerdict`) evaluates both answers alongside `{Chunks + Node Ref}` context, selects the winning strategy (`Vector + BM25`, `Knowledge Graph`, or `Hybrid (Both)`), and produces `best_answer`.
   * Live telemetry (`retrieval_trace`) returns `vector_score`, `bm25_score`, `chunks_retrieved`, `triples_retrieved`, `graph_hops`, `top_matches`, and `triples` for per-query UI rendering.

---

## 4. UI & Frontend Architecture Evolution

The frontend was redesigned from a basic single-panel chat prototype into a responsive, multi-view engineering workspace:

### 4.1 Desktop vs. Mobile Responsive Architecture
* **Desktop Layout:**
  * **Left Sidebar (`PdfSidebar.jsx`):** Fixed `w-72` navigation panel housing view switchers (`AI Architect Chat`, `Tech Stack & Services`, `Indexed PDFs`), PDF count badge, drag/click `.pdf` upload dropzone with live percentage progress ring/bar (`0%`–`100%`), and per-document `Delete` controls.
  * **Center Workspace (`App.jsx` & `ComparisonChatTurn.jsx`):** Single-line sticky `WorkspaceHeader` (`Hybrid`, `Vector`, `Graph` mode toggles + `New Chat`), user prompt bubbles, and structured answer cards featuring interactive `Summary`, `Matches`, and `Graph` pill tabs, source page badges (`p.1`, `p.3`), hop counters (`Graph: 5 hops`), and `Copy` / `Retry` actions.
  * **Per-Query Right Trace Column (`RetrievalTracePanel.jsx`):** Paired row-by-row alongside every chat turn (`xl:flex-row`), displaying live FAISS Vector and BM25 score bars, matched chunk snippets, and a visual Neo4j `(Subject) -[RELATION]-> (Object)` node diagram.
* **Mobile Single-Column Layout:**
  * Collapses the sidebar into a slide-out drawer triggered by a compact `Menu` button in `WorkspaceHeader` (`whitespace-nowrap` prevents multi-line header wrapping on narrow screens).
  * Stacks each turn's `RetrievalTracePanel` cleanly beneath its answer card so mobile users can inspect retrieval telemetry without horizontal scrolling.

### 4.2 Interactive Live Knowledge Graph Explorer (`ArchitectureExplorerView.jsx`)
* Connects to `GET /api/graph` to fetch live Neo4j nodes and edges.
* Renders an interactive radial SVG topology map where clicking any node highlights its incoming/outgoing relationships, dims unrelated nodes, filters the edge list panel, and pre-populates a targeted architectural question for one-click execution in **AI Architect Chat**.

---

## 5. Issues Encountered & Engineering Resolutions

| # | Issue / Symptom | Root Cause | Resolution Implemented |
| :--- | :--- | :--- | :--- |
| **1** | **Raw JSON & Escaped Formatting in Chat Output** | Backend structured responses or stringified JSON payloads with literal `\n` and `**` markdown markers rendered directly in UI bubbles. | Built `extractReadableText()` in `App.jsx` to safely parse JSON strings, extract `best_answer`/`answer`, normalize escaped newlines, and strip raw markdown artifacts, paired with `FormattedText` bullet rendering in `ComparisonChatTurn.jsx`. |
| **2** | **Mobile Query Failures (`Unable to fetch response: Load failed`)** | Multi-stage hybrid retrieval + 3 LLM calls exceeded default mobile browser/carrier idle tolerances, throwing opaque WebKit `TypeError: Load failed` errors; narrow screens also wrapped header buttons onto 3 lines. | Added an `AbortController` with a `120,000 ms` timeout and friendly retry messaging in `App.jsx`, added a `Retry` button on turns, and enforced `whitespace-nowrap` + compact sizing in `WorkspaceHeader.jsx`. |
| **3** | **Static / Identical Retrieval Trace Metrics Across Queries** | A single trace panel was pinned at the top of the page and populated with estimated scores based solely on chunk count (`0.87` / `0.68`), forcing users to scroll up and hiding per-query differences. | Added real `retrieval_trace` telemetry (RRF/keyword scores, top chunk previews, distinct relation hops, and live triples) to `retriever.py` and rendered a dedicated `RetrievalTracePanel` beside each individual chat turn. |
| **4** | **Stale PDF & Pre-Data Inconsistencies Across Stack** | Guardrails enforced a `1,500`-char limit while frontend enforced `1,000`; deleted PDFs needed full cleanup across FAISS, BM25, and Neo4j rather than partial file deletion; upload progress lacked visual feedback. | Aligned `MAX_QUERY_CHARS = 1000` across frontend and backend, implemented cascading deletion (`delete_document_by_id`) across all three stores, and replaced `fetch` uploads with `XMLHttpRequest` (`xhr.upload.onprogress`) driving a live `0%`–`100%` percentage badge. |
| **5** | **Placeholder Architecture View & Backend Import Errors** | `Tech Stack & Services` was initially a static prompt box; adding `GET /api/graph` in `main.py` initially triggered Pylance errors due to a missing `settings` import and strict dict typing. | Implemented `GET /api/graph` with `from config import settings` and `params: dict[str, Any]`, and upgraded `ArchitectureExplorerView.jsx` into an interactive SVG Neo4j node-and-edge explorer. |
| **6** | **Local Docker Build Failure (`npipe:////./pipe/dockerDesktopLinuxEngine`)** | Running `docker compose up --build -d` while Docker Desktop's Linux engine was stopped failed to connect to the daemon; local Compose also required HTTP without VPS SSL certificates. | Documented starting Docker Desktop prior to Compose builds and maintained gitignored local overrides (`docker-compose.override.yml` + `nginx.local.conf`) separate from production VPS SSL configurations. |

---

## 6. Deployment & Verification Workflow

### Local Development (Windows / Docker Desktop)
1. Start **Docker Desktop** and confirm the Linux engine status is **Engine running**.
2. Ensure `backend/.env` contains valid `OPENAI_API_KEY`, `NEO4J_URI`, `NEO4J_USERNAME`, and `NEO4J_PASSWORD` credentials.
3. Build and start the containers:
   ```cmd
   docker compose up --build -d
   docker compose ps
   ```
4. Verify locally at `http://localhost`:
   * Upload a `.pdf` and confirm the percentage badge progresses smoothly from `0%` to `100%`.
   * Run queries in `Hybrid`, `Vector`, and `Graph` modes and verify per-turn `Retrieval trace` cards update dynamically.
   * Open **Tech Stack & Services** to inspect live Neo4j nodes and edges.
   * Delete the uploaded PDF and verify `/api/documents` and `/api/graph` reflect complete cleanup.

### Production VPS Deployment (`vickycore.io` / `team-32.vickycore.io`)
1. Commit and push verified changes to the `main` branch on GitHub (`git add . && git commit -m "..." && git push origin main`).
2. Automated GitHub Actions (or SSH pull + `docker compose up --build -d`) updates the containers on the Hostinger VPS behind Nginx and Let's Encrypt SSL.
3. Confirm service health via `https://team-32.vickycore.io/api/health` and test both desktop and mobile viewports.