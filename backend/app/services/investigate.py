"""Workspace agent: a question → typed intent routing (Jev) → structured answer assembled by code from the workspace state.

No generative model writes the answer. The agent selects (intent, document, policy) with calibrated Choice questions;
code fetches the facts and returns sections the UI renders as cards. Uncertain routing says so instead of guessing.
"""

import re
from typing import Any

from typesafe_sdk import Choice

from app.decisions.providers import JudgmentError, judge_for
from app.schemas.actions import Investigation, TenantContext
from app.services.state import StateStore, new_id, now

INTENTS: dict[str, str] = {
    "latest_changes": "what changed recently, new or latest publications or circulars, what the last scan found",
    "conflicts": "which circulars conflict with internal policy, what needs fixing",
    "pending_reviews": "what is waiting for approval or review, what needs the user's decision",
    "explain_document": "why one specific circular got its result, its evidence, impact or applicability, or details about one publication",
    "policy_lookup": "contents, clauses, owner or version of one specific internal policy document",
    "scan_status": "when the last scan ran, whether monitoring is working, which source or models are in use",
    "run_scan": "asks to run, trigger or start a new scan now",
    "other": "none of the above",
}
MIN_INTENT_CONFIDENCE = 0.5
MIN_TARGET_CONFIDENCE = 0.5


def _keyword_intent(q: str) -> str:
    ql = q.lower()
    for intent, words in (
        ("run_scan", ["run a scan", "run scan", "scan now", "trigger", "start a scan"]),
        ("pending_reviews", ["approv", "review", "waiting", "pending", "decide"]),
        ("explain_document", ["why", "evidence", "applies", "explain"]),
        ("conflicts", ["conflict"]),
        ("scan_status", ["last scan", "monitoring", "source", "model", "status"]),
        ("policy_lookup", ["policy", "pol-", "sop-", "priv-"]),
        ("latest_changes", ["what changed", "latest", "new", "recent"]),
    ):
        if any(w in ql for w in words):
            return intent
    return "other"


async def route(question: str, docs: list[dict[str, Any]], policies: list[dict[str, Any]], pending: int, document_id: str | None) -> tuple[str, int | None, str | None, dict[str, Any]]:
    """→ (intent, document index or None, policy id or None, judge metadata)."""
    judge = judge_for("ask")
    state = {"question": question, "documents": [{"index": i, "title": d["title"], "circular_number": d["circular_number"], "impact": d["impact"], "status": d["status"]} for i, d in enumerate(docs)],
             "policies": [{"doc_id": p["doc_id"], "title": p["title"]} for p in policies], "pending_reviews": pending}
    qs: dict[str, Any] = {"intent": Choice(instructions="What is `question` asking for?", criteria=dict(INTENTS))}
    if docs:
        qs["document"] = Choice(instructions="Which entry in `documents` does `question` refer to, by index? Choose none when it refers to no specific publication.",
                                criteria={**{f"doc{i}": f"documents[{i}]: {d['title'][:80]}" for i, d in enumerate(docs)}, "none": "no specific publication"})
    if policies:
        qs["policy"] = Choice(instructions="Which internal policy in `policies` does `question` refer to? Choose none when it refers to no specific policy.",
                              criteria={**{p["doc_id"]: p["title"] for p in policies}, "none": "no specific policy"})
    try:
        j = await judge.ask("ask", state, qs, context={"document_id": document_id})
    except JudgmentError as e:
        return _keyword_intent(question), None, None, {"provider": "keyword-fallback", "model": "-", "calibrated": False, "error": str(e)[:120]}
    a = j.answers["intent"]
    intent = a.choice or "other"
    meta: dict[str, Any] = {"provider": j.provider, "model": j.model, "calibrated": j.calibrated, "intent_confidence": a.confidence,
                            "intent_probabilities": a.probabilities, "latency_ms": j.latency_ms, "input_tokens": j.input_tokens}
    if j.provider == "stub":
        intent = _keyword_intent(question)
        meta["note"] = "stub judge: keyword routing"
    elif (a.confidence or 0) < MIN_INTENT_CONFIDENCE:
        meta["note"] = f"intent confidence {a.confidence:.2f} below {MIN_INTENT_CONFIDENCE}; not routed"
        intent = "other"
    doc_i = None
    if "document" in j.answers and j.provider != "stub":
        da = j.answers["document"]
        if da.choice and da.choice != "none" and (da.confidence or 0) >= MIN_TARGET_CONFIDENCE:
            doc_i = int(da.choice[3:])
        meta["document_confidence"] = da.confidence
    pol = None
    if "policy" in j.answers and j.provider != "stub":
        pa = j.answers["policy"]
        if pa.choice and pa.choice != "none" and (pa.confidence or 0) >= MIN_TARGET_CONFIDENCE:
            pol = pa.choice
        meta["policy_confidence"] = pa.confidence
    if j.provider == "stub":  # keyword targets for the stub path
        for i, dd in enumerate(docs):
            if dd["circular_number"] and dd["circular_number"].lower() in question.lower():
                doc_i = i
        m2 = re.search(r"\b(POL|SOP|PRIV)-\d{3}\b", question, re.I)
        pol = m2.group(0).upper() if m2 else None
    return intent, doc_i, pol, meta


