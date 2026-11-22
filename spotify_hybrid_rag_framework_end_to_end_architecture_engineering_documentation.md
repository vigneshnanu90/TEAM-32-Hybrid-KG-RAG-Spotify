# Spotify Hybrid RAG Framework: End-to-End Technical & Engineering Documentation

## 1. Executive Summary & System Overview

The **Spotify Hybrid RAG Framework** is a full-stack, mobile-responsive Retrieval-Augmented Generation (RAG) web application engineered to ingest unstructured and semi-structured PDF documents, index them across dense vector, lexical keyword, and property graph stores, and synthesize deterministic, document-grounded answers with live retrieval telemetry.

### High-Level Tech Stack

* **Frontend:** React 18, Vite, Tailwind CSS, SVG Pointer/Force Graph Canvas, `XMLHttpRequest` + stage polling (real-time backend ingestion progress), and `AbortController` (resilient mobile timeouts).
* **Backend:** Python 3.11+, FastAPI, Pydantic (Structured Outputs), `pypdf`, `langchain-text-splitters`.
* **Hybrid Storage & Retrieval Layer:**
  * **Dense Vector Store:** FAISS (`IndexFlatL2`) with OpenAI Embeddings.
  * **Lexical Search Store:** `rank-bm25` (`BM25Okapi`) persisted via pickle (`bm25_docs.pkl`).
  * **Knowledge Graph:** Neo4j Graph Database (`Entity` nodes and `RELATES` directed edges).
* **LLM & Synthesis:** OpenAI Chat Completions API (`temperature=0.0`) utilizing structured output parsing (`SectionAnswer`, `JudgeVerdict`, `TripleExtractionResult`, `GuardrailDecision`).
* **Deployment & Infrastructure:** Docker & Docker Compose, Nginx reverse proxy with Let's Encrypt SSL/TLS hosted on a Hostinger VPS (`vickycore.io` and `team-32.vickycore.io`), integrated with GitHub CI/CD (`main` branch).

## 2. Alignment with Architectural Design Requirements

The system implements all three architectural blueprints defined during project scoping:

1. **Data Ingestion & Storage Pipeline:**
   * Supports dynamic PDF upload without hardcoded or pre-seeded sample data.
   * Splits extracted text into overlapping chunks (`chunk_size=700`, `chunk_overlap=120`), generates embeddings for **FAISS**, tokenizes text for **BM25**, and extracts `(subject, relation, object)` triples via LLM for **Neo4j** (`EE -> RM -> GS`).
   * Enforces complete data lifecycle management: deleting a PDF purges its chunks from BM25, rebuilds/clears the FAISS index, removes tagged relationships and orphaned nodes in Neo4j, and deletes the raw file from disk.
2. **Hybrid Retrieval, Reranking & Augmentation (`S.P + U.Q + R.C`):**
   * Executes parallel **Vector + BM25** search (fused via Reciprocal Rank Fusion and keyword reranking) alongside **Neo4j Cypher traversal**.
   * Combines `{Chunks + Node Ref}` with the System Prompt (`S.P`), User Query (`U.Q`), and Retrieved Context (`R.C`) at `temperature=0.0` under strict grounding constraints so answers rely exclusively on the uploaded document's content.
3. **Production Deployment:**
   * Version-controlled in GitHub, containerized via multi-stage Docker builds, and served over HTTPS via Nginx on a Linux VPS.

## 3. Backend Technical Implementation Details

### 3.1 Document Ingestion, Live Progress Jobs & Lifecycle Management (`backend/ingest.py`, `backend/main.py`)

When a user uploads a `.pdf` via `POST /api/upload-pdf?job_id=...` (max 50 MB), the backend tracks progress in `INGEST_JOBS` (polled via `GET /api/upload-status/{job_id}`) across deterministic milestones:

1. **Extraction & Chunking (`18%`–`26%`):**
   * `extract_pdf_pages()` parses text page-by-page using `pypdf.PdfReader`.
   * `RecursiveCharacterTextSplitter(chunk_size=700, chunk_overlap=120)` breaks page text into semantically coherent chunks tagged with `chunk_id`, `doc_id`, `filename`, and `page`.
2. **Knowledge Graph Extraction (`30%`–`70%`):**
   * `extract_triples_from_chunk()` prompts OpenAI (`temperature=0`) with Pydantic schema `TripleExtractionResult` to extract entities (`subject`, `subject_type`, `object`, `object_type`) and normalized `UPPER_SNAKE_CASE` relations (e.g., `USES_TECH`, `PART_OF_LAYER`, `HANDLES`).
   * `write_triples_to_neo4j()` executes an idempotent `UNWIND` Cypher query using `MERGE` to create `:Entity` nodes and `[:RELATES {type, doc_id, page}]` edges (`ON CREATE SET r.filename = row.filename`), advancing the job percentage proportionally per page.
