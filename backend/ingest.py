import asyncio
import json
import os
import pickle
import re
import shutil
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Any

from langchain_community.vectorstores import FAISS
from langchain_core.documents import Document
from langchain_openai import OpenAIEmbeddings
from langchain_text_splitters import RecursiveCharacterTextSplitter
from neo4j import GraphDatabase
from openai import AsyncOpenAI
from pydantic import BaseModel, Field
from pypdf import PdfReader
from rank_bm25 import BM25Okapi

from config import settings

SUPPORTED_EXTENSIONS = {".pdf", ".md", ".json", ".xml", ".txt", ".csv"}

STORAGE_ROOT = Path(os.getenv("RAG_STORAGE_DIR", "/app/data"))
UPLOADS_DIR = STORAGE_ROOT / "uploads"
FAISS_DIR = STORAGE_ROOT / "faiss_index"
BM25_STORE_PATH = STORAGE_ROOT / "bm25_docs.pkl"
DOCS_META_PATH = STORAGE_ROOT / "indexed_docs.json"

INGEST_JOBS: dict[str, dict[str, Any]] = {}

_NEO4J_URI = getattr(settings, "neo4j_uri", None) or os.getenv("NEO4J_URI", "")
_NEO4J_USER = (
    getattr(settings, "neo4j_user", None)
    or getattr(settings, "neo4j_username", None)
    or os.getenv("NEO4J_USER", "neo4j")
)
_NEO4J_PASSWORD = (
    getattr(settings, "neo4j_password", None)
    or os.getenv("NEO4J_PASSWORD", "")
)
_NEO4J_DATABASE = (
    getattr(settings, "neo4j_database", None)
    or os.getenv("NEO4J_DATABASE", "neo4j")
)
_OPENAI_API_KEY = (
    getattr(settings, "openai_api_key", None)
    or os.getenv("OPENAI_API_KEY", "")
)
_CHAT_MODEL = (
    getattr(settings, "openai_chat_model", None)
    or getattr(settings, "chat_model", None)
    or os.getenv("OPENAI_CHAT_MODEL", "gpt-4o-mini")
)
_EMBEDDING_MODEL = (
    getattr(settings, "openai_embedding_model", None)
    or getattr(settings, "embedding_model", None)
    or os.getenv("OPENAI_EMBEDDING_MODEL", "text-embedding-3-small")
)

neo4j_driver = GraphDatabase.driver(
    _NEO4J_URI,
    auth=(_NEO4J_USER, _NEO4J_PASSWORD),
)

if _OPENAI_API_KEY:
    os.environ["OPENAI_API_KEY"] = _OPENAI_API_KEY

openai_client = AsyncOpenAI(api_key=_OPENAI_API_KEY)
embeddings_model = OpenAIEmbeddings(
    model=_EMBEDDING_MODEL,
)

class TripleItem(BaseModel):
    subject: str = Field(..., min_length=1)
    relation: str = Field(..., min_length=1)
    object: str = Field(..., min_length=1)
    subject_type: str = Field(default="Component")
    object_type: str = Field(default="Component")


class TripleExtractionResult(BaseModel):
    triples: list[TripleItem] = Field(default_factory=list)


def is_supported_file(filename: str) -> bool:
    return Path(filename or "").suffix.lower() in SUPPORTED_EXTENSIONS


def ensure_storage_dirs() -> None:
    STORAGE_ROOT.mkdir(parents=True, exist_ok=True)
    UPLOADS_DIR.mkdir(parents=True, exist_ok=True)


def update_ingest_job(
    job_id: str | None,
    percent: int,
    stage: str,
    status: str = "running",
    error: str | None = None,
) -> None:
    if not job_id:
        return
    INGEST_JOBS[job_id] = {
        "job_id": job_id,
        "percent": max(0, min(100, int(percent))),
        "stage": stage,
        "status": status,
        "error": error,
    }


