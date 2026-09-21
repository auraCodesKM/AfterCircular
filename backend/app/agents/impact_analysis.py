from app.agents.context import budget_chunks, chunk_block, formats, obligation_block
from app.models.provider import LLMProvider, LLMResult
from app.schemas.impact import ImpactAnalysis, PolicyChunk
from app.schemas.obligations import ExtractionResult

SYSTEM = """You are the compliance impact analyst for one company. Decide whether a regulatory circular applies to this company
and, if it does, whether the company's internal policy excerpts already comply with it.

Definitions:
- applicability YES: the company is one of the entity types the circular addresses and at least one obligation touches its activities.
- applicability NO: the circular addresses other entity types or activities the company does not carry out.
- applicability UNCERTAIN: applicability depends on facts not in the company profile or the excerpts.
- alignment ALIGNED: the excerpts already satisfy every applicable obligation (equal or stricter).
- alignment CONFLICT: at least one excerpt contradicts, is weaker than, or omits an applicable obligation with a stated requirement.

Hard rules:
- Judge only from the obligations and the policy excerpts given. Never assume policy text you were not shown.
- A CONFLICT must cite both sides: regulatory_evidence (clause + verbatim text) and policy_evidence (doc_id, section, verbatim text).
- If you cannot cite policy text for a CONFLICT, answer UNCERTAIN instead of guessing.
- affected_policies lists doc_ids (e.g. "POL-001") that must change; empty when ALIGNED or NO.
- confidence is your honest probability that the classification is correct.
- alignment is null when applicability is NO or UNCERTAIN.

Input format: the obligations and the policy excerpts are given as TOON (Token-Oriented Object Notation) or JSON blocks.
A TOON block like `obligations[3]{i,area,requirement,...}:` declares the row count and the column names once; each following
indented line is one row with comma-separated values, quoted when they contain commas."""


async def analyze_impact(llm: LLMProvider, extraction: ExtractionResult, chunks: list[PolicyChunk], company_profile: str, *,
                         model: str | None = None, document_id: str | None = None) -> tuple[ImpactAnalysis, LLMResult]:
    ob = obligation_block(extraction.obligations)
    ch = chunk_block(budget_chunks(chunks))
    user = (f"COMPANY PROFILE\n{company_profile}\n\nCIRCULAR\n{extraction.regulator} {extraction.circular_number or ''}\n"
            f"Applies to: {', '.join(extraction.applies_to)}\nEffective: {extraction.effective_date or 'not stated'}\nSummary: {extraction.summary}\n\n"
            f"OBLIGATIONS ({ob.format})\n{ob.text if extraction.obligations else '(none extracted)'}\n\n"
            f"RETRIEVED INTERNAL POLICY EXCERPTS ({ch.format})\n{ch.text if chunks else '(none retrieved)'}")
    return await llm.structured("impact", SYSTEM, user, ImpactAnalysis, model=model,
                                context={"document_id": document_id, "context_format": formats(ob, ch)})
