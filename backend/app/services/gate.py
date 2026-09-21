"""Impact Gate: the final deterministic routing of an ImpactAnalysis (PRD §17/§18).

The typed decision layer (app/decisions) decides applicability and alignment; this function is the last word on what
happens next and enforces the evidence rule: a CONFLICT without two-sided evidence is never acted on.
"""

from app.schemas.impact import GateOutcome, ImpactAnalysis


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
    return "NEEDS_INVESTIGATION", "Applicable but alignment not settled — routed to a human"
