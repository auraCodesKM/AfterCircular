"""Ask AfterCircular: real Jev calls (faked here) over real workspace records, grounded narrative, follow-ups, refusals."""

from typing import Any

import pytest

from app.config import settings
from app.decisions.providers import JudgmentError, JudgmentProvider
from app.models.provider import LLMResult, ProviderError
from app.schemas.actions import TenantContext
from app.schemas.decisions import Answer, Judgment
from app.services import investigate as I
from app.services.ask_context import build_context, index_ids
from app.services.pipeline import Scan
from tests.test_pipeline_e2e import FakeGH


class FakeJev(JudgmentProvider):
    """Answers by question id; records every call so tests can inspect what Jev actually received."""

    name = "typesafe"
    calibrated = True

    def __init__(self, intent="prioritize", sufficient=0.9, urgency=None, fail_reason=False):
        self.intent, self.sufficient, self.urgency, self.fail_reason = intent, sufficient, urgency or {}, fail_reason
        self.calls: list[dict[str, Any]] = []

    async def ask(self, task, state, questions, *, model=None, context=None) -> Judgment:
        self.calls.append({"task": task, "state": state, "questions": list(questions)})
        if task == "ask_reason" and self.fail_reason:
            raise JudgmentError("jev down")
        out: dict[str, Answer] = {}
        for qid, q in questions.items():
            if qid == "intent":
                out[qid] = Answer(type="choice", choice=self.intent, probabilities={self.intent: 0.9}, confidence=0.9)
            elif qid in ("document", "document_2", "policy"):
                out[qid] = Answer(type="choice", choice="none", probabilities={"none": 1.0}, confidence=1.0)
            elif qid == "requests_action":
                out[qid] = Answer(type="noul", noul=0.95 if self.intent == "action_request" else 0.02)
            elif qid == "follow_up":
                out[qid] = Answer(type="noul", noul=0.9 if state.get("conversation") else 0.05)
            elif qid == "answerable":
                out[qid] = Answer(type="noul", noul=0.9)
            elif qid == "sufficient":
                out[qid] = Answer(type="noul", noul=self.sufficient)
            elif qid.endswith(":urgency"):
                rec = qid.split(":")[0]
                lvl = self.urgency.get(rec, 1)
                out[qid] = Answer(type="score", score=float(lvl), probabilities={str(i): (0.9 if i == lvl else 0.033) for i in range(4)}, confidence=0.85)
            else:
                out[qid] = Answer(type="noul", noul=0.8)
        return Judgment(provider="typesafe", model="jev-test", calibrated=True, answers=out, latency_ms=123, input_tokens=456, output_tokens=78)


class FakeNarrator:
    """Stands in for Foundry: returns an AskAnswer that cites one real id and one fabricated id."""

    name = "foundry"

    def __init__(self, cite: str, fabricate=True):
        self.cite, self.fabricate, self.calls = cite, fabricate, []

    async def structured(self, task, system, user, schema, *, model=None, context=None):
        self.calls.append({"task": task, "user": user})
        c = self.cite
        points = [I.AskPoint(record_id=c, claim=f"{c} conflicts with POL-001 and is awaiting review.", evidence_ids=[f"{c}.P1", f"{c}.R1"])]
        if self.fabricate:
            points.append(I.AskPoint(record_id="D9", claim="A circular that does not exist.", evidence_ids=["D9.R1"]))
        ans = I.AskAnswer(summary=f"Prioritise {c} first: it conflicts with POL-001 and is awaiting review.", points=points, insufficient_evidence=False, caveat=None)
        return ans, LLMResult(task=task, model="gpt-5-mini", provider="foundry", text="", latency_ms=900, input_tokens=1000, output_tokens=200, cached_tokens=0,
                              estimated_cost_usd=0.00065, pricing_status="estimate", structured_mode="json_schema", context_format=context.get("context_format") if context else None)


