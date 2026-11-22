import uuid
from pathlib import Path
from typing import Any

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from config import settings
from guardrails import check_input_guardrail
from ingest import (
    INGEST_JOBS,
    UPLOADS_DIR,
    delete_document_by_id,
    ensure_storage_dirs,
    ingest_pdf,
    load_bm25_records,
    load_indexed_docs_meta,
    neo4j_driver,
    update_ingest_job,
)
from retriever import run_three_section_query

app = FastAPI(title="Spotify Hybrid RAG API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class ChatRequest(BaseModel):
    query: str = Field(..., min_length=1, max_length=1000)
    session_id: str = Field(default="default-session")
    mode: str = Field(default="hybrid")


@app.get("/api/health")
def health() -> dict[str, str]:
    neo4j_driver.verify_connectivity()
    return {"status": "ok"}


@app.get("/api/documents")
def list_documents() -> dict[str, list[dict[str, Any]]]:
    docs = load_indexed_docs_meta()
    return {
        "documents": [
            {
                "doc_id": d["doc_id"],
                "filename": d["filename"],
                "pages_indexed": d.get("pages_indexed", 0),
                "chunks_indexed": d.get("chunks_indexed", 0),
                "triples_stored": d.get("triples_stored", 0),
            }
            for d in docs
        ]
    }


@app.get("/api/upload-status/{job_id}")
def get_upload_status(job_id: str) -> dict[str, Any]:
    return INGEST_JOBS.get(
        job_id,
        {
            "job_id": job_id,
            "percent": 15,
            "stage": "Preparing document...",
            "done": False,
        },
    )


async def _handle_pdf_upload(
    file: UploadFile,
    job_id: str | None = None,
) -> dict[str, Any]:
    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only .pdf files are supported.")

    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="Uploaded PDF is empty.")

    max_bytes = 50 * 1024 * 1024
    if len(content) > max_bytes:
        raise HTTPException(status_code=413, detail="PDF exceeds the 50 MB upload limit.")

    ensure_storage_dirs()
    safe_name = Path(file.filename).name
    temp_prefix = str(uuid.uuid4())[:8]
    target_path = UPLOADS_DIR / f"{temp_prefix}_{safe_name}"
    target_path.write_bytes(content)

    try:
        summary = await ingest_pdf(target_path, safe_name, job_id=job_id)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception as exc:
        update_ingest_job(job_id, 100, "Failed", done=True, error=str(exc))
        raise

    return {"status": "indexed", **summary}


@app.post("/api/upload-pdf")
async def upload_pdf(
    file: UploadFile = File(...),
    job_id: str | None = None,
) -> dict[str, Any]:
    return await _handle_pdf_upload(file, job_id=job_id)


@app.post("/api/upload")
async def upload_pdf_alias(
    file: UploadFile = File(...),
    job_id: str | None = None,
) -> dict[str, Any]:
    return await _handle_pdf_upload(file, job_id=job_id)


@app.delete("/api/documents/{doc_id}")
async def delete_document(doc_id: str) -> dict[str, Any]:
    cleaned_id = doc_id.strip()
    if not cleaned_id:
        raise HTTPException(status_code=400, detail="Document ID is required.")
    return await delete_document_by_id(cleaned_id)


@app.get("/api/graph")
def get_live_graph(q: str = "", limit: int = 50) -> dict[str, Any]:
    indexed_docs = load_indexed_docs_meta()
    if not indexed_docs:
        return {
            "nodes": [],
            "edges": [],
            "triple_count": 0,
        }

    active_doc_ids = [d["doc_id"] for d in indexed_docs if d.get("doc_id")]
    active_filenames = [d["filename"] for d in indexed_docs if d.get("filename")]

    safe_limit = max(1, min(int(limit), 100))
    cleaned_q = (q or "").strip().lower()

    params: dict[str, Any] = {
        "doc_ids": active_doc_ids,
        "filenames": active_filenames,
        "limit": safe_limit,
    }

    search_clause = ""
    if cleaned_q:
        search_clause = """
        AND (
          toLower(s.name) CONTAINS $q
          OR toLower(o.name) CONTAINS $q
          OR toLower(r.type) CONTAINS $q
        )
        """
        params["q"] = cleaned_q

    cypher = f"""
    MATCH (s:Entity)-[r:RELATES]->(o:Entity)
    WHERE (r.doc_id IN $doc_ids OR r.filename IN $filenames)
    {search_clause}
    RETURN s.name AS subject,
           coalesce(s.type, 'Entity') AS subject_type,
           r.type AS relation,
           o.name AS object,
           coalesce(o.type, 'Entity') AS object_type,
           r.filename AS filename,
           r.page AS page
    LIMIT $limit
    """

    with neo4j_driver.session(database=settings.neo4j_database) as session:
        records = [dict(rec) for rec in session.run(cypher, **params)]

    nodes_map: dict[str, dict[str, str]] = {}
    edges: list[dict[str, Any]] = []

    for idx, row in enumerate(records):
        subj = row.get("subject")
        obj = row.get("object")
        rel = row.get("relation")
        if not subj or not obj or not rel:
            continue

        if subj not in nodes_map:
            nodes_map[subj] = {
                "id": subj,
                "label": subj,
                "type": row.get("subject_type") or "Entity",
            }
        if obj not in nodes_map:
            nodes_map[obj] = {
                "id": obj,
                "label": obj,
                "type": row.get("object_type") or "Entity",
            }

        edges.append(
            {
                "id": f"edge_{idx}",
                "source": subj,
                "relation": rel,
                "target": obj,
                "filename": row.get("filename"),
                "page": row.get("page"),
            }
        )

    return {
        "nodes": list(nodes_map.values()),
        "edges": edges,
        "triple_count": len(edges),
    }


@app.post("/api/chat")
async def chat(payload: ChatRequest) -> dict[str, Any]:
    cleaned_query = payload.query.strip()
    if not cleaned_query:
        raise HTTPException(status_code=400, detail="Query cannot be empty.")

    has_records = len(load_bm25_records()) > 0
    decision = await check_input_guardrail(cleaned_query, has_documents=has_records)

    if not decision.allowed:
        return {
            "blocked": True,
            "guardrail_reason": decision.reason,
            "vector_section": None,
            "graph_section": None,
            "comparison_section": None,
        }

    result = await run_three_section_query(cleaned_query)
    return {
        "blocked": False,
        "session_id": payload.session_id,
        "mode": payload.mode,
        **result,
    }