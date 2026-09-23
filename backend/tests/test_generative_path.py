"""The generative path against a fake Foundry v1 client — no network, no credentials.

Covers: Responses API structured call → typed object + telemetry (tokens, cached tokens, cost, mode, format), the per-schema
fallback when the service rejects a strict schema, reasoning-family sampling, one deployment serving all three tasks,
budget accounting, and the real agents (extraction / impact / memo) running end to end on the fake client."""

from types import SimpleNamespace
from typing import Any

import pytest

from app.agents.impact_analysis import analyze_impact
from app.agents.memo_generation import generate_memo
from app.agents.obligation_extraction import extract_obligations
from app.config import settings
from app.models import provider as P
from app.schemas.impact import ImpactAnalysis, Memo, PolicyChunk
from app.schemas.obligations import ExtractionResult
from app.schemas.regulatory import RegulatoryDocument
from evals.dataset import load_scenarios


def _fixture(task: str) -> dict[str, Any]:
    for sc in load_scenarios():
        if sc["document"]["document_id"] == "DEMO-2026-014":
            return sc["fixtures"][task]
    raise AssertionError("fixture missing")


class FakeResponses:
    """Mimics `client.responses` for parse() and create(): returns the fixture matching the requested schema."""

    def __init__(self, reject_schemas: set[str] | None = None):
        self.calls: list[dict[str, Any]] = []
        self.reject = reject_schemas or set()

    async def parse(self, **kw: Any) -> Any:
        self.calls.append({"api": "parse", **kw})
        schema = kw["text_format"]
        if schema.__name__ in self.reject:
            raise FakeAPIError(400, f"Invalid schema for response_format '{schema.__name__}': unsupported keyword")
        payload = {"ExtractionResult": _fixture("extraction"), "ImpactAnalysis": _fixture("impact"), "Memo": _fixture("memo")}.get(schema.__name__) or {"ok": True, "echo": kw["input"]}
        parsed = schema.model_validate(payload)
        usage = SimpleNamespace(input_tokens=1200, output_tokens=300, input_tokens_details=SimpleNamespace(cached_tokens=1024))
        return SimpleNamespace(output_parsed=parsed, output_text=parsed.model_dump_json(), usage=usage)

    async def create(self, **kw: Any) -> Any:
        self.calls.append({"api": "create", **kw})
        import json

        payload = _fixture("impact") if "ImpactAnalysis" in kw.get("instructions", "") else _fixture("extraction")
        usage = SimpleNamespace(input_tokens=1500, output_tokens=350, input_tokens_details=SimpleNamespace(cached_tokens=0))
        return SimpleNamespace(output_text=json.dumps(payload), usage=usage)


class FakeAPIError(Exception):
    def __init__(self, status: int, msg: str):
        super().__init__(msg)
        self.status_code = status


class FakeEmbeddings:
    async def create(self, **kw: Any) -> Any:
        return SimpleNamespace(data=[SimpleNamespace(embedding=[0.0] * 1536) for _ in kw["input"]])


class FakeClient:
    def __init__(self, reject: set[str] | None = None):
        self.responses = FakeResponses(reject)
        self.embeddings = FakeEmbeddings()
        self.base_url = "https://aif-test.openai.azure.com/openai/v1/"

    async def close(self) -> None:
        pass


@pytest.fixture
def foundry(monkeypatch):
    monkeypatch.setattr(settings(), "foundry_endpoint", "https://aif-test.openai.azure.com")
    monkeypatch.setattr(settings(), "foundry_api_key", "unit-test-key")
    monkeypatch.setattr(settings(), "extraction_model", "gpt-4.1-mini")
    monkeypatch.setattr(settings(), "impact_model", "gpt-4.1-mini")
    monkeypatch.setattr(settings(), "memo_model", "gpt-4.1-mini")
    p = P.FoundryProvider()
    p.client = FakeClient()  # type: ignore[assignment]
    return p


async def test_structured_uses_responses_parse_with_strict_schema_and_records_telemetry(foundry):
    class Ping(P.BaseModel):
        ok: bool
        echo: str

    obj, res = await foundry.structured("extraction", "system rules", "hello", Ping)
    assert obj.ok and obj.echo == "hello"
    call = foundry.client.responses.calls[-1]
    assert call["api"] == "parse" and call["model"] == "gpt-4.1-mini" and call["text_format"] is Ping
    assert call["instructions"] == "system rules" and call["input"] == "hello" and call["temperature"] == 0
    assert res.structured_mode == "json_schema" and res.provider == "foundry" and res.attempts == 1
    assert (res.input_tokens, res.output_tokens, res.cached_tokens) == (1200, 300, 1024)
    assert res.estimated_cost_usd == pytest.approx(((1200 - 1024) * 0.40 + 1024 * 0.10 + 300 * 1.60) / 1_000_000, abs=1e-6)  # rounded to 6 dp


