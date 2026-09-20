"""Impact Gate: deterministic routing around the model's structured analysis (PRD §9, §17; prompt §19).

Cheap pass first: if retrieval finds nothing that overlaps the circular's topics, the expensive analysis call is skipped
and the circular is archived as not applicable. Only candidates that pass reach the model.
"""

from app.schemas.impact import GateOutcome, ImpactAnalysis, PolicyChunk
from app.schemas.obligations import ExtractionResult

# retrieval score below this (RRF scale, ~1/61 per rank-1 hit) means "no policy is plausibly related"
MIN_RRF_SCORE = 1 / 120


def cheap_prefilter(extraction: ExtractionResult, chunks: list[PolicyChunk]) -> tuple[bool, str]:
    """(should_run_full_analysis, reason). Never says CONFLICT on its own — only decides whether to spend a model call."""
    if not extraction.obligations:
        return False, "No obligations extracted — nothing to compare"
    if not chunks or max(c.score for c in chunks) < MIN_RRF_SCORE:
        return False, "No internal policy chunk overlaps the circular's obligations"
    return True, f"{len(chunks)} candidate policy chunks pass the cheap filter"


def route(impact: ImpactAnalysis) -> tuple[GateOutcome, str]:
    """Applicability → alignment → outcome. Evidence is mandatory for CONFLICT (PRD §18)."""
    if impact.applicability == "NO":
        return "ARCHIVED", "Not applicable to this company"
    if impact.applicability == "UNCERTAIN":
        return "NEEDS_INVESTIGATION", "Applicability uncertain — routed to a human, no automated action"
    if impact.alignment == "CONFLICT":
        if not impact.regulatory_evidence or not impact.policy_evidence or not impact.affected_policies:
            return "NEEDS_INVESTIGATION", "CONFLICT claimed without two-sided evidence — not accepted, routed to a human"
        return "CONFLICT", f"Conflict with {', '.join(impact.affected_policies)}"
    if impact.alignment == "ALIGNED":
        return "ALIGNED", "Applicable and already aligned — archived with evidence"
    return "NEEDS_INVESTIGATION", "Applicable but alignment not stated — routed to a human"
