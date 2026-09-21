"""Question builders. Literal, positively-framed, criteria aligned with instructions (Jev 1.13 jaggedness guide)."""

from typing import Any

from typesafe_sdk import Choice, Noul, NoulCriteria, Score

from app.schemas.impact import Severity

MAX_OBLIGATIONS = 8


def extraction_check_questions(n_obligations: int) -> dict[str, Noul]:
    q: dict[str, Noul] = {}
    for i in range(min(n_obligations, MAX_OBLIGATIONS)):
        q[f"ob{i}:stated"] = Noul(
            instructions=f"Does `circular.text` state the requirement written in `obligations[{i}].requirement`?",
            criteria=NoulCriteria(true="the circular text contains this requirement, in the same or equivalent words",
                                  false="the circular text does not contain this requirement"),
        )
        q[f"ob{i}:evidence_supports"] = Noul(
            instructions=f"Does the excerpt `obligations[{i}].evidence_text` express the requirement in `obligations[{i}].requirement`?",
            criteria=NoulCriteria(true="the excerpt states the requirement or the rule it is derived from",
                                  false="the excerpt is about something else or only mentions the topic without stating the requirement"),
        )
    return q


def applicability_questions() -> dict[str, Any]:
    return {
        "entity_in_scope": Noul(
            instructions="Is the company described in `company` one of the entity types listed in `circular.applies_to`?",
            criteria=NoulCriteria(true="the company's registration type or role is among the listed entity types, e.g. a stock broker when the list names stock brokers",
                                  false="the listed entity types do not include the company's registration type or role"),
        ),
        "activity_in_scope": Noul(
            instructions="Does at least one requirement in `circular.obligations` concern an activity or segment listed in `company.segments` or `company.registrations`?",
            criteria=NoulCriteria(true="a requirement concerns a listed segment, registration or activity of the company",
                                  false="every requirement concerns activities the company does not list"),
        ),
        "depends_on_unstated_fact": Noul(
            instructions="Does whether this circular applies to the company depend on a fact that `company` does not state, such as an optional service the company may or may not offer?",
            criteria=NoulCriteria(true="applicability turns on a condition the profile is silent about",
                                  false="the profile contains enough to decide applicability either way"),
        ),
        "applicability": Choice(
            instructions={"question": "Does this circular apply to the company?", "compare": ["`company`", "`circular.applies_to`", "`circular.obligations`"]},
            criteria={
                "applies": "the company is one of the addressed entity types and at least one requirement concerns an activity it lists",
                "does_not_apply": "the circular addresses other entity types, or only activities the company does not carry out",
                "cannot_tell_from_profile": "applicability depends on a fact the company profile does not state",
            },
        ),
        "severity": Score(
            instructions="If the requirements in `circular.obligations` apply to the company, how consequential are they?",
            criteria=[
                "Administrative: notifications, disclosures or record-keeping; no change to limits, procedures or client treatment",
                "Operational: changes limits, thresholds, timelines or procedures the company must implement",
                "Prohibitive: bans an activity, imposes penalties, or requires immediate cessation or restructuring",
            ],
        ),
    }


SEVERITY_LEVELS: list[Severity] = ["administrative", "operational", "prohibitive"]


def rerank_questions() -> dict[str, Noul]:
    return {
        "relevant": Noul(
            instructions="Does `policy_chunk.text` set a rule, limit, timeline or procedure on the same subject as at least one of `obligations`?",
            criteria=NoulCriteria(true="the chunk states a rule on the same subject as an obligation",
                                  false="the chunk is about a different subject, or only mentions the subject without stating a rule"),
        ),
    }


def alignment_questions(n_obligations: int) -> dict[str, Choice]:
    q: dict[str, Choice] = {}
    for i in range(min(n_obligations, MAX_OBLIGATIONS)):
        q[f"ob{i}:relation"] = Choice(
            instructions={"question": f"How does the rule in `policy_chunk.text` relate to `obligations[{i}].requirement`?",
                          "focus": "Compare the specific limit, timeline, cadence, condition or procedure; treat a stricter internal rule as satisfying."},
            criteria={
                "satisfies": {"what": "the chunk requires the same as the obligation, or something stricter, so no change is needed",
                              "examples": ["obligation: review within 30 days; chunk: review within 30 days or by the effective date, whichever is earlier"]},
                "conflicts": {"what": "the chunk sets a different limit, timeline, cadence, condition or procedure than the obligation requires, or permits what the obligation forbids",
                              "examples": ["obligation: review at least every six months; chunk: reviewed annually", "obligation: limits linked to net worth; chunk: fixed caps that do not vary with net worth"]},
                "not_addressed": {"what": "the chunk does not set a rule on the matter of this obligation", "not_for": "a chunk that addresses the matter but with a different rule — that is conflicts"},
            },
        )
    return q


def verification_questions() -> dict[str, Choice]:
    """Citation check (docs.typesafe.ai/cookbooks/citation_check): how does the source section relate to the claim?"""
    return {
        "relation": Choice(
            instructions="How does `section` relate to `claim`?",
            criteria={
                "supports": "the section states the claim or directly implies that it is true",
                "contradicts": "the section states the opposite of the claim or implies it is false",
                "says_nothing": "the section does not address what the claim asserts, either way",
            },
        ),
    }
