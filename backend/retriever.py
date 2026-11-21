import asyncio
from typing import Any

from openai import AsyncOpenAI
from pydantic import BaseModel

from config import settings
from ingest import (
    build_bm25_index,
    load_bm25_records,
    load_faiss_store,
    neo4j_driver,
    tokenize,
)

client = AsyncOpenAI(api_key=settings.openai_api_key)
DEFAULT_TEMPERATURE = 0.5


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

    store = load_faiss_store()
    if store is not None:
        faiss_hits = store.similarity_search(query, k=top_k)
        for rank, doc in enumerate(faiss_hits, start=1):
            cid = doc.metadata.get("chunk_id") or f"faiss_{rank}"
            doc_map[cid] = {
                "chunk_id": cid,
                "filename": doc.metadata.get("filename", "Source"),
                "page": doc.metadata.get("page", "?"),
                "text": doc.page_content,
            }
            fused_scores[cid] = fused_scores.get(cid, 0.0) + 1.0 / (rrf_k + rank)

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

    # Lightweight rerank: boost chunks matching query keywords
    query_terms = {w for w in tokenize(query) if len(w) > 2}
    reranked_ids = sorted(
        fused_scores.keys(),
        key=lambda cid: fused_scores[cid]
        + 0.02
        * sum(
            1
            for term in query_terms
            if term in doc_map[cid].get("text", "").lower()
        ),
        reverse=True,
    )[:top_k]

    return [doc_map[cid] for cid in reranked_ids]


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


def _build_augmented_prompt(system_prompt: str, user_query: str, retrieved_context: str) -> str:
    # Follows whiteboard augmentation flow: S.P + U.Q + R.C
    return (
        f"[S.P - System Prompt]\n{system_prompt}\n\n"
        f"[U.Q - User Query]\n{user_query}\n\n"
        f"[R.C - Retrieved Context]\n{retrieved_context}"
    )


async def _answer_from_vector_bm25(query: str, chunks: list[dict[str, Any]]) -> SectionAnswer:
    if not chunks:
        return SectionAnswer(
            answer="I could not find matching text passages for this question yet.",
            sources=[],
        )

    context_block = "\n\n".join(
        f"[Chunk {c.get('chunk_id', 'ref')} | {c.get('filename', 'Source')} p.{c.get('page', '?')}]: {c['text']}"
        for c in chunks
    )
    sources = sorted({f"{c.get('filename', 'Source')} (p. {c.get('page', '?')})" for c in chunks})

    system_prompt = (
        "You are a helpful software architect assistant. Explain answers clearly in plain, "
        "everyday human language using only the provided text passages. Use short paragraphs or "
        "simple bullet points when helpful, and avoid raw JSON or robotic phrasing."
    )
    augmented_user_msg = _build_augmented_prompt(system_prompt, query, context_block)

    resp = await client.beta.chat.completions.parse(
        model=settings.openai_chat_model,
        temperature=DEFAULT_TEMPERATURE,
        response_format=SectionAnswer,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": augmented_user_msg},
        ],
    )
    parsed = resp.choices[0].message.parsed
    return parsed or SectionAnswer(
        answer="I could not summarize the matching text passages right now.",
        sources=sources,
    )


async def _answer_from_graph(query: str, triples: list[dict[str, Any]]) -> SectionAnswer:
    if not triples:
        return SectionAnswer(
            answer="I could not find matching relationship links for this question yet.",
            sources=[],
        )

    triple_lines = [
        f"({t['subject']}) -[{t['relation']}]-> ({t['object']}) [NodeRef p.{t.get('page', '?')}]"
        for t in triples
    ]
    sources = sorted({f"{t.get('filename', 'Source')} (p. {t.get('page', '?')})" for t in triples})

    system_prompt = (
        "You are a helpful software architect assistant. Explain how components and concepts "
        "connect in plain, easy-to-follow language based strictly on the provided relationships."
    )
    augmented_user_msg = _build_augmented_prompt(
        system_prompt,
        query,
        "\n".join(triple_lines),
    )

    resp = await client.beta.chat.completions.parse(
        model=settings.openai_chat_model,
        temperature=DEFAULT_TEMPERATURE,
        response_format=SectionAnswer,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": augmented_user_msg},
        ],
    )
    parsed = resp.choices[0].message.parsed
    return parsed or SectionAnswer(
        answer="I could not summarize the connected relationships right now.",
        sources=sources,
    )


async def run_three_section_query(query: str) -> dict[str, Any]:
    chunks, triples = await asyncio.gather(
        asyncio.to_thread(_vector_and_bm25_search, query),
        asyncio.to_thread(_graph_search, query),
    )

    vector_sec, graph_sec = await asyncio.gather(
        _answer_from_vector_bm25(query, chunks),
        _answer_from_graph(query, triples),
    )

    # Combined {Chunks + Node Ref} context for final synthesis
    chunk_refs = [
        f"Chunk {c.get('chunk_id', 'ref')}: {c['text'][:240]}" for c in chunks
    ]
    node_refs = [
        f"NodeRef ({t['subject']} -> {t['relation']} -> {t['object']})" for t in triples[:10]
    ]
    combined_context = "\n".join(chunk_refs + node_refs) or "No retrieved items."

    judge_system = (
        "You are a clear, impartial assistant. Compare the two answers in plain human language, "
        "choose the best approach ('Vector + BM25', 'Knowledge Graph', or 'Hybrid (Both)'), "
        "and write a clear, easy-to-read `best_answer` grounded in the context."
    )
    judge_prompt = _build_augmented_prompt(
        judge_system,
        query,
        f"{combined_context}\n\nOption A (Vector + BM25):\n{vector_sec.answer}\n\nOption B (Knowledge Graph):\n{graph_sec.answer}",
    )

    judge_resp = await client.beta.chat.completions.parse(
        model=settings.openai_chat_model,
        temperature=DEFAULT_TEMPERATURE,
        response_format=JudgeVerdict,
        messages=[
            {"role": "system", "content": judge_system},
            {"role": "user", "content": judge_prompt},
        ],
    )
    verdict = judge_resp.choices[0].message.parsed or JudgeVerdict(
        comparison="Both retrieval paths were reviewed together.",
        winner="Hybrid (Both)",
        best_answer=vector_sec.answer or graph_sec.answer,
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