import asyncio
from typing import Any

from openai import AsyncOpenAI
from pydantic import BaseModel
from ingest import (
    build_bm25_index,
    load_bm25_records,
    load_faiss_store,
    neo4j_driver,
    tokenize,
)
from config import settings

client = AsyncOpenAI(api_key=settings.openai_api_key)


class SectionAnswer(BaseModel):
    answer: str
    sources: list[str]


class JudgeVerdict(BaseModel):
    comparison: str
    winner: str  # "Vector + BM25", "Knowledge Graph", or "Hybrid (Both)"
    best_answer: str


def _vector_and_bm25_search(query: str, top_k: int = 5) -> list[dict[str, Any]]:
    fused_scores: dict[str, float] = {}
    doc_map: dict[str, dict[str, Any]] = {}
    rrf_k = 60

    # Dense FAISS search
    store = load_faiss_store()
    if store is not None:
        faiss_hits = store.similarity_search(query, k=top_k)
        for rank, doc in enumerate(faiss_hits, start=1):
            cid = doc.metadata.get("chunk_id") or f"faiss_{rank}"
            doc_map[cid] = {
                "chunk_id": cid,
                "filename": doc.metadata.get("filename", "PDF"),
                "page": doc.metadata.get("page", "?"),
                "text": doc.page_content,
            }
            fused_scores[cid] = fused_scores.get(cid, 0.0) + 1.0 / (rrf_k + rank)

    # Sparse BM25 search
    bm25_records = load_bm25_records()
    bm25 = build_bm25_index(bm25_records)
    if bm25 is not None and bm25_records:
        scores = bm25.get_scores(tokenize(query))
        ranked_indices = sorted(range(len(scores)), key=lambda i: scores[i], reverse=True)[:top_k]
        for rank, idx in enumerate(ranked_indices, start=1):
            if scores[idx] <= 0:
                continue
            rec = bm25_records[idx]
            cid = rec["chunk_id"]
            doc_map[cid] = rec
            fused_scores[cid] = fused_scores.get(cid, 0.0) + 1.0 / (rrf_k + rank)

    sorted_ids = sorted(fused_scores.keys(), key=lambda k: fused_scores[k], reverse=True)[:top_k]
    return [doc_map[cid] for cid in sorted_ids]


def _graph_search(query: str, limit: int = 20) -> list[dict[str, Any]]:
    keywords = [w for w in tokenize(query) if len(w) > 2][:6]
    if not keywords:
        return []

    cypher = """
    MATCH (s:Entity)-[r:RELATES]->(o:Entity)
    WHERE ANY(kw IN $keywords WHERE
        toLower(s.name) CONTAINS kw OR
        toLower(o.name) CONTAINS kw OR
        toLower(r.type) CONTAINS kw
    )
    RETURN s.name AS subject, r.type AS relation, o.name AS object,
           r.filename AS filename, r.page AS page
    LIMIT $limit
    """
    with neo4j_driver.session(database=settings.neo4j_database) as session:
        result = session.run(cypher, keywords=keywords, limit=limit)
        return [dict(record) for record in result]


async def _answer_from_vector_bm25(query: str, chunks: list[dict[str, Any]]) -> SectionAnswer:
    if not chunks:
        return SectionAnswer(
            answer="No matching text passages were found in the indexed PDF chunks.",
            sources=[],
        )

    context_block = "\n\n".join(
        f"[{c['filename']} - Page {c['page']}]: {c['text']}" for c in chunks
    )
    sources = sorted({f"{c['filename']} (p. {c['page']})" for c in chunks})

    resp = await client.beta.chat.completions.parse(
        model=settings.openai_chat_model,
        temperature=0.2,
        response_format=SectionAnswer,
        messages=[
            {
                "role": "system",
                "content": (
                    "Answer the user's question strictly using the provided Vector+BM25 text passages. "
                    "Do not invent facts outside the context. Keep sources list concise."
                ),
            },
            {
                "role": "user",
                "content": f"Question: {query}\n\nContext:\n{context_block}\n\nSources: {sources}",
            },
        ],
    )
    parsed = resp.choices[0].message.parsed
    return parsed or SectionAnswer(answer="Could not synthesize Vector+BM25 answer.", sources=sources)


async def _answer_from_graph(query: str, triples: list[dict[str, Any]]) -> SectionAnswer:
    if not triples:
        return SectionAnswer(
            answer="No matching entity relationships were found in the Neo4j Knowledge Graph.",
            sources=[],
        )

    triple_lines = [
        f"({t['subject']}) -[:{t['relation']}]-> ({t['object']}) [Page {t.get('page', '?')}]"
        for t in triples
    ]
    sources = sorted({f"{t.get('filename', 'PDF')} (p. {t.get('page', '?')})" for t in triples})

    resp = await client.beta.chat.completions.parse(
        model=settings.openai_chat_model,
        temperature=0.2,
        response_format=SectionAnswer,
        messages=[
            {
                "role": "system",
                "content": (
                    "Answer the user's question strictly using the provided Knowledge Graph triples. "
                    "Highlight explicit entities and relationships."
                ),
            },
            {
                "role": "user",
                "content": (
                    f"Question: {query}\n\nGraph Triples:\n"
                    + "\n".join(triple_lines)
                    + f"\n\nSources: {sources}"
                ),
            },
        ],
    )
    parsed = resp.choices[0].message.parsed
    return parsed or SectionAnswer(answer="Could not synthesize Graph answer.", sources=sources)


async def run_three_section_query(query: str) -> dict[str, Any]:
    chunks, triples = await asyncio.gather(
        asyncio.to_thread(_vector_and_bm25_search, query),
        asyncio.to_thread(_graph_search, query),
    )

    vector_sec, graph_sec = await asyncio.gather(
        _answer_from_vector_bm25(query, chunks),
        _answer_from_graph(query, triples),
    )

    judge_resp = await client.beta.chat.completions.parse(
        model=settings.openai_chat_model,
        temperature=0.2,
        response_format=JudgeVerdict,
        messages=[
            {
                "role": "system",
                "content": (
                    "You are an impartial RAG evaluation judge. Compare the Vector+BM25 answer "
                    "and the Knowledge Graph answer for the user's query:\n"
                    "1. Explain strengths, gaps, or contradictions between both answers in `comparison`.\n"
                    "2. Set `winner` to 'Vector + BM25', 'Knowledge Graph', or 'Hybrid (Both)'.\n"
                    "3. Write `best_answer` combining the most accurate, grounded details."
                ),
            },
            {
                "role": "user",
                "content": (
                    f"User Query: {query}\n\n"
                    f"--- VECTOR + BM25 ANSWER ---\n{vector_sec.answer}\n\n"
                    f"--- KNOWLEDGE GRAPH ANSWER ---\n{graph_sec.answer}"
                ),
            },
        ],
    )
    verdict = judge_resp.choices[0].message.parsed or JudgeVerdict(
        comparison="Both sections were evaluated.",
        winner="Hybrid (Both)",
        best_answer=vector_sec.answer,
    )

    return {
        "vector_section": {
            "answer": vector_sec.answer,
            "sources": vector_sec.sources,
            "chunks_retrieved": len(chunks),
        },
        "graph_section": {
            "answer": graph_sec.answer,
            "sources": graph_sec.sources,
            "triples_retrieved": len(triples),
            "triples": triples[:10],
        },
        "comparison_section": {
            "comparison": verdict.comparison,
            "winner": verdict.winner,
            "best_answer": verdict.best_answer,
        },
    }