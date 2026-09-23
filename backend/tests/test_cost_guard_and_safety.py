"""Application cost circuit breakers + compliance safety cases — no network, no credentials."""

import asyncio
from typing import Any

import pytest

from app.config import settings
from app.models import provider as P
from app.schemas.impact import ImpactAnalysis
from app.services.gate import route
from app.services.pipeline import Scan
from tests.test_pipeline_e2e import FakeGH

DOC = "DEMO-2026-014"


# ---- CallBudget: calls + estimated cost -------------------------------------------------------------------------------
def test_below_at_and_above_the_scan_cost_budget():
    b = P.CallBudget(limit=100, cost_limit=0.50)
    b.take("a"); b.add(0.20)          # below → next call allowed
    b.take("b"); b.add(0.30)          # exactly at the limit after this call
    with pytest.raises(P.BudgetExceeded) as e:
        b.take("c")                    # refused: spent >= limit
    assert e.value.reason == "BUDGET_EXCEEDED:scan_cost"
    b2 = P.CallBudget(limit=100, cost_limit=0.50)
    b2.take("a"); b2.add(0.49)
    b2.take("b")                       # still under before the call → allowed (the crossing call completes and is recorded)
    b2.add(0.10)
    with pytest.raises(P.BudgetExceeded):
        b2.take("c")


def test_daily_budget_counts_earlier_spend():
    b = P.CallBudget(limit=100, cost_limit=0, daily_limit=5.0, daily_spent_before=4.99)
    b.take("a"); b.add(0.02)
    with pytest.raises(P.BudgetExceeded) as e:
        b.take("b")
    assert e.value.reason == "BUDGET_EXCEEDED:daily_cost" and b.daily_spent == pytest.approx(5.01)


def test_unknown_pricing_adds_nothing_but_is_counted():
    b = P.CallBudget(limit=100, cost_limit=0.01)
    for i in range(5):
        b.take(f"t{i}"); b.add(None)
    assert b.spent == 0 and b.unknown_pricing_calls == 5
    assert P.estimate_cost("some-private-deployment", 1000, 1000) is None
    assert P.pricing_status("some-private-deployment", None) == "unknown"
    assert P.pricing_status("gpt-5-mini", 0.001) == "estimate" and P.pricing_for("gpt-5-mini") == (0.25, 0.025, 2.0)


def test_zero_limits_disable_cost_breakers_but_not_the_call_cap():
    b = P.CallBudget(limit=2, cost_limit=0, daily_limit=0)
    b.take("a"); b.add(100.0); b.take("b"); b.add(100.0)
    with pytest.raises(P.BudgetExceeded) as e:
        b.take("c")
    assert e.value.reason == "BUDGET_EXCEEDED:calls"


class _Fake:
    """Provider that costs a fixed estimate per call and fails schema validation `bad` times first (to exercise repair)."""

    def __init__(self, cost: float, bad: int = 0):
        self.cost, self.bad, self.calls = cost, bad, 0

    async def structured(self, task, system, user, schema, **kw):
        return await P.LLMProvider.structured(self, task, system, user, schema, **kw)  # type: ignore[arg-type]

    generate_structured = P.LLMProvider.generate_structured
    model_for = P.LLMProvider.model_for
    name = "fake"

    async def generate(self, task, system, user, *, model=None, json_mode=False, context=None):
        self.calls += 1
        text = "not json" if self.bad > 0 else '{"applicability":"NO","reason":"x","confidence":0.9}'
        self.bad -= 1
        return P.LLMResult(task=task, model="fake", provider="fake", text=text, latency_ms=1, estimated_cost_usd=self.cost, pricing_status="estimate")

    async def embed(self, texts):
        return None


async def test_repair_attempt_draws_from_the_same_budget_and_stops_at_the_limit():
    P.budget_var.set(P.CallBudget(limit=1, cost_limit=0))
    try:
        with pytest.raises(P.BudgetExceeded) as e:
            await _Fake(0.01, bad=1).structured("impact", "s", "u", ImpactAnalysis)
        assert e.value.reason == "BUDGET_EXCEEDED:calls"
    finally:
        P.budget_var.set(None)


async def test_cost_accumulates_across_stages_and_stops_the_next_stage():
    P.budget_var.set(P.CallBudget(limit=100, cost_limit=0.025))
    try:
        f = _Fake(0.01)
        await f.structured("extraction", "s", "u", ImpactAnalysis)
        await f.structured("impact", "s", "u", ImpactAnalysis)
        await f.structured("memo", "s", "u", ImpactAnalysis)  # crosses 0.025 → recorded
        with pytest.raises(P.BudgetExceeded):
            await f.structured("memo", "s", "u", ImpactAnalysis)
        assert f.calls == 3 and P.budget_var.get().spent == pytest.approx(0.03)  # type: ignore[union-attr]
    finally:
        P.budget_var.set(None)


