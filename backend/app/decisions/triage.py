"""Pre-LLM triage: decide from the circular's *header* whether to spend a Foundry extraction call at all.

    prefilter (code, free)  →  Jev triage (one request)  →  archive NOT_APPLICABLE | proceed to extraction

Archiving is silent, so it needs the same certainty as the post-extraction NOT_APPLICABLE decision
(`not_applicable_min_confidence`, `not_applicable_max_entity_in_scope`). Anything uncertain proceeds — spending the
extraction call is the safe direction. When the addressee block plainly names the company's own entity type, triage is
skipped: the outcome is foreseeable and the call would only add latency.
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass, field
from typing import Any

from typesafe_sdk import Choice, Noul, NoulCriteria

from app.decisions.impact import ImpactDecision, company_state
from app.decisions.policy import thresholds
from app.decisions.providers import JudgmentError, judge_for
from app.schemas.regulatory import RegulatoryDocument

log = logging.getLogger(__name__)

# document types the pipeline compares against policy; anything else is filed without a model call
ACTIONABLE_TYPES = {"circular", "master circular", "master-circular", "guideline", "guidelines", "notification", "direction"}
HEADER_CHARS = 1800

# addressee phrases → entity type keys that also appear in manifest registration types
ENTITY_PHRASES: dict[str, tuple[str, ...]] = {
    "stock-broker": ("stock broker", "stock brokers", "trading member", "clearing member"),
    "mutual-fund-amc": ("mutual fund", "asset management compan", "amc", "trustee compan"),
    "depository": ("depositor", "depository participant"),
    "aif": ("alternative investment fund",),
    "portfolio-manager": ("portfolio manager",),
    "investment-adviser": ("investment adviser", "investment advisor"),
    "research-analyst": ("research analyst",),
    "rta": ("registrar", "share transfer agent"),
    "listed-company": ("listed entit", "listed compan"),
    "merchant-banker": ("merchant banker",),
    "custodian": ("custodian",),
    "stock-exchange": ("stock exchange", "clearing corporation"),
}


@dataclass
class TriageResult:
    outcome: str  # "archive" | "proceed" | "skipped"
    reason: str
    confidence: float = 0.0
    addressees: list[str] = field(default_factory=list)
    entity_match: bool | None = None
    stage: str = "prefilter"


def addressee_block(text: str) -> str:
    """The 'To, …' block at the top of a SEBI/RBI circular (up to the subject line), or the first lines."""
    head = text[:HEADER_CHARS]
    m = re.search(r"(?is)\bto[,:]?\s*\n(.+?)(?:\n\s*\n|\bsub(?:ject)?\b)", head)
    return (m.group(1) if m else head[:600]).strip()


def addressee_entities(block: str) -> list[str]:
    b = block.lower()
    return [key for key, phrases in ENTITY_PHRASES.items() if any(p in b for p in phrases)]


def manifest_entities(manifest: dict[str, Any]) -> list[str]:
    c = manifest.get("company", {})
    out = {str(r.get("type", "")).lower() for r in c.get("registrations", [])}
    out.add(str(c.get("sector", "")).lower())
    hits = []
    for key in ENTITY_PHRASES:
        if any(key in v or v in key for v in out if v):
            hits.append(key)
    # sector names in the manifests map onto the same keys
    if "securities-broking" in out and "stock-broker" not in hits:
        hits.append("stock-broker")
    if "asset-management" in out and "mutual-fund-amc" not in hits:
        hits.append("mutual-fund-amc")
    return hits


def prefilter(doc: RegulatoryDocument, manifest: dict[str, Any]) -> TriageResult:
    """Free checks. `archive` only for things that are not comparable to policy at all; never on subject matter."""
    company = manifest.get("company", {})
    if (doc.document_type or "circular").lower() not in ACTIONABLE_TYPES:
        return TriageResult("archive", f"document type '{doc.document_type}' is not a circular/guideline", stage="prefilter")
    regulator = str(company.get("regulator", "")).upper()
    if regulator and doc.source.upper() != regulator:
        return TriageResult("archive", f"regulator {doc.source} is not the company's regulator ({regulator})", stage="prefilter")
    if len(doc.content.strip()) < 300:
        return TriageResult("proceed", "document text too short to judge from the header — extract and let the pipeline decide", stage="prefilter")
    block = addressee_block(doc.content)
    addressees = addressee_entities(block)
    mine = manifest_entities(manifest)
    match = bool(set(addressees) & set(mine)) if addressees and mine else None
    if match:
        return TriageResult("skipped", "addressee block names the company's own entity type — extraction is warranted", addressees=addressees, entity_match=True, stage="prefilter")
    return TriageResult("proceed", "addressee unclear or different — ask the triage judge", addressees=addressees, entity_match=match, stage="prefilter")


def triage_questions() -> dict[str, Any]:
    return {
        "entity_in_scope": Noul(
            instructions="Is the company described in `company` one of the entity types the circular's `header.addressees` is addressed to?",
            criteria=NoulCriteria(true="the company's registration type or role is among the addressed entity types",
                                  false="the addressed entity types do not include the company's registration type or role"),
        ),
        "subject_in_scope": Noul(
            instructions="Does `header.subject` or `header.opening` concern an activity, segment or registration listed in `company`?",
            criteria=NoulCriteria(true="the subject concerns a listed activity, segment or registration of the company",
                                  false="the subject concerns activities the company does not list"),
        ),
        "depends_on_unstated_fact": Noul(
            instructions="Does deciding whether this circular concerns the company depend on a fact `company` does not state?",
            criteria=NoulCriteria(true="it turns on a condition the profile is silent about", false="the profile is enough to decide either way"),
        ),
        "relevance": Choice(
            instructions={"question": "From the header alone, does this circular concern the company?", "compare": ["`company`", "`header`"]},
            criteria={
                "concerns": "the company is an addressed entity type or the subject touches its listed activities",
                "does_not_concern": "the circular addresses other entity types and a subject outside the company's activities",
                "cannot_tell_from_header": "the header does not settle it",
            },
        ),
    }


async def triage(d: ImpactDecision, doc: RegulatoryDocument, manifest: dict[str, Any], company_name: str, pre: TriageResult) -> TriageResult:
    """One Jev request on the header. → archive (certain NOT_APPLICABLE) or proceed."""
    t = thresholds()
    judge = judge_for("triage")
    head = doc.content[:HEADER_CHARS]
    subject = re.search(r"(?im)^\s*sub(?:ject)?\s*[:.\-]\s*(.+)$", head)
    state = {"company": company_state(manifest, company_name),
             "header": {"title": doc.title, "circular_number": doc.circular_number, "addressees": addressee_block(doc.content)[:400],
                        "subject": subject.group(1).strip() if subject else doc.title, "opening": head[:900]}}
    try:
        j = await judge.ask("triage", state, triage_questions(), context={"document_id": doc.document_id})
    except JudgmentError as e:
        d.record("triage", None, state=state, routing={"outcome": "proceed", "reason": f"judge unavailable: {str(e)[:120]}"})
        return TriageResult("proceed", f"triage judge unavailable ({str(e)[:80]}) — extracting", addressees=pre.addressees, stage="triage")
    rel, ent, dep = j.answers["relevance"], j.answers["entity_in_scope"], j.answers["depends_on_unstated_fact"]
    conf = rel.confidence or 0.0
    archive = (rel.choice == "does_not_concern" and conf >= t["not_applicable_min_confidence"]
               and (ent.noul or 0.0) <= t["not_applicable_max_entity_in_scope"] and (dep.noul or 0.0) < t["noul_uncertain_high"])
    outcome = "archive" if archive else "proceed"
    reason = (f"header addressed to other entity types (P(concerns)={(rel.probabilities or {}).get('concerns', 0.0):.2f}, entity in scope {ent.noul or 0:.2f})"
              if archive else f"triage {rel.choice} at confidence {conf:.2f} — extracting")
    d.record("triage", j, state=state, routing={"outcome": outcome, "choice": rel.choice, "confidence": round(conf, 3),
                                                  "entity_in_scope": ent.noul, "depends_on_unstated_fact": dep.noul,
                                                  "thresholds": {"not_applicable_min_confidence": t["not_applicable_min_confidence"],
                                                                 "not_applicable_max_entity_in_scope": t["not_applicable_max_entity_in_scope"]}})
    return TriageResult(outcome, reason, confidence=conf if rel.choice == "concerns" else 0.0, addressees=pre.addressees, entity_match=pre.entity_match, stage="triage")
