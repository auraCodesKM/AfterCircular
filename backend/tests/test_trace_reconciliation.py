"""The trace is authoritative for the UI, so its numbers must be the persisted numbers — and the Ask answers built from it
must say the same thing. Runs on the stub scan (fixture provider, labelled as such; never 'Microsoft Foundry')."""

from __future__ import annotations

import pytest

from app.services import investigate as I
from app.services.pipeline import Scan
from app.services.reviews import decide
from app.services.trace import build_trace
from tests.test_ask_reasoning import FakeJev
from tests.test_pipeline_e2e import FakeGH


@pytest.fixture
async def scanned(db, tenant, monkeypatch):
    monkeypatch.setattr("app.services.pipeline.GitHubClient", FakeGH)
    rec = await Scan(db, tenant).run()
    assert rec.status == "COMPLETED"
    return db


def _doc(db, tenant, impact):
    return next(d for d in db.list_documents(tenant.tenant_id) if d.impact == impact)


async def test_trace_counts_reconcile_with_persisted_telemetry(scanned, tenant):
    db = scanned
    doc = _doc(db, tenant, "CONFLICT")
    tr = build_trace(db, tenant, doc.id)
    assert tr and tr["outcome"] == "CONFLICT"
    calls = db.conn.execute("SELECT COUNT(*) FROM llm_calls WHERE analysis_id=? AND ok=1", (doc.analysis_id,)).fetchone()[0]
    assert tr["summary"]["foundry_calls"] == calls == sum(1 for s in tr["steps"] if s["actor"] == "foundry" and s["status"] == "completed")
    decs = db.decisions_for(doc.analysis_id, tenant.tenant_id)
    assert tr["summary"]["jev_decision_records"] == sum(1 for d in decs if d.provider == "typesafe")
    assert tr["summary"]["jev_judgments"] == sum(len(d.question_ids) for d in decs if d.provider == "typesafe")
    a = db.get_analysis(doc.analysis_id, tenant.tenant_id)
    ret = next(s for s in tr["steps"] if s["id"] == "retrieve")
    assert ret["status"] == "completed" and ret["telemetry"]["count"] == len(a.retrieved_chunks) == len(ret["details"]["chunks"]) == tr["summary"]["azure_search_results"]
    assert [c["rank"] for c in ret["details"]["chunks"]] == list(range(1, len(a.retrieved_chunks) + 1))
    tok_in = db.conn.execute("SELECT SUM(input_tokens) FROM llm_calls WHERE analysis_id=? AND ok=1", (doc.analysis_id,)).fetchone()[0] or 0
    assert tr["summary"]["foundry_tokens"]["input"] == tok_in
    cost = db.conn.execute("SELECT SUM(estimated_cost_usd) FROM llm_calls WHERE analysis_id=? AND ok=1", (doc.analysis_id,)).fetchone()[0]
    assert (tr["summary"]["estimated_cost_usd"] or 0) == round(cost or 0, 6)
    assert tr["summary"]["stages"] == len(tr["steps"]) == tr["summary"]["completed"] + tr["summary"]["skipped"] + tr["summary"]["failed"] + tr["summary"]["awaiting_approval"] + tr["summary"]["blocked"]
    # the stub provider is never presented as Microsoft Foundry
    for s in tr["steps"]:
        if s["actor"] == "foundry" and s["status"] == "completed":
            assert "Foundry" not in s["name"] and "fixture" in s["telemetry"]["provider"]
    # TOON comparison only when both measurements exist
    for s in tr["steps"]:
        cc = s["telemetry"].get("context_comparison")
        if cc:
            assert cc["compact_json_tokens"] >= cc["as_sent_tokens"] >= 0 and cc["saved_tokens"] == cc["compact_json_tokens"] - cc["as_sent_tokens"]


async def test_archived_document_trace_shows_skipped_stages_with_reasons(scanned, tenant):
    tr = build_trace(scanned, tenant, _doc(scanned, tenant, "NOT_APPLICABLE").id)
    assert tr["outcome"] == "ARCHIVED"
    by = {s["id"]: s for s in tr["steps"]}
    for sid in ("escalate", "memo", "review", "github"):
        assert by[sid]["status"] == "skipped", sid
    assert "not applicable" in by["memo"]["reason"].lower() or "no conflict" in by["memo"]["reason"].lower()
    assert "decisive" in by["escalate"]["reason"].lower() or "triage" in by["escalate"]["reason"].lower()
    assert all(s["reason"] for s in tr["steps"] if s["status"] == "skipped"), "every skipped step says why"


