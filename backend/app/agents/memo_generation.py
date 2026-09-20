from app.models.provider import LLMProvider, LLMResult
from app.schemas.impact import ImpactAnalysis, Memo, PolicyChunk
from app.schemas.obligations import ExtractionResult

SYSTEM = """You draft policy-update memos for a compliance officer. Write in plain, specific language.
- proposed_amendment must be concrete replacement text for the affected clause(s), not advice.
- evidence lists citations in the form 'SEBI <circular> §<clause>: "<verbatim>"' and '<DOC-ID> §<section>: "<verbatim>"'.
- Do not claim anything not supported by the evidence you were given.
- This is a draft for human review; never present it as approved."""


async def generate_memo(llm: LLMProvider, extraction: ExtractionResult, impact: ImpactAnalysis, chunks: list[PolicyChunk], *,
                        model: str | None = None, document_id: str | None = None) -> tuple[Memo, LLMResult]:
    affected = [c for c in chunks if c.doc_id in impact.affected_policies] or chunks[:3]
    user = (f"CIRCULAR {extraction.regulator} {extraction.circular_number or ''} — effective {impact.effective_date or extraction.effective_date or 'not stated'}\n"
            f"Summary: {extraction.summary}\n\nIMPACT ANALYSIS\nAlignment: {impact.alignment}\nReason: {impact.reason}\n"
            f"Regulatory evidence:\n" + "\n".join(f"- §{e.section}: \"{e.text}\"" for e in impact.regulatory_evidence) +
            "\nPolicy evidence:\n" + "\n".join(f"- {e.doc_id} §{e.section}: \"{e.text}\"" for e in impact.policy_evidence) +
            "\nRecommended action: " + (impact.recommended_action or "") +
            "\n\nAFFECTED POLICY TEXT\n" + "\n\n".join(f"[{c.doc_id} §{c.section}]\n{c.text}" for c in affected))
    memo, res = await llm.structured("memo", SYSTEM, user, Memo, model=model, context={"document_id": document_id})
    return memo.model_copy(update={"disclaimer": "AI-generated draft — human review required"}), res