def set_ingest_job_status(
    job_id: str | None,
    percent: int,
    stage: str,
    status: str = "running",
    error: str | None = None,
) -> None:
    update_ingest_job(job_id, percent, stage, status=status, error=error)


def get_ingest_job_status(job_id: str) -> dict[str, Any]:
    return INGEST_JOBS.get(
        job_id,
        {
            "job_id": job_id,
            "percent": 0,
            "stage": "Waiting for upload...",
            "status": "unknown",
            "error": None,
        },
    )


def tokenize(text: str) -> list[str]:
    return re.findall(r"[a-z0-9]+", (text or "").lower())


def load_indexed_docs_meta() -> list[dict[str, Any]]:
    ensure_storage_dirs()
    if not DOCS_META_PATH.exists():
        return []
    try:
        data = json.loads(DOCS_META_PATH.read_text(encoding="utf-8"))
        return data if isinstance(data, list) else []
    except Exception:
        return []


def save_indexed_docs_meta(docs: list[dict[str, Any]]) -> None:
    ensure_storage_dirs()
    DOCS_META_PATH.write_text(json.dumps(docs, indent=2), encoding="utf-8")


def load_bm25_records() -> list[dict[str, Any]]:
    ensure_storage_dirs()
    if not BM25_STORE_PATH.exists():
        return []
    try:
        with open(BM25_STORE_PATH, "rb") as f:
            data = pickle.load(f)
        return data if isinstance(data, list) else []
    except Exception:
        return []


def save_bm25_records(records: list[dict[str, Any]]) -> None:
    ensure_storage_dirs()
    with open(BM25_STORE_PATH, "wb") as f:
        pickle.dump(records, f)


def build_bm25_index(records: list[dict[str, Any]]) -> BM25Okapi | None:
    if not records:
        return None
    corpus = [tokenize(r.get("text", "")) for r in records]
    if not any(corpus):
        return None
    return BM25Okapi(corpus)


def load_faiss_store() -> FAISS | None:
    if not FAISS_DIR.exists():
        return None
    try:
        return FAISS.load_local(
            str(FAISS_DIR),
            embeddings_model,
            allow_dangerous_deserialization=True,
        )
    except Exception:
        return None


def extract_blocks_from_file(file_path: str) -> list[tuple[int, str]]:
    path = Path(file_path)
    ext = path.suffix.lower()

    if ext == ".pdf":
        reader = PdfReader(str(path))
        blocks: list[tuple[int, str]] = []
        for idx, page in enumerate(reader.pages, start=1):
            text = (page.extract_text() or "").strip()
            if text:
                blocks.append((idx, text))
        return blocks

    raw_text = path.read_text(encoding="utf-8", errors="replace")
    if ext == ".json":
        try:
            parsed = json.loads(raw_text)
            formatted = json.dumps(parsed, indent=2, ensure_ascii=False)
        except Exception:
            formatted = raw_text
        return [(1, formatted.strip())] if formatted.strip() else []

    if ext == ".xml":
        try:
            root = ET.fromstring(raw_text)
            lines: list[str] = []
            for elem in root.iter():
                tag = elem.tag.split("}")[-1]
                txt = (elem.text or "").strip()
                attrs = " ".join(f"{k}={v}" for k, v in elem.attrib.items())
                if txt or attrs:
                    lines.append(
                        f"{tag}{f' ({attrs})' if attrs else ''}: {txt}".strip()
                    )
            xml_text = "\n".join(lines).strip() or raw_text.strip()
        except Exception:
            xml_text = raw_text.strip()
        return [(1, xml_text)] if xml_text else []

    if ext == ".md":
        sections = [
            s.strip()
            for s in re.split(r"(?m)^(?=#{1,3}\s+)", raw_text)
            if s.strip()
        ]
        if not sections:
            return []
        return [(idx, sec) for idx, sec in enumerate(sections, start=1)]

    cleaned = raw_text.strip()
    return [(1, cleaned)] if cleaned else []


