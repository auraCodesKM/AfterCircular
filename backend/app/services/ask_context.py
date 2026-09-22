"""Ask context: deterministic, bounded retrieval of the workspace records a question can be answered from.

Nothing here reasons. It selects and shapes real rows (documents, analyses, evidence, reviews, policies, scans, audit,
previous conversation turns) into a compact structure with stable ids (`D1`, `D1.R2`, `D1.P1`, `D1.O3`) so that every
judgment Jev makes and every sentence the narrative model writes can be traced back to a record. Text is clipped, counts
are capped; the whole context is what the models see — never the database.
"""

from __future__ import annotations

from typing import Any

from app.schemas.actions import Investigation, TenantContext
from app.services.state import StateStore

MAX_DOCS = 8
MAX_OBLIGATIONS = 6
MAX_EVIDENCE = 4
MAX_TEXT = 240
MAX_TURNS = 3
MAX_ACTIVITY = 8


def clip(s: Any, n: int = MAX_TEXT) -> str:
    t = " ".join(str(s or "").split())
    return t if len(t) <= n else t[: n - 1] + "…"


def document_record(db: StateStore, tenant_id: str, d: dict[str, Any], ref: str, review: Any | None) -> dict[str, Any]:
    a = db.get_analysis(d["analysis_id"], tenant_id) if d.get("analysis_id") else None
    imp = (a.impact if a else None) or {}
    ext = (a.extraction if a else None) or {}
    rec: dict[str, Any] = {
        "id": ref, "document_pk": d["id"], "document_id": d["document_id"], "circular_number": d.get("circular_number"), "title": clip(d["title"], 160),
        "regulator": d["source"], "published_date": d.get("published_date"), "effective_date": imp.get("effective_date") or d.get("effective_date"),
        "source_mode": d.get("source_mode"), "synthetic": bool(d.get("synthetic")), "url": d.get("url"), "document_url": d.get("document_url"),
        "status": d["status"], "impact": d.get("impact"), "analysis_id": d.get("analysis_id"),
        "applicability": imp.get("applicability"), "alignment": imp.get("alignment"), "gate": a.gate_outcome if a else None,
        "severity": imp.get("severity"), "confidence": imp.get("confidence"), "affected_policies": imp.get("affected_policies") or [],
        "reason": clip(imp.get("reason"), 320), "recommended_action": clip(imp.get("recommended_action"), 200),
        "decision_path": a.decision_path if a else [], "escalation_reason": clip(a.escalation_reason, 160) if a and a.escalation_reason else None,
        "obligations": [{"id": f"{ref}.O{i + 1}", "requirement": clip(o.get("requirement")), "area": o.get("affected_area"), "deadline": o.get("deadline"), "section": (o.get("evidence") or {}).get("section")}
                        for i, o in enumerate((ext.get("obligations") or [])[:MAX_OBLIGATIONS])],
        "regulatory_evidence": [{"id": f"{ref}.R{i + 1}", "section": e.get("section"), "text": clip(e.get("text"))} for i, e in enumerate((imp.get("regulatory_evidence") or [])[:MAX_EVIDENCE])],
        "policy_evidence": [{"id": f"{ref}.P{i + 1}", "doc_id": e.get("doc_id"), "section": e.get("section"), "text": clip(e.get("text"))} for i, e in enumerate((imp.get("policy_evidence") or [])[:MAX_EVIDENCE])],
        "review": {"status": review.status, "decided_by": review.decided_by, "decided_at": review.decided_at.isoformat() if review.decided_at else None,
                   "ticket_id": review.ticket_id, "ticket_url": review.ticket_url} if review else None,
        "memo": bool(a and a.memo),
        "triage": (a.metrics or {}).get("triage") if a else None,
        "regulatory_source": imp.get("regulatory_source"),
        "policy_sources": imp.get("policy_sources") or {},
    }
    return rec


def build_context(db: StateStore, tenant: TenantContext, question: str, conversation_id: str | None) -> dict[str, Any]:
    docs = [d.model_dump(mode="json") for d in db.list_documents(tenant.tenant_id, limit=MAX_DOCS)]
    reviews = {r.document_pk: r for r in db.list_reviews(tenant.tenant_id)}
    records = [document_record(db, tenant.tenant_id, d, f"D{i + 1}", reviews.get(d["id"])) for i, d in enumerate(docs)]
    meta = db.policy_index_meta(tenant.tenant_id) or {}
    policies = [{"doc_id": p["doc_id"], "title": p.get("title"), "version": p.get("version"), "effective_date": p.get("effective_date"), "category": p.get("category")}
                for p in (meta.get("documents") or [])]
    scan = db.latest_scan(tenant.tenant_id)
    activity = [{"at": e.timestamp.isoformat(), "event": e.event_type, "actor": e.actor, "document_pk": e.document_pk}
                for e in db.list_audit(tenant.tenant_id, limit=MAX_ACTIVITY) if e.event_type not in ("DOCUMENT_SKIPPED", "POLICIES_RETRIEVED")]
    turns: list[Investigation] = db.conversation(tenant.tenant_id, conversation_id, MAX_TURNS) if conversation_id else []
    return {
        "workspace": {"company": tenant.company_name, "tenant_id": tenant.tenant_id, "policy_repository": tenant.github_repo, "note": "Company and policies are a fictional PoC tenant; regulatory documents are real only when source_mode is LIVE."},
        "question": question,
        "conversation": [{"question": t.question, "intent": t.intent, "answer_summary": clip(t.summary, 400), "records_cited": (t.answer.get("reasoning") or {}).get("cited", [])} for t in turns],
        "records": records,
        "policies": policies,
        "pending_reviews": [{"record": r["id"], "title": r["title"]} for r in records if r["review"] and r["review"]["status"] == "AWAITING_REVIEW"],
        "latest_scan": {"status": scan.status, "source_mode": scan.source_mode, "source_status": scan.source_status, "new": scan.new_documents, "skipped": scan.skipped_documents,
                        "at": (scan.finished_at or scan.started_at).isoformat(), "llm_calls": scan.llm_calls} if scan else None,
        "recent_activity": activity,
    }


def index_ids(ctx: dict[str, Any]) -> dict[str, dict[str, Any]]:
    """Every citable id in the context → the record/evidence it names (for validating model output)."""
    out: dict[str, dict[str, Any]] = {}
    for r in ctx["records"]:
        out[r["id"]] = r
        for k in ("obligations", "regulatory_evidence", "policy_evidence"):
            for e in r[k]:
                out[e["id"]] = {**e, "record": r["id"]}
    return out
