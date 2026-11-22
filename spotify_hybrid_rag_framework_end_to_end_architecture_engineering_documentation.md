# Spotify Hybrid RAG Framework: End-to-End Technical & Engineering Documentation

## 1. Executive Summary & System Overview

The **Spotify Hybrid RAG Framework** is a full-stack, mobile-responsive Retrieval-Augmented Generation (RAG) web application engineered to ingest unstructured and semi-structured documents (`.pdf`, `.md`, `.json`, `.xml`, `.txt`, `.csv`), index them across dense vector, lexical keyword, and property graph stores, and synthesize deterministic, document-grounded answers with verified citations, live retrieval telemetry, and automated evaluation benchmarks.

### High-Level Tech Stack

* **Frontend:** React 18, Vite, Tailwind CSS, SVG Pointer/Force Graph Canvas, `XMLHttpRequest` + stage polling (real-time backend ingestion progress), and `AbortController` (resilient mobile timeouts).
* **Backend:** Python 3.11+, FastAPI, Pydantic (Structured Outputs), `pypdf`, `langchain-text-splitters`, standard-library `json` / `xml.etree.ElementTree`.
* **Hybrid Storage & Retrieval Layer:**
  * **Storage Root (`RAG_STORAGE_DIR`):** Configurable persistent directory (e.g., `backend/storage` locally on Windows or `/app/storage` / `/app/data` in Docker/VPS) holding `faiss_index`, `bm25_docs.pkl`, `indexed_docs.json`, and `uploads`.
  * **Dense Vector Store:** FAISS (`IndexFlatL2`) with OpenAI Embeddings.
  * **Lexical Search Store:** `rank-bm25` (`BM25Okapi`) persisted via pickle (`bm25_docs.pkl`).
  * **Knowledge Graph:** Neo4j Graph Database (`Entity` nodes and `RELATES` directed edges).
* **LLM & Synthesis:** OpenAI Chat Completions API (`temperature=0.0`) utilizing structured output parsing (`SectionAnswer`, `JudgeVerdict`, `TripleExtractionResult`), paired with post-generation citation verification.
* **Testing, Evaluation & Deployment:** `pytest` unit test suite, `eval_rag.py` automated retrieval benchmark (`docs/EVAL.md`), Docker & Docker Compose, Nginx reverse proxy with Let's Encrypt SSL/TLS hosted on a Hostinger VPS (`vickycore.io` and `team-32.vickycore.io`), integrated with GitHub CI/CD (`main` branch).

## 2. Alignment with Architectural Design Requirements

The system implements the core architectural and engineering practices defined for production RAG and GraphRAG pipelines:

1. **Multi-Format Data Ingestion & Storage Pipeline:**
   * Supports uploading `.pdf` alongside semi-structured and text/data formats (`.md`, `.json`, `.xml`, `.txt`, `.csv`) via `POST /api/upload-pdf` and `POST /api/upload` without hardcoded sample data.
   * Extracts readable blocks per format (`extract_blocks_from_file`), splits text into overlapping chunks, generates embeddings for **FAISS**, tokenizes text for **BM25**, and extracts `(subject, relation, object)` triples via LLM for **Neo4j** (`EE -> RM -> GS`).
   * Enforces complete data lifecycle management: deleting a document purges its chunks from BM25, rebuilds/clears the FAISS index, removes tagged relationships and orphaned nodes in Neo4j, and deletes the stored file from disk.
2. **Hybrid Retrieval, Reranking & Augmentation (`S.P + U.Q + R.C`):**
   * Executes parallel **Vector + BM25** search (fused via Reciprocal Rank Fusion and keyword reranking) alongside **Neo4j Cypher traversal**.
   * Combines `{Chunks + Node Ref}` with the System Prompt (`S.P`), User Query (`U.Q`), and Retrieved Context (`R.C`) at `temperature=0.0` under strict grounding and post-generation citation verification so answers rely exclusively on the uploaded content.
3. **Automated Quality Assurance & Production Deployment:**
   * Verified by a `pytest` unit test suite (`backend/tests/test_rag_pipeline.py`) and an automated ground-truth evaluation script (`backend/eval_rag.py` outputting `docs/EVAL.md` with Hit@3, Hit@5, and MRR metrics).
   * Version-controlled in GitHub, containerized via multi-stage Docker builds, and served over HTTPS via Nginx on a Linux VPS.

## 3. Backend Technical Implementation Details

### 3.1 Multi-Format Ingestion, Live Progress Jobs & Lifecycle Management (`backend/ingest.py`, `backend/main.py`)

When a user uploads a supported file (`.pdf`, `.md`, `.json`, `.xml`, `.txt`, `.csv`, up to 50 MB) via `POST /api/upload-pdf` or `POST /api/upload` with an optional `job_id`, the backend tracks progress in `INGEST_JOBS` (polled via `GET /api/upload-status/{job_id}`) across deterministic milestones:

