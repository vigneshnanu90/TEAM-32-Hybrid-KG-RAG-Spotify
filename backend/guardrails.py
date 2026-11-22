import re
from typing import Iterable

from openai import AsyncOpenAI
from pydantic import BaseModel

from config import settings

client = AsyncOpenAI(api_key=settings.openai_api_key)


class GuardrailDecision(BaseModel):
    allowed: bool
    reason: str


BLOCKED_PATTERNS = [
    r"ignore\s+(all\s+)?previous\s+instructions",
    r"reveal\s+(your\s+)?system\s+prompt",
    r"bypass\s+(safety|guardrails|rules)",
]


async def check_input_guardrail(
    query: str,
    has_documents: bool = True,
) -> GuardrailDecision:
    cleaned = (query or "").strip()
    if not cleaned:
        return GuardrailDecision(
            allowed=False,
            reason="Please enter a question about your uploaded PDF.",
        )

    if len(cleaned) > 1000:
        return GuardrailDecision(
            allowed=False,
            reason="Query exceeds the 1000-character limit.",
        )

    lowered = cleaned.lower()
    for pattern in BLOCKED_PATTERNS:
        if re.search(pattern, lowered):
            return GuardrailDecision(
                allowed=False,
                reason="Query blocked by prompt-injection guardrails.",
            )

    if not has_documents:
        return GuardrailDecision(
            allowed=False,
            reason="Knowledge store is currently empty. Please upload a PDF first before asking questions.",
        )

    return GuardrailDecision(allowed=True, reason="Allowed")


def verify_citations(
    answer_text: str,
    allowed_sources: Iterable[str],
) -> str:
    """
    Post-generation check:
    1. Strips bracketed numeric citations like [1], [2] that do not map to retrieved chunks.
    2. Strips page references like (p. 19) or p.19 if that page number was not in `allowed_sources`.
    """
    if not answer_text:
        return ""

    sources_list = [str(s) for s in allowed_sources if s]
    max_index = len(sources_list)

    allowed_pages: set[str] = set()
    for src in sources_list:
        for match in re.findall(r"p\.\s*([0-9]+)", src, flags=re.IGNORECASE):
            allowed_pages.add(match)

    def _replace_numeric_ref(match: re.Match[str]) -> str:
        idx = int(match.group(1))
        if 1 <= idx <= max_index:
            return match.group(0)
        return ""

    cleaned = re.sub(r"\[(\d+)\]", _replace_numeric_ref, answer_text)

    def _replace_page_ref(match: re.Match[str]) -> str:
        page_num = match.group(1)
        if page_num in allowed_pages:
            return match.group(0)
        return ""

    cleaned = re.sub(
        r"\(\s*p\.\s*([0-9]+)\s*\)",
        _replace_page_ref,
        cleaned,
        flags=re.IGNORECASE,
    )
    cleaned = re.sub(
        r"\bp\.\s*([0-9]+)\b",
        _replace_page_ref,
        cleaned,
        flags=re.IGNORECASE,
    )

    cleaned = re.sub(r"[ \t]{2,}", " ", cleaned)
    cleaned = re.sub(r"\s+([.,;:])", r"\1", cleaned)
    return cleaned.strip()