@pytest.fixture
async def workspace(db, tenant, monkeypatch):
    monkeypatch.setattr("app.services.pipeline.GitHubClient", FakeGH)
    rec = await Scan(db, tenant).run()  # stub scan: 014 CONFLICT (review), 015 ALIGNED, 016 NOT_APPLICABLE
    assert rec.status == "COMPLETED", rec.error
    return db


async def test_context_is_built_from_real_records_with_stable_ids(workspace, tenant):
    ctx = build_context(workspace, tenant, "which conflict?", None)
    assert len(ctx["records"]) == 3 and {r["id"] for r in ctx["records"]} == {"D1", "D2", "D3"}
    conflict = next(r for r in ctx["records"] if r["impact"] == "CONFLICT")
    assert conflict["document_id"] == "DEMO-2026-014" and conflict["affected_policies"] == ["POL-001"] and conflict["review"]["status"] == "AWAITING_REVIEW"
    assert conflict["regulatory_evidence"][0]["id"].endswith(".R1") and conflict["policy_evidence"][0]["id"].endswith(".P1") and conflict["obligations"]
    assert conflict["synthetic"] is True and conflict["source_mode"] == "DEMO_SNAPSHOT"
    ids = index_ids(ctx)
    assert conflict["policy_evidence"][0]["id"] in ids and ids[conflict["policy_evidence"][0]["id"]]["record"] == conflict["id"]
    assert ctx["pending_reviews"] and ctx["latest_scan"]["source_status"] == "DEMO_SNAPSHOT" and ctx["policies"]


async def test_reasoning_question_calls_jev_twice_with_real_evidence_and_records_provenance(workspace, tenant, monkeypatch):
    conflict = next(r["id"] for r in build_context(workspace, tenant, "", None)["records"] if r["impact"] == "CONFLICT")
    jev = FakeJev(intent="prioritize", urgency={conflict: 3})
    monkeypatch.setattr(I, "judge_for", lambda task: jev)
    monkeypatch.setattr(settings(), "ask_narrative", False)
    inv = await I.investigate(workspace, tenant, "Which should be prioritized and why?")
    assert [c["task"] for c in jev.calls] == ["ask", "ask_reason"]
    reason_state = jev.calls[1]["state"]
    assert reason_state["question"].startswith("Which should") and len(reason_state["records"]) == 3
    r = reason_state["records"][0]
    assert {"title", "applicability", "alignment", "affected_policies", "regulatory_evidence", "policy_evidence", "review", "effective_date", "confidence", "source_mode"} <= set(r)
    assert any(q.endswith(":urgency") for q in jev.calls[1]["questions"]) and "sufficient" in jev.calls[1]["questions"]
    prov = inv.answer["reasoning"]
    assert prov["kind"] == "jev_reasoning" and prov["jev_judgments"]["latency_ms"] == 123 and prov["jev_judgments"]["input_tokens"] == 456
    assert prov["narrative"] is None and prov["composed"] is True
    assert inv.answer["points"][0]["record_id"] == conflict and "urgency high" in inv.answer["points"][0]["claim"]
    assert inv.answer["documents"][0]["document_id"] == "DEMO-2026-014" and prov["cited"][0] == conflict


async def test_narrative_claims_are_validated_against_the_context(workspace, tenant, monkeypatch):
    conflict = next(r["id"] for r in build_context(workspace, tenant, "", None)["records"] if r["impact"] == "CONFLICT")
    jev = FakeJev(intent="prioritize", urgency={conflict: 3})
    narrator = FakeNarrator(conflict, fabricate=True)
    monkeypatch.setattr(I, "judge_for", lambda task: jev)
    monkeypatch.setattr(I, "provider", lambda: narrator)
    monkeypatch.setattr(settings(), "ask_narrative", True)
    inv = await I.investigate(workspace, tenant, "Which should be prioritized and why?")
    prov = inv.answer["reasoning"]
    assert prov["narrative"]["model"] == "gpt-5-mini" and prov["narrative"]["latency_ms"] == 900 and prov["narrative"]["context_format"] == "toon"
    assert [p["record_id"] for p in inv.answer["points"]] == [conflict] and "D9" in prov["dropped_uncited"]
    assert inv.answer["points"][0]["evidence"][0]["id"] == f"{conflict}.P1" and "text" in inv.answer["points"][0]["evidence"][0]
    assert "records" in narrator.calls[0]["user"] and "JUDGMENTS" in narrator.calls[0]["user"]
    ask_calls = [m for m in workspace.usage(tenant_id=tenant.tenant_id)["models"] if m["model"] == "gpt-5-mini"]
    assert ask_calls and ask_calls[0]["requests"] == 1  # the narrative call is real telemetry (the scan's stub calls are separate rows)


