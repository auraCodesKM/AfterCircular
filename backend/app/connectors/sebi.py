"""SEBI circulars connector: live listing → circular page → PDF text, with a labelled demo snapshot fallback."""

import asyncio
import html as htmllib
import io
import json
import logging
import re
from datetime import date, datetime
from pathlib import Path

import httpx
from pypdf import PdfReader

from app.config import settings
from app.connectors.base import RegulatorySource
from app.schemas.regulatory import FetchResult, RegulatoryDocument

log = logging.getLogger(__name__)

LISTING_URL = "https://www.sebi.gov.in/sebiweb/home/HomeAction.do?doListing=yes&sid=1&ssid=7&smid=0"
UA = {"User-Agent": "Mozilla/5.0 (AfterCircular compliance monitor; +https://github.com/auraCodesKM/AfterCircular)"}
SNAPSHOT_DIR = Path(__file__).resolve().parents[2] / "data" / "snapshot"

_ROW = re.compile(r"<tr[^>]*>(.*?)</tr>", re.S)
_LINK = re.compile(r'href="(https://www\.sebi\.gov\.in/legal/circulars/[^"]+_(\d+)\.html)"[^>]*>(.*?)</a>', re.S)
_DATE = re.compile(r"([A-Z][a-z]{2} \d{1,2}, \d{4})")
_CIRC_NO = re.compile(r"Circular No\.:\s*</span>\s*<span>([^<]+)</span>", re.S)
_PDF = re.compile(r"file=(https://www\.sebi\.gov\.in/[^'\"&]+\.pdf)", re.I)
_EFFECTIVE = re.compile(r"(?:come into (?:force|effect)|effective|applicable)[^.]{0,80}?((?:\d{1,2}(?:st|nd|rd|th)?\s+)?[A-Z][a-z]+\s+\d{1,2},?\s+\d{4}|\d{1,2}[./-]\d{1,2}[./-]\d{4})", re.I)


def _text(fragment: str) -> str:
    return htmllib.unescape(re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", fragment))).strip()


def _parse_date(s: str | None) -> date | None:
    if not s:
        return None
    for fmt in ("%b %d, %Y", "%B %d, %Y", "%d.%m.%Y", "%d/%m/%Y", "%d-%m-%Y", "%Y-%m-%d"):
        try:
            return datetime.strptime(s.strip().replace("st ", " ").replace("nd ", " ").replace("rd ", " ").replace("th ", " "), fmt).date()
        except ValueError:
            continue
    return None


def parse_listing(page: str) -> list[dict[str, str]]:
    """Rows of the circular listing → [{url, entry_id, title, date}] (malformed rows skipped)."""
    out = []
    for row in _ROW.findall(page):
        m = _LINK.search(row)
        if not m:
            continue
        d = _DATE.search(_text(row))
        out.append({"url": m.group(1), "entry_id": m.group(2), "title": _text(m.group(3)), "date": d.group(1) if d else ""})
    return out


def parse_circular_page(page: str) -> dict[str, str | None]:
    m = _CIRC_NO.search(page)
    p = _PDF.search(page)
    return {"circular_number": _text(m.group(1)) if m else None, "pdf_url": p.group(1) if p else None}


def pdf_text(data: bytes) -> str:
    reader = PdfReader(io.BytesIO(data))
    return "\n".join((page.extract_text() or "") for page in reader.pages).strip()


def guess_effective_date(text: str) -> date | None:
    m = _EFFECTIVE.search(text)
    return _parse_date(m.group(1).replace(",", ", ").replace("  ", " ")) if m else None


class SEBIConnector(RegulatorySource):
    name = "SEBI"
    jurisdiction = "IN"

    def __init__(self, mode: str | None = None, timeout: float | None = None):
        self.mode = mode or settings().sebi_mode
        self.timeout = timeout or settings().sebi_timeout_seconds

    async def fetch_documents(self, limit: int) -> FetchResult:
        if self.mode == "live":
            try:
                return await self._fetch_live(limit)
            except Exception as e:  # noqa: BLE001 — any live failure must fall back, never crash the scan
                log.warning("SEBI live fetch failed (%s); using demo snapshot", e)
                snap = self.snapshot(limit)
                snap.warnings.insert(0, f"Live source unavailable ({type(e).__name__}: {str(e)[:120]}). Using demo snapshot.")
                return snap
        return self.snapshot(limit)

    async def _fetch_live(self, limit: int) -> FetchResult:
        warnings: list[str] = []
        async with httpx.AsyncClient(headers=UA, timeout=self.timeout, follow_redirects=True) as client:
            r = await client.get(LISTING_URL)
            r.raise_for_status()
            rows = parse_listing(r.text)
            if not rows:
                raise ValueError("Listing page contained no circular rows (layout changed?)")
            docs: list[RegulatoryDocument] = []
            for row in rows[:limit]:
                try:
                    docs.append(await self._fetch_one(client, row))
                except Exception as e:  # noqa: BLE001 — one bad circular must not sink the batch
                    warnings.append(f"Skipped {row['entry_id']}: {type(e).__name__}: {str(e)[:100]}")
            if not docs:
                raise ValueError("No circular could be retrieved: " + "; ".join(warnings))
        return FetchResult(mode="LIVE", documents=docs, warnings=warnings)

    async def _fetch_one(self, client: httpx.AsyncClient, row: dict[str, str]) -> RegulatoryDocument:
        page = await client.get(row["url"])
        page.raise_for_status()
        meta = parse_circular_page(page.text)
        if not meta["pdf_url"]:
            raise ValueError("no PDF attachment found")
        pdf = await client.get(meta["pdf_url"])
        pdf.raise_for_status()
        text = await asyncio.to_thread(pdf_text, pdf.content)
        if len(text) < 200:
            raise ValueError("PDF text too short (scanned document?)")
        return RegulatoryDocument(
            source=self.name, jurisdiction=self.jurisdiction, document_id=row["entry_id"],
            circular_number=meta["circular_number"], title=row["title"], published_date=_parse_date(row["date"]),
            effective_date=guess_effective_date(text), url=row["url"], content=text, source_mode="LIVE",
        ).with_hash()

    def snapshot(self, limit: int) -> FetchResult:
        docs = []
        for f in sorted(SNAPSHOT_DIR.glob("*.json"))[:limit]:
            raw = json.loads(f.read_text(encoding="utf-8"))
            docs.append(RegulatoryDocument.model_validate({**raw, "source_mode": "DEMO_SNAPSHOT"}).with_hash())
        return FetchResult(mode="DEMO_SNAPSHOT", documents=docs, warnings=["Demo snapshot: fictional circulars, clearly labelled."])
