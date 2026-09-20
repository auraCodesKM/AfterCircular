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
- alignment is null when applicability is NO or UNCERTAIN."""


def format_chunks(chunks: list[PolicyChunk]) -> str:
    return "\n\n".join(f"[{c.doc_id} §{c.section}] (version {c.version or 'n/a'}, {c.path})\n{c.text}" for c in chunks)


async def analyze_impact(llm: LLMProvider, extraction: ExtractionResult, chunks: list[PolicyChunk], company_profile: str, *,
                         model: str | None = None, document_id: str | None = None) -> tuple[ImpactAnalysis, LLMResult]:
    obligations = "\n".join(
        f"{i + 1}. [{o.affected_area}] {o.requirement} (deadline: {o.deadline or 'none stated'}) — evidence §{o.evidence.section}: \"{o.evidence.text}\""
        for i, o in enumerate(extraction.obligations)
    )
    user = (f"COMPANY PROFILE\n{company_profile}\n\nCIRCULAR\n{extraction.regulator} {extraction.circular_number or ''}\n"
            f"Applies to: {', '.join(extraction.applies_to)}\nEffective: {extraction.effective_date or 'not stated'}\nSummary: {extraction.summary}\n\n"
            f"OBLIGATIONS\n{obligations or '(none extracted)'}\n\nRETRIEVED INTERNAL POLICY EXCERPTS\n{format_chunks(chunks) or '(none retrieved)'}")
    return await llm.structured("impact", SYSTEM, user, ImpactAnalysis, model=model, context={"document_id": document_id})