1. **Validation & Format-Aware Extraction (`18%`–`22%`):**
   * `is_supported_file()` validates extensions against `{".pdf", ".md", ".json", ".xml", ".txt", ".csv"}`.
   * `extract_blocks_from_file()` parses `.pdf` page-by-page via `pypdf.PdfReader`, pretty-prints `.json` objects, extracts tags/attributes/text from `.xml` via `xml.etree.ElementTree`, splits `.md` along top-level headings, and reads `.txt`/`.csv` blocks.
2. **Chunking & Dense/Lexical Indexing (`22%`–`48%`):**
   * Chunks extracted blocks and tags each chunk with `chunk_id`, `doc_id`, `filename`, and `page`.
   * Updates or creates the FAISS index under `$RAG_STORAGE_DIR/faiss_index` and appends chunk records to `$RAG_STORAGE_DIR/bm25_docs.pkl`.
3. **Knowledge Graph Extraction (`72%`–`96%`):**
   * `_extract_triples_from_chunk()` prompts OpenAI (`temperature=0.0`) with Pydantic schema `TripleExtractionResult` to extract entities (`subject`, `subject_type`, `object`, `object_type`) and normalized `UPPER_SNAKE_CASE` relations.
   * `_write_triples_to_neo4j()` executes an idempotent `UNWIND` Cypher query using `MERGE` to create `:Entity` nodes and `[:RELATES {type, doc_id, page}]` edges (`SET r.filename = row.filename`), updating job progress per chunk batch.
4. **Completion & Metadata Persistence (`100%`):**
   * Records document metadata (`doc_id`, `filename`, `stored_path`, `pages_indexed`, `chunks_indexed`, `triples_stored`) in `$RAG_STORAGE_DIR/indexed_docs.json` and marks the job `completed` at `100%`.
5. **Cascading Deletion (`delete_document_by_id`):**
   * Matches records by `doc_id` (and `filename` in Neo4j) so no residual chunks or triples remain.
   * Filters out deleted records from `bm25_docs.pkl`, removes `faiss_index` when empty or rebuilds it from remaining records, deletes matching `RELATES` edges and orphaned `:Entity` nodes in Neo4j, and removes the file from disk.

### 3.2 Input Guardrails & Post-Generation Citation Verification (`backend/guardrails.py`)

Every query passes through both pre-retrieval input validation and post-generation citation verification:

* **Input Validation (`check_input_guardrail`):**
  * **Length & Empty Validation:** Rejects empty strings and enforces a strict `1,000`-character limit aligned with the frontend input field.
  * **Regex Prompt-Injection Defense:** Blocks instruction-override patterns (`ignore previous instructions`, `reveal system prompt`, `bypass safety/guardrails/rules`).
  * **Index Readiness Check:** Verifies `has_documents` and instructs the user to upload a document if the knowledge store is empty.
* **Post-Generation Citation Verification (`verify_citations`):**
  * Extracts valid source indices ($1 \dots N$) and allowed page numbers (`p.X`) from the retrieved `sources` list.
  * Strips any bracketed numeric citations (`[n]`) or page references (`p.X`, `(p. X)`) in the LLM's output that do not map to the actual retrieved chunks or graph triples, normalizing whitespace and punctuation afterward.

### 3.3 Hybrid Retrieval, RRF Fusion & Deterministic Grounding (`backend/retriever.py`)

`run_three_section_query(query)` orchestrates parallel retrieval, deterministic grounded synthesis, and citation verification:

1. **Vector + BM25 Hybrid Search & Reranking (`_vector_and_bm25_search`):**
   * **Dense Retrieval:** Queries `FAISS.similarity_search(query, k=top_k)`.
   * **Sparse Retrieval:** Scores tokenized query terms against `BM25Okapi` and selects positive-scoring chunks.
   * **Reciprocal Rank Fusion (RRF):** Combines dense and sparse rankings using:
     $$\text{Score}_{\text{RRF}}(d) = \sum_{r \in \{\text{FAISS}, \text{BM25}\}} \frac{1}{k + \text{rank}_r(d)}, \quad k = 60$$
   * **Keyword Reranking:** Applies a relevance boost (`+0.02` per matching query token $> 2$ characters) to reorder fused candidates before selecting the top `top_k` chunks.
2. **Knowledge Graph Traversal (`_graph_search`):**
   * Extracts up to 6 meaningful keywords ($\text{length} > 2$) from the query and runs a case-insensitive Cypher match across `s.name`, `o.name`, and `r.type` to retrieve up to 20 matching `(subject, relation, object)` triples with source page metadata.
