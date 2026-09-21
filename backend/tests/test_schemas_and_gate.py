import pytest
from pydantic import ValidationError

from app.schemas.impact import ImpactAnalysis, PolicyEvidence, RegulatoryEvidence
from app.schemas.obligations import ExtractionResult
from app.services.gate import route


def test_extraction_requires_evidence():
    with pytest.raises(ValidationError):
        ExtractionResult.model_validate({"regulator": "SEBI", "applies_to": [], "summary": "s",
                                         "obligations": [{"requirement": "r", "affected_area": "position_limits", "evidence": {"text": "", "section": "1"}}]})
    ok = ExtractionResult.model_validate({"regulator": "SEBI", "applies_to": ["stock brokers"], "summary": "s",
                                          "obligations": [{"requirement": "r", "affected_area": "position_limits", "evidence": {"text": "quote", "section": "2.1"}}]})
    assert ok.obligations[0].deadline is None


def _impact(**kw) -> ImpactAnalysis:
    base = {"applicability": "YES", "alignment": "CONFLICT", "affected_policies": ["POL-001"], "reason": "r", "confidence": 0.9,
            "regulatory_evidence": [RegulatoryEvidence(section="2.1", text="reg")], "policy_evidence": [PolicyEvidence(doc_id="POL-001", section="4.1", text="pol")]}
    return ImpactAnalysis.model_validate({**base, **kw})


def test_gate_routes_every_branch():
    assert route(_impact(applicability="NO", alignment=None))[0] == "ARCHIVED"
    assert route(_impact(applicability="UNCERTAIN", alignment=None))[0] == "NEEDS_INVESTIGATION"
    assert route(_impact(alignment="ALIGNED"))[0] == "ALIGNED"
    assert route(_impact())[0] == "CONFLICT"
    assert route(_impact(alignment=None))[0] == "NEEDS_INVESTIGATION"


def test_gate_rejects_conflict_without_two_sided_evidence():
    assert route(_impact(policy_evidence=[]))[0] == "NEEDS_INVESTIGATION"
    assert route(_impact(regulatory_evidence=[]))[0] == "NEEDS_INVESTIGATION"
    assert route(_impact(affected_policies=[]))[0] == "NEEDS_INVESTIGATION"