async def test_follow_up_carries_previous_turn_and_cited_records(workspace, tenant, monkeypatch):
    jev = FakeJev(intent="prioritize", urgency={"D1": 3})
    monkeypatch.setattr(I, "judge_for", lambda task: jev)
    monkeypatch.setattr(settings(), "ask_narrative", False)
    first = await I.investigate(workspace, tenant, "Which circulars conflict with our policies?")
    jev.intent = "explain"
    second = await I.investigate(workspace, tenant, "why?", conversation_id=first.conversation_id)
    assert second.conversation_id == first.conversation_id
    route_state = jev.calls[-2]["state"]
    assert route_state["conversation"][0]["question"] == "Which circulars conflict with our policies?" and route_state["conversation"][0]["answer_summary"]
    reason_state = jev.calls[-1]["state"]
    assert [r["id"] for r in reason_state["records"]] == first.answer["reasoning"]["cited"]  # a follow-up reasons over what the previous answer cited
    assert second.answer["reasoning"]["jev_route"]["flags"]["follow_up"] is True
    assert len(workspace.conversation(tenant.tenant_id, first.conversation_id)) == 2


async def test_deterministic_count_is_labelled_workspace_data_and_makes_one_jev_call(workspace, tenant, monkeypatch):
    jev = FakeJev(intent="pending_reviews")
    monkeypatch.setattr(I, "judge_for", lambda task: jev)
    inv = await I.investigate(workspace, tenant, "What needs my review?")
    assert inv.answer["reasoning"]["kind"] == "workspace_data" and len(jev.calls) == 1 and "1 conflict" in inv.summary
    assert inv.answer["documents"][0]["review"]["status"] == "AWAITING_REVIEW"


async def test_insufficient_evidence_is_said_not_invented(workspace, tenant, monkeypatch):
    jev = FakeJev(intent="other_reasoning", sufficient=0.1)
    monkeypatch.setattr(I, "judge_for", lambda task: jev)
    monkeypatch.setattr(settings(), "ask_narrative", False)
    inv = await I.investigate(workspace, tenant, "Which RBI circulars affect our treasury desk?")
    assert inv.summary.startswith("I don't have enough evidence in this workspace to determine that.") and inv.answer["insufficient_evidence"] is True
    assert inv.answer["points"] == []


async def test_action_request_is_refused_with_no_side_effect(workspace, tenant, monkeypatch):
    jev = FakeJev(intent="action_request")
    monkeypatch.setattr(I, "judge_for", lambda task: jev)
    created = []
    monkeypatch.setattr("app.services.reviews.GitHubClient", lambda token: created.append(1))
    before = [(r.id, r.status) for r in workspace.list_reviews(tenant.tenant_id)]
    inv = await I.investigate(workspace, tenant, "Create a GitHub issue for this.")
    assert inv.answer["reasoning"]["kind"] == "refused" and "requires human approval" in inv.summary and "awaiting review" in inv.summary
    assert [(r.id, r.status) for r in workspace.list_reviews(tenant.tenant_id)] == before and created == [] and len(jev.calls) == 1