async def test_budget_is_deterministic_under_concurrency():
    P.budget_var.set(P.CallBudget(limit=4, cost_limit=0))
    try:
        f = _Fake(0.0)
        results = await asyncio.gather(*(f.structured("memo", "s", "u", ImpactAnalysis) for _ in range(10)), return_exceptions=True)
        ok = [r for r in results if not isinstance(r, Exception)]
        refused = [r for r in results if isinstance(r, P.BudgetExceeded)]
        assert len(ok) == 4 and len(refused) == 6 and f.calls == 4
    finally:
        P.budget_var.set(None)


# ---- pipeline-level breakers ------------------------------------------------------------------------------------------------
async def test_daily_limit_reached_before_the_scan_makes_no_call_and_fails_visibly(db, tenant, monkeypatch):
    monkeypatch.setattr("app.services.pipeline.GitHubClient", FakeGH)
    monkeypatch.setattr(settings(), "max_estimated_cost_per_day_usd", 0.01)
    db.record_llm_call(tenant_id="other-tenant", scan_id="s0", task="memo", model="gpt-5-mini", provider="foundry", latency_ms=1,
                       input_tokens=1, output_tokens=1, ok=1, estimated_cost_usd=0.02)
    rec = await Scan(db, tenant).run()
    assert rec.status == "FAILED" and rec.error_kind == "ai" and "daily" in rec.error.lower() and rec.llm_calls == 0
    assert "BUDGET_EXCEEDED:daily_cost" in (rec.error_detail or "")


async def test_scan_cost_limit_stops_generative_work_mid_scan_with_an_audit_event(db, tenant, monkeypatch):
    """Stub calls are free; give them a price so the scan breaker trips after the first call. No memo, no review row."""
    monkeypatch.setattr("app.services.pipeline.GitHubClient", FakeGH)
    monkeypatch.setattr(settings(), "max_estimated_cost_per_scan_usd", 0.001)
    orig = P.StubProvider.generate

    async def priced(self, *a, **k):
        r = await orig(self, *a, **k)
        r.estimated_cost_usd, r.pricing_status = 0.002, "estimate"
        return r

    monkeypatch.setattr(P.StubProvider, "generate", priced)
    rec = await Scan(db, tenant).run()
    events = {e.event_type for e in db.list_audit(tenant.tenant_id)}
    assert "BUDGET_EXCEEDED" in events and "MEMO_GENERATED" not in events and "REVIEW_REQUESTED" not in events
    assert rec.status == "FAILED" and rec.error_kind == "ai"
    docs = db.list_documents(tenant.tenant_id)
    assert docs and all(d.status == "FAILED" for d in docs) and db.list_reviews(tenant.tenant_id) == []
    assert rec.llm_calls == 1  # the crossing call completed and was recorded; nothing after it


# ---- safety cases ----------------------------------------------------------------------------------------------------
async def test_search_unavailable_is_a_visible_failure_not_a_guess(db, tenant, monkeypatch):
    monkeypatch.setattr("app.services.pipeline.GitHubClient", FakeGH)

    class DownRetriever:
        name = "azure-ai-search"

        async def index(self, tenant_id, chunks):
            raise RuntimeError("HttpResponseError: 403 Forbidden (Search)")

        async def is_ready(self, tenant_id):
            return False

        async def search(self, *a, **k):
            raise RuntimeError("down")

    rec = await Scan(db, tenant, ret=DownRetriever()).run()
    assert rec.status == "FAILED" and rec.error_kind == "backend" and "403" in (rec.error_detail or "")
    assert db.list_reviews(tenant.tenant_id) == [] and rec.llm_calls == 0


async def test_foundry_unavailable_fails_the_document_not_the_truth(db, tenant, monkeypatch):
    monkeypatch.setattr("app.services.pipeline.GitHubClient", FakeGH)

    class Down(P.LLMProvider):
        name = "foundry"

        async def generate(self, *a, **k):
            raise P.ProviderError("Foundry call failed (APITimeoutError): timed out")

        async def embed(self, texts):
            return None

    rec = await Scan(db, tenant, llm=Down()).run()
    assert rec.status == "COMPLETED"  # the scan finishes; each document is marked FAILED with the provider error, nothing archived
    docs = db.list_documents(tenant.tenant_id)
    assert docs and all(d.status == "FAILED" and "Foundry" in (d.error or "") for d in docs)
    assert db.list_reviews(tenant.tenant_id) == []
    failed_calls = db.conn.execute("SELECT task, ok, error FROM llm_calls WHERE ok=0").fetchall()
    assert failed_calls and all("Foundry" in r["error"] for r in failed_calls)  # the failure is telemetry, not a result
    assert not db.conn.execute("SELECT 1 FROM llm_calls WHERE ok=1").fetchone()
    assert {e.event_type for e in db.list_audit(tenant.tenant_id)} >= {"PIPELINE_FAILED"} and "TICKET_CREATED" not in {e.event_type for e in db.list_audit(tenant.tenant_id)}