3. **Deterministic Document-Grounded Synthesis (`S.P + U.Q + R.C`) & Judge Evaluation:**
   * `_answer_from_vector_bm25` and `_answer_from_graph` run concurrently via `asyncio.gather()` at `GROUNDED_TEMPERATURE = 0.0`, summarizing matching details strictly from `[R.C - Retrieved Context]`, stripping hallucinated citations via `verify_citations()`, and refusing only when retrieved passages/triples contain no relevant facts.
   * When both vector chunks and graph triples contain relevant hits, `deterministic_winner` is fixed to `"Hybrid (Both)"` (falling back deterministically to `"Knowledge Graph"` or `"Vector + BM25"` when only one path has matches), and `judge_resp` synthesizes `best_answer` at `DEFAULT_TEMPERATURE = 0.0` followed by `verify_citations(verdict.best_answer, all_sources)`.
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

## 5. Automated Testing & Retrieval Evaluation (`backend/tests/`, `docs/EVAL.md`)

### 5.1 `pytest` Unit Test Suite (`backend/tests/test_rag_pipeline.py`)

Six automated unit tests validate core reliability and safety invariants without requiring live external network calls:

* `test_guardrail_blocks_empty_store`: Verifies queries are blocked with a clear upload prompt when `has_documents=False`.
* `test_guardrail_blocks_prompt_injection`: Ensures instruction-override strings are blocked by regex guardrails.
* `test_guardrail_allows_valid_domain_query`: Confirms legitimate architecture queries pass input validation.
* `test_verify_citations_keeps_valid_and_strips_hallucinated_refs`: Verifies valid citations (`[1]`, `p.1`, `(p. 6)`) are preserved while ungrounded references (`[9]`, `p.42`, `(p. 99)`) are stripped.
* `test_tokenize_normalizes_punctuation_and_case`: Ensures consistent lowercase alphanumeric tokenization for BM25 and keyword reranking.
* `test_delete_document_by_id_cleans_bm25_faiss_uploads_and_neo4j`: Uses temporary directories and a mocked Neo4j driver to confirm deleting a document clears BM25 records, metadata, uploaded files, and Neo4j relationships.

### 5.2 Ground-Truth Retrieval Evaluation (`backend/eval_rag.py` & `docs/EVAL.md`)

`eval_rag.py` runs automated retrieval evaluation against `backend/tests/eval_questions.json` and writes a timestamped report to `docs/EVAL.md`:

* **Hit@3:** `100.00%` (6 / 6 queries retrieved a ground-truth relevant chunk in the top 3 results)
* **Hit@5:** `100.00%` (6 / 6 queries retrieved a ground-truth relevant chunk in the top 5 results)
* **Mean Reciprocal Rank (MRR):** `0.8889` (5 of 6 queries hit at rank `1`, and 1 query hit at rank `3`)

## 6. Issues Encountered & Engineering Resolutions

