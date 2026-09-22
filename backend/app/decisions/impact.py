"""Impact decision layer: typed System One judgments + deterministic routing, with a reasoning-model rung for the
cases Jev cannot settle and a human rung for everything still uncertain.

    extraction (Foundry)            ── generative: free-form obligations with evidence
      └ extraction_check (Jev)      ── per-obligation Nouls: is it stated? does the excerpt support it?  + code verbatim check
    applicability (Jev, 1 request)  ── Nouls + Choice(applies/does_not_apply/cannot_tell) + Score(severity)
    rerank (Jev, 1 request/chunk)   ── Noul relevance over hybrid-search candidates → top evidence
    alignment (Jev, 1 request/chunk)── Choice(satisfies/conflicts/not_addressed) per (obligation, chunk) pair
    verification (Jev)              ── citation check: does the circular section support the obligation claim?
    escalation (Foundry)            ── only for pairs/cases the typed judgments left uncertain
    human                           ── anything still uncertain, and every side effect

Code owns: thresholds (policy.py), routing, evidence assembly, string matching, arithmetic, persistence.
"""

import asyncio
import logging
import re
from typing import Any

from app.decisions import questions as Q
from app.decisions.policy import noul_band, thresholds
from app.decisions.providers import JudgmentError, JudgmentProvider, judge_for, state_digest
from app.models.provider import LLMProvider, LLMResult, ProviderError
from app.schemas.decisions import Answer, DecisionRecord, Judgment
from app.schemas.impact import ImpactAnalysis, PolicyChunk, PolicyEvidence, RegulatoryEvidence, Severity
from app.schemas.obligations import ExtractionResult, Obligation
from app.services.state import new_id, now

log = logging.getLogger(__name__)

MAX_CIRCULAR_CHARS = 16000
EVIDENCE_CHARS = 700


class ImpactDecision:
    def __init__(self, analysis_id: str, tenant_id: str, document_id: str):
        self.analysis_id, self.tenant_id, self.document_id = analysis_id, tenant_id, document_id
        self.records: list[DecisionRecord] = []
        self.path: list[str] = []
        self.escalation_reason: str | None = None
        self.llm_results: list[LLMResult] = []
        self.impact: ImpactAnalysis | None = None
        self.kept_chunks: list[PolicyChunk] = []
        self.obligations: list[Obligation] = []

    def record(self, stage: str, j: Judgment | None, *, provider: str = "code", model: str = "-", question_ids: list[str] | None = None,
               state: Any = None, evidence_ids: list[str] | None = None, routing: dict[str, Any] | None = None) -> DecisionRecord:
        rec = DecisionRecord(
            id=new_id("dec"), analysis_id=self.analysis_id, tenant_id=self.tenant_id, stage=stage,  # type: ignore[arg-type]
            provider=j.provider if j else provider, model=j.model if j else model, calibrated=j.calibrated if j else None,  # type: ignore[arg-type]
            question_ids=question_ids or (list(j.answers) if j else []), state_digest=state_digest(state) if state is not None else "",
            evidence_ids=evidence_ids or [], answers=j.answers if j else {}, routing=routing or {}, latency_ms=j.latency_ms if j else 0,
            input_tokens=j.input_tokens if j else None, output_tokens=j.output_tokens if j else None, created_at=now(),
        )
        self.records.append(rec)
        tag = f"{rec.provider}:{stage}"
        if tag not in self.path:
            self.path.append(tag)
        return rec


def _norm(s: str) -> str:
    return " ".join(s.split()).lower()


def verbatim(needle: str, hay: str) -> bool:
    n = _norm(needle)
    return len(n) >= 12 and n in _norm(hay)


