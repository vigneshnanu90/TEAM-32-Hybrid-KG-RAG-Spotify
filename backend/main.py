from pathlib import Path
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from config import settings
from guardrails import check_input_guardrail
from ingest import ingest_pdf, load_bm25_records, neo4j_driver
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
    query: str = Field(..., min_length=1)
    session_id: str = Field(default="default-session")


@app.get("/api/health")
def health() -> dict[str, str]:
    neo4j_driver.verify_connectivity()
    return {"status": "ok"}


@app.post("/api/upload-pdf")
async def upload_pdf(file: UploadFile = File(...)) -> dict:
    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are supported.")

    safe_name = Path(file.filename).name
    target_path = settings.storage_path / "uploads" / safe_name

    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="Uploaded PDF is empty.")

    target_path.write_bytes(content)

    try:
        summary = await ingest_pdf(target_path, safe_name)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    return {"status": "indexed", **summary}


@app.post("/api/chat")
async def chat(payload: ChatRequest) -> dict:
    has_docs = len(load_bm25_records()) > 0
    decision = await check_input_guardrail(payload.query, has_documents=has_docs)

    if not decision.allowed:
        return {
            "blocked": True,
            "guardrail_reason": decision.reason,
            "vector_section": None,
            "graph_section": None,
            "comparison_section": None,
        }

    result = await run_three_section_query(payload.query)
    return {
        "blocked": False,
        "session_id": payload.session_id,
        **result,
    }