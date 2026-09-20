from pathlib import Path

import pytest

from app.connectors.sebi import SEBIConnector, guess_effective_date, parse_circular_page, parse_listing

LISTING = """<table><tr><td>Date</td><td>Title</td></tr>
<tr><td>Sep 09, 2026</td><td><a href="https://www.sebi.gov.in/legal/circulars/sep-2026/review-of-position-limits_104387.html">Review of Position Limits</a></td></tr>
<tr><td>broken row without link</td></tr></table>"""

PAGE = """<div class='id_area'><span>Circular No.:  </span><span>HO/47/16/13(5)2026-MRD-POD1/ I/20735/2026</span></div>
<iframe src='../../../web/?file=https://www.sebi.gov.in/sebi_data/attachdocs/sep-2026/1788952299552.PDF'></iframe>"""


def test_parse_listing_skips_malformed_rows():
    rows = parse_listing(LISTING)
    assert rows == [{"url": "https://www.sebi.gov.in/legal/circulars/sep-2026/review-of-position-limits_104387.html", "entry_id": "104387",
                     "title": "Review of Position Limits", "date": "Sep 09, 2026"}]


def test_parse_circular_page():
    meta = parse_circular_page(PAGE)
    assert meta["circular_number"] == "HO/47/16/13(5)2026-MRD-POD1/ I/20735/2026"
    assert meta["pdf_url"].endswith("1788952299552.PDF")
    assert parse_circular_page("<html/>") == {"circular_number": None, "pdf_url": None}


def test_guess_effective_date():
    assert str(guess_effective_date("shall come into effect on October 15, 2026.")) == "2026-10-15"
    assert guess_effective_date("no date here") is None


async def test_snapshot_is_labelled_and_hashed():
    res = await SEBIConnector(mode="snapshot").fetch_documents(10)
    assert res.mode == "DEMO_SNAPSHOT" and len(res.documents) == 3
    assert all(d.source_mode == "DEMO_SNAPSHOT" and len(d.content_hash) == 64 for d in res.documents)


async def test_live_failure_falls_back_to_snapshot(monkeypatch):
    async def boom(self, limit):
        raise ConnectionError("sebi down")

    monkeypatch.setattr(SEBIConnector, "_fetch_live", boom)
    res = await SEBIConnector(mode="live").fetch_documents(10)
    assert res.mode == "DEMO_SNAPSHOT" and "Live source unavailable" in res.warnings[0]
