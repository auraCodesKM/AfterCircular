"""End-to-end trace of one document — built only from persisted rows (documents, analyses, decisions, llm_calls, audit,
reviews). Authoritative for the UI: every step carries actor, status, a one-line summary, why it ran (or did not) and
the telemetry it actually left behind. A step that did not run says so; nothing is inferred from configuration."""

from __future__ import annotations

from collections import Counter
from typing import Any, Literal

from app.schemas.actions import TenantContext
from app.schemas.decisions import DecisionRecord
from app.services.state import StateStore

Actor = Literal["regulator", "connector", "deterministic", "jev", "foundry", "embedding", "azure_search", "human", "github"]
Status = Literal["completed", "skipped", "failed", "awaiting_approval", "blocked"]
ROLE: dict[str, str] = {"regulator": "Official source", "connector": "Official source ingestion", "deterministic": "Deterministic decision gate", "jev": "Reasoning support",
                        "foundry": "Generative reasoning", "embedding": "Semantic representation", "azure_search": "Retrieval", "human": "Human decision", "github": "External side effect"}
NAME: dict[str, str] = {"regulator": "SEBI", "connector": "Connector", "deterministic": "Impact Gate", "jev": "Jev", "foundry": "Microsoft Foundry", "embedding": "Embeddings",
                        "azure_search": "Azure AI Search", "human": "Human review", "github": "GitHub"}
GROUP: dict[str, str] = {"regulator": "source", "connector": "source", "jev": "reasoning", "foundry": "reasoning", "embedding": "reasoning", "azure_search": "reasoning",
                         "deterministic": "decision", "human": "action", "github": "action"}


def _calls(db: StateStore, analysis_id: str) -> list[dict[str, Any]]:
    return [dict(r) for r in db.conn.execute("SELECT * FROM llm_calls WHERE analysis_id=? ORDER BY created_at", (analysis_id,)).fetchall()]


def _llm(calls: list[dict[str, Any]], task: str, metrics: dict[str, Any]) -> dict[str, Any] | None:
    c = next((c for c in calls if c["task"] == task), None)
    if c is None:  # rows written before llm_calls carried analysis_id: the same telemetry lives in analysis.metrics[task]
        m = metrics.get(task)
        if not (isinstance(m, dict) and m.get("model")):
            return None
        c = {**m, "provider": "foundry", "created_at": None, "ok": 1, "attempts": m.get("attempts", 1)}
    t: dict[str, Any] = {"provider": "Microsoft Foundry" if c.get("provider") == "foundry" else f"{c.get('provider')} (no model — fixture)", "model": c["model"], "api": "Responses API", "structured_mode": c.get("structured_mode"), "response_id": c.get("response_id"),
                         "latency_ms": c.get("latency_ms"), "input_tokens": c.get("input_tokens"), "output_tokens": c.get("output_tokens"), "cached_tokens": c.get("cached_tokens"),
                         "estimated_cost_usd": c.get("estimated_cost_usd"), "pricing": "list-price estimate, not an Azure invoice" if c.get("estimated_cost_usd") is not None else "unknown",
                         "attempts": c.get("attempts") or 1, "at": c.get("created_at"), "ok": bool(c.get("ok", 1)), "error": c.get("error"), "context_format": c.get("context_format")}
    if c.get("context_tokens") is not None and c.get("context_json_tokens"):
        ct, cj = int(c["context_tokens"]), int(c["context_json_tokens"])
        t["context_comparison"] = {"kind": "serialization comparison · same payload · tiktoken", "as_sent_format": c.get("context_format"), "as_sent_tokens": ct, "compact_json_tokens": cj,
                                   "saved_tokens": cj - ct, "saved_pct": round(100 * (cj - ct) / cj, 1) if cj else None,
                                   "note": "Measures structural serialization overhead of the structured context only; not provider billing and not total prompt size."}
    return t


def _stage(decs: list[DecisionRecord], stage: str) -> list[DecisionRecord]:
    return [d for d in decs if d.stage == stage]