async def _extract_triples_from_chunk(chunk_text: str) -> list[TripleItem]:
    prompt = (
        "Extract factual architecture or domain entity relationships as "
        "(subject, relation, object) triples from the text below. Keep entity "
        "names concise and relations UPPER_SNAKE_CASE.\n\n"
        f"Text:\n{chunk_text[:2000]}"
    )
    resp = await openai_client.beta.chat.completions.parse(
        model=_CHAT_MODEL,
        temperature=0.0,
        response_format=TripleExtractionResult,
        messages=[
            {
                "role": "system",
                "content": "You extract structured knowledge graph triples strictly from provided text.",
            },
            {"role": "user", "content": prompt},
        ],
    )
    parsed = resp.choices[0].message.parsed
    return parsed.triples if parsed and parsed.triples else []


def _write_triples_to_neo4j(
    doc_id: str,
    filename: str,
    page: int,
    triples: list[TripleItem],
) -> int:
    if not triples:
        return 0
    rows = [
        {
            "subject": t.subject.strip(),
            "relation": re.sub(
                r"[^A-Z0-9_]+", "_", t.relation.strip().upper()
            ).strip("_")
            or "RELATES_TO",
            "object": t.object.strip(),
            "subject_type": (t.subject_type or "Component").strip(),
            "object_type": (t.object_type or "Component").strip(),
            "doc_id": doc_id,
            "filename": filename,
            "page": page,
        }
        for t in triples
        if t.subject.strip() and t.object.strip()
    ]
    if not rows:
        return 0

    cypher = """
    UNWIND $rows AS row
    MERGE (s:Entity {name: row.subject})
    ON CREATE SET s.type = row.subject_type
    MERGE (o:Entity {name: row.object})
    ON CREATE SET o.type = row.object_type
    MERGE (s)-[r:RELATES {
        type: row.relation,
        doc_id: row.doc_id,
        page: row.page
    }]->(o)
    SET r.filename = row.filename
    RETURN count(r) AS written
    """
    with neo4j_driver.session(database=_NEO4J_DATABASE) as session:
        rec = session.run(cypher, rows=rows).single()
        return (
            int(rec["written"])
            if rec and rec["written"] is not None
            else len(rows)
        )


async def ingest_document_file(
    doc_id: str,
    filename: str,
    stored_path: str,
    job_id: str | None = None,
) -> dict[str, Any]:
    ensure_storage_dirs()
    update_ingest_job(job_id, 22, "Extracting content from file...")

    blocks = await asyncio.to_thread(extract_blocks_from_file, stored_path)
    if not blocks:
        raise ValueError(f"No readable content found in {filename}.")

    splitter = RecursiveCharacterTextSplitter(
        chunk_size=900,
        chunk_overlap=150,
    )
    chunk_records: list[dict[str, Any]] = []
    langchain_docs: list[Document] = []

    for page_num, block_text in blocks:
        splits = splitter.split_text(block_text)
        for c_idx, chunk_text in enumerate(splits):
            chunk_id = f"{doc_id}_p{page_num}_c{c_idx}"
            meta = {
                "chunk_id": chunk_id,
                "doc_id": doc_id,
                "filename": filename,
                "page": page_num,
            }
            chunk_records.append({**meta, "text": chunk_text})
            langchain_docs.append(Document(page_content=chunk_text, metadata=meta))

    update_ingest_job(job_id, 48, "Generating vector embeddings & FAISS index...")
    existing_store = load_faiss_store()
    if existing_store is None:
        new_store = FAISS.from_documents(langchain_docs, embeddings_model)
    else:
        new_store = existing_store
        new_store.add_documents(langchain_docs)
    FAISS_DIR.mkdir(parents=True, exist_ok=True)
    new_store.save_local(str(FAISS_DIR))

    bm25_records = load_bm25_records()
    bm25_records.extend(chunk_records)
    save_bm25_records(bm25_records)

    update_ingest_job(job_id, 72, "Extracting knowledge graph triples...")
    total_triples = 0
    sample_chunks = chunk_records[:12]
    for idx, rec in enumerate(sample_chunks, start=1):
        triples = await _extract_triples_from_chunk(rec["text"])
        written = await asyncio.to_thread(
            _write_triples_to_neo4j,
            doc_id,
            filename,
            int(rec.get("page") or 1),
            triples,
        )
        total_triples += written
        pct = 72 + int((idx / max(1, len(sample_chunks))) * 24)
        update_ingest_job(job_id, pct, "Writing entities & edges to Neo4j...")

    docs_meta = load_indexed_docs_meta()
    doc_entry = {
        "doc_id": doc_id,
        "filename": filename,
        "stored_path": stored_path,
        "pages_indexed": len(blocks),
        "chunks_indexed": len(chunk_records),
        "triples_stored": total_triples,
    }
    docs_meta = [d for d in docs_meta if d.get("doc_id") != doc_id]
    docs_meta.append(doc_entry)
    save_indexed_docs_meta(docs_meta)

    update_ingest_job(job_id, 100, "Indexing complete", status="completed")
    return doc_entry


