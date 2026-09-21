"""SEBI connector against an httpx.MockTransport (no network): HTTP robustness, validation, modes, dedup.
The real-network test at the bottom is opt-in: RUN_LIVE_SEBI_TEST=1."""

import os
from pathlib import Path

import httpx
import pytest

from app.connectors import sebi as S
from app.connectors.sebi import SEBIConnector
from app.schemas.regulatory import content_hash

LISTING_HTML = (Path(__file__).parent / "fixtures" / "sebi_listing.html").read_text(encoding="utf-8") if (Path(__file__).parent / "fixtures" / "sebi_listing.html").exists() else ""

DETAIL = """<html><div class='id_area'><span>Circular No.:  </span><span>SEBI/HO/TEST/2026/1</span></div>
<iframe src='../../../web/?file=https://www.sebi.gov.in/sebi_data/attachdocs/sep-2026/1.pdf'></iframe></html>"""


def _listing(n: int = 2) -> str:
    rows = "".join(f'<tr><td>Sep 0{i + 1}, 2026</td><td><a href="https://www.sebi.gov.in/legal/circulars/sep-2026/circular-{i}_10{i}.html">Circular {i}</a></td></tr>' for i in range(n))
    return f"<html><table>{rows}</table></html>"


def _pdf_bytes() -> bytes:
    """A real one-page PDF with enough text (built with pypdf, so extract_text works)."""
    from io import BytesIO

    from pypdf import PdfWriter
    from pypdf.generic import DictionaryObject, NameObject, StreamObject

    w = PdfWriter()
    page = w.add_blank_page(width=300, height=300)
    text = " ".join(["Stock brokers shall review their internal position limit policy at least every six months."] * 4)
    content = StreamObject()
    content.set_data(f"BT /F1 10 Tf 20 250 Td ({text}) Tj ET".encode("latin-1"))
    font = DictionaryObject({NameObject("/Type"): NameObject("/Font"), NameObject("/Subtype"): NameObject("/Type1"), NameObject("/BaseFont"): NameObject("/Helvetica")})
    page[NameObject("/Resources")] = DictionaryObject({NameObject("/Font"): DictionaryObject({NameObject("/F1"): w._add_object(font)})})
    page[NameObject("/Contents")] = w._add_object(content)
    buf = BytesIO()
    w.write(buf)
    return buf.getvalue()


def _connector(handler, mode="live", retries=2) -> SEBIConnector:
    client = httpx.AsyncClient(transport=httpx.MockTransport(handler), headers=S.HEADERS, follow_redirects=True)
    return SEBIConnector(mode=mode, timeout=5, retries=retries, client=client)


def _ok_handler(pdf: bytes):
    def handler(req: httpx.Request) -> httpx.Response:
        u = str(req.url)
        if "HomeAction.do" in u:
            return httpx.Response(200, text=_listing(), headers={"content-type": "text/html;charset=UTF-8"})
        if u.endswith(".html"):
            return httpx.Response(200, text=DETAIL, headers={"content-type": "text/html; charset=UTF-8"})
        if u.endswith(".pdf"):
            return httpx.Response(200, content=pdf, headers={"content-type": "application/pdf"})
        return httpx.Response(404)

    return handler


async def test_live_success_carries_provenance_and_dedup_hash():
    res = await _connector(_ok_handler(_pdf_bytes())).fetch_documents(2)
    assert res.status == "LIVE_SUCCESS" and res.mode == "LIVE" and res.discovered == 2 and len(res.documents) == 2 and not res.fallback
    d = res.documents[0]
    assert d.source_mode == "LIVE" and d.synthetic is False and d.url.startswith("https://www.sebi.gov.in/legal/circulars/") and d.document_url.endswith("/1.pdf")
    assert d.document_id == "100" and d.circular_number == "SEBI/HO/TEST/2026/1" and str(d.published_date) == "2026-09-01" and d.document_bytes and d.fetched_at
    assert d.content_hash == content_hash(d.content) and len(d.content_hash) == 64
    # the same PDF served twice → same hash → the pipeline's processed_documents check dedupes it, not the title
    assert res.documents[0].content_hash == res.documents[1].content_hash


