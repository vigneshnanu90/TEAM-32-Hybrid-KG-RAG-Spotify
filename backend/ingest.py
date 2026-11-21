import pickle
import re
import uuid
from pathlib import Path
from typing import Any

from pypdf import PdfReader
from rank_bm25 import BM25Okapi
from openai import AsyncOpenAI
from pydantic import BaseModel, Field
from langchain_core.documents import Document
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_openai import OpenAIEmbeddings
from langchain_community.vectorstores import FAISS
from neo4j import GraphDatabase
from pydantic import BaseModel, Field, SecretStr

from config import settings

embeddings = OpenAIEmbeddings(
    model=settings.openai_embed_model,
    api_key=SecretStr(settings.openai_api_key),
)

async_openai = AsyncOpenAI(api_key=settings.openai_api_key)
splitter = RecursiveCharacterTextSplitter(chunk_size=700, chunk_overlap=120)

neo4j_driver = GraphDatabase.driver(
    settings.neo4j_uri,
    auth=(settings.neo4j_username, settings.neo4j_password),
)

BM25_STORE_PATH = settings.storage_path / "bm25_docs.pkl"
FAISS_DIR = str(settings.storage_path / "faiss_index")


class TripleItem(BaseModel):
    subject: str = Field(..., min_length=1)
    subject_type: str = Field(default="Entity")
    relation: str = Field(..., min_length=1)
    object: str = Field(..., min_length=1)
    object_type: str = Field(default="Entity")


class TripleExtractionResult(BaseModel):
    triples: list[TripleItem] = Field(default_factory=list)


def tokenize(text: str) -> list[str]:
    return re.findall(r"[a-z0-9]+", text.lower())


def load_bm25_records() -> list[dict[str, Any]]:
    if BM25_STORE_PATH.exists():
        with open(BM25_STORE_PATH, "rb") as f:
            return pickle.load(f)
    return []


def save_bm25_records(records: list[dict[str, Any]]) -> None:
    with open(BM25_STORE_PATH, "wb") as f:
        pickle.dump(records, f)


def build_bm25_index(records: list[dict[str, Any]]) -> BM25Okapi | None:
    if not records:
        return None
    corpus = [tokenize(r["text"]) for r in records]
    return BM25Okapi(corpus)


def load_faiss_store() -> FAISS | None:
    index_file = Path(FAISS_DIR) / "index.faiss"
    if index_file.exists():
        return FAISS.load_local(
            FAISS_DIR,
            embeddings,
            allow_dangerous_deserialization=True,
        )
    return None


def extract_pdf_pages(pdf_path: Path) -> list[tuple[int, str]]:
    reader = PdfReader(str(pdf_path))
    pages: list[tuple[int, str]] = []
    for idx, page in enumerate(reader.pages, start=1):
        txt = (page.extract_text() or "").strip()
        if txt:
            pages.append((idx, txt))
    return pages


async def extract_triples_from_chunk(chunk_text: str) -> list[TripleItem]:
    resp = await async_openai.beta.chat.completions.parse(
        model=settings.openai_chat_model,
        temperature=0,
        response_format=TripleExtractionResult,
        messages=[
            {
                "role": "system",
                "content": (
                    "Extract factual Knowledge Graph triples from the document text as "
                    "(subject, subject_type, relation, object, object_type). "
                    "Capture system architecture layers (Frontend, Backend, Databases, DevOps), "
                    "technologies (Next.js, NestJS, PostgreSQL, Redis, Kafka, Docker), "
                    "microservices, core tables, routes, and features. "
                    "Normalize RELATION to UPPER_SNAKE_CASE (e.g., USES_TECH, PART_OF_LAYER, "
                    "HAS_CORE_TABLE, HANDLES, COMMUNICATES_VIA, PROVIDES_FEATURE). Skip vague pronouns."
                ),
            },
            {"role": "user", "content": chunk_text[:3500]},
        ],
    )
    parsed = resp.choices[0].message.parsed
    return parsed.triples if parsed else []


def write_triples_to_neo4j(
    doc_id: str,
    filename: str,
    page_number: int,
    triples: list[TripleItem],
) -> int:
    if not triples:
        return 0

    rows = [
        {
            "subject": t.subject.strip(),
            "subject_type": re.sub(r"[^A-Za-z0-9_]", "_", t.subject_type.strip() or "Entity"),
            "relation": re.sub(r"[^A-Z0-9_]", "_", t.relation.strip().upper()) or "RELATED_TO",
            "object": t.object.strip(),
            "object_type": re.sub(r"[^A-Za-z0-9_]", "_", t.object_type.strip() or "Entity"),
            "doc_id": doc_id,
            "filename": filename,
            "page": page_number,
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
    MERGE (s)-[r:RELATES {type: row.relation, doc_id: row.doc_id, page: row.page}]->(o)
      ON CREATE SET r.filename = row.filename
    RETURN count(r) AS inserted
    """
    with neo4j_driver.session(database=settings.neo4j_database) as session:
        result = session.run(cypher, rows=rows)
        record = result.single()
        return int(record["inserted"]) if record else 0


async def ingest_pdf(pdf_path: Path, original_filename: str) -> dict[str, Any]:
    doc_id = str(uuid.uuid4())[:8]
    pages = extract_pdf_pages(pdf_path)
    if not pages:
        raise ValueError("No extractable text found in the uploaded PDF.")

    chunk_docs: list[Document] = []
    bm25_new_records: list[dict[str, Any]] = []
    total_triples = 0
    neo4j_error: str | None = None

    for page_num, page_text in pages:
        chunks = splitter.split_text(page_text)
        for chunk_idx, chunk in enumerate(chunks):
            chunk_id = f"{doc_id}_p{page_num}_c{chunk_idx}"
            meta = {
                "chunk_id": chunk_id,
                "doc_id": doc_id,
                "filename": original_filename,
                "page": page_num,
            }
            chunk_docs.append(Document(page_content=chunk, metadata=meta))
            bm25_new_records.append(
                {
                    "chunk_id": chunk_id,
                    "doc_id": doc_id,
                    "filename": original_filename,
                    "page": page_num,
                    "text": chunk,
                }
            )

        if neo4j_error is None:
            try:
                triples = await extract_triples_from_chunk(page_text)
                total_triples += write_triples_to_neo4j(
                    doc_id, original_filename, page_num, triples
                )
            except Exception as exc:
                neo4j_error = str(exc)

    # 1. Update FAISS Vector Store
    existing_faiss = load_faiss_store()
    if existing_faiss is None:
        vector_store = await FAISS.afrom_documents(chunk_docs, embeddings)
    else:
        await existing_faiss.aadd_documents(chunk_docs)
        vector_store = existing_faiss
    vector_store.save_local(FAISS_DIR)

    # 2. Update BM25 Corpus
    all_bm25 = load_bm25_records()
    all_bm25.extend(bm25_new_records)
    save_bm25_records(all_bm25)

    return {
        "doc_id": doc_id,
        "filename": original_filename,
        "pages_indexed": len(pages),
        "chunks_indexed": len(chunk_docs),
        "triples_stored": total_triples,
        "neo4j_warning": neo4j_error,
    }