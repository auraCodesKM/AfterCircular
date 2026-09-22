"""Source-link integrity: every citation the UI can show must resolve to the exact persisted source — never a homepage,
a guessed slug, or another tenant's file."""

from __future__ import annotations

from datetime import UTC, datetime
from urllib.parse import urlparse

import pytest

from app.connectors.registry import load_registry
from app.schemas.actions import ProcessedDocument, TenantContext
from app.schemas.impact import ImpactAnalysis
from app.services.pipeline import provenance

MANIFEST = {"documents": [{"id": "POL-002", "path": "policies/POL-002-distributor-empanelment-and-certification-policy.md"}]}


def _doc(**kw) -> ProcessedDocument:
    base = dict(id="doc_1", tenant_id="nimbus-asset-management-181441765", document_id="102986", source="SEBI", jurisdiction="IN", circular_number="HO/24/13/17(1)2026-IMD-POD-1/I/16895/2026",
                title="Certification Requirements for Distribution of Specialized Investment Funds (SIFs)", published_date="2026-07-21", effective_date=None,
                url="https://www.sebi.gov.in/legal/circulars/jul-2026/certification-requirements-for-distribution-of-specialized-investment-funds-sifs-_102986.html",
                document_url="https://www.sebi.gov.in/sebi_data/attachdocs/jul-2026/1784633350069.pdf", content_hash="h" * 64, processed_at=datetime.now(UTC), status="COMPLETED",
                source_mode="LIVE", synthetic=False, fetched_at=datetime.now(UTC))
    return ProcessedDocument(**{**base, **kw})


def _impact() -> ImpactAnalysis:
    return ImpactAnalysis(applicability="YES", alignment="CONFLICT", affected_policies=["POL-002"], reason="r", confidence=0.85,
                          regulatory_evidence=[{"section": "21.10.1", "text": "Any persons"}, {"section": "21.10.3", "text": "The existing requirement"}],  # type: ignore[list-item]
                          policy_evidence=[{"doc_id": "POL-002", "section": "4.2", "text": "must hold NISM Series XIII"}])  # type: ignore[list-item]


def test_registry_records_point_at_exact_official_sebi_pages():
    reg = load_registry()
    assert reg, "registry is empty"
    for entry_id, r in reg.items():
        for key in ("detail_url", "pdf_url"):
            u = urlparse(r[key])
            assert u.scheme == "https" and u.netloc == "www.sebi.gov.in", (entry_id, key, r[key])
        assert r["detail_url"].endswith(f"_{entry_id}.html"), "detail page must be the circular's own page, not a listing or homepage"
        assert r["pdf_url"].lower().endswith(".pdf")
    assert reg["102986"]["detail_url"] == "https://www.sebi.gov.in/legal/circulars/jul-2026/certification-requirements-for-distribution-of-specialized-investment-funds-sifs-_102986.html"
    assert reg["102986"]["pdf_url"] == "https://www.sebi.gov.in/sebi_data/attachdocs/jul-2026/1784633350069.pdf"


def test_provenance_uses_persisted_urls_and_exact_github_file():
    t = TenantContext(tenant_id="nimbus-asset-management-181441765", company_name="Nimbus", github_repo="auraCodesKM/nimbus-amc-policies", default_branch="main", actor="x")
    p = provenance(_doc(), _impact(), t, MANIFEST)
    rs, ps = p["regulatory_source"], p["policy_sources"]
    assert rs["detail_url"] == _doc().url and rs["pdf_url"] == _doc().document_url and rs["source_mode"] == "LIVE" and rs["synthetic"] is False
    assert rs["reference"] == "HO/24/13/17(1)2026-IMD-POD-1/I/16895/2026" and rs["document_id"] == "102986"
    assert ps["POL-002"]["url"] == "https://github.com/auraCodesKM/nimbus-amc-policies/blob/main/policies/POL-002-distributor-empanelment-and-certification-policy.md"
    assert ps["POL-002"]["repo"] == "auraCodesKM/nimbus-amc-policies" and ps["POL-002"]["fictional"] is True
    assert "POL-001" not in ps, "only cited policies get a source; nothing is invented for uncited ones"


def test_policy_source_is_absent_when_the_manifest_has_no_such_file():
    t = TenantContext(tenant_id="t", company_name="C", github_repo="o/r", default_branch="main", actor="x")
    ps = provenance(_doc(), _impact(), t, {"documents": []})["policy_sources"]
    assert ps["POL-002"]["url"] is None and ps["POL-002"]["path"] is None  # no guessed path, no fabricated link


def test_snapshot_documents_are_marked_synthetic_and_never_link_to_sebi():
    t = TenantContext(tenant_id="t", company_name="C", github_repo="o/r", default_branch="main", actor="x")
    d = _doc(source_mode="DEMO_SNAPSHOT", synthetic=True, url="https://example.invalid/sebi/demo/2026/015", document_url=None)
    rs = provenance(d, _impact(), t, MANIFEST)["regulatory_source"]
    assert rs["synthetic"] is True and rs["source_mode"] == "DEMO_SNAPSHOT" and "sebi.gov.in" not in rs["detail_url"] and rs["pdf_url"] is None


@pytest.mark.anyio
async def test_ask_cards_never_carry_another_tenants_records(db, tenant, monkeypatch):
    from app.services.pipeline import Scan
    from app.services import investigate as I
    from tests.test_ask_reasoning import FakeJev
    from tests.test_pipeline_e2e import FakeGH

    monkeypatch.setattr("app.services.pipeline.GitHubClient", FakeGH)
    assert (await Scan(db, tenant).run()).status == "COMPLETED"
    other = TenantContext(tenant_id="nimbus-test", company_name="Nimbus", github_repo="acme/policies", default_branch="main", actor="x", github_token="t")
    monkeypatch.setattr(I, "judge_for", lambda task: FakeJev(intent="list_conflicts"))
    mine = await I.investigate(db, tenant, "Which circulars conflict with our policies?")
    theirs = await I.investigate(db, other, "Which circulars conflict with our policies?")
    assert mine.answer["documents"] and all(c["policy_sources"] is not None for c in mine.answer["documents"])
    assert theirs.answer.get("documents", []) == [] and "No processed circular" in theirs.summary
    # a focus id from another tenant is ignored, never resolved
    foreign = await I.investigate(db, other, "Why is this a conflict?", focus={"document_pk": mine.answer["documents"][0]["document_pk"]})
    assert foreign.answer["reasoning"].get("focus") is None