async def test_github_is_blocked_until_a_human_approves_then_completed(scanned, tenant, monkeypatch):
    db = scanned
    doc = _doc(db, tenant, "CONFLICT")
    before = build_trace(db, tenant, doc.id)
    by = {s["id"]: s for s in before["steps"]}
    assert by["review"]["status"] == "awaiting_approval" and by["github"]["status"] == "blocked" and "approval" in by["github"]["reason"].lower()
    class GH:
        def __init__(self, token):
            pass

        async def find_issue(self, repo, marker):
            return None

        async def create_issue(self, repo, payload):
            return {"number": 7, "html_url": "https://github.com/x/y/issues/7"}

    monkeypatch.setattr("app.services.reviews.GitHubClient", GH)
    review = db.review_for_document(doc.id)
    await decide(db, tenant, review.id, "approve", "ok")
    after = build_trace(db, tenant, doc.id)
    by = {s["id"]: s for s in after["steps"]}
    assert by["review"]["status"] == "completed" and by["review"]["telemetry"]["actor_type"] == "human"
    assert by["github"]["status"] == "completed" and by["github"]["telemetry"]["issue"]


async def test_failed_foundry_call_is_a_failed_step_not_a_result(db, tenant, monkeypatch):
    from app.models import provider as P

    monkeypatch.setattr("app.services.pipeline.GitHubClient", FakeGH)

    class Down(P.LLMProvider):
        name = "foundry"

        async def generate(self, *a, **k):
            raise P.ProviderError("Foundry call failed (NotFoundError): DeploymentNotFound")

        async def embed(self, texts):
            return None

    await Scan(db, tenant, llm=Down()).run()
    doc = next(d for d in db.list_documents(tenant.tenant_id) if d.status == "FAILED")
    tr = build_trace(db, tenant, doc.id)
    by = {s["id"]: s for s in tr["steps"]}
    assert by["extract"]["status"] == "failed" and by["extract"]["telemetry"]["ok"] is False and "DeploymentNotFound" in by["extract"]["telemetry"]["error"]
    assert by["gate"]["status"] == "skipped" and by["github"]["status"] == "skipped" and tr["summary"]["failed"] == 1


async def test_ask_pipeline_cost_and_performance_answers_come_from_the_trace(scanned, tenant, monkeypatch):
    db = scanned
    doc = _doc(db, tenant, "CONFLICT")
    tr = build_trace(db, tenant, doc.id)
    focus = {"document_pk": doc.id}
    for intent, needle in (("pipeline", "executed stages"), ("cost", "priced"), ("performance", "typed judgments"), ("retrieval", "candidates"), ("next_step", "awaiting your decision"), ("toon", "TOON")):
        monkeypatch.setattr(I, "judge_for", lambda task, intent=intent: FakeJev(intent=intent))
        inv = await I.investigate(db, tenant, "q?", focus=focus)
        assert inv.answer["reasoning"]["kind"] == "workspace_data" and needle in inv.summary, (intent, inv.summary)
        assert inv.answer["trace"]["analysis_id"] == doc.analysis_id
    monkeypatch.setattr(I, "judge_for", lambda task: FakeJev(intent="performance"))
    inv = await I.investigate(db, tenant, "How many Foundry calls?", focus=focus)
    assert f"{tr['summary']['foundry_calls']} " in inv.summary and f"{tr['summary']['jev_judgments']} typed judgments" in inv.summary
    # why a stage did NOT run, on the archived record
    arch = _doc(db, tenant, "NOT_APPLICABLE")
    monkeypatch.setattr(I, "judge_for", lambda task: FakeJev(intent="pipeline"))
    inv = await I.investigate(db, tenant, "Why didn't Foundry run?", focus={"document_pk": arch.id})
    assert "did not run" in inv.summary and "triage" in inv.summary.lower()
