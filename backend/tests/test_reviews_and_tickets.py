import pytest

from app.schemas.actions import AnalysisRecord, ProcessedDocument, ReviewRecord
from app.services.reviews import ReviewError, decide, transition
from app.services.state import now
from app.services.tickets import MARKER, build_ticket
from evals.dataset import load_scenarios


def _rev(status="AWAITING_REVIEW") -> ReviewRecord:
    return ReviewRecord(id="rev_1", tenant_id="acme-test", document_pk="doc_1", analysis_id="ana_1", status=status, requested_at=now())


def test_transitions():
    assert transition(_rev(), "approve").status == "APPROVED"
    assert transition(_rev(), "reject").status == "REJECTED"
    with pytest.raises(ReviewError):
        transition(_rev("APPROVED"), "approve")
    with pytest.raises(ReviewError):
        transition(_rev(), "maybe")


def _seed(db, tenant):
    sc = next(s for s in load_scenarios() if s["id"] == "conflict-index-position-limits")
    doc = ProcessedDocument(id="doc_1", tenant_id=tenant.tenant_id, source="SEBI", jurisdiction="IN", document_id="DEMO-2026-014",
                            circular_number=sc["document"]["circular_number"], title=sc["document"]["title"], published_date="2026-09-15",
                            effective_date="2026-10-15", url="https://example.invalid", content_hash="h" * 64, processed_at=now(), status="AWAITING_REVIEW", impact="CONFLICT", analysis_id="ana_1",
                            source_mode="DEMO_SNAPSHOT")
    db.insert_document(doc, sc["document"]["content"])
    ana = AnalysisRecord(id="ana_1", tenant_id=tenant.tenant_id, document_pk="doc_1", scan_id=None, extraction=sc["fixtures"]["extraction"], retrieved_chunks=[],
                         impact=sc["fixtures"]["impact"], gate_outcome="CONFLICT", memo=sc["fixtures"]["memo"], ai_provider="stub", models={"impact": "stub"}, metrics={}, created_at=now())
    db.save_analysis(ana)
    db.upsert_review(_rev())
    return doc, ana


def test_ticket_payload_contains_all_required_fields(db, tenant):
    doc, ana = _seed(db, tenant)
    rev = transition(_rev(), "approve").model_copy(update={"decided_by": "tester", "note": "ok"})
    t = build_ticket(doc, ana, rev)
    assert t.title.startswith("[Compliance] SEBI DEMO/SEBI/HO/MRD/POD-1/CIR/2026/014 vs POL-001 §4.1")
    for needle in ["DEMO_SNAPSHOT", "Applicability:** YES", "Alignment:** CONFLICT", "POL-001 §4.1", "§2.1", "AI-generated draft — human review required",
                   "Effective date:** 2026-10-15", "Approved by tester", f"{MARKER} ana_1"]:
        assert needle in t.body, needle
    assert t.labels == ["compliance", "needs-review"]


async def test_reject_records_audit_and_no_side_effect(db, tenant):
    _seed(db, tenant)
    rev = await decide(db, tenant, "rev_1", "reject", "not relevant")
    assert rev.status == "REJECTED" and rev.ticket_id is None
    assert db.get_document("doc_1", tenant.tenant_id).status == "REJECTED"
    assert db.list_audit(tenant.tenant_id)[0].event_type == "REJECTED"


async def test_approve_creates_ticket_once(db, tenant, monkeypatch):
    _seed(db, tenant)
    calls = {"create": 0}

    class FakeGH:
        def __init__(self, token):
            pass

        async def find_issue(self, repo, marker):
            return {"number": 7, "html_url": "https://github.com/x/y/issues/7"} if calls["create"] else None

        async def create_issue(self, repo, payload):
            calls["create"] += 1
            return {"number": 7, "html_url": "https://github.com/x/y/issues/7"}

    monkeypatch.setattr("app.services.reviews.GitHubClient", FakeGH)
    rev = await decide(db, tenant, "rev_1", "approve", "go")
    assert rev.status == "APPROVED" and rev.ticket_id == "7"
    assert db.get_document("doc_1", tenant.tenant_id).status == "COMPLETED"
    assert calls["create"] == 1
    with pytest.raises(ReviewError):  # second approval refused — no duplicate issue
        await decide(db, tenant, "rev_1", "approve", "again")
    kinds = [e.event_type for e in db.list_audit(tenant.tenant_id)]
    assert kinds[:2] == ["TICKET_CREATED", "APPROVED"]


async def test_ask_routes_with_stub_and_answers_from_state(db, tenant):
    from app.services.investigate import investigate

    _seed(db, tenant)
    inv = await investigate(db, tenant, "What needs my review?")
    assert inv.intent == "pending_reviews" and "1 conflict" in inv.summary and inv.answer["documents"][0]["alignment"] == "CONFLICT"
    inv = await investigate(db, tenant, "Why does DEMO/SEBI/HO/MRD/POD-1/CIR/2026/014 conflict?")
    assert inv.intent == "explain_document" and inv.document_pk == "doc_1" and inv.answer["document"]["affected_policies"] == ["POL-001"]
    assert db.list_investigations(tenant.tenant_id)[0].id == inv.id
    inv = await investigate(db, tenant, "run a scan")
    assert inv.intent == "run_scan" and inv.answer["actions"][0]["kind"] == "scan"
