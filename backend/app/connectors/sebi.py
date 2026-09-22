"""SEBI circulars connector — official source only: www.sebi.gov.in listing → circular page → PDF → text.

    listing  https://www.sebi.gov.in/sebiweb/home/HomeAction.do?doListing=yes&sid=1&ssid=7&smid=0   (Legal → Circulars)
    detail   https://www.sebi.gov.in/legal/circulars/<mon-yyyy>/<slug>_<entry_id>.html                 (circular number, iframe → PDF)
    pdf      https://www.sebi.gov.in/sebi_data/attachdocs/<mon-yyyy>/<id>.pdf

Modes (SEBI_MODE):
    live                         real fetch; any failure → FetchResult(status=LIVE_FAILED) — NO snapshot fallback
    demo_snapshot                the fictional, labelled fixtures in data/snapshot (tests, offline demos)
    live_with_snapshot_fallback  dev only: LIVE_FAILED → DEMO_SNAPSHOT_FALLBACK, recorded as a fallback, never as live

Provenance on every document: source_mode (LIVE | DEMO_SNAPSHOT), synthetic (True only for fixtures), url (detail page),
document_url (PDF), fetched_at. Access is scan-triggered (no crawling): one listing request plus ≤ `limit` circular pages
and PDFs per scan, a shared client, bounded retries with backoff on transient errors only, explicit 403/429 handling and
content validation. Nothing here works around access controls; a block is reported as LIVE_FAILED.
"""

from __future__ import annotations

import asyncio
import html as htmllib
import io
import json
import logging
import re
import time
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any

import httpx
from pypdf import PdfReader

from app.config import settings
from app.connectors.base import RegulatorySource
from app.connectors.registry import load_registry
from app.schemas.regulatory import FetchResult, RegulatoryDocument

log = logging.getLogger(__name__)

LISTING_URL = "https://www.sebi.gov.in/sebiweb/home/HomeAction.do?doListing=yes&sid=1&ssid=7&smid=0"
OFFICIAL_HOST = "www.sebi.gov.in"
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36 AfterCircular/0.1 (+https://github.com/auraCodesKM/AfterCircular)",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,application/pdf;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-IN,en;q=0.9",
}
SNAPSHOT_DIR = Path(__file__).resolve().parents[2] / "data" / "snapshot"
MIN_TEXT_CHARS = 200
MAX_PDF_BYTES = 25 * 1024 * 1024

_ROW = re.compile(r"<tr[^>]*>(.*?)</tr>", re.S)
_LINK = re.compile(r'href="(https://www\.sebi\.gov\.in/legal/circulars/[^"]+_(\d+)\.html)"[^>]*>(.*?)</a>', re.S)
_DATE = re.compile(r"([A-Z][a-z]{2} \d{1,2}, \d{4})")
_CIRC_NO = re.compile(r"Circular No\.:\s*</span>\s*<span>([^<]+)</span>", re.S)
_PDF = re.compile(r"file=(https://www\.sebi\.gov\.in/[^'\"&]+\.pdf)", re.I)
_EFFECTIVE = re.compile(r"(?:come into (?:force|effect)|effective|applicable)[^.]{0,80}?((?:\d{1,2}(?:st|nd|rd|th)?\s+)?[A-Z][a-z]+\s+\d{1,2},?\s+\d{4}|\d{1,2}[./-]\d{1,2}[./-]\d{4})", re.I)


class SourceError(RuntimeError):
    """A live-source failure with a concise, person-readable reason (never a secret, never a stack trace)."""


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
    if not data.startswith(b"%PDF-"):
        raise SourceError("document is not a PDF (no %PDF header — HTML or an error page was served instead)")
    reader = PdfReader(io.BytesIO(data))
    return "\n".join((page.extract_text() or "") for page in reader.pages).strip()


def guess_effective_date(text: str) -> date | None:
    m = _EFFECTIVE.search(text)
    return _parse_date(m.group(1).replace(",", ", ").replace("  ", " ")) if m else None


def _official(url: str) -> bool:
    return httpx.URL(url).host == OFFICIAL_HOST