3. **Dense Vector Indexing (`75%`):**
   * Chunks are wrapped as LangChain `Document` objects and embedded using `OpenAIEmbeddings`.
   * Existing `storage/faiss_index` stores are updated via `aadd_documents()`, or initialized via `FAISS.afrom_documents()` and persisted locally.
4. **Lexical Indexing (`92%`–`100%`):**
   * Chunks are appended to `bm25_docs.pkl`. At query time, `tokenize()` normalizes lowercase alphanumeric tokens (`[a-z0-9]+`) to construct an in-memory `BM25Okapi` corpus.
   * Metadata is saved to `indexed_docs.json` and the job transitions to `100%` (`"Indexing complete"`).
5. **Cascading Deletion (`delete_document_by_id`):**
   * Matches records by both `doc_id` and `filename` so no residual chunks or triples remain.
   * Filters out deleted records from `bm25_docs.pkl`, wipes `faiss_index`, and rebuilds FAISS from remaining records (or leaves it empty when `0` documents remain).
   * Executes Cypher deletion for matching `RELATES` edges and removes orphaned `:Entity` nodes (`WHERE NOT (n)--()`).
   * `GET /api/graph` verifies `load_indexed_docs_meta()` and immediately returns an empty graph when `0` PDFs are active.

### 3.2 Input Guardrails (`backend/guardrails.py`)

Before running retrieval or LLM synthesis, `check_input_guardrail()` validates every incoming query:

* **Length & Empty Validation:** Rejects empty strings and enforces a strict `1,000`-character limit aligned with the frontend input field.
* **Regex Prompt-Injection Defense:** Blocks instruction-override patterns (e.g., `"ignore previous instructions"`, `"reveal system prompt"`, `"act as root/DAN"`).
* **Index Readiness Check:** Verifies `has_documents` (`len(load_bm25_records()) > 0`) and instructs the user to upload a PDF if the store is empty.
* **Semantic Policy Gate:** Uses a zero-temperature LLM classifier (`GuardrailDecision`) to permit legitimate architectural queries while blocking harmful, medical, financial, or legal requests.

### 3.3 Hybrid Retrieval, RRF Fusion & Deterministic Grounding (`backend/retriever.py`)

`run_three_section_query(query)` orchestrates parallel retrieval and deterministic grounded synthesis:

1. **Vector + BM25 Hybrid Search & Reranking (`_vector_and_bm25_search`):**
   * **Dense Retrieval:** Queries `FAISS.similarity_search(query, k=5)`.
   * **Sparse Retrieval:** Scores tokenized query terms against `BM25Okapi` and selects the top 5 positive-scoring chunks.
   * **Reciprocal Rank Fusion (RRF):** Combines dense and sparse rankings using:
     $$\text{Score}_{\text{RRF}}(d) = \sum_{r \in \{\text{FAISS}, \text{BM25}\}} \frac{1}{k + \text{rank}_r(d)}, \quad k = 60$$
   * **Keyword Reranking:** Applies a relevance boost (`+0.02` per matching query token $> 2$ characters) to reorder fused candidates before selecting the top $k=5$ chunks.
2. **Knowledge Graph Traversal (`_graph_search`):**
   * Extracts up to 6 meaningful keywords ($\text{length} > 2$) from the query and runs a case-insensitive Cypher match across `s.name`, `o.name`, and `r.type` to retrieve up to 20 matching `(subject, relation, object)` triples with source page metadata.
3. **Deterministic Document-Grounded Synthesis (`S.P + U.Q + R.C`) & Judge Evaluation:**
   * `_answer_from_vector_bm25` and `_answer_from_graph` run concurrently via `asyncio.gather()` at `GROUNDED_TEMPERATURE = 0.0`, summarizing matching details strictly from `[R.C - Retrieved Context]` without outside knowledge or inconsistent markdown code ticks.
   * When both vector chunks and graph triples contain relevant hits, `deterministic_winner` is fixed to `"Hybrid (Both)"` (falling back deterministically to `"Knowledge Graph"` or `"Vector + BM25"` when only one path has matches), and `judge_resp` synthesizes `best_answer` at `DEFAULT_TEMPERATURE = 0.0` with consistent overview + bullet formatting.
   * Live telemetry (`retrieval_trace`) returns `vector_score`, `bm25_score`, `chunks_retrieved`, `triples_retrieved`, `graph_hops`, `top_matches`, and `triples` for per-query UI rendering.

## 4. UI & Frontend Architecture Evolution

### 4.1 Mode-Isolated Chat & Adaptive Workspace Headers

