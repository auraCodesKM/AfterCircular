"""End-to-end trace of one document — built only from persisted rows (documents, analyses, decisions, llm_calls, audit,
reviews). Every step says whether it ran, from which service, with the stored telemetry; a step that did not run says so
("not needed" / "not reached") — the trace never implies an execution that the tables do not hold."""

from __future__ import annotations

from typing import Any

from app.schemas.actions import TenantContext
from app.services.state import StateStore


def _calls(db: StateStore, analysis_id: str) -> list[dict[str, Any]]:
    return [dict(r) for r in db.conn.execute("SELECT * FROM llm_calls WHERE analysis_id=? ORDER BY created_at", (analysis_id,)).fetchall()]


def _llm_step(calls: list[dict[str, Any]], task: str, metrics: dict[str, Any]) -> dict[str, Any] | None:
    c = next((c for c in calls if c["task"] == task), None)
    if not c:  # rows written before llm_calls carried analysis_id: the same telemetry lives in analysis.metrics[task]
        m = metrics.get(task)
        return {**m, "provider": "foundry", "at": None, "ok": True} if isinstance(m, dict) and m.get("model") else None
    return {"model": c["model"], "provider": c["provider"], "response_id": c.get("response_id"), "latency_ms": c["latency_ms"], "input_tokens": c["input_tokens"],
            "output_tokens": c["output_tokens"], "cached_tokens": c.get("cached_tokens"), "estimated_cost_usd": c.get("estimated_cost_usd"), "structured_mode": c.get("structured_mode"),
            "context_format": c.get("context_format"), "at": c["created_at"], "ok": bool(c["ok"])}


def _jev(decs: list[Any], stage: str) -> dict[str, Any] | None:
    rows = [d for d in decs if d.stage == stage]
    if not rows:
        return None
    return {"records": len(rows), "provider": rows[0].provider, "model": rows[0].model, "calibrated": rows[0].calibrated,
            "latency_ms": sum(d.latency_ms for d in rows), "input_tokens": sum(d.input_tokens or 0 for d in rows), "output_tokens": sum(d.output_tokens or 0 for d in rows),
            "outcomes": [d.routing.get("outcome") or d.routing.get("verdict") or d.routing.get("kept") for d in rows][:12]}