def _doc_card(d: dict[str, Any], analysis: Any) -> dict[str, Any]:
    imp = analysis.impact if analysis else None
    return {
        "document_pk": d["id"], "title": d["title"], "circular_number": d["circular_number"], "source": d["source"], "published_date": d["published_date"],
        "effective_date": (imp or {}).get("effective_date") or d["effective_date"], "impact": d["impact"], "status": d["status"], "source_mode": d["source_mode"],
        "analysis_id": d["analysis_id"], "applicability": (imp or {}).get("applicability"), "alignment": (imp or {}).get("alignment"),
        "affected_policies": (imp or {}).get("affected_policies", []), "reason": (imp or {}).get("reason"), "severity": (imp or {}).get("severity"),
        "regulatory_evidence": (imp or {}).get("regulatory_evidence", []), "policy_evidence": (imp or {}).get("policy_evidence", []),
        "recommended_action": (imp or {}).get("recommended_action"), "decision_path": analysis.decision_path if analysis else [],
        "escalation_reason": analysis.escalation_reason if analysis else None, "ticket_url": d["ticket_url"], "ticket_id": d["ticket_id"],
    }


async def investigate(db: StateStore, tenant: TenantContext, question: str) -> Investigation:
    docs = [d.model_dump() for d in db.list_documents(tenant.tenant_id, limit=12)]
    meta = db.policy_index_meta(tenant.tenant_id) or {}
    policies = meta.get("documents") or []
    reviews = db.list_reviews(tenant.tenant_id, "AWAITING_REVIEW")
    scan = db.latest_scan(tenant.tenant_id)
    intent, doc_i, pol, judge = await route(question, docs, policies, len(reviews), docs[0]["document_id"] if docs else None)

    if doc_i is not None and intent in ("conflicts", "latest_changes", "other"):
        intent = "explain_document"  # a specific circular was named: explain it rather than list
    answer: dict[str, Any] = {"intent": intent}
    target = docs[doc_i] if doc_i is not None else None
    analysis = db.get_analysis(target["analysis_id"], tenant.tenant_id) if target and target.get("analysis_id") else None
    review_by_doc = {r.document_pk: r for r in db.list_reviews(tenant.tenant_id)}

    conflicts = [d for d in docs if d["impact"] == "CONFLICT"]
    if intent == "explain_document" and target is None and len(conflicts) == 1:
        target = conflicts[0]
        analysis = db.get_analysis(target["analysis_id"], tenant.tenant_id) if target.get("analysis_id") else None
        judge["note"] = (str(judge.get("note")) + "; " if judge.get("note") else "") + "no specific circular named; showing the only conflict"

    if intent == "run_scan":
        summary = "A scan is a human-triggered action here. Use Scan now; nothing runs from a question."
        answer["actions"] = [{"label": "Scan now", "kind": "scan"}]
    elif intent == "scan_status":
        summary = (f"Last scan {scan.status.lower()} at {scan.finished_at or scan.started_at:%b %d, %H:%M UTC} from the {('demo snapshot' if scan.source_mode == 'DEMO_SNAPSHOT' else 'live SEBI source')}: "
                   f"{scan.new_documents} new, {scan.skipped_documents} already processed." if scan else "No scan has run yet.")
        answer["scan"] = scan.model_dump(mode="json") if scan else None
    elif intent == "pending_reviews":
        summary = f"{len(reviews)} conflict{'s' if len(reviews) != 1 else ''} waiting for your decision." if reviews else "Nothing is waiting for your decision."
        answer["documents"] = [_doc_card(d, db.get_analysis(d["analysis_id"], tenant.tenant_id) if d["analysis_id"] else None) for d in docs if d["id"] in {r.document_pk for r in reviews}]
    elif intent == "conflicts":
        summary = f"{len(conflicts)} of {len(docs)} processed circulars conflict with internal policy." if docs else "No circulars have been processed yet."
        answer["documents"] = [_doc_card(d, db.get_analysis(d["analysis_id"], tenant.tenant_id) if d["analysis_id"] else None) for d in conflicts]
    elif intent == "latest_changes":
        recent = docs[:5]
        n_c = sum(1 for d in recent if d["impact"] == "CONFLICT")
        n_a = sum(1 for d in recent if d["impact"] == "ALIGNED")
        n_n = sum(1 for d in recent if d["impact"] == "NOT_APPLICABLE")
        summary = (f"{len(recent)} recent publication{'s' if len(recent) != 1 else ''}: {n_c} conflict, {n_a} aligned, {n_n} not applicable"
                   + (f", {len(recent) - n_c - n_a - n_n} pending or uncertain." if len(recent) - n_c - n_a - n_n else ".")) if recent else "No publications processed yet. Run a scan."
        answer["documents"] = [_doc_card(d, db.get_analysis(d["analysis_id"], tenant.tenant_id) if d["analysis_id"] else None) for d in recent]
    elif intent == "policy_lookup":
        pdoc = next((p for p in policies if p["doc_id"] == pol), None) if pol else None
        if pdoc:
            chunks = [c for c in db.policy_chunks(tenant.tenant_id) if c["doc_id"] == pol]
            affected = []
            for d in docs:
                a = db.get_analysis(d["analysis_id"], tenant.tenant_id) if d.get("analysis_id") else None
                if a and pol in (a.impact or {}).get("affected_policies", []):
                    affected.append(d)
            summary = f"{pdoc['doc_id']} — {pdoc['title']}, version {pdoc.get('version') or '—'}, {len(chunks)} sections." + (f" Affected by {len(affected)} circular(s)." if affected else " No processed circular affects it.")
            answer["policy"] = {**pdoc, "sections": [{"section": c["section"], "text": c["text"].split("\n", 1)[-1]} for c in chunks]}
            answer["documents"] = [_doc_card(d, db.get_analysis(d["analysis_id"], tenant.tenant_id)) for d in affected]
        else:
            summary = "Which policy? Name a document id such as POL-001." if policies else "No policies are indexed yet — run a scan to read the repository."
            answer["policies"] = policies
    elif intent == "explain_document" and target:
        imp = analysis.impact if analysis else None
        if imp:
            verdict = {"YES": {"CONFLICT": "conflicts with", "ALIGNED": "is already satisfied by"}.get(imp.get("alignment") or "", "needs a person to judge against"), "NO": "does not apply to", "UNCERTAIN": "may or may not apply to"}[imp["applicability"]]
            summary = f"{target['circular_number'] or target['title']} {verdict} {', '.join(imp.get('affected_policies') or []) or 'the current policies'}."
        else:
            summary = f"{target['title']} has not been analyzed yet ({target['status'].lower()})."
        answer["document"] = _doc_card(target, analysis)
        rv = review_by_doc.get(target["id"])
        answer["review"] = rv.model_dump(mode="json") if rv else None
    else:
        summary = ("I couldn't route that to something this workspace knows. Try: what changed, which circulars conflict, what needs my review, why does <circular> conflict, or show POL-001."
                   if intent in ("other", "explain_document") else "Nothing to show.")
        answer["suggestions"] = ["What changed in the latest scan?", "Which circulars conflict with our policies?", "What needs my review?", "Show POL-001"]

    inv = Investigation(id=new_id("inv"), tenant_id=tenant.tenant_id, question=question.strip()[:500], intent=intent, summary=summary,
                        document_pk=target["id"] if target else None, analysis_id=analysis.id if analysis else None, policy_id=pol if intent == "policy_lookup" else None,
                        answer=answer, judge=judge, actor=tenant.actor, created_at=now())
    return db.save_investigation(inv)