def window(text: str, needle: str, chars: int = EVIDENCE_CHARS) -> str:
    """The circular paragraph(s) around an evidence excerpt — the 'section' a citation check reads."""
    i = _norm(text).find(_norm(needle))
    if i < 0:
        return text[:chars]
    # map the normalized offset back approximately by ratio; good enough for a context window
    ratio = i / max(1, len(_norm(text)))
    start = max(0, int(ratio * len(text)) - chars // 2)
    return text[start : start + chars]


async def _ask(judge: JudgmentProvider, task: str, state: Any, qs: dict[str, Any], document_id: str) -> Judgment:
    return await judge.ask(task, state, qs, context={"document_id": document_id})


# ---- stage 1: extraction check ----------------------------------------------------------------------------------
async def check_extraction(d: ImpactDecision, extraction: ExtractionResult, circular_text: str) -> list[Obligation]:
    t = thresholds()
    obs = extraction.obligations[: Q.MAX_OBLIGATIONS]
    if not obs:
        return []
    judge = judge_for("extraction_check")
    state = {"circular": {"title": extraction.summary[:200], "circular_number": extraction.circular_number, "text": circular_text[:MAX_CIRCULAR_CHARS]},
             "obligations": [{"index": i, "requirement": o.requirement, "evidence_section": o.evidence.section, "evidence_text": o.evidence.text} for i, o in enumerate(obs)]}
    try:
        j = await _ask(judge, "extraction_check", state, Q.extraction_check_questions(len(obs)), d.document_id)
    except JudgmentError as e:
        log.warning("extraction check unavailable: %s", e)
        d.record("extraction_check", None, routing={"skipped": str(e)[:160], "kept": list(range(len(obs)))})
        return obs
    kept, dropped, flagged = [], [], []
    for i, o in enumerate(obs):
        stated = j.answers[f"ob{i}:stated"].noul or 0.0
        supports = j.answers[f"ob{i}:evidence_supports"].noul or 0.0
        verbatim_ok = verbatim(o.evidence.text, circular_text)
        if noul_band(stated, t) == "no" or (not verbatim_ok and noul_band(supports, t) == "no"):
            dropped.append(i)
            continue
        if noul_band(stated, t) == "uncertain" or noul_band(supports, t) == "uncertain" or not verbatim_ok:
            flagged.append(i)
        kept.append(o)
    d.record("extraction_check", j, state=state, evidence_ids=[f"ob{i}" for i in range(len(obs))],
             routing={"kept": len(kept), "dropped": dropped, "flagged_uncertain": flagged, "verbatim_checked_in_code": True})
    return kept


# ---- stage 2: applicability ------------------------------------------------------------------------------------
def company_state(manifest: dict[str, Any], company_name: str) -> dict[str, Any]:
    c = manifest.get("company", {})
    return {
        "legal_name": c.get("legal_name", company_name), "sector": c.get("sector"), "country": c.get("country"), "regulator": c.get("regulator"),
        "registrations": [f"{r.get('authority')} {r.get('type')}" for r in c.get("registrations", [])],
        "exchanges": c.get("exchanges", []), "segments": c.get("segments", []), "products": c.get("products", []),
        "not_registered_for": c.get("not_registered_for", []),
        "note": "Registered activities, listed segments and products are known. Activities under not_registered_for are declared absent. Anything else is unknown, not absent.",
    }


TRIAGE_REUSE_MIN = 0.90  # triage said "concerns" at least this confidently → the post-extraction applicability request is skipped


async def decide_applicability(d: ImpactDecision, extraction: ExtractionResult, obs: list[Obligation], company: dict[str, Any],
                               triage_confidence: float = 0.0) -> tuple[str, Severity | None, str]:
    """→ ('YES'|'NO'|'UNCERTAIN', severity, reason). Uncertain means: escalate."""
    t = thresholds()
    if triage_confidence >= TRIAGE_REUSE_MIN:
        d.record("applicability", None, routing={"outcome": "YES", "reused": "triage", "triage_confidence": round(triage_confidence, 3), "min": TRIAGE_REUSE_MIN})
        return "YES", None, f"applies (triage judged the header relevant at {triage_confidence:.2f}; applicability request skipped)"
    judge = judge_for("applicability")
    state = {"company": company, "circular": {"title": extraction.summary[:300], "applies_to": extraction.applies_to, "summary": extraction.summary,
                                              "obligations": [o.requirement for o in obs[:6]]}}
    try:
        j = await _ask(judge, "applicability", state, Q.applicability_questions(), d.document_id)
    except JudgmentError as e:
        d.record("applicability", None, routing={"outcome": "UNCERTAIN", "reason": f"judge unavailable: {str(e)[:120]}"}, state=state)
        return "UNCERTAIN", None, f"applicability judge unavailable ({str(e)[:80]})"
    a, ent, dep = j.answers["applicability"], j.answers["entity_in_scope"], j.answers["depends_on_unstated_fact"]
    sev = j.answers["severity"]
    severity: Severity | None = Q.SEVERITY_LEVELS[min(len(Q.SEVERITY_LEVELS) - 1, int(round(sev.score or 0)))] if (sev.confidence or 0) >= 0.5 else None
    conf = a.confidence or 0.0
    if a.choice == "does_not_apply" and conf >= t["not_applicable_min_confidence"] and noul_band(ent.noul or 0, t) == "no":
        outcome, reason = "NO", f"The circular addresses {', '.join(extraction.applies_to) or 'other entities'}; the company is not an addressed entity type."
    elif a.choice == "applies" and conf >= t["applicability_min_confidence"] and noul_band(dep.noul or 0, t) != "yes":
        outcome, reason = "YES", "The company is an addressed entity type and at least one obligation concerns its listed activities."
    else:
        outcome = "UNCERTAIN"
        reason = ("applicability depends on a fact the company profile does not state" if a.choice == "cannot_tell_from_profile" or noul_band(dep.noul or 0, t) == "yes"
                  else f"applicability judgment not confident enough to act on (confidence {conf:.2f})")
    d.record("applicability", j, state=state, routing={"outcome": outcome, "reason": reason, "choice": a.choice, "confidence": conf,
                                                        "thresholds": {k: t[k] for k in ("applicability_min_confidence", "not_applicable_min_confidence", "not_applicable_max_entity_in_scope")},
                                                        "severity": severity})
    return outcome, severity, reason


# ---- stage 3: rerank --------------------------------------------------------------------------------------------
async def rerank(d: ImpactDecision, obs: list[Obligation], candidates: list[PolicyChunk]) -> list[PolicyChunk]:
    t = thresholds()
    if not candidates:
        return []
    judge = judge_for("rerank")
    ob_state = [{"index": i, "requirement": o.requirement} for i, o in enumerate(obs[: Q.MAX_OBLIGATIONS])]

    async def one(c: PolicyChunk) -> tuple[PolicyChunk, Judgment | None, dict[str, Any]]:
        state = {"obligations": ob_state, "policy_chunk": {"doc_id": c.doc_id, "title": c.title, "section": c.section, "text": c.text}}
        try:
            return c, await _ask(judge, "rerank", state, Q.rerank_questions(), d.document_id), state
        except JudgmentError as e:
            log.warning("rerank failed for %s: %s", c.chunk_id, e)
            return c, None, state

    results = await asyncio.gather(*(one(c) for c in candidates))
    scored = []
    for c, j, state in results:
        rel = j.answers["relevant"].noul if j else None
        d.record("rerank", j, state=state, evidence_ids=[c.chunk_id], provider="code", model="hybrid-search-order",
                 routing={"relevant": rel, "hybrid_score": c.score, "kept": (rel is None) or rel >= t["relevant_min"]})
        scored.append((rel if rel is not None else c.score, c))
    if all(j is None for _, j, _ in results):  # judge unavailable → keep hybrid order, say so
        d.escalation_reason = d.escalation_reason or "rerank judge unavailable; hybrid order used"
        return candidates[: int(t["rerank_keep"])]
    scored.sort(key=lambda p: -p[0])
    kept = [c.model_copy(update={"score": s}) for s, c in scored if s >= t["relevant_min"]][: int(t["rerank_keep"])]
    return kept


# ---- stage 4: alignment ----------------------------------------------------------------------------------------
async def decide_alignment(d: ImpactDecision, obs: list[Obligation], chunks: list[PolicyChunk]) -> dict[str, Any]:
    """Per (obligation, chunk) relation → {conflicts:[(i,chunk,answer)], satisfies:[...], uncertain:[...], addressed:int}."""
    t = thresholds()
    judge = judge_for("alignment")
    ob_state = [{"index": i, "requirement": o.requirement, "deadline": o.deadline} for i, o in enumerate(obs[: Q.MAX_OBLIGATIONS])]
    out: dict[str, Any] = {"conflicts": [], "satisfies": [], "uncertain": [], "not_addressed": 0, "unavailable": False}

    async def one(c: PolicyChunk) -> tuple[PolicyChunk, Judgment | None, dict[str, Any]]:
        state = {"obligations": ob_state, "policy_chunk": {"doc_id": c.doc_id, "title": c.title, "section": c.section, "text": c.text}}
        try:
            return c, await _ask(judge, "alignment", state, Q.alignment_questions(len(ob_state)), d.document_id), state
        except JudgmentError as e:
            log.warning("alignment failed for %s: %s", c.chunk_id, e)
            return c, None, state

    for c, j, state in await asyncio.gather(*(one(c) for c in chunks)):
        if j is None:
            out["unavailable"] = True
            d.record("alignment", None, state=state, evidence_ids=[c.chunk_id], routing={"unavailable": True})
            continue
        routing: dict[str, Any] = {"pairs": {}}
        for i in range(len(ob_state)):
            a = j.answers[f"ob{i}:relation"]
            conf = a.confidence or 0.0
            p_conflict = (a.probabilities or {}).get("conflicts", 0.0)
            bucket = (a.choice or "not_addressed") if conf >= t["alignment_min_confidence"] else "uncertain"
            if bucket == "uncertain" and p_conflict < t["conflict_probability_escalate_min"]:
                bucket = "harmless_uncertain"  # torn between satisfies / not_addressed — no conflict is plausible
            if bucket in ("not_addressed", "harmless_uncertain"):
                out["not_addressed"] += 1
            elif bucket == "uncertain":
                out["uncertain"].append((i, c, a))
            else:
                out[bucket].append((i, c, a))
            routing["pairs"][f"ob{i}"] = {"choice": a.choice, "confidence": round(conf, 3), "p_conflicts": round(p_conflict, 3), "bucket": bucket}
        routing["thresholds"] = {"alignment_min_confidence": t["alignment_min_confidence"], "conflict_probability_escalate_min": t["conflict_probability_escalate_min"]}
        d.record("alignment", j, state=state, evidence_ids=[c.chunk_id] + [f"ob{i}" for i in range(len(ob_state))], routing=routing)
    return out


# ---- stage 5: verification (citation check) -------------------------------------------------------------------
async def verify_conflicts(d: ImpactDecision, obs: list[Obligation], conflicts: list[tuple[int, PolicyChunk, Answer | None]], circular_text: str) -> tuple[list[tuple[int, PolicyChunk, Answer | None]], list[str]]:
    """Keep only conflicts whose regulatory claim the circular section supports. Code string-matches first."""
    t = thresholds()
    judge = judge_for("verification")
    kept, notes = [], []
    for i, c, a in conflicts:
        o = obs[i]
        if not verbatim(o.evidence.text, circular_text):
            notes.append(f"ob{i}: evidence excerpt not found verbatim in circular — dropped")
            d.record("verification", None, evidence_ids=[f"ob{i}", c.chunk_id], routing={"verdict": "fabricated", "auto": True, "reason": "excerpt not in source"})
            continue
        state = {"claim": o.requirement, "section": window(circular_text, o.evidence.text)}
        try:
            j = await _ask(judge, "verification", state, Q.verification_questions(), d.document_id)
        except JudgmentError as e:
            notes.append(f"ob{i}: verification judge unavailable ({str(e)[:60]}); kept, flagged for human")
            d.record("verification", None, state=state, evidence_ids=[f"ob{i}", c.chunk_id], routing={"verdict": "unverified", "auto": False})
            kept.append((i, c, a))
            continue
        rel = j.answers["relation"]
        conf = rel.confidence or 0.0
        auto = conf >= t["verify_min_confidence"]
        verdict = {"supports": "verified", "contradicts": "contradicted", "says_nothing": "unsupported"}.get(rel.choice or "", "unsupported")
        d.record("verification", j, state=state, evidence_ids=[f"ob{i}", c.chunk_id], routing={"verdict": verdict, "confidence": conf, "auto": auto, "threshold": t["verify_min_confidence"]})
        if verdict == "verified" or not auto:
            kept.append((i, c, a))
            if not auto:
                notes.append(f"ob{i}: citation check {verdict} at confidence {conf:.2f} — human should confirm")
        else:
            notes.append(f"ob{i}: circular section {verdict} the claimed requirement — conflict dropped")
    return kept, notes


# ---- escalation (reasoning model) --------------------------------------------------------------------------------
async def cross_check(d: ImpactDecision, obs: list[Obligation], impact: ImpactAnalysis, chunks: list[PolicyChunk], prior_conflict_p: float) -> ImpactAnalysis:
    """Independent Jev verdict on the reasoning model's conclusion. Disagreement resolves to a person, never to silence
    (archive) or to a ticket: a CONFLICT Jev calls 'satisfies' and an ALIGNED where Jev saw a live conflict both become
    'alignment not settled' → NEEDS_INVESTIGATION at the gate."""
    t = thresholds()
    if impact.applicability != "YES" or impact.alignment is None:
        return impact
    if impact.alignment == "ALIGNED":
        if prior_conflict_p >= 0.50:
            d.record("cross_check", None, routing={"verdict": "disagree", "reason": f"reasoning model ALIGNED but a typed pair had P(conflicts)={prior_conflict_p:.2f}"})
            return impact.model_copy(update={"alignment": None, "reason": impact.reason + f" | Cross-check: a typed alignment judgment had P(conflicts)={prior_conflict_p:.2f} — routed to a person."})
        d.record("cross_check", None, routing={"verdict": "agree", "reason": "no typed pair suggested a conflict"})
        return impact
    # CONFLICT: re-judge the cited (obligation, chunk) pairs with the same typed question
    cited = [c for c in chunks if any(e.doc_id == c.doc_id and _section_number(c.section) == _section_number(e.section) for e in impact.policy_evidence)] or chunks[:1]
    if not cited or not obs:
        return impact
    judge = judge_for("alignment")
    ob_state = [{"index": i, "requirement": o.requirement, "deadline": o.deadline} for i, o in enumerate(obs[: Q.MAX_OBLIGATIONS])]
    c = cited[0]
    state = {"obligations": ob_state, "policy_chunk": {"doc_id": c.doc_id, "title": c.title, "section": c.section, "text": c.text}}
    try:
        j = await _ask(judge, "cross_check", state, Q.alignment_questions(len(ob_state)), d.document_id)
    except JudgmentError as e:
        d.record("cross_check", None, state=state, evidence_ids=[c.chunk_id], routing={"verdict": "unavailable", "reason": str(e)[:120]})
        return impact.model_copy(update={"alignment": None, "reason": impact.reason + " | Cross-check judge unavailable — routed to a person."})
    answers = [j.answers[f"ob{i}:relation"] for i in range(len(ob_state))]
    conflicts = [a for a in answers if a.choice == "conflicts" and (a.confidence or 0) >= t["alignment_min_confidence"]]
    satisfies = [a for a in answers if a.choice == "satisfies" and (a.confidence or 0) >= t["alignment_min_confidence"]]
    verdict = "agree" if conflicts else ("disagree" if satisfies else "uncertain")
    d.record("cross_check", j, state=state, evidence_ids=[c.chunk_id], routing={"verdict": verdict, "conflicts": len(conflicts), "satisfies": len(satisfies)})
    if verdict == "agree":
        return impact
    note = " | Cross-check: the typed alignment judgment did not confirm the conflict — routed to a person."
    return impact.model_copy(update={"alignment": None, "reason": impact.reason + note})


async def escalate(d: ImpactDecision, llm: LLMProvider, extraction: ExtractionResult, chunks: list[PolicyChunk], profile: str, why: str) -> ImpactAnalysis | None:
    from app.agents.impact_analysis import analyze_impact
    from app.config import settings

    d.escalation_reason = why
    if not settings().foundry_configured and llm.name != "stub":
        d.record("escalation", None, routing={"outcome": "human", "reason": f"{why}; reasoning model not configured"})
        return None
    try:
        impact, res = await analyze_impact(llm, extraction, chunks, profile, document_id=d.document_id)
    except ProviderError as e:
        d.record("escalation", None, routing={"outcome": "human", "reason": f"{why}; reasoning model failed: {str(e)[:120]}"})
        return None
    d.llm_results.append(res)
    d.record("escalation", None, provider=llm.name, model=res.model, evidence_ids=[c.chunk_id for c in chunks],  # type: ignore[arg-type]
             routing={"outcome": f"{impact.applicability}/{impact.alignment}", "reason": why, "model_confidence": impact.confidence})
    # the reasoning model's policy quotes must exist verbatim in the chunks it was shown
    by_doc: dict[str, str] = {}
    for c in chunks:
        by_doc[c.doc_id] = by_doc.get(c.doc_id, "") + "\n" + c.text
    impact.policy_evidence = [e for e in impact.policy_evidence if verbatim(e.text, by_doc.get(e.doc_id, ""))]
    return impact


# ---- orchestration --------------------------------------------------------------------------------------------------
async def decide_impact(*, analysis_id: str, tenant_id: str, document_id: str, extraction: ExtractionResult, circular_text: str,
                        candidates: list[PolicyChunk], manifest: dict[str, Any], company_name: str, profile: str, llm: LLMProvider,
                        triage_confidence: float = 0.0, path_prefix: list[str] | None = None) -> ImpactDecision:
    d = ImpactDecision(analysis_id, tenant_id, document_id)
    d.path = list(path_prefix or [])
    obs = await check_extraction(d, extraction, circular_text)
    d.obligations = obs
    if not obs:
        d.impact = ImpactAnalysis(applicability="UNCERTAIN", reason="No obligation survived verification against the circular text", confidence=0.0)
        return d

    applicability, severity, why = await decide_applicability(d, extraction, obs, company_state(manifest, company_name), triage_confidence)
    reg_ev = [RegulatoryEvidence(section=o.evidence.section, text=o.evidence.text) for o in obs[:3]]
    if applicability == "NO":
        d.impact = ImpactAnalysis(applicability="NO", reason=why, regulatory_evidence=reg_ev, effective_date=extraction.effective_date,
                                  confidence=_conf(d, "applicability"), severity=severity)
        return d

    kept = await rerank(d, obs, candidates)
    d.kept_chunks = kept
    if applicability == "UNCERTAIN":
        esc = await escalate(d, llm, extraction, kept, profile, f"applicability uncertain: {why}")
        if esc is not None:
            esc = await cross_check(d, obs, esc, kept, 0.0)
        d.impact = esc or ImpactAnalysis(applicability="UNCERTAIN", reason=why, regulatory_evidence=reg_ev, effective_date=extraction.effective_date, confidence=_conf(d, "applicability"), severity=severity)
        d.impact.severity = d.impact.severity or severity
        return d

    if not kept:
        d.impact = ImpactAnalysis(applicability="YES", alignment=None, reason="Applicable, but no internal policy chunk was judged relevant to the obligations — retrieval gap, needs a person",
                                  regulatory_evidence=reg_ev, effective_date=extraction.effective_date, confidence=_conf(d, "applicability"), severity=severity)
        return d

    al = await decide_alignment(d, obs, kept)
    al["conflicts"].sort(key=lambda p: -((p[2].probabilities if p[2] else None) or {}).get("conflicts", 0.0))
    conflicts, notes = await verify_conflicts(d, obs, al["conflicts"][:6], circular_text)
    if conflicts:
        affected = list(dict.fromkeys(c.doc_id for _, c, _ in conflicts))
        pol_ev = list({(c.doc_id, c.section): PolicyEvidence(doc_id=c.doc_id, section=_section_number(c.section), text=_excerpt(c.text)) for _, c, _ in conflicts}.values())
        reg = list({i: RegulatoryEvidence(section=obs[i].evidence.section, text=obs[i].evidence.text) for i, _, _ in conflicts}.values())
        by_sec: dict[str, list[str]] = {}
        for i, c, _ in conflicts:
            by_sec.setdefault(f"{c.doc_id} §{_section_number(c.section)}", []).append(f"§{obs[i].evidence.section}")
        ps = [((a.probabilities if a else None) or {}).get("conflicts", 0.0) for _, _, a in conflicts]
        reason = (f"{len({i for i, _, _ in conflicts})} of {len(obs)} obligations conflict with the current policy: "
                  + "; ".join(f"{sec} vs circular {', '.join(dict.fromkeys(secs))}" for sec, secs in by_sec.items())
                  + f". Each pair was judged 'conflicts' by the typed alignment question (P(conflicts) {min(ps):.2f}–{max(ps):.2f}) and the regulatory claims were verified against the circular text.")
        if notes:
            reason += " Verification notes: " + "; ".join(notes) + "."
        d.impact = ImpactAnalysis(applicability="YES", alignment="CONFLICT", affected_policies=affected, reason=reason, regulatory_evidence=reg, policy_evidence=pol_ev,
                                  effective_date=extraction.effective_date, recommended_action=f"Amend {', '.join(affected)} to adopt the circular's requirements before {extraction.effective_date or 'the effective date'}; issue an interim instruction if needed.",
                                  confidence=min((a.confidence or 0.0) for _, _, a in conflicts if a) if any(a for _, _, a in conflicts) else 0.0, severity=severity)
        return d

    if al["uncertain"] or al["unavailable"] or (al["conflicts"] and not conflicts):
        why = ("alignment judge unavailable" if al["unavailable"] else f"{len(al['uncertain'])} obligation/policy pair(s) judged below confidence {thresholds()['alignment_min_confidence']}" if al["uncertain"]
               else "conflict claims failed citation verification")
        esc = await escalate(d, llm, extraction, [c for _, c, _ in al["uncertain"]] or kept, profile, why)
        if esc is not None:
            prior = max([((a.probabilities if a else None) or {}).get("conflicts", 0.0) for _, _, a in al["uncertain"] + al["conflicts"]] or [0.0])
            esc = await cross_check(d, obs, esc, [c for _, c, _ in al["uncertain"]] or kept, prior)
            esc.severity = esc.severity or severity
            d.impact = esc
            return d
        d.impact = ImpactAnalysis(applicability="YES", alignment=None, reason=f"{why}; no reasoning model available — routed to a person", regulatory_evidence=reg_ev,
                                  effective_date=extraction.effective_date, confidence=0.0, severity=severity)
        return d

    if al["satisfies"]:
        pol_ev = list({(c.doc_id, c.section): PolicyEvidence(doc_id=c.doc_id, section=_section_number(c.section), text=_excerpt(c.text)) for _, c, _ in al["satisfies"]}.values())
        reg = list({i: RegulatoryEvidence(section=obs[i].evidence.section, text=obs[i].evidence.text) for i, _, _ in al["satisfies"]}.values())
        d.impact = ImpactAnalysis(applicability="YES", alignment="ALIGNED", reason=f"Every addressed obligation is satisfied by {', '.join(dict.fromkeys(c.doc_id + ' §' + _section_number(c.section) for _, c, _ in al['satisfies']))}; no conflicting rule found in the relevant policy text",
                                  regulatory_evidence=reg, policy_evidence=pol_ev, effective_date=extraction.effective_date, recommended_action="No change required; log the review.",
                                  confidence=min((a.confidence or 0.0) for _, _, a in al["satisfies"]), severity=severity)
        return d

    d.impact = ImpactAnalysis(applicability="YES", alignment=None, reason="Relevant policy text was retrieved but none of it addresses the obligations — possible policy gap, needs a person",
                              regulatory_evidence=reg_ev, policy_evidence=[], effective_date=extraction.effective_date, confidence=0.0, severity=severity)
    return d


def _conf(d: ImpactDecision, stage: str) -> float:
    for r in d.records:
        if r.stage == stage and "confidence" in r.routing:
            return float(r.routing["confidence"])
    return 0.0


def _excerpt(chunk_text: str, chars: int = EVIDENCE_CHARS) -> str:
    """Chunk body without the 'DOC — Title §x' header line; markdown table rows flattened to readable text."""
    body = chunk_text.split("\n", 1)[-1]
    lines = []
    for ln in body.splitlines():
        if re.match(r"^\s*\|?\s*-{3,}", ln):
            continue
        ln = re.sub(r"^\s*\|\s*|\s*\|\s*$", "", ln)
        lines.append(re.sub(r"\s*\|\s*", " · ", ln))
    return " ".join(x for x in lines if x.strip())[:chars]


def _section_number(label: str) -> str:
    m = re.match(r"^(\d+(?:\.\d+)*)", label)
    return m.group(1) if m else label