* **Browser Title & Dynamic Mode Headers (`frontend/index.html`, `WorkspaceHeader.jsx`, `App.jsx`):**
  * Browser tab title is branded as **Spotify Architect RAG — Hybrid Vector, BM25 & Graph**.
  * Header and empty-state titles adapt dynamically to the selected mode: **Hybrid RAG — Vector, BM25 & Graph** (`hybrid`), **Vector + BM25 Retrieval** (`vector`), and **Neo4j GraphRAG Explorer** (`graph`), as well as **Live Knowledge Graph — Nodes & Edges** and **Document Indexer — FAISS, BM25 & Neo4j** for secondary views.
* **Mode-Specific Loading & Result Isolation (`ComparisonChatTurn.jsx`, `App.jsx`):**
  * In-flight turns display mode-accurate progress messages (`Running Vector + BM25 search across indexed chunks...`, `Running Neo4j GraphRAG search across entity relationships...`, or `Running Hybrid RAG search across Vector, BM25, and Graph...`).
  * **Hybrid Mode** renders `Best Match`, `Vector`, and `Graph` tabs with `Best Match` selected by default.
  * **Vector Mode** renders only the **Vector** tab and source page badges while ignoring graph results and hop badges.
  * **Graph Mode** renders only the **Graph** tab and relationship hop badges while ignoring vector chunk results.
* **Per-Query Right Trace Column (`RetrievalTracePanel.jsx`):** Paired row-by-row alongside every chat turn (`xl:flex-row`), displaying live FAISS Vector and BM25 score bars, matched chunk snippets, and a visual Neo4j `(Subject) -[RELATION]-> (Object)` node diagram.

### 4.2 Interactive Force-Directed Knowledge Graph Explorer (`ArchitectureExplorerView.jsx`)

`ArchitectureExplorerView.jsx` provides an interactive graph canvas backed by `GET /api/graph`:

* **Connected-Component Island Packing (`layoutIslands`):** Uses Union-Find to partition the graph into connected components and arranges them as non-overlapping islands (largest cluster centered, smaller clusters spiraled outward) so disconnected groups never pile onto each other.
* **d3-Force-Style Physics Simulation (`tickSimulation`):** Combines intra-component Coulomb repulsion, edge spring attraction scaled by node radius and degree, anchor gravity, and circle collision resolution (`minD = a.r + b.r + 30`) with smooth alpha decay (`ALPHA_DECAY = 0.972`) and golden-angle spiral seeding.
* **Multi-Touch & Pointer Interactions:**
  * Drag individual nodes (`fx`/`fy` pinning during drag, released on pointer up) to inspect local neighborhoods dynamically.
  * Drag background to pan; scroll wheel or two-finger pinch to zoom (`0.35x` to `4x`) around the cursor/midpoint, plus `+`, `−`, and zoom-to-fit (`⤢`) controls.
* **Semantic Visual Encoding & Decluttering:**
  * Scales node radius by degree ($7 + 3.6\sqrt{\text{degree}}$), color-codes nodes by entity type (`Hub`/`Service` emerald, `Component`/`Feature` violet, `Data`/`Database` amber, `API` sky blue), and renders toggleable type filter pills (`hiddenTypes`).
  * Declutters dense graphs by showing labels for selected nodes, search matches, hovered nodes, immediate neighbors, top hubs, or any node when zoomed past `LABEL_ZOOM = 1.6`, and renders amber relation pills along highlighted edges.
* **Inspector & One-Click Chat Integration:** Displays the selected node's type, connection count, clickable incoming/outgoing relationship cards with source page numbers, top-hub quick-select buttons when idle, and a direct **Ask AI about this node** input form.

## 5. Issues Encountered & Engineering Resolutions