def build_trace(db: StateStore, t: TenantContext, pk: str) -> dict[str, Any] | None:
    doc = db.get_document(pk, t.tenant_id)
    if not doc:
        return None
    a = db.get_analysis(doc.analysis_id, t.tenant_id) if doc.analysis_id else None
    decs = db.decisions_for(a.id, t.tenant_id) if a else []
    calls = _calls(db, a.id) if a else []
    audit = db.list_audit(t.tenant_id, limit=200, document_pk=pk)
    review = db.review_for_document(pk)
    imp = (a.impact if a else None) or {}
    metrics = (a.metrics if a else None) or {}
    ret = metrics.get("retrieval") or {}
    tri = metrics.get("triage") or {}
    ev = {e.event_type: e for e in audit}

    def step(n: int, service: str, name: str, ran: bool, detail: dict[str, Any] | None = None, note: str | None = None) -> dict[str, Any]:
        return {"n": n, "service": service, "name": name, "ran": ran, "detail": detail or {}, "note": note}

    ext = _llm_step(calls, "extraction", metrics)
    impact_call = _llm_step(calls, "impact", metrics)
    memo_call = _llm_step(calls, "memo", metrics)
    gate = a.gate_outcome if a else None
    steps = [
        step(1, "SEBI", "official circular", True, {"url": doc.url, "pdf": doc.document_url, "reference": doc.circular_number, "published": doc.published_date, "source_mode": doc.source_mode, "synthetic": doc.synthetic}),
        step(2, "connector", "live ingestion", True, {"content_hash": doc.content_hash, "fetched_at": doc.fetched_at.isoformat() if doc.fetched_at else None,
                                                     "detected_at": ev["DOCUMENT_DETECTED"].timestamp.isoformat() if "DOCUMENT_DETECTED" in ev else None}),
        step(3, "Jev" if _jev(decs, "triage") else "prefilter (code)", "triage", bool(_jev(decs, "triage")) or bool(tri), {**tri, **(_jev(decs, "triage") or {})} if (tri or _jev(decs, "triage")) else None,
             None if _jev(decs, "triage") else ("prefilter skipped triage (addressee match)" if tri.get("stage") == "prefilter" else "not reached")),
        step(4, "Microsoft Foundry", "obligation extraction", bool(ext), ext, None if ext else "not reached (archived at triage)"),
        step(5, "Foundry embeddings", "query embedding", bool(ret.get("vector")), {"model": ret.get("embedding_model"), "embed_ms": ret.get("embed_ms")} if ret else None, None if ret else "not reached"),
        step(6, "Azure AI Search", "hybrid retrieval", bool(ret), {"backend": ret.get("backend"), "method": ret.get("method"), "k": ret.get("k"), "count": ret.get("count"), "search_ms": ret.get("search_ms"),
                                                                 "commits": ret.get("commits"), "chunks": [{"doc_id": c.get("doc_id"), "section": c.get("section"), "path": c.get("path"), "score": c.get("score"), "commit": c.get("commit_sha")} for c in (a.retrieved_chunks if a else [])][:10]} if ret else None,
             None if ret else "not reached"),
        step(7, "Jev", "extraction check · applicability · rerank · alignment", any(_jev(decs, s_) for s_ in ("extraction_check", "applicability", "rerank", "alignment")),
             {s_: _jev(decs, s_) for s_ in ("extraction_check", "applicability", "rerank", "alignment") if _jev(decs, s_)} or None),
        step(8, "Microsoft Foundry", "impact analysis (escalation)", bool(impact_call), impact_call,
             None if impact_call else ("not needed — typed judgments were decisive; Foundry reasons only on escalation" if a and a.decision_path and "foundry:escalation" not in a.decision_path else "not reached")),
        step(9, "Jev", "verification / cross-check", any(_jev(decs, s_) for s_ in ("verification", "cross_check")), {s_: _jev(decs, s_) for s_ in ("verification", "cross_check") if _jev(decs, s_)} or None),
        step(10, "Impact Gate", "deterministic gate", bool(gate), {"outcome": gate, "applicability": imp.get("applicability"), "alignment": imp.get("alignment"), "confidence": imp.get("confidence"),
                                                                  "affected_policies": imp.get("affected_policies"), "decision_path": a.decision_path if a else [], "escalation_reason": a.escalation_reason if a else None}),
        step(11, "Microsoft Foundry", "memo drafting", bool(memo_call), memo_call, None if memo_call else "not needed — memos are drafted only for a verified CONFLICT"),
        step(12, "Human", "review", review is not None, {"review_id": review.id, "status": review.status, "decided_by": review.decided_by, "decided_at": review.decided_at.isoformat() if review.decided_at else None,
                                                        "actor_type": ev["APPROVED"].actor_type if "APPROVED" in ev else None} if review else None, None if review else "no review needed"),
        step(13, "GitHub", "issue", bool(review and review.ticket_url), {"issue": review.ticket_id, "url": review.ticket_url, "created_at": ev["TICKET_CREATED"].timestamp.isoformat() if "TICKET_CREATED" in ev else None} if review and review.ticket_url else None,
             None if review and review.ticket_url else "no side effect (awaiting or rejected)" if review else "no side effect"),
    ]
    return {"document_pk": pk, "document_id": doc.document_id, "title": doc.title, "tenant_id": t.tenant_id, "analysis_id": a.id if a else None,
            "foundry_calls": len(calls) or sum(1 for k in ("extraction", "impact", "memo") if isinstance(metrics.get(k), dict) and metrics[k].get("model")), "jev_records": len(decs), "audit_events": [{"at": e.timestamp.isoformat(), "event": e.event_type, "actor": e.actor, "actor_type": e.actor_type} for e in audit],
            "steps": steps}
