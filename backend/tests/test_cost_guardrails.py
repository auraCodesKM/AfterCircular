"""Cost guardrails and the TOON adapter — no model calls, no network."""

import pytest

from app.agents.context import budget_chunks, obligation_block
from app.config import settings
from app.models.provider import BudgetExceeded, CallBudget, StubProvider, budget_var, estimate_cost
from app.schemas.impact import ImpactAnalysis, PolicyChunk
from app.schemas.obligations import Evidence, Obligation
from app.toon import compare, format_context, from_toon, validate_toon


def test_call_budget_stops_the_pipeline_instead_of_spending():
    b = CallBudget(2)
    b.take("extraction")
    b.take("impact")
    with pytest.raises(BudgetExceeded):
        b.take("memo")


async def test_structured_draws_from_the_budget():
    budget_var.set(CallBudget(1))
    stub = StubProvider()
    await stub.structured("impact", "s", "u", ImpactAnalysis, context={"document_id": "DEMO-2026-014"})
    with pytest.raises(BudgetExceeded):
        await stub.structured("impact", "s", "u", ImpactAnalysis, context={"document_id": "DEMO-2026-014"})
    budget_var.set(None)


def test_cost_estimate_uses_cached_price_and_unknown_models_are_none():
    assert estimate_cost("gpt-4o-mini", 1_000_000, 0) == 0.15
    assert estimate_cost("gpt-4o-mini", 1_000_000, 0, cached_tokens=1_000_000) == 0.075
    assert estimate_cost("some-custom-deployment", 100, 10) is None


def test_toon_round_trips_and_is_smaller_than_json_for_uniform_rows():
    rows = [{"i": i, "area": "position_limits", "requirement": f"Requirement {i} with, a comma", "deadline": "2026-10-15"} for i in range(5)]
    block = format_context({"obligations": rows})
    assert block.format == "toon" and not block.fallback
    assert from_toon(block.text) == {"obligations": rows}
    c = compare({"obligations": rows})
    assert c["toon"] < c["compact_json"] < c["pretty_json"]


def test_toon_validates_against_a_schema():
    text = format_context({"section": "2.1", "text": "verbatim"}).text
    from app.schemas.impact import RegulatoryEvidence

    assert validate_toon(text, RegulatoryEvidence).section == "2.1"


def test_obligation_block_respects_the_context_budget(monkeypatch):
    monkeypatch.setattr(settings(), "max_obligations_in_context", 2)
    obs = [Obligation(requirement=f"r{i}", affected_area="other", evidence=Evidence(section=str(i), text=f"text {i} long enough")) for i in range(5)]
    assert from_toon(obligation_block(obs).text)["obligations"].__len__() == 2


def test_budget_chunks_dedupes_and_never_cuts_inside_a_chunk(monkeypatch):
    monkeypatch.setattr(settings(), "max_evidence_tokens", 40)
    mk = lambda i, text, score: PolicyChunk(chunk_id=f"c{i}", doc_id="POL-001", title="t", path="p", section=str(i), text=text, score=score)  # noqa: E731
    chunks = [mk(1, "same words " * 10, 0.9), mk(2, "same words " * 10, 0.8), mk(3, "other text " * 10, 0.7), mk(4, "third " * 10, 0.6)]
    kept = budget_chunks(chunks)
    assert [c.chunk_id for c in kept] == ["c1", "c3"] or [c.chunk_id for c in kept] == ["c1"]
    assert all(c.text in {x.text for x in chunks} for c in kept)


async def test_scan_defers_documents_beyond_the_limit(db, tenant, monkeypatch):
    from app.services.pipeline import Scan
    from tests.test_pipeline_e2e import FakeGH  # same fake repository as the e2e test

    monkeypatch.setattr("app.services.pipeline.GitHubClient", FakeGH)
    monkeypatch.setattr(settings(), "max_documents_per_scan", 1)
    rec = await Scan(db, tenant).run()
    assert rec.status == "COMPLETED", rec.error
    assert rec.new_documents == 1 and rec.deferred_documents == 2 and rec.llm_calls >= 1
    rec2 = await Scan(db, tenant).run()
    assert rec2.new_documents == 1 and rec2.skipped_documents == 1 and rec2.deferred_documents == 1


def test_section_labels_that_look_numeric_round_trip_as_toon():
    # SEBI numbers sections "5." / "2."; toon-format 0.9.0b1 left them unquoted and decoded them as floats (TOON_FALLBACK)
    from app.toon import format_context, from_toon
    payload = {"evidence": [{"section": s, "text": "x"} for s in ("5.", "2.", ".5", "4.1", "5")]}
    block = format_context(payload)
    assert block.format == "toon" and not block.fallback and from_toon(block.text) == payload
