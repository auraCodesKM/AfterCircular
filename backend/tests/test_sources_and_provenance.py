"""Real-source registry, curated live selection, and the provenance attached to every analysis — no network."""

import json
from pathlib import Path

import httpx
import pytest

from app.config import settings
from app.connectors import sebi as S
from app.connectors.registry import REGISTRY_DIR, load_registry
from app.services.pipeline import Scan
from tests.test_pipeline_e2e import FakeGH
from tests.test_sebi_live_connector import DETAIL, _connector, _pdf_bytes

OFFICIAL = "https://www.sebi.gov.in/"


def test_registry_records_are_live_official_and_complete():
    reg = load_registry()
    assert len(reg) >= 4
    for eid, r in reg.items():
        assert r["source_mode"] == "LIVE" and r["synthetic"] is False and r["regulator"] == "SEBI"
        assert r["detail_url"].startswith(OFFICIAL + "legal/circulars/") and r["detail_url"].endswith(f"_{eid}.html")
        assert r["pdf_url"].startswith(OFFICIAL + "sebi_data/attachdocs/") and r["pdf_url"].lower().endswith(".pdf")
        assert r["reference"] and r["date"] and len(r["content_hash"]) == 64 and r["pdf_bytes"] > 10_000 and r["text_chars"] > 200
        assert r["retrieved_at"]
    # the matrix only names circulars that exist in the registry
    matrix = json.loads((Path(__file__).resolve().parents[1] / "evals" / "scenarios" / "live_matrix.json").read_text(encoding="utf-8"))
    assert {c["entry_id"] for c in matrix["cases"]} <= set(reg)
    assert {"NOT_APPLICABLE" if c["gate"] == "ARCHIVED" else c["gate"] for c in matrix["cases"]} >= {"NOT_APPLICABLE", "ALIGNED", "CONFLICT", "UNCERTAIN"}


def test_registry_rejects_synthetic_or_non_live_records(tmp_path, monkeypatch):
    bad = tmp_path / "1.json"
    bad.write_text(json.dumps({"entry_id": "1", "source_mode": "DEMO_SNAPSHOT", "synthetic": True}), encoding="utf-8")
    monkeypatch.setattr("app.connectors.registry.REGISTRY_DIR", tmp_path)
    with pytest.raises(ValueError):
        load_registry()
    assert REGISTRY_DIR.name == "sebi"


async def test_selected_entry_ids_fetch_only_registry_circulars_live(monkeypatch):
    """The listing is still read live; ids not on its first page are fetched by their official detail URL from the registry."""
    reg = load_registry()
    eid_on_listing, eid_off_listing = sorted(reg)[:2]
    monkeypatch.setattr(settings(), "sebi_selected_entry_ids", f"{eid_on_listing},{eid_off_listing},999999")
    pdf = _pdf_bytes()
    seen: list[str] = []

    def handler(req: httpx.Request) -> httpx.Response:
        u = str(req.url)
        seen.append(u)
        if "HomeAction.do" in u:
            row = f'<tr><td>Sep 01, 2026</td><td><a href="{reg[eid_on_listing]["detail_url"]}">{reg[eid_on_listing]["title"]}</a></td></tr>'
            return httpx.Response(200, text=f"<table>{row}</table>", headers={"content-type": "text/html"})
        if u.endswith(".html"):
            return httpx.Response(200, text=DETAIL, headers={"content-type": "text/html"})
        return httpx.Response(200, content=pdf, headers={"content-type": "application/pdf"})

    res = await _connector(handler).fetch_documents(1)
    assert res.status == "LIVE_PARTIAL"  # 999999 is not in the registry → warning, not a fabricated document
    assert [d.document_id for d in res.documents] == [eid_on_listing, eid_off_listing]
    assert reg[eid_off_listing]["detail_url"] in seen  # fetched by its official URL
    assert all(d.source_mode == "LIVE" and not d.synthetic and d.url.startswith(OFFICIAL) for d in res.documents)
    assert any("999999" in w for w in res.warnings)


async def test_every_stored_impact_carries_exact_sources(db, tenant, monkeypatch):
    monkeypatch.setattr("app.services.pipeline.GitHubClient", FakeGH)
    rec = await Scan(db, tenant).run()
    assert rec.status == "COMPLETED", rec.error
    for d in db.list_documents(tenant.tenant_id):
        a = db.get_analysis(d.analysis_id, tenant.tenant_id)
        src = a.impact["regulatory_source"]
        assert src["detail_url"] == d.url and src["document_id"] == d.document_id and src["content_hash"] == d.content_hash
        assert src["synthetic"] is True and src["source_mode"] == "DEMO_SNAPSHOT"  # the stub scan is honest about its fixtures
        for e in a.impact["policy_evidence"]:
            ps = a.impact["policy_sources"][e["doc_id"]]
            assert ps["url"] == f"https://github.com/{tenant.github_repo}/blob/{tenant.default_branch}/{ps['path']}" and ps["fictional"] is True


def test_ticket_body_links_official_pdf_and_policy_file():
    from datetime import UTC, datetime

    from app.schemas.actions import AnalysisRecord, ProcessedDocument, ReviewRecord
    from app.services.tickets import build_ticket

    now = datetime.now(UTC)
    doc = ProcessedDocument(id="doc_x", tenant_id="t", document_id="102584", source="SEBI", jurisdiction="IN", title="T", url="https://www.sebi.gov.in/x.html", circular_number="C", published_date="2026-07-03", effective_date=None,
                            document_url="https://www.sebi.gov.in/x.pdf", content_hash="h", status="COMPLETED", processed_at=now, fetched_at=now, source_mode="LIVE")
    impact = {"applicability": "YES", "alignment": "CONFLICT", "affected_policies": ["POL-001"], "reason": "r", "confidence": 0.8,
              "regulatory_evidence": [{"section": "46.4", "text": "five trading days"}], "policy_evidence": [{"doc_id": "POL-001", "section": "5.1", "text": "seven trading days"}],
              "policy_sources": {"POL-001": {"path": "policies/POL-001.md", "url": "https://github.com/o/r/blob/main/policies/POL-001.md", "repo": "o/r", "branch": "main", "fictional": True}}}
    analysis = AnalysisRecord(id="ana_x", tenant_id="t", document_pk="doc_x", scan_id=None, retrieved_chunks=[], extraction={"summary": "s", "obligations": [], "regulator": "SEBI", "applies_to": ["stock brokers"]}, impact=impact,
                              gate_outcome="CONFLICT", memo=None, ai_provider="foundry", models={}, metrics={}, created_at=now)
    review = ReviewRecord(id="rev_x", tenant_id="t", document_pk="doc_x", analysis_id="ana_x", status="APPROVED", requested_at=now, decided_by="auraCodesKM", decided_at=now)
    body = build_ticket(doc, analysis, review).body
    assert "https://www.sebi.gov.in/x.pdf" in body and "· LIVE" in body
    assert "[policies/POL-001.md](https://github.com/o/r/blob/main/policies/POL-001.md)" in body
    assert "Demo snapshot" not in body