class SEBIConnector(RegulatorySource):
    name = "SEBI"
    jurisdiction = "IN"

    def __init__(self, mode: str | None = None, timeout: float | None = None, retries: int | None = None, client: httpx.AsyncClient | None = None):
        s = settings()
        self.mode = _normalize_mode(mode or s.sebi_mode)
        self.timeout = timeout or s.sebi_timeout_seconds
        self.retries = s.max_retries if retries is None else retries
        self._client = client  # injected in tests (MockTransport); otherwise one client per fetch

    # ---- HTTP ----------------------------------------------------------------------------------------------------------
    def _make_client(self) -> httpx.AsyncClient:
        t = httpx.Timeout(self.timeout, connect=min(10.0, self.timeout), read=self.timeout, pool=self.timeout)
        return httpx.AsyncClient(headers=HEADERS, timeout=t, follow_redirects=True, limits=httpx.Limits(max_connections=4))

    async def _get(self, client: httpx.AsyncClient, url: str, *, expect: str) -> httpx.Response:
        """One GET with bounded retries (transient only), explicit 403/429, content-type and host validation."""
        if not _official(url):
            raise SourceError(f"refusing non-official host for {url}")
        last: str = ""
        for attempt in range(self.retries + 1):
            t0 = time.perf_counter()
            try:
                r = await client.get(url)
            except (httpx.TimeoutException, httpx.NetworkError) as e:
                last = f"{type(e).__name__} after {int((time.perf_counter() - t0) * 1000)} ms"
                log.warning("SEBI %s attempt %d/%d: %s", url, attempt + 1, self.retries + 1, last)
            else:
                log.info("SEBI GET %s → %s %s (%s, %d bytes, %d ms)", url, r.status_code, r.url, r.headers.get("content-type", "?"), len(r.content), int((time.perf_counter() - t0) * 1000))
                if r.status_code == 403:
                    raise SourceError("SEBI returned 403 Forbidden — access to the official site is blocked from this network")
                if r.status_code == 429:
                    raise SourceError("SEBI returned 429 Too Many Requests — rate limited; try again later")
                if r.status_code >= 500:
                    last = f"HTTP {r.status_code}"
                elif r.status_code != 200:
                    raise SourceError(f"SEBI returned HTTP {r.status_code} for {url}")
                else:
                    ctype = r.headers.get("content-type", "").lower()
                    if expect == "html" and "html" not in ctype:
                        raise SourceError(f"expected an HTML page, got {ctype or 'no content-type'} for {url}")
                    if expect == "pdf":
                        if len(r.content) > MAX_PDF_BYTES:
                            raise SourceError(f"PDF larger than {MAX_PDF_BYTES // 1024 // 1024} MB — skipped")
                        if not r.content.startswith(b"%PDF-"):
                            raise SourceError(f"expected a PDF, got {ctype or 'no content-type'} (body does not start with %PDF) for {url}")
                    if not r.content:
                        raise SourceError(f"empty response body for {url}")
                    return r
            if attempt < self.retries:
                await asyncio.sleep(0.5 * (2**attempt))
        raise SourceError(f"SEBI unreachable after {self.retries + 1} attempts: {last}")

    # ---- public --------------------------------------------------------------------------------------------------------
    async def fetch_documents(self, limit: int) -> FetchResult:
        if self.mode == "demo_snapshot":
            return self.snapshot(limit)
        try:
            return await self._fetch_live(limit)
        except SourceError as e:
            reason = str(e)
        except Exception as e:  # noqa: BLE001 — anything else is still a live failure, reported as such
            reason = f"{type(e).__name__}: {str(e)[:160]}"
        log.warning("SEBI live fetch failed: %s", reason)
        if self.mode == "live_with_snapshot_fallback":
            snap = self.snapshot(limit)
            snap.status, snap.fallback, snap.error = "DEMO_SNAPSHOT_FALLBACK", True, reason
            snap.warnings.insert(0, f"Live SEBI fetch failed ({reason}). Fell back to the fictional demo snapshot — this is NOT live data.")
            return snap
        return FetchResult(mode="LIVE", status="LIVE_FAILED", documents=[], error=reason, listing_url=LISTING_URL,
                           warnings=[f"SEBI connection failed: {reason}. No snapshot fallback in live mode."])

    async def check(self) -> dict[str, Any]:
        """Health probe: ONE listing request, no circular pages, no PDFs."""
        t0 = time.perf_counter()
        out: dict[str, Any] = {"source": "SEBI", "listing_url": LISTING_URL, "mode": self.mode, "last_checked_at": datetime.now(timezone.utc).isoformat(), "error": None}
        if self.mode == "demo_snapshot":
            return {**out, "status": "DEMO_SNAPSHOT", "circulars_discovered": len(list(SNAPSHOT_DIR.glob("*.json"))), "latency_ms": 0}
        try:
            async with (self._client or self._make_client()) as client:
                r = await self._get(client, LISTING_URL, expect="html")
                rows = parse_listing(r.text)
            if not rows:
                raise SourceError("listing page contained no circular rows (layout changed?)")
            return {**out, "status": "LIVE", "circulars_discovered": len(rows), "latest": {"date": rows[0]["date"], "title": rows[0]["title"], "url": rows[0]["url"]},
                    "latency_ms": int((time.perf_counter() - t0) * 1000)}
        except Exception as e:  # noqa: BLE001
            return {**out, "status": "LIVE_FAILED", "circulars_discovered": 0, "error": str(e)[:300], "latency_ms": int((time.perf_counter() - t0) * 1000)}

    # ---- live ----------------------------------------------------------------------------------------------------------
    async def _fetch_live(self, limit: int) -> FetchResult:
        warnings: list[str] = []
        selected = settings().sebi_selected_ids
        async with (self._client or self._make_client()) as client:
            r = await self._get(client, LISTING_URL, expect="html")
            rows = parse_listing(r.text)
            if not rows:
                raise SourceError("listing page contained no circular rows (layout changed?)")
            if selected:
                # curated demo set: only registry entries, each still fetched live; ids that have left the first listing page
                # are fetched by their official detail URL from the registry record
                registry = load_registry()
                by_id = {x["entry_id"]: x for x in rows}
                chosen: list[dict[str, str]] = []
                for eid in selected:
                    reg = registry.get(eid)
                    if reg is None:
                        warnings.append(f"Selected entry {eid} is not in the source registry — skipped")
                        continue
                    chosen.append(by_id.get(eid) or {"url": reg["detail_url"], "entry_id": eid, "title": reg["title"], "date": _listing_date(reg["date"])})
                rows = chosen
                limit = max(limit, len(rows))
            docs: list[RegulatoryDocument] = []
            for row in rows[:limit]:
                try:
                    docs.append(await self._fetch_one(client, row))
                except SourceError as e:
                    warnings.append(f"Skipped {row['entry_id']} ({row['title'][:60]}): {e}")
                except Exception as e:  # noqa: BLE001 — one bad circular must not sink the batch
                    warnings.append(f"Skipped {row['entry_id']} ({row['title'][:60]}): {type(e).__name__}: {str(e)[:100]}")
        if not docs:
            raise SourceError("listing reached, but no circular could be retrieved: " + "; ".join(warnings)[:300])
        return FetchResult(mode="LIVE", status="LIVE_PARTIAL" if warnings else "LIVE_SUCCESS", documents=docs, warnings=warnings, listing_url=LISTING_URL, discovered=len(rows))

    async def _fetch_one(self, client: httpx.AsyncClient, row: dict[str, str]) -> RegulatoryDocument:
        page = await self._get(client, row["url"], expect="html")
        meta = parse_circular_page(page.text)
        if not meta["pdf_url"]:
            raise SourceError("no PDF attachment found on the circular page")
        pdf = await self._get(client, meta["pdf_url"], expect="pdf")
        text = await asyncio.to_thread(pdf_text, pdf.content)
        if len(text) < MIN_TEXT_CHARS:
            raise SourceError(f"PDF text too short ({len(text)} chars — scanned document?)")
        return RegulatoryDocument(
            source=self.name, jurisdiction=self.jurisdiction, document_id=row["entry_id"],
            circular_number=meta["circular_number"], title=row["title"], published_date=_parse_date(row["date"]),
            effective_date=guess_effective_date(text), url=str(page.url), document_url=str(pdf.url), document_bytes=len(pdf.content),
            content=text, source_mode="LIVE", synthetic=False,
        ).with_hash()

    # ---- fixtures ------------------------------------------------------------------------------------------------------
    def snapshot(self, limit: int) -> FetchResult:
        docs = []
        for f in sorted(SNAPSHOT_DIR.glob("*.json"))[:limit]:
            raw = json.loads(f.read_text(encoding="utf-8"))
            docs.append(RegulatoryDocument.model_validate({**raw, "source_mode": "DEMO_SNAPSHOT", "synthetic": True}).with_hash())
        return FetchResult(mode="DEMO_SNAPSHOT", status="DEMO_SNAPSHOT", documents=docs, discovered=len(docs),
                           warnings=["Demo snapshot: fictional circulars, clearly labelled. Not SEBI data."])


def _listing_date(iso: str | None) -> str:
    """Registry dates are ISO; the listing parser expects 'Sep 09, 2026'."""
    try:
        return datetime.strptime(iso or "", "%Y-%m-%d").strftime("%b %d, %Y")
    except ValueError:
        return ""


def _normalize_mode(mode: str) -> str:
    m = mode.strip().lower()
    if m == "snapshot":
        m = "demo_snapshot"
    if m not in ("live", "demo_snapshot", "live_with_snapshot_fallback"):
        raise ValueError(f"SEBI_MODE must be live | demo_snapshot | live_with_snapshot_fallback, got {mode!r}")
    return m