async def test_one_deployment_serves_all_three_tasks(foundry):
    assert foundry.model_for("extraction") == foundry.model_for("impact") == foundry.model_for("memo") == "gpt-4.1-mini"


def test_reasoning_family_models_get_no_temperature():
    assert P.FoundryProvider._sampling("gpt-4.1-mini") == {"temperature": 0}
    assert P.FoundryProvider._sampling("gpt-5-mini") == {} and P.FoundryProvider._sampling("o4-mini") == {}
    # Ask narration runs at low effort; pipeline tasks keep the deployment default
    assert P.FoundryProvider._sampling("gpt-5-mini", "ask") == {"reasoning": {"effort": "low"}}
    assert P.FoundryProvider._sampling("gpt-5-mini", "ask", "chat") == {"reasoning_effort": "low"}
    assert P.FoundryProvider._sampling("gpt-5-mini", "impact") == {} and P.FoundryProvider._sampling("gpt-4.1-mini", "ask") == {"temperature": 0}


async def test_schema_rejected_once_falls_back_to_json_mode_for_that_schema_only(foundry):
    foundry.client = FakeClient(reject={"ImpactAnalysis"})  # type: ignore[assignment]
    doc = RegulatoryDocument(source="SEBI", jurisdiction="IN", document_id="DEMO-2026-014", title="t", url="https://x", content="body " * 50).with_hash()
    ext, res = await extract_obligations(foundry, doc)
    assert res.structured_mode == "json_schema" and len(ext.obligations) == 5
    chunks = [PolicyChunk(chunk_id="c1", doc_id="POL-001", title="", path="p", section="4.1", text="fixed caps reviewed annually", score=0.9)]
    imp, res2 = await analyze_impact(foundry, ext, chunks, "Acme — stock broker")
    assert imp.alignment == "CONFLICT" and res2.structured_mode == "json_object"
    apis = [c["api"] for c in foundry.client.responses.calls]
    assert apis == ["parse", "parse", "create"]  # extraction strict; impact strict rejected → JSON mode; no retry storm
    assert foundry._strict_ok == {"ExtractionResult": True, "ImpactAnalysis": False}
    # second impact call goes straight to JSON mode without trying the rejected schema again
    await analyze_impact(foundry, ext, chunks, "Acme — stock broker")
    assert [c["api"] for c in foundry.client.responses.calls][-1] == "create" and len(foundry.client.responses.calls) == 4


async def test_agents_run_end_to_end_on_the_v1_client_with_toon_context(foundry):
    doc = RegulatoryDocument(source="SEBI", jurisdiction="IN", document_id="DEMO-2026-014", title="t", url="https://x", content="body " * 50).with_hash()
    ext, r1 = await extract_obligations(foundry, doc)
    assert isinstance(ext, ExtractionResult) and r1.context_format is None
    chunks = [PolicyChunk(chunk_id="c1", doc_id="POL-001", title="", path="p", section="4.1", text="fixed caps reviewed annually", score=0.9)]
    imp, r2 = await analyze_impact(foundry, ext, chunks, "Acme — stock broker")
    assert isinstance(imp, ImpactAnalysis) and r2.context_format == "toon"
    assert "obligations[" in foundry.client.responses.calls[-1]["input"]  # TOON table in the prompt
    memo, r3 = await generate_memo(foundry, ext, imp, chunks, document_id="DEMO-2026-014")
    assert isinstance(memo, Memo) and memo.disclaimer.startswith("AI-generated") and r3.context_format == "toon"


async def test_budget_counts_generative_calls_not_embeddings(foundry):
    P.budget_var.set(P.CallBudget(1))
    try:
        await foundry.embed(["x"])  # embeddings are not budgeted
        await foundry.structured("memo", "s", "u", Memo)
        with pytest.raises(P.BudgetExceeded):
            await foundry.structured("memo", "s", "u", Memo)
    finally:
        P.budget_var.set(None)


async def test_concurrency_is_capped_by_the_semaphore(foundry, monkeypatch):
    import asyncio

    monkeypatch.setattr(settings(), "max_concurrent_calls", 2)
    p = P.FoundryProvider()
    p.client = FakeClient()  # type: ignore[assignment]
    active, peak = 0, 0
    orig = p.client.responses.parse

    async def slow(**kw: Any) -> Any:
        nonlocal active, peak
        active += 1
        peak = max(peak, active)
        await asyncio.sleep(0.01)
        active -= 1
        return await orig(**kw)

    p.client.responses.parse = slow  # type: ignore[method-assign]
    await asyncio.gather(*(p.structured("memo", "s", "u", Memo) for _ in range(6)))
    assert peak <= 2