async def test_listing_parser_on_real_shape_and_invalid_html():
    assert len(S.parse_listing(_listing(3))) == 3
    assert S.parse_listing("<html><body>Service Unavailable</body></html>") == []
    assert S.parse_listing("") == []


async def test_invalid_listing_html_is_live_failed_not_snapshot():
    res = await _connector(lambda r: httpx.Response(200, text="<html>maintenance</html>", headers={"content-type": "text/html"})).fetch_documents(2)
    assert res.status == "LIVE_FAILED" and "no circular rows" in (res.error or "") and res.documents == []


async def test_html_masquerading_as_pdf_is_rejected():
    def handler(req):
        u = str(req.url)
        if "HomeAction.do" in u:
            return httpx.Response(200, text=_listing(1), headers={"content-type": "text/html"})
        if u.endswith(".html"):
            return httpx.Response(200, text=DETAIL, headers={"content-type": "text/html"})
        return httpx.Response(200, text="<html>login</html>", headers={"content-type": "application/pdf"})

    res = await _connector(handler).fetch_documents(1)
    assert res.status == "LIVE_FAILED" and "not start with %PDF" in (res.error or "")


async def test_empty_or_scanned_pdf_is_rejected():
    from io import BytesIO

    from pypdf import PdfWriter

    w = PdfWriter()
    w.add_blank_page(width=100, height=100)
    buf = BytesIO()
    w.write(buf)
    res = await _connector(_ok_handler(buf.getvalue())).fetch_documents(1)
    assert res.status == "LIVE_FAILED" and "too short" in (res.error or "")


@pytest.mark.parametrize("status,needle", [(403, "403 Forbidden"), (429, "429 Too Many Requests")])
async def test_403_and_429_are_explicit_and_not_retried(status, needle):
    calls = {"n": 0}

    def handler(req):
        calls["n"] += 1
        return httpx.Response(status, text="blocked", headers={"content-type": "text/html"})

    res = await _connector(handler).fetch_documents(1)
    assert res.status == "LIVE_FAILED" and needle in (res.error or "") and calls["n"] == 1


async def test_5xx_is_retried_with_backoff_then_succeeds(monkeypatch):
    calls = {"n": 0}
    pdf = _pdf_bytes()
    ok = _ok_handler(pdf)

    def handler(req):
        calls["n"] += 1
        if calls["n"] == 1:
            return httpx.Response(503, text="busy", headers={"content-type": "text/html"})
        return ok(req)

    monkeypatch.setattr(S.asyncio, "sleep", _nosleep)
    res = await _connector(handler, retries=2).fetch_documents(1)
    assert res.status == "LIVE_SUCCESS" and calls["n"] >= 2


async def test_persistent_5xx_and_timeouts_are_bounded(monkeypatch):
    monkeypatch.setattr(S.asyncio, "sleep", _nosleep)
    calls = {"n": 0}

    def five(req):
        calls["n"] += 1
        return httpx.Response(502, text="bad gateway", headers={"content-type": "text/html"})

    res = await _connector(five, retries=2).fetch_documents(1)
    assert res.status == "LIVE_FAILED" and "after 3 attempts" in (res.error or "") and calls["n"] == 3

    calls["n"] = 0

    def timeout(req):
        calls["n"] += 1
        raise httpx.ReadTimeout("read timed out", request=req)

    res = await _connector(timeout, retries=1).fetch_documents(1)
    assert res.status == "LIVE_FAILED" and "ReadTimeout" in (res.error or "") and calls["n"] == 2


async def test_non_official_host_is_refused():
    def handler(req):
        if "HomeAction.do" in str(req.url):
            return httpx.Response(200, text='<tr><td>Sep 01, 2026</td><td><a href="https://www.sebi.gov.in/legal/circulars/sep-2026/x_1.html">X</a></td></tr>', headers={"content-type": "text/html"})
        return httpx.Response(200, text="<iframe src='?file=https://evil.example/legal.pdf'></iframe>", headers={"content-type": "text/html"})

    res = await _connector(handler).fetch_documents(1)
    assert res.status == "LIVE_FAILED" and "no PDF attachment" in (res.error or "")  # the non-official PDF URL never matches the official-host regex


