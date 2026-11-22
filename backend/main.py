import os
import re
import uuid
from typing import Any

from fastapi import FastAPI, File, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from config import settings
from guardrails import check_input_guardrail
from ingest import (
    INGEST_JOBS,
    UPLOADS_DIR,
    delete_document_by_id,
    ensure_storage_dirs,
    get_ingest_job_status,
    ingest_document_file,
    is_supported_file,
    load_bm25_records,
    load_indexed_docs_meta,
    neo4j_driver,
    update_ingest_job,
)
from retriever import run_three_section_query

_NEO4J_DATABASE = (
    getattr(settings, "neo4j_database", None)
    or os.getenv("NEO4J_DATABASE", "neo4j")
)
MAX_UPLOAD_BYTES = 50 * 1024 * 1024

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
    mode: str = Field(default="hybrid")


def _safe_filename(filename: str) -> str:
    base = os.path.basename(filename or "document.pdf")
    return re.sub(r"[^A-Za-z0-9._-]+", "_", base) or "document.pdf"


@app.get("/api/health")
def health_check() -> dict[str, Any]:
    docs = load_indexed_docs_meta()
    chunks = load_bm25_records()
    return {
        "status": "ok",
        "documents_count": len(docs),
        "chunks_count": len(chunks),
    }


@app.get("/api/documents")
def list_documents() -> dict[str, Any]:
    docs = load_indexed_docs_meta()
    return {"documents": docs, "count": len(docs)}


@app.get("/api/upload-status/{job_id}")
def get_upload_status(job_id: str) -> dict[str, Any]:
    job = get_ingest_job_status(job_id)
    done = job.get("status") in {"completed", "failed"}
    return {**job, "done": done}


async def _handle_file_upload(
    file: UploadFile,
    job_id: str | None = None,
) -> dict[str, Any]:
    ensure_storage_dirs()
    active_job_id = job_id or f"job_{uuid.uuid4().hex[:10]}"
    update_ingest_job(active_job_id, 18, "Validating uploaded file...")

    if not is_supported_file(file.filename or ""):
        update_ingest_job(
            active_job_id,
            100,
            "Unsupported file type",
            status="failed",
            error="Unsupported file type",
        )
        raise HTTPException(
            status_code=400,
            detail="Unsupported file type. Allowed formats: .pdf, .md, .json, .xml, .txt, .csv",
        )

    content = await file.read()
    if not content:
        update_ingest_job(
            active_job_id,
            100,
            "Uploaded file is empty",
            status="failed",
            error="Uploaded file is empty",
        )
        raise HTTPException(status_code=400, detail="Uploaded file is empty.")

    if len(content) > MAX_UPLOAD_BYTES:
        update_ingest_job(
            active_job_id,
            100,
            "File exceeds 50 MB limit",
            status="failed",
            error="File exceeds 50 MB limit",
        )
        raise HTTPException(
            status_code=400,
            detail="File size exceeds the 50 MB limit.",
        )

    doc_id = f"doc_{uuid.uuid4().hex[:8]}"
    clean_name = _safe_filename(file.filename or "document.pdf")
    stored_path = str(UPLOADS_DIR / f"{doc_id}_{clean_name}")

    with open(stored_path, "wb") as f:
        f.write(content)

    try:
        summary = await ingest_document_file(
            doc_id=doc_id,
            filename=clean_name,
            stored_path=stored_path,
            job_id=active_job_id,
        )
        return {**summary, "job_id": active_job_id}
    except Exception as exc:
        update_ingest_job(
            active_job_id,
            100,
            "Indexing failed",
            status="failed",
            error=str(exc),
        )
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/api/upload-pdf")
async def upload_pdf(
    file: UploadFile = File(...),
    job_id: str | None = Query(default=None),
) -> dict[str, Any]:
    return await _handle_file_upload(file=file, job_id=job_id)


@app.post("/api/upload")
async def upload_document(
    file: UploadFile = File(...),
    job_id: str | None = Query(default=None),
) -> dict[str, Any]:
    return await _handle_file_upload(file=file, job_id=job_id)


@app.delete("/api/documents/{doc_id}")
async def delete_document(doc_id: str) -> dict[str, Any]:
    return await delete_document_by_id(doc_id)


@app.get("/api/graph")
def get_graph(
    limit: int = Query(default=50, ge=1, le=200),
    q: str = Query(default=""),
) -> dict[str, Any]:
    term = (q or "").strip().lower()
    cypher = """
    MATCH (s:Entity)-[r:RELATES]->(o:Entity)
    WHERE $term = '' OR
          toLower(s.name) CONTAINS $term OR
          toLower(o.name) CONTAINS $term OR
          toLower(r.type) CONTAINS $term
    RETURN elementId(s) AS s_id, s.name AS s_name, coalesce(s.type, 'Component') AS s_type,
           elementId(o) AS o_id, o.name AS o_name, coalesce(o.type, 'Component') AS o_type,
           elementId(r) AS e_id, r.type AS relation, r.page AS page
    LIMIT $limit
    """
    nodes_map: dict[str, dict[str, Any]] = {}
    edges_list: list[dict[str, Any]] = []

    with neo4j_driver.session(database=_NEO4J_DATABASE) as session:
        records = list(session.run(cypher, term=term, limit=limit))

    for idx, rec in enumerate(records):
        s_id = str(rec["s_id"] or f"s_{idx}")
        o_id = str(rec["o_id"] or f"o_{idx}")

        if s_id not in nodes_map:
            nodes_map[s_id] = {
                "id": s_id,
                "label": rec["s_name"] or s_id,
                "type": rec["s_type"] or "Component",
            }
        if o_id not in nodes_map:
            nodes_map[o_id] = {
                "id": o_id,
                "label": rec["o_name"] or o_id,
                "type": rec["o_type"] or "Component",
            }

        edges_list.append(
            {
                "id": str(rec["e_id"] or f"e_{idx}"),
                "source": s_id,
                "target": o_id,
                "relation": rec["relation"] or "RELATES_TO",
                "page": rec["page"],
            }
        )

    return {
        "nodes": list(nodes_map.values())[:limit],
        "edges": edges_list[:limit],
    }


@app.post("/api/chat")
async def chat_endpoint(payload: ChatRequest) -> dict[str, Any]:
    docs = load_indexed_docs_meta()
    chunks = load_bm25_records()
    has_documents = bool(docs) or bool(chunks)

    guard = await check_input_guardrail(
        query=payload.query,
        has_documents=has_documents,
    )
    if not guard.allowed:
        return {
            "blocked": True,
            "guardrail_reason": guard.reason,
        }

    result = await run_three_section_query(payload.query)
    return {
        "blocked": False,
        "mode": payload.mode,
        **result,
    }