from app.agents.context import budget_chunks, chunk_block, evidence_block, formats
from app.models.provider import LLMProvider, LLMResult
from app.schemas.impact import ImpactAnalysis, Memo, PolicyChunk
from app.schemas.obligations import ExtractionResult

SYSTEM = """You draft policy-update memos for a compliance officer. Write in plain, specific language.
- proposed_amendment must be concrete replacement text for the affected clause(s), not advice.
- evidence lists citations in the form 'SEBI <circular> §<clause>: "<verbatim>"' and '<DOC-ID> §<section>: "<verbatim>"'.
- Do not claim anything not supported by the evidence you were given.
- This is a draft for human review; never present it as approved.
- Evidence and policy text arrive as TOON or JSON blocks: a header like `policy_evidence[2]{doc_id,section,text}:` names the
  columns once and each indented line is one row."""


async def generate_memo(llm: LLMProvider, extraction: ExtractionResult, impact: ImpactAnalysis, chunks: list[PolicyChunk], *,
                        model: str | None = None, document_id: str | None = None) -> tuple[Memo, LLMResult]:
    affected = budget_chunks([c for c in chunks if c.doc_id in impact.affected_policies] or chunks[:3])
    ev = evidence_block([{"section": e.section, "text": e.text} for e in impact.regulatory_evidence],
                        [{"doc_id": e.doc_id, "section": e.section, "text": e.text} for e in impact.policy_evidence])
    ch = chunk_block(affected)
    user = (f"CIRCULAR {extraction.regulator} {extraction.circular_number or ''} — effective {impact.effective_date or extraction.effective_date or 'not stated'}\n"
            f"Summary: {extraction.summary}\n\nIMPACT ANALYSIS\nAlignment: {impact.alignment}\nReason: {impact.reason}\n"
            f"Recommended action: {impact.recommended_action or ''}\n\nEVIDENCE ({ev.format})\n{ev.text}\n\nAFFECTED POLICY TEXT ({ch.format})\n{ch.text}")
    memo, res = await llm.structured("memo", SYSTEM, user, Memo, model=model, context={"document_id": document_id, "context_format": formats(ev, ch)})
    return memo.model_copy(update={"disclaimer": "AI-generated draft — human review required"}), res
