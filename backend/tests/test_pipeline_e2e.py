"""Full scan with the stub provider and a fake GitHub: exercises detection → extraction → retrieval → gate → memo → review → idempotency."""

from pathlib import Path

import pytest

from app.services.pipeline import Scan
from app.services.policies import chunk_markdown, parse_front_matter
from evals.dataset import load_scenarios

CORPUS = Path(__file__).resolve().parent / "fixtures" / "acme-securities-policies"  # vendored copy of the fictional Acme policy repo (hermetic tests)
pytestmark = pytest.mark.skipif(not (CORPUS / "aftercircular.yml").exists(), reason="policy corpus checkout not present")


class FakeGH:
    def __init__(self, token):
        pass

    async def head_sha(self, repo, branch):
        return "abc1234"

    async def file_text(self, repo, path, ref):
        return (CORPUS / path).read_text(encoding="utf-8")


@pytest.fixture(autouse=True)
def fake_github(monkeypatch):
    monkeypatch.setattr("app.services.pipeline.GitHubClient", FakeGH)


async def test_scan_end_to_end_with_stub_provider(db, tenant):
    rec = await Scan(db, tenant).run()
    assert rec.status == "COMPLETED", rec.error
    assert rec.source_mode == "DEMO_SNAPSHOT" and rec.new_documents == 3
    docs = {d.document_id: d for d in db.list_documents(tenant.tenant_id)}
    assert docs["DEMO-2026-014"].status == "AWAITING_REVIEW" and docs["DEMO-2026-014"].impact == "CONFLICT"
    assert docs["DEMO-2026-015"].status == "ARCHIVED" and docs["DEMO-2026-015"].impact == "ALIGNED"
    assert docs["DEMO-2026-016"].status == "ARCHIVED" and docs["DEMO-2026-016"].impact == "NOT_APPLICABLE"
    ana = db.get_analysis(docs["DEMO-2026-014"].analysis_id, tenant.tenant_id)
    assert ana.gate_outcome == "CONFLICT" and ana.memo["disclaimer"] == "AI-generated draft — human review required"
    assert any(c["doc_id"] == "POL-001" for c in ana.retrieved_chunks)
    reviews = db.list_reviews(tenant.tenant_id, "AWAITING_REVIEW")
    assert len(reviews) == 1
    kinds = {e.event_type for e in db.list_audit(tenant.tenant_id)}
    assert {"SCAN_STARTED", "DOCUMENT_DETECTED", "POLICIES_INDEXED", "OBLIGATIONS_EXTRACTED", "POLICIES_RETRIEVED", "IMPACT_ANALYZED",
            "CONFLICT_DETECTED", "MEMO_GENERATED", "REVIEW_REQUESTED", "ARCHIVED", "SCAN_COMPLETED"} <= kinds

    # idempotency: second scan skips everything, no new review
    rec2 = await Scan(db, tenant).run()
    assert rec2.status == "COMPLETED" and rec2.new_documents == 0 and rec2.skipped_documents == 3
    assert len(db.list_reviews(tenant.tenant_id)) == 1
    assert len(db.list_documents(tenant.tenant_id)) == 3


async def test_decision_records_persist_and_path_is_visible(db, tenant):
    await Scan(db, tenant).run()
    docs = {d.document_id: d for d in db.list_documents(tenant.tenant_id)}
    conflict = db.get_analysis(docs["DEMO-2026-014"].analysis_id, tenant.tenant_id)
    # DEMO-014 is addressed to stock brokers = Acme's own entity type → the prefilter skips the triage request entirely
    assert conflict.decision_path == ["stub:extraction_check", "stub:applicability", "stub:rerank", "stub:alignment", "stub:verification"]
    recs = db.decisions_for(conflict.id, tenant.tenant_id)
    assert {r.stage for r in recs} >= {"applicability", "rerank", "alignment", "verification"}
    assert all(r.provider == "stub" and r.calibrated is False for r in recs if r.provider != "code")
    na = db.get_analysis(docs["DEMO-2026-016"].analysis_id, tenant.tenant_id)
    # DEMO-016 is addressed to mutual funds → triage ran (stub judge answers neutrally → proceed), then archived without retrieval
    assert na.decision_path == ["stub:triage", "stub:extraction_check", "stub:applicability"]
    aligned = db.get_analysis(docs["DEMO-2026-015"].analysis_id, tenant.tenant_id)
    assert aligned.impact["alignment"] == "ALIGNED" and aligned.escalation_reason is None
