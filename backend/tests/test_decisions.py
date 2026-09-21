"""Deterministic routing around typed judgments: thresholds, uncertain bands, escalation, verification, evidence."""

import os

import pytest

from app.decisions import impact as I
from app.decisions.policy import noul_band, thresholds
from app.decisions.providers import JudgmentError, JudgmentProvider, question_json
from app.schemas.decisions import Answer, Judgment
from app.schemas.impact import PolicyChunk
from app.schemas.obligations import ExtractionResult

CIRCULAR = ("1. Every stock broker shall review its internal position limit policy at least once every six months. "
            "2. Client-level limits shall be linked to the client's net worth. 3. Applies to all stock brokers.")
EXTRACTION = ExtractionResult.model_validate({
    "regulator": "SEBI", "circular_number": "T/1", "applies_to": ["stock brokers"], "summary": "limits and reviews", "effective_date": "2026-10-15",
    "obligations": [
        {"requirement": "Review the internal position limit policy at least every six months", "affected_area": "governance", "evidence": {"section": "1", "text": "review its internal position limit policy at least once every six months"}},
        {"requirement": "Link client-level limits to net worth", "affected_area": "position_limits", "evidence": {"section": "2", "text": "Client-level limits shall be linked to the client's net worth"}},
    ]})
CHUNK_41 = PolicyChunk(chunk_id="POL-001#4.1", doc_id="POL-001", title="Position Limits Policy", path="p", section="4.1 Client-level limits", text="POL-001 §4.1\nLimits are fixed caps reviewed annually.", score=0.02)
CHUNK_9 = PolicyChunk(chunk_id="POL-001#9", doc_id="POL-001", title="Position Limits Policy", path="p", section="9 Review", text="POL-001 §9\nAnnual review by the Board.", score=0.01)
MANIFEST = {"company": {"legal_name": "Acme", "sector": "broking", "regulator": "SEBI", "registrations": [{"authority": "SEBI", "type": "stock-broker"}], "segments": ["equity-derivatives"]}}


def choice(c, probs, conf=None):
    return Answer(type="choice", choice=c, probabilities=probs, confidence=conf if conf is not None else round((3 * max(probs.values()) - 1) / 2, 3))


class FakeJudge(JudgmentProvider):
    """Scripted answers per task; unknown questions get neutral answers."""

    name = "typesafe"
    calibrated = True

    def __init__(self, script: dict[str, dict[str, Answer]], fail: set[str] | None = None):
        self.script, self.fail, self.calls = script, fail or set(), []

    async def ask(self, task, state, questions, *, model=None, context=None):
        self.calls.append((task, state))
        if task in self.fail:
            raise JudgmentError(f"{task} down")
        answers = {}
        for qid, q in questions.items():
            qt = question_json(q)["type"]
            given = self.script.get(task, {}).get(qid)
            if given is None and task in ("rerank", "alignment") and isinstance(state, dict):  # per-chunk script: "task@chunk_id"
                given = self.script.get(f"{task}@{state['policy_chunk']['doc_id']}#{state['policy_chunk']['section'].split()[0]}", {}).get(qid)
            if given is not None:
                answers[qid] = given
            elif qt == "noul":
                answers[qid] = Answer(type="noul", noul=0.9)
            elif qt == "choice":
                opts = list(question_json(q)["criteria"])
                answers[qid] = choice(opts[-1], {o: (0.9 if o == opts[-1] else 0.1 / (len(opts) - 1)) for o in opts})
            else:
                answers[qid] = Answer(type="score", score=1.0, probabilities={"0": 0.0, "1": 1.0, "2": 0.0}, confidence=1.0)
        return Judgment(provider="typesafe", model="fake", calibrated=True, answers=answers, latency_ms=1)


APPLIES = {"applicability": choice("applies", {"applies": 0.97, "does_not_apply": 0.02, "cannot_tell_from_profile": 0.01}),
           "entity_in_scope": Answer(type="noul", noul=0.95), "depends_on_unstated_fact": Answer(type="noul", noul=0.1)}