| # | Issue / Symptom | Root Cause | Resolution Implemented |
| :--- | :--- | :--- | :--- |
| **1** | **Raw JSON & Escaped Formatting in Chat Output** | Backend structured responses or stringified JSON payloads with literal `\n` and `**` markdown markers rendered directly in UI bubbles. | Built `extractReadableText()` in `App.jsx` to parse JSON strings, extract `best_answer`/`answer`, normalize escaped newlines, and strip markdown artifacts, paired with `FormattedText` bullet rendering in `ComparisonChatTurn.jsx`. |
| **2** | **Mobile Query Failures (`Load failed`) & Header Wrapping** | Multi-stage hybrid retrieval + LLM calls exceeded mobile browser idle tolerances; narrow screens wrapped header buttons onto multiple lines. | Added an `AbortController` (`120,000 ms` timeout) and `Retry` button in `App.jsx`, and enforced responsive layout rules in `WorkspaceHeader.jsx`. |
| **3** | **Static / Identical Retrieval Trace Metrics Across Queries** | A single trace panel was pinned at the top of the page and populated with estimated scores based solely on chunk count (`0.87` / `0.68`). | Added real `retrieval_trace` telemetry (RRF/keyword scores, top chunk previews, distinct relation hops, and live triples) to `retriever.py` and rendered a dedicated `RetrievalTracePanel` beside each individual chat turn. |
| **4** | **Residual Graph/Chunk Data After Deleting a PDF** | Deleting a PDF only matched `doc_id` in some stores or left orphaned Neo4j edges visible in `GET /api/graph` even when `0 PDFs` were indexed. | Updated `delete_document_by_id()` to match by both `doc_id` and `filename` across BM25, FAISS, and Neo4j (including orphan node cleanup), and updated `GET /api/graph` to return empty results immediately when `indexed_docs.json` is empty. |
| **5** | **LLM Off-Topic Hallucinations vs. Over-Refusal** | Initial prompts allowed pre-trained knowledge on unrelated PDFs; an initial strict pass caused over-refusal on valid backend architecture queries. | Balanced prompts in `retriever.py` so the LLM summarizes matching facts directly from `[R.C - Retrieved Context]` and only refuses when retrieved passages/triples contain no relevant facts. |
| **6** | **Upload Progress Jumping Immediately to `100%`** | `xhr.upload.onprogress` only tracked browser-to-server network transfer, hitting `100%` before backend splitting, Neo4j extraction, and embedding finished. | Added server-side `INGEST_JOBS` tracking (`GET /api/upload-status/{job_id}`) in `ingest.py`/`main.py` and paired `0%–15%` network upload with `700 ms` stage polling in `App.jsx`, `PdfSidebar.jsx`, and `DocumentManagerView.jsx`. |
| **7** | **Node Clumping in Knowledge Graph Visualization** | Initial physics pulled nodes toward the center without island separation or collision avoidance, causing nodes and labels to overlap. | Rebuilt `ArchitectureExplorerView.jsx` with connected-component island packing (`layoutIslands`), force-directed repulsion + collision resolution (`tickSimulation`), zoom/pan/drag gestures, type filter pills, and hub-based label decluttering. |
| **8** | **Inconsistent Winner & Formatting on Repeated Identical Queries** | Judge and section LLM calls sampled at `temperature=0.5`/`0.3` without a deterministic winner tie-breaker, flipping between prose/bullets and `Graph` vs. `Vector` winners. | Set `DEFAULT_TEMPERATURE = 0.0` and `GROUNDED_TEMPERATURE = 0.0` in `retriever.py` and enforced deterministic `winner` selection and consistent formatting. |
| **9** | **Mode Mismatch in Loading Text & Mixed Results in Vector/Graph Modes** | Loading status hardcoded `"Running hybrid retrieval..."` and `ComparisonChatTurn` displayed all three tabs (`Best Match`, `Vector`, `Graph`) even when `Vector` or `Graph` mode was selected. | Updated `WorkspaceHeader.jsx`, `ComparisonChatTurn.jsx`, `App.jsx`, and `index.html` to reflect the active mode in the title and loading indicator, and isolated `Vector` and `Graph` modes so each displays only its respective result. |

## 6. Deployment & Verification Workflow

### Local Development (Windows / Docker Desktop)

1. Start **Docker Desktop** and confirm the Linux engine status is **Engine running**.
2. Ensure `backend/.env` contains valid `OPENAI_API_KEY`, `NEO4J_URI`, `NEO4J_USERNAME`, and `NEO4J_PASSWORD` credentials.
3. Build and start the containers:
   ```bash
   docker compose up --build -d
   docker compose ps
   ```
4. Verify locally at `http://localhost`:
   * Upload a `.pdf` and verify real-time stage progress (`Upload`, `Split Text`, `Graph Nodes`, `FAISS & BM25`) before hitting `100%`.
   * Test **Hybrid** (`Best Match`, `Vector`, `Graph`), **Vector** (Vector result only), and **Graph** (Graph result only) modes, and ask identical queries twice to confirm consistent answers.
   * Open **Tech Stack & Services** to test island-packed force layout, node dragging, zoom/pan, type filter pills, and node inspection.
   * Delete the uploaded PDF and verify `0 PDFs` and `0 Nodes` / `0 Edges`.

### Production VPS Deployment (`vickycore.io` / `team-32.vickycore.io`)

1. Commit and push verified changes to `main` on GitHub (`git add . && git commit -m "..." && git push origin main`).
2. Automated GitHub Actions (or SSH pull + `docker compose up --build -d`) updates the containers on the Hostinger VPS behind Nginx and Let's Encrypt SSL.
3. Confirm service health via `https://team-32.vickycore.io/api/health` and verify both desktop and mobile viewports.