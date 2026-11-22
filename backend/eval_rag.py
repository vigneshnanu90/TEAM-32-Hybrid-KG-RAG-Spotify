import asyncio
import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

BACKEND_DIR = Path(__file__).resolve().parent
REPO_ROOT = BACKEND_DIR.parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from retriever import _vector_and_bm25_search  # noqa: E402

EVAL_QUESTIONS_PATH = BACKEND_DIR / "tests" / "eval_questions.json"
EVAL_REPORT_PATH = REPO_ROOT / "docs" / "EVAL.md"


def _is_relevant(chunk: dict[str, Any], item: dict[str, Any]) -> bool:
    filename = str(chunk.get("filename") or "").lower()
    text = str(chunk.get("text") or "").lower()

    expected_files = [
        str(f).lower() for f in (item.get("expected_filenames") or [])
    ]
    expected_terms = [
        str(t).lower() for t in (item.get("expected_terms") or [])
    ]

    file_match = any(ef in filename for ef in expected_files) if expected_files else False
    term_match = any(term in text for term in expected_terms) if expected_terms else False
    return file_match and term_match if (expected_files and expected_terms) else (file_match or term_match)


async def evaluate_dataset(questions: list[dict[str, Any]]) -> dict[str, Any]:
    if not questions:
        return {
            "total_queries": 0,
            "hit_at_3": 0.0,
            "hit_at_5": 0.0,
            "mrr": 0.0,
            "rows": [],
        }

    hit3_count = 0
    hit5_count = 0
    rr_sum = 0.0
    rows: list[dict[str, Any]] = []

    for item in questions:
        qid = item.get("id", "q")
        query = item.get("query", "")
        chunks = await asyncio.to_thread(_vector_and_bm25_search, query, 5)

        first_hit_rank: int | None = None
        for idx, chunk in enumerate(chunks, start=1):
            if _is_relevant(chunk, item):
                first_hit_rank = idx
                break

        in_top3 = first_hit_rank is not None and first_hit_rank <= 3
        in_top5 = first_hit_rank is not None and first_hit_rank <= 5
        rr = (1.0 / first_hit_rank) if first_hit_rank is not None else 0.0

        if in_top3:
            hit3_count += 1
        if in_top5:
            hit5_count += 1
        rr_sum += rr

        rows.append(
            {
                "id": qid,
                "query": query,
                "first_hit_rank": first_hit_rank,
                "hit_at_3": in_top3,
                "hit_at_5": in_top5,
                "reciprocal_rank": round(rr, 4),
            }
        )

    total = len(questions)
    return {
        "total_queries": total,
        "hit_at_3": round(hit3_count / total, 4),
        "hit_at_5": round(hit5_count / total, 4),
        "mrr": round(rr_sum / total, 4),
        "rows": rows,
    }


def write_eval_report(summary: dict[str, Any], output_path: Path) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    ts = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    lines = [
        "# RAG Retrieval Evaluation Report",
        "",
        f"- **Generated:** {ts}",
        f"- **Total Queries:** {summary['total_queries']}",
        f"- **Hit@3:** {summary['hit_at_3']:.2%}",
        f"- **Hit@5:** {summary['hit_at_5']:.2%}",
        f"- **MRR:** {summary['mrr']:.4f}",
        "",
        "| ID | Query | First Hit Rank | Hit@3 | Hit@5 | Reciprocal Rank |",
        "| :--- | :--- | :---: | :---: | :---: | :---: |",
    ]
    for r in summary["rows"]:
        rank_display = str(r["first_hit_rank"]) if r["first_hit_rank"] else "None"
        lines.append(
            f"| {r['id']} | {r['query']} | {rank_display} | "
            f"{'Yes' if r['hit_at_3'] else 'No'} | "
            f"{'Yes' if r['hit_at_5'] else 'No'} | "
            f"{r['reciprocal_rank']:.4f} |"
        )
    output_path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def main() -> None:
    questions = json.loads(EVAL_QUESTIONS_PATH.read_text(encoding="utf-8"))
    summary = asyncio.run(evaluate_dataset(questions))
    write_eval_report(summary, EVAL_REPORT_PATH)
    print(json.dumps({k: v for k, v in summary.items() if k != "rows"}, indent=2))
    print(f"Report written to {EVAL_REPORT_PATH}")


if __name__ == "__main__":
    main()