async def test_jev_reasoning_outage_shows_records_not_a_fake_answer(workspace, tenant, monkeypatch):
    jev = FakeJev(intent="prioritize", fail_reason=True)
    monkeypatch.setattr(I, "judge_for", lambda task: jev)
    inv = await I.investigate(workspace, tenant, "Which should be prioritized and why?")
    assert inv.answer["reasoning"]["kind"] == "workspace_data" and "unavailable" in inv.summary and inv.answer["documents"]
    assert "error" in inv.answer["reasoning"]["jev_judgments"]


async def test_narrative_provider_failure_falls_back_to_composed_judgments(workspace, tenant, monkeypatch):
    jev = FakeJev(intent="prioritize", urgency={"D1": 2})

    class Down:
        name = "foundry"

        async def structured(self, *a, **k):
            raise ProviderError("Foundry call failed (APITimeoutError)")

    monkeypatch.setattr(I, "judge_for", lambda task: jev)
    monkeypatch.setattr(I, "provider", lambda: Down())
    monkeypatch.setattr(settings(), "ask_narrative", True)
    inv = await I.investigate(workspace, tenant, "Which should be prioritized and why?")
    prov = inv.answer["reasoning"]
    assert prov["kind"] == "jev_reasoning" and "error" in prov["narrative"] and prov["composed"] is True and inv.answer["points"]


async def test_other_tenant_has_no_records_to_reason_over(workspace, monkeypatch):
    jev = FakeJev(intent="prioritize")
    monkeypatch.setattr(I, "judge_for", lambda task: jev)
    other = TenantContext(tenant_id="nimbus-test", company_name="Nimbus", github_repo="acme/policies", default_branch="main", actor="x", github_token="t")
    inv = await I.investigate(workspace, other, "Which should be prioritized and why?")
    assert inv.answer["insufficient_evidence"] is True and "no publications have been processed" in inv.summary and inv.tenant_id == "nimbus-test"


def test_validate_answer_drops_unknown_ids():
    ids = {"D1": {"id": "D1"}, "D1.R1": {"id": "D1.R1", "record": "D1"}, "D2": {"id": "D2"}, "D2.P1": {"id": "D2.P1", "record": "D2"}}
    ans = I.AskAnswer(summary="s", points=[I.AskPoint(record_id="D1", claim="c", evidence_ids=["D1.R1", "D2.P1", "D1.R7"]), I.AskPoint(record_id="D5", claim="c", evidence_ids=[])], insufficient_evidence=False)
    out, dropped = I.validate_answer(ans, ids, {"D1", "D2"})
    assert [p.record_id for p in out.points] == ["D1"] and out.points[0].evidence_ids == ["D1.R1"] and set(dropped) == {"D2.P1", "D1.R7", "D5"}


def test_no_canned_answer_strings_remain_in_reasoning_paths():
    import inspect

    src = inspect.getsource(I)
    for banned in ("These should be prioritized", "2 of 4 processed"):
        assert banned not in src


async def test_new_list_intents_answer_from_records_without_a_model(workspace, tenant, monkeypatch):
    for intent, needle in (("list_aligned", "already aligned"), ("list_applicable", "apply to"), ("effective_dates", "DEMO/SEBI")):
        jev = FakeJev(intent=intent)
        monkeypatch.setattr(I, "judge_for", lambda task, jev=jev: jev)
        inv = await I.investigate(workspace, tenant, "q?")
        assert inv.answer["reasoning"]["kind"] == "workspace_data" and needle in inv.summary and len(jev.calls) == 1, (intent, inv.summary)


def test_by_significance_puts_conflicts_before_archived():
    recs = [{"impact": "NOT_APPLICABLE", "confidence": 1.0}, {"impact": "ALIGNED", "confidence": 0.7}, {"impact": "CONFLICT", "confidence": 0.8}, {"impact": "UNCERTAIN", "confidence": 0.5}]
    assert [r["impact"] for r in I.by_significance(recs)] == ["CONFLICT", "UNCERTAIN", "ALIGNED", "NOT_APPLICABLE"]
