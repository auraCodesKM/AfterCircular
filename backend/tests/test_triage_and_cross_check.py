"""Pre-LLM triage (prefilter + Jev) and the post-escalation Jev cross-check — fake judges, no network."""

from typing import Any

import pytest

from app.decisions import impact as I
from app.decisions import triage as T
from app.decisions.providers import JudgmentError, JudgmentProvider
from app.schemas.decisions import Answer, Judgment
from app.schemas.impact import ImpactAnalysis, PolicyChunk, PolicyEvidence, RegulatoryEvidence
from app.schemas.obligations import Evidence, Obligation
from app.schemas.regulatory import RegulatoryDocument
from app.services.gate import route

ACME = {"company": {"legal_name": "Acme Securities Private Limited", "sector": "securities-broking", "regulator": "SEBI", "country": "IN",
                    "registrations": [{"authority": "SEBI", "type": "stock-broker"}], "segments": ["cash-equity", "equity-derivatives"]}}
NIMBUS = {"company": {"legal_name": "Nimbus AMC", "sector": "asset-management", "regulator": "SEBI", "country": "IN",
                      "registrations": [{"authority": "SEBI", "type": "mutual-fund-amc"}], "segments": []}}

AMC_TEXT = ("FICTIONAL DEMO CIRCULAR.\n\nTo,\nAll Mutual Funds / Asset Management Companies / Trustee Companies.\n\n"
            "Sub: Disclosure of Total Expense Ratio by Asset Management Companies\n\n1. Asset management companies shall disclose the TER daily. " * 8)
BROKER_TEXT = ("FICTIONAL DEMO CIRCULAR.\n\nTo,\nAll Stock Brokers and Clearing Members.\n\nSub: Position limits\n\n1. Stock brokers shall... " * 12)


def _doc(text: str, doc_type: str = "circular", source: str = "SEBI") -> RegulatoryDocument:
    return RegulatoryDocument(source=source, jurisdiction="IN", document_id="D1", title="t", url="https://x", content=text, document_type=doc_type).with_hash()


class FakeJudge(JudgmentProvider):
    name = "typesafe"
    calibrated = True

    def __init__(self, answers: dict[str, Answer] | None = None, fail: bool = False):
        self.answers, self.fail, self.calls = answers or {}, fail, 0

    async def ask(self, task, state, questions, *, model=None, context=None) -> Judgment:
        self.calls += 1
        if self.fail:
            raise JudgmentError("boom")
        out = {}
        for qid, q in questions.items():
            if qid in self.answers:
                out[qid] = self.answers[qid]
            elif qid.endswith(":relation"):
                out[qid] = self.answers["relation"]
            else:
                out[qid] = Answer(type="noul", noul=0.5)
        return Judgment(provider="typesafe", model="jev-test", calibrated=True, answers=out, latency_ms=1)


def choice(c: str, conf: float, **probs: float) -> Answer:
    return Answer(type="choice", choice=c, probabilities=probs or {c: 1.0}, confidence=conf)


# ---- prefilter (free) ------------------------------------------------------------------------------------------------
def test_prefilter_archives_non_circulars_and_other_regulators_without_any_model():
    assert T.prefilter(_doc(BROKER_TEXT, doc_type="press release"), ACME).outcome == "archive"
    assert T.prefilter(_doc(BROKER_TEXT, source="RBI"), ACME).outcome == "archive"


def test_prefilter_skips_triage_when_the_addressee_is_the_companys_own_entity_type():
    r = T.prefilter(_doc(BROKER_TEXT), ACME)
    assert r.outcome == "skipped" and r.entity_match is True and "stock-broker" in r.addressees


def test_prefilter_sends_other_addressees_to_triage_never_archives_on_subject():
    r = T.prefilter(_doc(AMC_TEXT), ACME)
    assert r.outcome == "proceed" and r.entity_match is False and r.addressees == ["mutual-fund-amc"]
    assert T.prefilter(_doc(AMC_TEXT), NIMBUS).outcome == "skipped"


# ---- Jev triage --------------------------------------------------------------------------------------------------------
async def test_triage_archives_only_with_high_confidence_and_low_entity_scope(monkeypatch):
    j = FakeJudge({"relevance": choice("does_not_concern", 0.95, does_not_concern=0.96, concerns=0.02, cannot_tell_from_header=0.02),
                   "entity_in_scope": Answer(type="noul", noul=0.05), "depends_on_unstated_fact": Answer(type="noul", noul=0.1)})
    monkeypatch.setattr(T, "judge_for", lambda task: j)
    d = I.ImpactDecision("ana", "acme", "D1")
    r = await T.triage(d, _doc(AMC_TEXT), ACME, "Acme", T.prefilter(_doc(AMC_TEXT), ACME))
    assert r.outcome == "archive" and j.calls == 1 and d.records[0].stage == "triage" and d.path == ["typesafe:triage"]