@pytest.fixture
def judge(monkeypatch):
    def install(script, fail=None):
        j = FakeJudge(script, fail)
        monkeypatch.setattr(I, "judge_for", lambda task: j)
        return j
    return install


async def run(llm=None):
    from app.models.provider import StubProvider

    return await I.decide_impact(analysis_id="ana", tenant_id="t", document_id="none", extraction=EXTRACTION, circular_text=CIRCULAR,
                                 candidates=[CHUNK_41, CHUNK_9], manifest=MANIFEST, company_name="Acme", profile="Acme profile", llm=llm or StubProvider())


def test_noul_band():
    t = thresholds()
    assert noul_band(0.9, t) == "yes" and noul_band(0.1, t) == "no" and noul_band(0.5, t) == "uncertain"


def test_thresholds_env_override(monkeypatch):
    monkeypatch.setenv("DECISION_THRESHOLDS", '{"relevant_min": 0.9, "bogus": 1}')
    assert thresholds()["relevant_min"] == 0.9 and "bogus" not in thresholds()


async def test_not_applicable_needs_high_confidence_and_low_entity_scope(judge):
    judge({"applicability": {"applicability": choice("does_not_apply", {"applies": 0.05, "does_not_apply": 0.9, "cannot_tell_from_profile": 0.05}),
                             "entity_in_scope": Answer(type="noul", noul=0.05), "depends_on_unstated_fact": Answer(type="noul", noul=0.1)}})
    d = await run()
    assert d.impact.applicability == "NO" and d.path == ["typesafe:extraction_check", "typesafe:applicability"]
    # same choice but entity_in_scope in the uncertain band → not archived silently
    judge({"applicability": {"applicability": choice("does_not_apply", {"applies": 0.05, "does_not_apply": 0.9, "cannot_tell_from_profile": 0.05}),
                             "entity_in_scope": Answer(type="noul", noul=0.5), "depends_on_unstated_fact": Answer(type="noul", noul=0.1)}})
    d = await run()
    assert d.impact.applicability == "UNCERTAIN" and d.escalation_reason


async def test_conflict_via_jev_with_verification(judge):
    j = judge({"applicability": APPLIES,
               "rerank@POL-001#4.1": {"relevant": Answer(type="noul", noul=0.95)}, "rerank@POL-001#9": {"relevant": Answer(type="noul", noul=0.2)},
               "alignment@POL-001#4.1": {"ob0:relation": choice("conflicts", {"satisfies": 0.01, "conflicts": 0.97, "not_addressed": 0.02}),
                                         "ob1:relation": choice("conflicts", {"satisfies": 0.01, "conflicts": 0.96, "not_addressed": 0.03})},
               "verification": {"relation": choice("supports", {"supports": 0.98, "contradicts": 0.01, "says_nothing": 0.01})}})
    d = await run()
    imp = d.impact
    assert imp.applicability == "YES" and imp.alignment == "CONFLICT" and imp.affected_policies == ["POL-001"]
    assert imp.policy_evidence[0].section == "4.1" and "fixed caps" in imp.policy_evidence[0].text
    assert {e.section for e in imp.regulatory_evidence} == {"1", "2"}
    assert d.path == ["typesafe:extraction_check", "typesafe:applicability", "typesafe:rerank", "typesafe:alignment", "typesafe:verification"]
    assert [c.chunk_id for c in d.kept_chunks] == ["POL-001#4.1"]  # §9 dropped by rerank
    assert not any(t == "alignment" and s["policy_chunk"]["section"].startswith("9") for t, s in j.calls)
    assert d.escalation_reason is None


async def test_conflict_dropped_when_citation_check_contradicts(judge):
    judge({"applicability": APPLIES,
           "alignment@POL-001#4.1": {"ob0:relation": choice("conflicts", {"satisfies": 0.01, "conflicts": 0.97, "not_addressed": 0.02})},
           "verification": {"relation": choice("contradicts", {"supports": 0.02, "contradicts": 0.95, "says_nothing": 0.03})}})
    d = await run()
    # the only conflict failed verification; no reasoning model configured (stub) → routed to a person
    assert d.impact.alignment is None and d.impact.applicability == "YES"
    assert d.escalation_reason and "verification" in d.escalation_reason