async def test_demo_snapshot_mode_is_explicit_and_synthetic():
    res = await SEBIConnector(mode="demo_snapshot").fetch_documents(5)
    assert res.status == "DEMO_SNAPSHOT" and res.mode == "DEMO_SNAPSHOT" and all(d.synthetic and d.source_mode == "DEMO_SNAPSHOT" for d in res.documents)


async def test_live_with_snapshot_fallback_says_so():
    res = await _connector(lambda r: httpx.Response(500, text="x", headers={"content-type": "text/html"}), mode="live_with_snapshot_fallback", retries=0).fetch_documents(3)
    assert res.status == "DEMO_SNAPSHOT_FALLBACK" and res.fallback and res.mode == "DEMO_SNAPSHOT" and "NOT live" in res.warnings[0] and res.error
    assert all(d.synthetic for d in res.documents)


def test_mode_aliases_and_validation():
    assert SEBIConnector(mode="snapshot").mode == "demo_snapshot"
    with pytest.raises(ValueError):
        SEBIConnector(mode="bogus")


async def test_health_check_is_one_listing_request():
    calls = {"n": 0}
    ok = _ok_handler(_pdf_bytes())

    def handler(req):
        calls["n"] += 1
        return ok(req)

    out = await _connector(handler).check()
    assert out["status"] == "LIVE" and out["circulars_discovered"] == 2 and calls["n"] == 1 and out["error"] is None
    bad = await _connector(lambda r: httpx.Response(403, text="", headers={"content-type": "text/html"})).check()
    assert bad["status"] == "LIVE_FAILED" and "403" in bad["error"]


async def _nosleep(_):
    return None


# ---- pipeline-level: live mode failure fails the scan visibly; demo mode is labelled ----------------------------------
async def test_scan_in_live_mode_fails_visibly_without_fallback(db, tenant, monkeypatch):
    from app.services.pipeline import Scan
    from tests.test_pipeline_e2e import FakeGH

    monkeypatch.setattr("app.services.pipeline.GitHubClient", FakeGH)
    monkeypatch.setattr("app.services.pipeline.SEBIConnector", lambda: _connector(lambda r: httpx.Response(403, text="", headers={"content-type": "text/html"})))
    rec = await Scan(db, tenant).run()
    assert rec.status == "FAILED" and rec.error_kind == "source" and rec.source_status == "LIVE_FAILED" and rec.source_mode == "LIVE"
    assert "No snapshot fallback in live mode" in (rec.error or "") and "403" in (rec.error or "")
    assert rec.llm_calls == 0 and db.list_documents(tenant.tenant_id) == []


async def test_scan_in_demo_mode_is_labelled_not_reported_as_live(db, tenant, monkeypatch):
    from app.services.pipeline import Scan
    from tests.test_pipeline_e2e import FakeGH

    monkeypatch.setattr("app.services.pipeline.GitHubClient", FakeGH)
    rec = await Scan(db, tenant).run()  # conftest sets SEBI_MODE=snapshot
    assert rec.source_mode == "DEMO_SNAPSHOT" and rec.source_status == "DEMO_SNAPSHOT"
    assert "Demo snapshot" in next(s.detail for s in rec.steps if s.key == "connect")
    assert all(d.synthetic and d.source_mode == "DEMO_SNAPSHOT" for d in db.list_documents(tenant.tenant_id))


# ---- opt-in real network ----------------------------------------------------------------------------------------------
@pytest.mark.skipif(os.environ.get("RUN_LIVE_SEBI_TEST") != "1", reason="set RUN_LIVE_SEBI_TEST=1 to hit www.sebi.gov.in")
async def test_live_sebi_listing_and_one_circular():
    res = await SEBIConnector(mode="live").fetch_documents(1)
    assert res.status in ("LIVE_SUCCESS", "LIVE_PARTIAL"), res.error
    d = res.documents[0]
    assert d.source_mode == "LIVE" and not d.synthetic and d.url.startswith("https://www.sebi.gov.in/") and d.document_url.startswith("https://www.sebi.gov.in/")
    assert len(d.content) >= S.MIN_TEXT_CHARS and d.published_date is not None
