"""Demo reset (services/demo.py): owner-only, demo-workspaces-only, tenant-scoped, idempotent, audited, and it never
touches GitHub, Azure, the policy index or the cost telemetry the daily breaker relies on."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.api.deps import db as db_dep
from app.config import settings
from app.schemas.actions import TenantContext
from app.services import demo
from app.services.state import StateStore

OWNER, OTHER = "181441765", "999"
RUNTIME = ("scans", "investigations", "processed_documents", "analyses", "decisions", "reviews")


def _seed(db: StateStore, tid: str, owner: str = OWNER, is_demo: bool = True) -> None:
    x = db.conn.execute
    x("INSERT INTO tenants(tenant_id, company_name, github_repo, default_branch, connected_by, connected_by_login, connected_at, demo) VALUES(?,?,?,?,?,?,?,?)",
      (tid, tid.title(), f"o/{tid}", "main", owner, "owner", "2026-09-21T00:00:00Z", int(is_demo)))
    x("INSERT INTO scans(id, tenant_id, status, started_at, steps) VALUES(?,?,?,?,?)", (f"scan-{tid}", tid, "COMPLETED", "t", "[]"))
    x("INSERT INTO investigations(id, tenant_id, question, intent, summary, answer, judge, actor, created_at) VALUES(?,?,?,?,?,?,?,?,?)",
      (f"inv-{tid}", tid, "q", "explain", "s", "{}", "{}", "owner", "t"))
    x("INSERT INTO processed_documents(id, tenant_id, source, jurisdiction, document_id, title, url, content_hash, processed_at, status, source_mode) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
      (f"doc-{tid}", tid, "SEBI", "IN", "102584", "t", "https://www.sebi.gov.in/x", "h", "t", "AWAITING_REVIEW", "LIVE"))
    x("INSERT INTO analyses(id, tenant_id, document_pk, extraction, retrieved_chunks, ai_provider, models, metrics, created_at) VALUES(?,?,?,?,?,?,?,?,?)",
      (f"ana-{tid}", tid, f"doc-{tid}", "{}", "[]", "foundry", "{}", "{}", "t"))
    x("INSERT INTO decisions(id, analysis_id, tenant_id, stage, provider, model, question_ids, state_digest, evidence_ids, answers, routing, latency_ms, created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",
      (f"dec-{tid}", f"ana-{tid}", tid, "triage", "typesafe", "jev", "[]", "", "[]", "{}", "{}", 1, "t"))
    x("INSERT INTO reviews(id, tenant_id, document_pk, analysis_id, status, requested_at, ticket_url) VALUES(?,?,?,?,?,?,?)",
      (f"rev-{tid}", tid, f"doc-{tid}", f"ana-{tid}", "APPROVED", "t", f"https://github.com/o/{tid}/issues/7"))
    x("INSERT INTO audit_events(id, tenant_id, timestamp, actor, actor_type, event_type, metadata) VALUES(?,?,?,?,?,?,?)",
      (f"evt-{tid}", tid, "t", "owner", "human", "APPROVED", "{}"))
    x("INSERT INTO llm_calls(id, tenant_id, task, model, provider, latency_ms, ok, created_at, estimated_cost_usd) VALUES(?,?,?,?,?,?,?,?,?)",
      (f"llm-{tid}", tid, "impact", "gpt-5-mini", "foundry", 1, 1, "2099-01-01T00:00:00+00:00", 0.02))
    x("INSERT INTO policy_chunks(chunk_id, tenant_id, doc_id, title, path, section, text) VALUES(?,?,?,?,?,?,?)", ("c1", tid, "POL-001", "t", "p", "1", "text"))
    x("INSERT INTO policy_index_meta(tenant_id, repo, commit_sha, indexed_at, chunk_count) VALUES(?,?,?,?,?)", (tid, f"o/{tid}", "abc", "t", 1))
    db.conn.commit()


def _count(db: StateStore, table: str, tid: str) -> int:
    return db.conn.execute(f"SELECT COUNT(*) FROM {table} WHERE tenant_id=?", (tid,)).fetchone()[0]


def _ctx(tid: str, actor_id: str | None = OWNER) -> TenantContext:
    return TenantContext(tenant_id=tid, company_name=tid, github_repo=f"o/{tid}", actor="owner", actor_id=actor_id)


@pytest.fixture
def two(db):
    _seed(db, "nimbus")
    _seed(db, "acme")
    return db


def test_authorized_reset_clears_runtime_state_and_keeps_everything_else(two):
    out = demo.reset(two, _ctx("nimbus"), "nimbus")
    assert out["reset_completed"] and out["tenant"] == "nimbus"
    assert out["records_reset"] == {t: 1 for t in RUNTIME} | {"audit_events": 1}
    assert out["github_issues_kept"] == ["https://github.com/o/nimbus/issues/7"]
    for t in RUNTIME:
        assert _count(two, t, "nimbus") == 0, t
    # preserved: workspace, policy index (no re-embedding), cost telemetry (the daily breaker sums it)
    for t in ("tenants", "policy_chunks", "policy_index_meta", "llm_calls"):
        assert _count(two, t, "nimbus") == 1, t
    assert two.estimated_cost_since("2098-01-01") == pytest.approx(0.04), "a reset must not lower today's counted spend"


def test_other_tenants_are_untouched(two):
    demo.reset(two, _ctx("nimbus"), "nimbus")
    for t in (*RUNTIME, "audit_events", "llm_calls", "policy_chunks"):
        assert _count(two, t, "acme") == 1, t


def test_reset_is_idempotent_and_audited(two):
    demo.reset(two, _ctx("nimbus"), "nimbus")
    again = demo.reset(two, _ctx("nimbus"), "nimbus")
    assert again["reset_completed"] and not any(again["records_reset"].values())
    events = [r[0] for r in two.conn.execute("SELECT event_type FROM audit_events WHERE tenant_id='nimbus' ORDER BY timestamp")]
    assert events == ["DEMO_RESET_REQUESTED", "DEMO_RESET_COMPLETED"] * 2, "only the demo-reset trail survives, every reset recorded"


@pytest.mark.parametrize("actor", [OTHER, None])
def test_only_the_owner_can_reset(two, actor):
    with pytest.raises(demo.DemoError) as e:
        demo.reset(two, _ctx("nimbus", actor), "nimbus")
    assert e.value.status == 403 and _count(two, "processed_documents", "nimbus") == 1


def test_live_workspace_is_never_reset(db):
    _seed(db, "live", is_demo=False)
    with pytest.raises(demo.DemoError) as e:
        demo.reset(db, _ctx("live"), "live")
    assert e.value.status == 409 and _count(db, "processed_documents", "live") == 1
    assert demo.set_mode(db, _ctx("live"), True)["demo"] is True  # the owner must opt in explicitly…
    assert demo.reset(db, _ctx("live"), "live")["reset_completed"]  # …and only then can it be reset


def test_confirmation_must_name_the_workspace(two):
    with pytest.raises(demo.DemoError) as e:
        demo.reset(two, _ctx("nimbus"), "acme")
    assert e.value.status == 400 and _count(two, "scans", "nimbus") == 1


def test_production_must_opt_in(two, monkeypatch):
    monkeypatch.setattr(settings(), "environment", "production")
    monkeypatch.setattr(settings(), "enable_demo_reset", False)
    with pytest.raises(demo.DemoError) as e:
        demo.reset(two, _ctx("nimbus"), "nimbus")
    assert e.value.status == 403
    monkeypatch.setattr(settings(), "enable_demo_reset", True)
    assert demo.reset(two, _ctx("nimbus"), "nimbus")["reset_completed"]


def test_reset_makes_no_github_search_or_model_call(two, monkeypatch):
    def boom(*a, **k):
        raise AssertionError("a demo reset must not call external services")
    monkeypatch.setattr("app.tools.github.GitHubClient.__init__", boom)
    monkeypatch.setattr("app.retrieval.azure_search.AzureSearchRetriever.__init__", boom)
    monkeypatch.setattr("app.models.provider.provider", boom)
    assert demo.reset(two, _ctx("nimbus"), "nimbus")["reset_completed"]


def test_http_endpoints_enforce_ownership(two):
    from app.main import app

    app.dependency_overrides[db_dep] = lambda: two
    h = {"Authorization": f"Bearer {settings().backend_api_key}", "X-Tenant-Id": "nimbus", "X-Tenant-Repo": "o/nimbus"}
    try:
        with TestClient(app) as c:
            assert c.get("/api/workspace/demo", headers=h).status_code == 403, "no signed-in identity → refused"
            owner = h | {"X-Actor-Id": OWNER}
            st = c.get("/api/workspace/demo", headers=owner).json()
            assert st["demo"] and st["will_reset"]["processed_documents"] == 1 and st["live_documents"] == 1
            assert c.post("/api/workspace/demo/reset", headers=h | {"X-Actor-Id": OTHER}, json={"confirm_tenant_id": "nimbus"}).status_code == 403
            r = c.post("/api/workspace/demo/reset", headers=owner, json={"confirm_tenant_id": "nimbus"})
            assert r.status_code == 200 and r.json()["reset_completed"]
            assert c.post("/api/workspace/demo/reset", json={"confirm_tenant_id": "nimbus"}).status_code == 401, "backend key required"
    finally:
        app.dependency_overrides.clear()


def test_a_scan_orphaned_by_a_restart_is_failed_and_unblocks_scan_and_reset(two):
    """A revision swap stopped the process mid-scan: the next process must not inherit a scan RUNNING forever."""
    import json

    from app.services.pipeline import INTERRUPTED, recover_interrupted_scans

    steps = json.dumps([{"key": "triage", "label": "Triaging", "status": "running"}, {"key": "memo", "label": "Memo", "status": "done"}])
    two.conn.execute("UPDATE scans SET status='RUNNING', started_at='2026-09-23T15:12:58+00:00', steps=?, document_ids=? WHERE tenant_id='nimbus'", (steps, json.dumps(["doc-nimbus", "doc-done"])))
    two.conn.execute("UPDATE processed_documents SET status='DISCOVERED', processed_at='2026-09-23T15:13:00+00:00' WHERE tenant_id='nimbus'")
    two.conn.execute("INSERT INTO processed_documents(id, tenant_id, source, jurisdiction, document_id, title, url, content_hash, processed_at, status) VALUES('doc-done','nimbus','SEBI','IN','1','t','u','h2','2026-09-23T15:14:00+00:00','AWAITING_REVIEW')")
    two.conn.commit()
    assert demo.status(two, _ctx("nimbus"))["scan_running"]

    assert recover_interrupted_scans(two) == ["scan-nimbus"]
    rec = two.get_scan("scan-nimbus", "nimbus")
    assert rec.status == "FAILED" and rec.error == INTERRUPTED and rec.finished_at is not None
    assert [s.status for s in rec.steps] == ["failed", "done"]
    assert two.get_document("doc-nimbus", "nimbus").status == "FAILED", "unfinished publication is retried by the next scan"
    assert two.get_document("doc-done", "nimbus").status == "AWAITING_REVIEW", "finished work is kept"
    assert two.running_scan("nimbus") is None and not demo.status(two, _ctx("nimbus"))["scan_running"]
    assert two.conn.execute("SELECT status FROM scans WHERE id='scan-acme'").fetchone()[0] == "COMPLETED", "other tenants' scans untouched"
    assert recover_interrupted_scans(two) == [], "idempotent"