def test_gate_never_accepts_a_conflict_without_two_sided_evidence():
    one_sided = ImpactAnalysis(applicability="YES", alignment="CONFLICT", affected_policies=["POL-001"], reason="r", confidence=0.9,
                               regulatory_evidence=[{"section": "1", "text": "x"}], policy_evidence=[])  # type: ignore[list-item]
    assert route(one_sided)[0] == "NEEDS_INVESTIGATION"


async def test_usage_endpoint_reports_only_recorded_calls_and_budgets(db, tenant, monkeypatch):
    from app.api.usage import usage as usage_endpoint

    db.record_llm_call(tenant_id=tenant.tenant_id, scan_id="scan_x", task="extraction", model="gpt-5-mini", provider="foundry", latency_ms=100,
                       input_tokens=1000, output_tokens=200, cached_tokens=0, ok=1, estimated_cost_usd=0.00065, pricing_status="estimate", context_format=None)
    db.record_llm_call(tenant_id=tenant.tenant_id, scan_id="scan_x", task="impact", model="gpt-5-mini", provider="foundry", latency_ms=300,
                       input_tokens=500, output_tokens=100, cached_tokens=0, ok=1, estimated_cost_usd=0.000325, pricing_status="estimate", context_format="toon", attempts=2)
    db.record_llm_call(tenant_id="other", scan_id="scan_y", task="memo", model="private-model", provider="foundry", latency_ms=50,
                       input_tokens=10, output_tokens=10, ok=0, error="boom", estimated_cost_usd=None, pricing_status="unknown")
    out = usage_endpoint(period="today", scan_id=None, t=tenant, s=db)
    assert out["requests"] == 2 and out["input_tokens"] == 1500 and out["output_tokens"] == 300 and out["cached_tokens"] == 0
    assert out["estimated_cost_usd"] == pytest.approx(0.000975) and out["retried"] == 1 and out["toon_calls"] == 1 and out["errors"] == 0
    assert out["models"][0]["model"] == "gpt-5-mini" and out["models"][0]["pricing_status"] == "estimate"
    assert out["budget"]["spent_today_usd"] == pytest.approx(0.000975)  # application-wide; the unknown-priced call adds 0
    assert out["budget"]["daily_limit_usd"] == settings().max_estimated_cost_per_day_usd and out["budget"]["daily_remaining_usd"] > 0
    assert out["pricing"]["gpt-5-mini"] == "estimate"


def test_production_guard_names_every_unsafe_setting(monkeypatch):
    from app.config import Settings

    s = Settings(ENVIRONMENT="production", AI_PROVIDER="stub", FOUNDRY_ENDPOINT="", AZURE_SEARCH_ENDPOINT="", SEBI_MODE="demo_snapshot",
                 BACKEND_API_KEY="change-me", CORS_ORIGINS="*", DATABASE_PATH="data/aftercircular.db")  # type: ignore[call-arg]
    problems = " | ".join(s.production_guard())
    for needle in ("FOUNDRY_ENDPOINT", "AZURE_SEARCH_ENDPOINT", "SEBI_MODE", "BACKEND_API_KEY", "CORS_ORIGINS", "DATABASE_PATH"):
        assert needle in problems, needle
    ok = Settings(ENVIRONMENT="production", AI_PROVIDER="foundry", FOUNDRY_ENDPOINT="https://aif.example/", AZURE_SEARCH_ENDPOINT="https://srch.example",
                  SEBI_MODE="live", BACKEND_API_KEY="real-secret", CORS_ORIGINS="https://web.example", DATABASE_PATH="/data/aftercircular.db",
                  TYPESAFE_API_KEY="jev-key", DEFAULT_JUDGE="typesafe")  # type: ignore[call-arg]
    assert ok.production_guard() == []
    # a dev box is never blocked by the production contract
    assert Settings(ENVIRONMENT="dev", AI_PROVIDER="stub").production_guard() == []  # type: ignore[call-arg]


async def test_production_never_falls_back_to_the_local_index_when_search_is_down(db, monkeypatch):
    from app.retrieval import azure_search as az

    monkeypatch.setattr(az.settings(), "azure_search_endpoint", "https://srch-test.search.windows.net")
    monkeypatch.setattr(az, "AzureSearchRetriever", _boom)
    monkeypatch.setattr(az.settings(), "environment", "dev")
    assert az.retriever(db).name != "azure-ai-search"  # dev degrades, with a warning
    monkeypatch.setattr(az.settings(), "environment", "production")
    with pytest.raises(RuntimeError):
        az.retriever(db)


def _boom(*a, **k):
    raise RuntimeError("search down")