@pytest.mark.parametrize("rel,ent,dep", [
    (choice("does_not_concern", 0.70), 0.05, 0.1),   # confidence below not_applicable_min_confidence 0.80
    (choice("does_not_concern", 0.95), 0.45, 0.1),   # entity_in_scope above 0.30
    (choice("does_not_concern", 0.95), 0.05, 0.8),   # depends on an unstated fact
    (choice("cannot_tell_from_header", 0.9), 0.1, 0.1),
])
async def test_triage_proceeds_whenever_uncertain(monkeypatch, rel, ent, dep):
    j = FakeJudge({"relevance": rel, "entity_in_scope": Answer(type="noul", noul=ent), "depends_on_unstated_fact": Answer(type="noul", noul=dep)})
    monkeypatch.setattr(T, "judge_for", lambda task: j)
    d = I.ImpactDecision("ana", "acme", "D1")
    assert (await T.triage(d, _doc(AMC_TEXT), ACME, "Acme", T.prefilter(_doc(AMC_TEXT), ACME))).outcome == "proceed"


async def test_triage_judge_outage_proceeds_to_extraction(monkeypatch):
    monkeypatch.setattr(T, "judge_for", lambda task: FakeJudge(fail=True))
    d = I.ImpactDecision("ana", "acme", "D1")
    r = await T.triage(d, _doc(AMC_TEXT), ACME, "Acme", T.prefilter(_doc(AMC_TEXT), ACME))
    assert r.outcome == "proceed" and d.records[0].routing["outcome"] == "proceed"


async def test_confident_triage_skips_the_applicability_request(monkeypatch):
    j = FakeJudge()
    monkeypatch.setattr(I, "judge_for", lambda task: j)
    d = I.ImpactDecision("ana", "acme", "D1")
    from app.schemas.obligations import ExtractionResult

    ext = ExtractionResult(regulator="SEBI", applies_to=["stock brokers"], summary="s", obligations=[])
    outcome, _, why = await I.decide_applicability(d, ext, [], {}, triage_confidence=0.95)
    assert outcome == "YES" and j.calls == 0 and d.records[0].routing["reused"] == "triage"


# ---- cross-check --------------------------------------------------------------------------------------------------------
OB = [Obligation(requirement="Review the position limit policy at least every six months", affected_area="other",
                 evidence=Evidence(section="3.1", text="review its internal position limit policy at least once every six months"))]
CHUNK = [PolicyChunk(chunk_id="POL-001#4.1", doc_id="POL-001", title="Position Limits Policy", path="p", section="4.1 Client-level limits",
                     text="reviewed annually", score=0.9)]


def _conflict() -> ImpactAnalysis:
    return ImpactAnalysis(applicability="YES", alignment="CONFLICT", affected_policies=["POL-001"], reason="model says conflict",
                          regulatory_evidence=[RegulatoryEvidence(section="3.1", text="every six months")],
                          policy_evidence=[PolicyEvidence(doc_id="POL-001", section="4.1", text="reviewed annually")], confidence=0.9)


async def test_cross_check_confirms_a_conflict_jev_also_sees(monkeypatch):
    monkeypatch.setattr(I, "judge_for", lambda task: FakeJudge({"relation": choice("conflicts", 0.9)}))
    d = I.ImpactDecision("ana", "acme", "D1")
    out = await I.cross_check(d, OB, _conflict(), CHUNK, 0.0)
    assert out.alignment == "CONFLICT" and route(out)[0] == "CONFLICT" and d.records[-1].routing["verdict"] == "agree"


async def test_disagreement_routes_to_a_person_not_to_a_ticket(monkeypatch):
    monkeypatch.setattr(I, "judge_for", lambda task: FakeJudge({"relation": choice("satisfies", 0.9)}))
    d = I.ImpactDecision("ana", "acme", "D1")
    out = await I.cross_check(d, OB, _conflict(), CHUNK, 0.0)
    assert out.alignment is None and route(out)[0] == "NEEDS_INVESTIGATION" and "Cross-check" in out.reason


async def test_model_aligned_but_typed_pair_saw_a_live_conflict_goes_to_a_person():
    d = I.ImpactDecision("ana", "acme", "D1")
    aligned = _conflict().model_copy(update={"alignment": "ALIGNED", "affected_policies": []})
    out = await I.cross_check(d, OB, aligned, CHUNK, prior_conflict_p=0.6)
    assert out.alignment is None and route(out)[0] == "NEEDS_INVESTIGATION"
    assert (await I.cross_check(d, OB, aligned, CHUNK, prior_conflict_p=0.1)).alignment == "ALIGNED"


async def test_cross_check_judge_outage_never_silently_accepts(monkeypatch):
    monkeypatch.setattr(I, "judge_for", lambda task: FakeJudge(fail=True))
    d = I.ImpactDecision("ana", "acme", "D1")
    out = await I.cross_check(d, OB, _conflict(), CHUNK, 0.0)
    assert out.alignment is None and route(out)[0] == "NEEDS_INVESTIGATION"


def test_decision_records_accept_the_new_stages():
    from app.schemas.decisions import DecisionRecord
    from app.services.state import now

    for stage in ("triage", "cross_check"):
        DecisionRecord(id="x", analysis_id="a", tenant_id="t", stage=stage, provider="code", model="-", calibrated=None,  # type: ignore[arg-type]
                       question_ids=[], state_digest="", evidence_ids=[], answers={}, routing={}, latency_ms=0, created_at=now())