def _jev_stage(decs: list[DecisionRecord], stage: str) -> dict[str, Any] | None:
    rows = _stage(decs, stage)
    if not rows:
        return None
    r0 = rows[0]
    out: dict[str, Any] = {"stage": stage, "records": len(rows), "provider": r0.provider, "model": r0.model, "calibrated": r0.calibrated,
                           "latency_ms": sum(d.latency_ms for d in rows), "input_tokens": sum(d.input_tokens or 0 for d in rows), "output_tokens": sum(d.output_tokens or 0 for d in rows),
                           "questions": sum(len(d.question_ids) for d in rows)}
    rt = r0.routing
    out["outcome"], out["confidence"] = rt.get("outcome"), rt.get("confidence")
    if stage == "triage":
        out["decision"] = f"{rt.get('outcome')} · {rt.get('choice')} · P={rt.get('confidence')}"
        out["entity_in_scope"], out["depends_on_unstated_fact"] = rt.get("entity_in_scope"), rt.get("depends_on_unstated_fact")
    elif stage == "extraction_check":
        out["decision"] = f"{rt.get('kept')} obligation(s) confirmed, {len(rt.get('dropped') or [])} dropped, {len(rt.get('flagged_uncertain') or [])} flagged uncertain"
        out["kept"], out["dropped"], out["uncertain"] = rt.get("kept"), len(rt.get("dropped") or []), len(rt.get("flagged_uncertain") or [])
    elif stage == "applicability":
        out["decision"] = f"{rt.get('outcome')} · {rt.get('choice')} · P={rt.get('confidence')}"
        out["reason"] = rt.get("reason")
    elif stage == "rerank":
        kept = sum(1 for d in rows if d.routing.get("kept"))
        out["decision"] = f"{kept} / {len(rows)} policy sections judged relevant"
        out["kept"], out["total"] = kept, len(rows)
        out["items"] = [{"chunk": (d.evidence_ids or [""])[0].split("_", 1)[-1], "relevant": d.routing.get("relevant"), "kept": d.routing.get("kept")} for d in rows]
    elif stage == "alignment":
        pairs = [(k, v) for d in rows for k, v in (d.routing.get("pairs") or {}).items()]
        cnt = Counter(v.get("bucket") or v.get("choice") for _, v in pairs)
        out["decision"] = ", ".join(f"{n} {k}" for k, n in cnt.most_common()) or "no pairs"
        out["counts"] = dict(cnt)
        out["items"] = [{"obligation": k, "choice": v.get("choice"), "confidence": v.get("confidence"), "p_conflicts": v.get("p_conflicts")} for k, v in pairs][:24]
        out["conflicts"] = sum(1 for _, v in pairs if v.get("choice") == "conflicts")
    elif stage == "verification":
        v = Counter(d.routing.get("verdict") for d in rows)
        label = {"verified": "excerpt(s) verified verbatim against the stored text", "fabricated": "excerpt(s) rejected — not verbatim in the source, dropped before the gate"}
        out["decision"] = ", ".join(f"{n} {label.get(str(k), str(k))}" for k, n in v.most_common())
        out["counts"] = dict(v)
    elif stage == "cross_check":
        out["decision"] = f"{rt.get('verdict')} with the Foundry conclusion ({rt.get('conflicts')} conflict pair(s), {rt.get('satisfies')} satisfied)"
        out["verdict"], out["conflict_pairs"], out["satisfied_pairs"] = rt.get("verdict"), rt.get("conflicts"), rt.get("satisfies")
    return out


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
    ext = (a.extraction if a else None) or {}
    metrics = (a.metrics if a else None) or {}
    ret = metrics.get("retrieval") or {}
    tri = metrics.get("triage") or {}
    ev = {e.event_type: e for e in audit}
    gate = a.gate_outcome if a else None
    path = a.decision_path if a else []
    steps: list[dict[str, Any]] = []

    def step(sid: str, actor: str, operation: str, status: str, summary: str, *, reason: str | None = None, telemetry: dict[str, Any] | None = None,
             details: dict[str, Any] | None = None, latency_ms: int | None = None, at: str | None = None, name: str | None = None) -> None:
        if actor == "foundry" and telemetry and telemetry.get("provider") and not str(telemetry["provider"]).startswith("Microsoft"):
            name = str(telemetry["provider"])  # never label a fixture or another provider as Microsoft Foundry
        steps.append({"id": sid, "order": len(steps) + 1, "actor": actor, "name": name or NAME[actor], "role": ROLE[actor], "group": GROUP[actor], "operation": operation, "status": status,
                      "summary": summary, "reason": reason, "latency_ms": latency_ms, "at": at, "telemetry": telemetry or {}, "details": details or {}})

    # 1 source
    step("source", "regulator", "Official circular", "completed", f"{doc.source} circular {doc.circular_number or doc.document_id}, published {doc.published_date or '—'}",
         reason="Read from the official regulator listing, not from a search engine or a snapshot" if doc.source_mode == "LIVE" else "Fictional demo snapshot record (synthetic), labelled as such",
         details={"url": doc.url, "pdf_url": doc.document_url, "reference": doc.circular_number, "published": doc.published_date, "source_mode": doc.source_mode, "synthetic": doc.synthetic, "title": doc.title})
    # 2 ingestion
    step("ingest", "connector", "Ingestion and change detection", "completed", f"New document detected (content hash {doc.content_hash[:12]}…)",
         reason="The content hash was not among this tenant's processed documents, so the pipeline ran", at=ev["DOCUMENT_DETECTED"].timestamp.isoformat() if "DOCUMENT_DETECTED" in ev else None,
         details={"content_hash": doc.content_hash, "fetched_at": doc.fetched_at.isoformat() if doc.fetched_at else None, "document_version": doc.document_version})
    # 3 triage
    jt = _jev_stage(decs, "triage")
    if jt:
        archived = (tri.get("outcome") == "archive") or gate == "ARCHIVED"
        step("triage", "jev", "Triage", "completed", f"{'Outside scope — archived' if archived else 'In scope — proceed'} ({jt['decision']})",
             reason="Every new document is triaged before any generative call so out-of-scope circulars cost nothing", telemetry=jt,
             details={"addressees": tri.get("addressees"), "entity_match": tri.get("entity_match")}, latency_ms=jt["latency_ms"])
    else:
        step("triage", "deterministic", "Triage (prefilter)", "completed" if tri else "skipped",
             "Addressee prefilter matched the company profile — Jev triage not needed" if tri.get("stage") == "prefilter" else "Prefilter", name="Prefilter (code)",
             reason="A code prefilter on the circular's addressee block settles obvious cases; Jev is consulted only when it cannot",
             details={"stage": tri.get("stage"), "outcome": tri.get("outcome"), "addressees": tri.get("addressees"), "entity_match": tri.get("entity_match")})
    archived_note = ("Archived at triage — the circular does not concern this company, so no further stage ran" if not _llm(calls, "extraction", metrics)
                     else "Judged not applicable after the typed applicability judgment — no escalation, memo or review was needed" if gate == "ARCHIVED" else "Not reached")
    # 4 extraction
    fx = _llm(calls, "extraction", metrics)
    n_ob = len(ext.get("obligations") or [])
    step("extract", "foundry", "Obligation extraction", "completed" if fx and fx["ok"] else "failed" if fx else "skipped",
         f"Extracted {n_ob} obligation{'s' if n_ob != 1 else ''} as strict JSON Schema" if fx else "Not run",
         reason="Document passed triage and required obligation extraction" if fx else archived_note, telemetry=fx or {}, latency_ms=fx.get("latency_ms") if fx else None, at=fx.get("at") if fx else None,
         details={"applies_to": ext.get("applies_to"), "effective_date": ext.get("effective_date"), "obligations": [{"section": (o.get("evidence") or {}).get("section"), "requirement": o.get("requirement")} for o in (ext.get("obligations") or [])][:12]})
    jx = _jev_stage(decs, "extraction_check")
    step("extraction_check", "jev", "Extraction check", "completed" if jx else "skipped", jx["decision"] if jx else "Not run",
         reason="Each extracted obligation is checked against its verbatim excerpt before it can drive a decision" if jx else archived_note, telemetry=jx or {}, latency_ms=jx["latency_ms"] if jx else None)
    # 5 retrieval
    step("embed", "embedding", "Query embedding", "completed" if ret.get("vector") else "skipped",
         f"{ret.get('embedding_model')} · 1536 dimensions" if ret.get("vector") else "Not run",
         reason="Obligations were available, so the retrieval query was embedded for the vector leg of hybrid search" if ret.get("vector") else archived_note,
         telemetry={"model": ret.get("embedding_model"), "dimensions": 1536, "latency_ms": ret.get("embed_ms")} if ret else {}, latency_ms=ret.get("embed_ms"))
    chunks = [{"rank": i + 1, "doc_id": c.get("doc_id"), "section": c.get("section"), "path": c.get("path"), "score": c.get("score"), "commit": c.get("commit_sha"), "chunk_hash": c.get("chunk_hash")} for i, c in enumerate(a.retrieved_chunks if a else [])]
    step("retrieve", "azure_search", "Hybrid policy retrieval", "completed" if ret else "skipped",
         f"{ret.get('count')} policy candidates · {ret.get('method')}" if ret else "Not run",
         reason="Obligations were available, so the tenant's policy corpus was searched for the clauses they touch" if ret else archived_note,
         telemetry={"backend": ret.get("backend"), "method": ret.get("method"), "k": ret.get("k"), "count": ret.get("count"), "latency_ms": ret.get("search_ms"), "tenant_filter": f"tenant_id eq '{t.tenant_id}' and status eq 'active'",
                    "corpus_commits": ret.get("commits"), "query_chars": len(ret.get("query") or "") or None, "at": ret.get("at")} if ret else {},
         details={"chunks": chunks}, latency_ms=ret.get("search_ms"))
    # 6 typed reasoning
    ja, jr, jal = _jev_stage(decs, "applicability"), _jev_stage(decs, "rerank"), _jev_stage(decs, "alignment")
    if any((ja, jr, jal)):
        parts = [x["decision"] for x in (ja, jr, jal) if x]
        tel = {k: v for k, v in (("applicability", ja), ("rerank", jr), ("alignment", jal)) if v}
        step("reason", "jev", "Applicability · rerank · alignment", "completed", " · ".join(parts),
             reason="Typed, calibrated judgments route the case; they are model judgments and never authorize an action", telemetry=tel, latency_ms=sum(x["latency_ms"] for x in (ja, jr, jal) if x))
    else:
        step("reason", "jev", "Applicability · rerank · alignment", "skipped", "Not run", reason=archived_note if not fx else "No obligations to judge")
    # 7 escalation
    fi = _llm(calls, "impact", metrics)
    esc = a.escalation_reason if a else None
    step("escalate", "foundry", "Impact analysis (escalation)", "completed" if fi and fi["ok"] else "failed" if fi else "skipped",
         f"{imp.get('applicability')} / {imp.get('alignment') or '—'} — Foundry reasoning on the full obligation and policy context" if fi else "Not run",
         reason=(f"Typed reasoning was not decisive: {esc}" if esc else "Escalation rule triggered") if fi else ("Typed judgments were decisive — Foundry reasons only when applicability or alignment stays uncertain" if (ja or jal) else archived_note),
         telemetry=fi or {}, latency_ms=fi.get("latency_ms") if fi else None, at=fi.get("at") if fi else None)
    # 8 verification
    jv, jc = _jev_stage(decs, "verification"), _jev_stage(decs, "cross_check")
    if jv or jc:
        step("verify", "jev", "Verification / cross-check", "completed", " · ".join(x["decision"] for x in (jv, jc) if x),
             reason="Cited excerpts are re-checked against the stored text; a Foundry conclusion is cross-checked before it can reach the gate" if jc or jv else None,
             telemetry={k: v for k, v in (("verification", jv), ("cross_check", jc)) if v}, latency_ms=sum(x["latency_ms"] for x in (jv, jc) if x))
    else:
        step("verify", "jev", "Verification / cross-check", "skipped", "Not run", reason=archived_note if not fx else "No conflict pair to verify")
    # 9 gate
    step("gate", "deterministic", "Impact Gate", "completed" if gate else "skipped",
         f"{gate} · applicability {imp.get('applicability')} · alignment {imp.get('alignment') or '—'} · confidence {round((imp.get('confidence') or 0) * 100)}%" if gate else "Not run",
         reason="Deterministic rules over the typed judgments, verified evidence and thresholds classify the case; the gate, not a model, sets the outcome" if gate else None,
         telemetry={"outcome": gate, "applicability": imp.get("applicability"), "alignment": imp.get("alignment"), "confidence": imp.get("confidence"), "affected_policies": imp.get("affected_policies"),
                    "decision_path": path, "escalation_reason": esc, "regulatory_evidence": len(imp.get("regulatory_evidence") or []), "policy_evidence": len(imp.get("policy_evidence") or [])})
    # 10 memo
    fm = _llm(calls, "memo", metrics)
    step("memo", "foundry", "Memo drafting", "completed" if fm and fm["ok"] else "failed" if fm else "skipped", "Compliance memo drafted from the verified evidence" if fm else "Not run",
         reason="Impact Gate produced CONFLICT" if fm else ("No conflict — memo drafting not required" if gate and gate != "CONFLICT" else archived_note if not fx else "No verified conflict"),
         telemetry=fm or {}, latency_ms=fm.get("latency_ms") if fm else None, at=fm.get("at") if fm else None)
    # 11 human
    if review:
        decided = review.status in ("APPROVED", "REJECTED")
        step("review", "human", "Decision" if decided else "Approval required", "completed" if decided else "awaiting_approval",
             f"{review.status.replace('_', ' ').title()}" + (f" by @{review.decided_by}" if decided else " — no external action has been taken"),
             reason="A verified conflict always stops here; approval is the only path to a side effect",
             telemetry={"review_id": review.id, "status": review.status, "decided_by": review.decided_by, "decided_at": review.decided_at.isoformat() if review.decided_at else None,
                        "actor_type": next((ev[k].actor_type for k in ("APPROVED", "REJECTED") if k in ev), None), "note": review.note}, at=review.decided_at.isoformat() if review.decided_at else None)
    else:
        step("review", "human", "Human review", "skipped", "Not required", reason="Only a verified CONFLICT is put to a person" if gate else archived_note)
    # 12 github
    if review and review.ticket_url:
        step("github", "github", "Compliance issue", "completed", f"Issue #{review.ticket_id} created after approval",
             reason="Human approval recorded; the side effect ran once and is idempotent",
             telemetry={"issue": review.ticket_id, "url": review.ticket_url, "created_at": ev["TICKET_CREATED"].timestamp.isoformat() if "TICKET_CREATED" in ev else None, "actor": "aftercircular (after human approval)"},
             at=ev["TICKET_CREATED"].timestamp.isoformat() if "TICKET_CREATED" in ev else None)
    elif review and review.status == "AWAITING_REVIEW":
        step("github", "github", "Compliance issue", "blocked", "Not executed", reason="Waiting for human approval — no external action")
    elif review:
        step("github", "github", "Compliance issue", "skipped", "Not executed", reason="Rejected by a person — no external action")
    else:
        step("github", "github", "Compliance issue", "skipped", "Not executed", reason="No review was needed, so no side effect")

    foundry_steps = [s for s in steps if s["actor"] == "foundry" and s["status"] == "completed"]
    by = Counter(s["status"] for s in steps)
    lat = {"foundry_ms": sum(s["latency_ms"] or 0 for s in foundry_steps) or None, "jev_ms": sum(s["latency_ms"] or 0 for s in steps if s["actor"] == "jev" and s["latency_ms"]) or None,
           "azure_search_ms": ret.get("search_ms"), "embedding_ms": ret.get("embed_ms")}
    tok = {"input": sum(s["telemetry"].get("input_tokens") or 0 for s in foundry_steps), "output": sum(s["telemetry"].get("output_tokens") or 0 for s in foundry_steps),
           "cached": sum(s["telemetry"].get("cached_tokens") or 0 for s in foundry_steps)}
    cost = [s["telemetry"].get("estimated_cost_usd") for s in foundry_steps if s["telemetry"].get("estimated_cost_usd") is not None]
    cmp_rows = [s["telemetry"]["context_comparison"] for s in foundry_steps if s["telemetry"].get("context_comparison")]
    summary = {"stages": len(steps), "completed": by.get("completed", 0), "skipped": by.get("skipped", 0), "failed": by.get("failed", 0), "awaiting_approval": by.get("awaiting_approval", 0), "blocked": by.get("blocked", 0),
               "foundry_calls": len(foundry_steps), "jev_judgments": sum(len(d.question_ids) for d in decs if d.provider == "typesafe"), "jev_decision_records": sum(1 for d in decs if d.provider == "typesafe"),
               "azure_search_retrievals": 1 if ret else 0, "azure_search_results": ret.get("count") if ret else None, "deterministic_gate": 1 if gate else 0, "human_pending": by.get("awaiting_approval", 0),
               "latency": lat, "foundry_tokens": tok, "estimated_cost_usd": round(sum(cost), 6) if cost else None, "pricing": "list-price estimate, not an Azure invoice",
               "context_comparison": {"measured_calls": len(cmp_rows), "compact_json_tokens": sum(r["compact_json_tokens"] for r in cmp_rows), "as_sent_tokens": sum(r["as_sent_tokens"] for r in cmp_rows),
                                      "saved_tokens": sum(r["saved_tokens"] for r in cmp_rows), "saved_pct": round(100 * sum(r["saved_tokens"] for r in cmp_rows) / sum(r["compact_json_tokens"] for r in cmp_rows), 1) if cmp_rows and sum(r["compact_json_tokens"] for r in cmp_rows) else None,
                                      "note": "Same-payload serialization comparison (tiktoken) for the structured context blocks of the measured calls; not provider billing"} if cmp_rows else None}
    return {"document_pk": pk, "document_id": doc.document_id, "title": doc.title, "tenant_id": t.tenant_id, "analysis_id": a.id if a else None, "outcome": gate,
            "summary": summary, "steps": steps, "foundry_calls": len(foundry_steps), "jev_records": summary["jev_decision_records"],
            "audit_events": [{"at": e.timestamp.isoformat(), "event": e.event_type, "actor": e.actor, "actor_type": e.actor_type} for e in audit]}