| \# | Issue / Symptom | Root Cause | Resolution Implemented |
| :--- | :--- | :--- | :--- |
| **1** | **Raw JSON & Escaped Formatting in Chat Output** | Backend structured responses or stringified JSON payloads with literal `\n` and `**` markdown markers rendered directly in UI bubbles. | Built `extractReadableText()` in `App.jsx` to parse JSON strings, extract `best_answer`/`answer`, normalize escaped newlines, and strip markdown artifacts, paired with `FormattedText` bullet rendering in `ComparisonChatTurn.jsx`. |
| **2** | **Mobile Query Failures (`Load failed`) & Header Wrapping** | Multi-stage hybrid retrieval + LLM calls exceeded mobile browser idle tolerances; narrow screens wrapped header buttons onto multiple lines. | Added an `AbortController` (`120,000 ms` timeout) and `Retry` button in `App.jsx`, and enforced responsive layout rules in `WorkspaceHeader.jsx`. |
| **3** | **Static / Identical Retrieval Trace Metrics Across Queries** | A single trace panel was pinned at the top of the page and populated with estimated scores based solely on chunk count (`0.87` / `0.68`). | Added real `retrieval_trace` telemetry (RRF/keyword scores, top chunk previews, distinct relation hops, and live triples) to `retriever.py` and rendered a dedicated `RetrievalTracePanel` beside each individual chat turn. |
| **4** | **Residual Graph/Chunk Data After Deleting a Document** | Deleting a file only matched `doc_id` in some stores or left orphaned Neo4j edges visible in `GET /api/graph` even when `0` documents were indexed. | Updated `delete_document_by_id()` to match by both `doc_id` and `filename` across BM25, FAISS, and Neo4j (including orphan node cleanup), and updated `GET /api/graph` to return empty results immediately when `indexed_docs.json` is empty. |
| **5** | **LLM Off-Topic Hallucinations, Over-Refusal & Unverified Citations** | Initial prompts allowed pre-trained knowledge on unrelated documents; an initial strict pass caused over-refusal, and responses lacked post-generation citation validation. | Balanced prompts in `retriever.py` so the LLM summarizes matching facts directly from `[R.C - Retrieved Context]` and added `verify_citations()` in `guardrails.py` to strip any `[n]` or `p.X` reference not present in retrieved sources. |
| **6** | **Upload Progress Jumping Immediately to `100%`** | `xhr.upload.onprogress` only tracked browser-to-server network transfer, hitting `100%` before backend splitting, Neo4j extraction, and embedding finished. | Added server-side `INGEST_JOBS` tracking (`GET /api/upload-status/{job_id}`) in `ingest.py`/`main.py` and paired `0%–15%` network upload with `700 ms` stage polling in `App.jsx`, `PdfSidebar.jsx`, and `DocumentManagerView.jsx`. |
| **7** | **Node Clumping in Knowledge Graph Visualization** | Initial physics pulled nodes toward the center without island separation or collision avoidance, causing nodes and labels to overlap. | Rebuilt `ArchitectureExplorerView.jsx` with connected-component island packing (`layoutIslands`), force-directed repulsion + collision resolution (`tickSimulation`), zoom/pan/drag gestures, type filter pills, and hub-based label decluttering. |
| **8** | **Inconsistent Winner & Formatting on Repeated Identical Queries** | Judge and section LLM calls sampled at `temperature=0.5`/`0.3` without a deterministic winner tie-breaker, flipping between prose/bullets and `Graph` vs. `Vector` winners. | Set `DEFAULT_TEMPERATURE = 0.0` and `GROUNDED_TEMPERATURE = 0.0` in `retriever.py` and enforced deterministic `winner` selection and consistent formatting. |
| **9** | **Mode Mismatch in Loading Text & Mixed Results in Vector/Graph Modes** | Loading status hardcoded `"Running hybrid retrieval..."` and `ComparisonChatTurn` displayed all three tabs (`Best Match`, `Vector`, `Graph`) even when `Vector` or `Graph` mode was selected. | Updated `WorkspaceHeader.jsx`, `ComparisonChatTurn.jsx`, `App.jsx`, and `index.html` to reflect the active mode in the title and loading indicator, and isolated `Vector` and `Graph` modes so each displays only its respective result. |
| **10** | **PDF-Only Upload Restriction & `RAG_STORAGE_DIR` Path Mismatch During Eval** | Uploads were restricted to `.pdf`, and running `eval_rag.py` without `RAG_STORAGE_DIR` pointing to `backend/storage` read an empty directory (`0.00%` metrics). | Added `.pdf`, `.md`, `.json`, `.xml`, `.txt`, and `.csv` support in `ingest.py`, `main.py`, and UI file pickers, and aligned `RAG_STORAGE_DIR` with `backend/storage` (`100.00%` Hit@3/Hit@5, `0.8889` MRR). |

## 7. Deployment & Verification Workflow

### Local Development (Windows / Docker Desktop)

1. Start **Docker Desktop** and confirm the Linux engine status is **Engine running**.
2. Ensure `backend/.env` contains valid `OPENAI_API_KEY`, `NEO4J_URI`, `NEO4J_USERNAME`, `NEO4J_PASSWORD`, and `RAG_STORAGE_DIR` (pointing to your local `backend/storage` directory on Windows).
3. Build and start the containers:

```bash
docker compose up --build -d
docker compose ps
```

4. Run automated unit tests and retrieval evaluation from `backend/` (with `RAG_STORAGE_DIR` set to `backend/storage`):

```bash
pytest -v
python eval_rag.py
```

5. Verify locally at `http://localhost`:
   * Upload a `.pdf` or supported `.md` / `.json` / `.xml` / `.txt` / `.csv` file and verify real-time stage progress (`Upload`, `Split Text`, `Graph Nodes`, `FAISS & BM25`).
   * Switch between **Hybrid**, **Vector**, and **Graph** modes to confirm isolated views and per-query retrieval traces.
   * Open the **Live Knowledge Graph** to pan, zoom, drag nodes, filter by type, and click **Ask AI about this node**.
   * Delete an indexed document and verify that chunks, graph nodes/edges, and stored uploads are cleanly purged.

### Production VPS Deployment (`vickycore.io` & `team-32.vickycore.io`)

1. Commit and push changes to `main` on GitHub (`git push origin main`) to trigger `.github/workflows/deploy.yml` (or run `git pull origin main && docker compose up --build -d` directly on the VPS).
2. Confirm containers are healthy (`docker compose ps`) and verify live HTTPS responses across `https://team-32.vickycore.io`.