async def ingest_pdf(
    doc_id: str,
    filename: str,
    stored_path: str,
    job_id: str | None = None,
) -> dict[str, Any]:
    return await ingest_document_file(
        doc_id=doc_id,
        filename=filename,
        stored_path=stored_path,
        job_id=job_id,
    )


async def delete_document_by_id(doc_id: str) -> dict[str, Any]:
    docs_meta = load_indexed_docs_meta()
    target = next((d for d in docs_meta if d.get("doc_id") == doc_id), None)
    remaining_docs = [d for d in docs_meta if d.get("doc_id") != doc_id]
    save_indexed_docs_meta(remaining_docs)

    filename = target.get("filename", "") if target else ""
    stored_path = target.get("stored_path", "") if target else ""
    if stored_path and Path(stored_path).exists():
        try:
            Path(stored_path).unlink()
        except Exception:
            pass

    all_bm25 = load_bm25_records()
    remaining_bm25 = [r for r in all_bm25 if r.get("doc_id") != doc_id]
    save_bm25_records(remaining_bm25)

    if not remaining_bm25:
        if FAISS_DIR.exists():
            shutil.rmtree(FAISS_DIR, ignore_errors=True)
    else:
        remaining_docs_lc = [
            Document(
                page_content=r["text"],
                metadata={
                    "chunk_id": r.get("chunk_id"),
                    "doc_id": r.get("doc_id"),
                    "filename": r.get("filename"),
                    "page": r.get("page"),
                },
            )
            for r in remaining_bm25
        ]
        rebuilt = FAISS.from_documents(remaining_docs_lc, embeddings_model)
        FAISS_DIR.mkdir(parents=True, exist_ok=True)
        rebuilt.save_local(str(FAISS_DIR))

    cypher = """
    MATCH (s:Entity)-[r:RELATES]->(o:Entity)
    WHERE r.doc_id = $doc_id OR ($filename <> '' AND r.filename = $filename)
    WITH count(r) AS deleted_count
    OPTIONAL MATCH ()-[rem:RELATES]-()
    WITH deleted_count, count(rem) AS remaining_edges
    OPTIONAL MATCH (n:Entity)
    WHERE remaining_edges = 0 OR NOT (n)--()
    DETACH DELETE n
    RETURN deleted_count
    """
    with neo4j_driver.session(database=_NEO4J_DATABASE) as session:
        rec = session.run(cypher, doc_id=doc_id, filename=filename).single()
        deleted_triples = (
            int(rec["deleted_count"])
            if rec and rec["deleted_count"] is not None
            else 0
        )

    return {
        "deleted": True,
        "doc_id": doc_id,
        "remaining_chunks": len(remaining_bm25),
        "deleted_triples": deleted_triples,
    }