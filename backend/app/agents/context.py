"""Context budgeting for model prompts: deterministic filtering → dedupe → ranking → compact (TOON) → truncate last.

The agents call `obligation_block` / `chunk_block` and put the returned text in the prompt. The block records which
format was produced so the call's telemetry can say TOON or JSON. Budgets come from settings (MAX_* values).
"""

from __future__ import annotations

from app.config import settings
from app.schemas.impact import PolicyChunk
from app.schemas.obligations import Obligation
from app.toon import ContextBlock, count_tokens, format_context


def _norm(s: str) -> str:
    return " ".join(s.split()).lower()


def budget_chunks(chunks: list[PolicyChunk]) -> list[PolicyChunk]:
    """Dedupe (same normalized text), keep the best-scored MAX_POLICY_CHUNKS, then drop from the tail until the evidence
    fits MAX_EVIDENCE_TOKENS. Never cuts inside a chunk — a partial policy clause would be misleading evidence."""
    s = settings()
    seen: set[str] = set()
    uniq: list[PolicyChunk] = []
    for c in sorted(chunks, key=lambda c: c.score, reverse=True):
        key = _norm(c.text)
        if key in seen:
            continue
        seen.add(key)
        uniq.append(c)
    kept = uniq[: s.max_policy_chunks]
    while len(kept) > 1 and sum(count_tokens(c.text) for c in kept) > s.max_evidence_tokens:
        kept.pop()
    return kept


def obligation_block(obligations: list[Obligation]) -> ContextBlock:
    s = settings()
    rows = [{"i": i + 1, "area": o.affected_area, "requirement": o.requirement, "deadline": o.deadline or "",
             "section": o.evidence.section, "evidence": o.evidence.text}
            for i, o in enumerate(obligations[: s.max_obligations_in_context])]
    return format_context({"obligations": rows}, prefer="toon" if s.toon_context else "json")


def chunk_block(chunks: list[PolicyChunk]) -> ContextBlock:
    s = settings()
    rows = [{"doc_id": c.doc_id, "section": c.section, "version": c.version or "", "path": c.path, "text": c.text} for c in chunks]
    return format_context({"policy_excerpts": rows}, prefer="toon" if s.toon_context else "json")


def evidence_block(regulatory: list[dict[str, str]], policy: list[dict[str, str]]) -> ContextBlock:
    s = settings()
    payload = {"regulatory_evidence": regulatory[: s.max_evidence_items], "policy_evidence": policy[: s.max_evidence_items]}
    return format_context(payload, prefer="toon" if s.toon_context else "json")


def formats(*blocks: ContextBlock) -> str:
    """'toon' when every block is TOON, 'json' when every block is JSON, 'mixed' otherwise."""
    kinds = {b.format for b in blocks}
    return kinds.pop() if len(kinds) == 1 else "mixed"
