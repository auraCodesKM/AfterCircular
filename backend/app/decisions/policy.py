"""Threshold policy — every number the routers read lives here (TypeSafe pattern: change a constant, not a prompt).

Semantics, following docs.typesafe.ai/confidence and /cookbooks/consistency_noul_cookbook:
- A Noul is P(yes). Values inside (NOUL_UNCERTAIN_LOW, NOUL_UNCERTAIN_HIGH) mean "similar probability for yes and no"
  and are treated as *uncertain*, never rounded to a decision.
- Choice/Score `confidence` summarizes how concentrated the distribution is. It is NOT workflow correctness and never
  authorizes a side effect: the only side effect (GitHub issue) is behind a human click regardless of any number here.
- Thresholds scale with consequence: archiving as NOT APPLICABLE (silently dropping a circular) needs more certainty
  than sending a case to a person.

Defaults are conservative starting points; tune on evals/ results, not by feel. Override with DECISION_THRESHOLDS
(JSON) in the environment.
"""

import json
import os

THRESHOLDS: dict[str, float] = {
    # Noul uncertain band (both stages)
    "noul_uncertain_low": 0.30,
    "noul_uncertain_high": 0.70,
    # applicability Choice: below this → escalate (reasoning model, else human)
    "applicability_min_confidence": 0.60,
    # archiving as NOT APPLICABLE is silent → demand more certainty than routing to a human
    "not_applicable_min_confidence": 0.80,
    "not_applicable_max_entity_in_scope": 0.30,
    # rerank: a chunk below this relevance is not evidence
    "relevant_min": 0.45,
    "rerank_keep": 5,
    # alignment Choice per (obligation, chunk) pair
    "alignment_min_confidence": 0.70,
    # a low-confidence pair only forces escalation when a conflict is a live possibility: P(conflicts) at or above this.
    # (a pair torn between "satisfies" and "not_addressed" is harmless either way)
    "conflict_probability_escalate_min": 0.30,
    # verification Choice (citation check): below this a human confirms the verdict
    "verify_min_confidence": 0.80,
    # extraction check: an obligation whose "unsupported" P(yes) exceeds this is dropped
    "obligation_unsupported_max": 0.70,
}


def thresholds() -> dict[str, float]:
    raw = os.environ.get("DECISION_THRESHOLDS")
    if not raw:
        return THRESHOLDS
    try:
        override = json.loads(raw)
    except json.JSONDecodeError:
        return THRESHOLDS
    return {**THRESHOLDS, **{k: float(v) for k, v in override.items() if k in THRESHOLDS}}


def noul_band(p: float, t: dict[str, float] | None = None) -> str:
    """'yes' | 'no' | 'uncertain' — the only three things code may read from a Noul."""
    t = t or thresholds()
    if p >= t["noul_uncertain_high"]:
        return "yes"
    if p <= t["noul_uncertain_low"]:
        return "no"
    return "uncertain"