async def test_fabricated_evidence_never_becomes_conflict(judge):
    bad = EXTRACTION.model_copy(deep=True)
    bad.obligations[0].evidence.text = "this sentence is not in the circular at all"
    judge({"applicability": APPLIES, "alignment@POL-001#4.1": {"ob0:relation": choice("conflicts", {"satisfies": 0.01, "conflicts": 0.97, "not_addressed": 0.02})},
           "extraction_check": {"ob0:stated": Answer(type="noul", noul=0.9), "ob0:evidence_supports": Answer(type="noul", noul=0.9)}})
    from app.models.provider import StubProvider

    d = await I.decide_impact(analysis_id="a", tenant_id="t", document_id="none", extraction=bad, circular_text=CIRCULAR, candidates=[CHUNK_41],
                              manifest=MANIFEST, company_name="Acme", profile="p", llm=StubProvider())
    ver = [r for r in d.records if r.stage == "verification"]
    assert ver and ver[0].routing["verdict"] == "fabricated"
    assert d.impact.alignment != "CONFLICT"


async def test_low_confidence_conflict_escalates_and_harmless_uncertainty_does_not(judge):
    judge({"applicability": APPLIES,
           "alignment@POL-001#4.1": {"ob0:relation": choice("satisfies", {"satisfies": 0.9, "conflicts": 0.02, "not_addressed": 0.08}),
                                     "ob1:relation": choice("not_addressed", {"satisfies": 0.45, "conflicts": 0.05, "not_addressed": 0.5})}})  # torn, but no conflict plausible
    d = await run()
    assert d.impact.alignment == "ALIGNED" and d.escalation_reason is None
    judge({"applicability": APPLIES,
           "alignment@POL-001#4.1": {"ob0:relation": choice("satisfies", {"satisfies": 0.9, "conflicts": 0.02, "not_addressed": 0.08}),
                                     "ob1:relation": choice("not_addressed", {"satisfies": 0.1, "conflicts": 0.45, "not_addressed": 0.45})}})  # conflict plausible
    d = await run()
    assert d.escalation_reason and "below confidence" in d.escalation_reason
    assert d.impact.alignment is None  # stub llm has no fixture for 'none' → human


async def test_judge_outage_degrades_to_human_not_to_a_guess(judge):
    judge({"applicability": APPLIES}, fail={"alignment"})
    d = await run()
    assert d.impact.applicability == "YES" and d.impact.alignment is None
    assert any(r.stage == "alignment" and r.routing.get("unavailable") for r in d.records)


async def test_records_carry_state_digest_and_thresholds(judge):
    judge({"applicability": APPLIES, "alignment@POL-001#4.1": {"ob0:relation": choice("conflicts", {"satisfies": 0.01, "conflicts": 0.97, "not_addressed": 0.02})}})
    d = await run()
    app = next(r for r in d.records if r.stage == "applicability")
    assert len(app.state_digest) == 64 and app.calibrated is True and "thresholds" in app.routing
    al = next(r for r in d.records if r.stage == "alignment")
    assert al.routing["pairs"]["ob0"]["p_conflicts"] == 0.97


@pytest.mark.skipif(not os.environ.get("TYPESAFE_API_KEY") and not os.environ.get("TYPE_SAFE_API_KEY"), reason="live TypeSafe key not set")
@pytest.mark.skipif(os.environ.get("RUN_LIVE") != "1", reason="set RUN_LIVE=1 to call Jev")
async def test_live_jev_applicability():
    from app.decisions.providers import TypeSafeJudgmentProvider
    from app.decisions.questions import applicability_questions

    j = await TypeSafeJudgmentProvider().ask("applicability", {"company": I.company_state(MANIFEST, "Acme"), "circular": {"applies_to": ["mutual funds"], "summary": "expense ratios", "obligations": ["disclose TER daily"]}}, applicability_questions())
    assert j.calibrated and j.answers["applicability"].choice == "does_not_apply"
