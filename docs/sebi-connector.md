# SEBI connector — official source, live by default

**Source of record:** SEBI's own site only. Listing `https://www.sebi.gov.in/sebiweb/home/HomeAction.do?doListing=yes&sid=1&ssid=7&smid=0`
(Legal → Circulars) → each circular's detail page (`/legal/circulars/<mon-yyyy>/<slug>_<entry_id>.html`, carries the circular
number and an iframe to the PDF) → the PDF under `/sebi_data/attachdocs/…` → text via pypdf. Code: `backend/app/connectors/sebi.py`.
No search engines, mirrors, news sites or copied data. Any URL off `www.sebi.gov.in` is refused.

**Access pattern (PoC, respectful):** scan-triggered, not continuous. One scan = 1 listing request + up to `SEBI_MAX_DOCUMENTS`
circular pages and PDFs, on a shared client (max 4 connections). Browser-compatible `User-Agent`/`Accept` headers that also
identify AfterCircular, redirects on, connect/read/pool timeouts (`SEBI_TIMEOUT_SECONDS`), retries only on 5xx/timeouts/
network errors with exponential backoff (`AFTERCIRCULAR_MAX_RETRIES`), 403 and 429 reported immediately (never retried, never
worked around), content-type and `%PDF` magic validated, PDFs over 25 MB and text under 200 chars rejected. Every request logs
final URL, status, content-type, size and latency; no secrets are involved.

**Modes (`SEBI_MODE`):**

| mode | behaviour | `FetchResult.status` |
|---|---|---|
| `live` (demo default) | real fetch; failure → scan **FAILED** with the real reason, **no fallback** | `LIVE_SUCCESS` / `LIVE_PARTIAL` (some rows skipped, reasons listed) / `LIVE_FAILED` |
| `demo_snapshot` (`snapshot`) | fictional fixtures in `backend/data/snapshot`, labelled everywhere | `DEMO_SNAPSHOT` |
| `live_with_snapshot_fallback` | dev only; a live failure falls back and says so | `DEMO_SNAPSHOT_FALLBACK` (+ `error`) |

The scan records `source_mode` (LIVE / DEMO_SNAPSHOT), `source_status` (adds `LIVE_NO_NEW_DOCUMENTS` when the live listing
held nothing new) and `source_error`. The UI reads those: "Connected to SEBI — fetched N live publications", "Connected to SEBI —
no new publications since last scan", "SEBI connection failed — <reason> · no snapshot fallback in live mode", or "Demo snapshot —
synthetic publications, not SEBI data". Demo is never described as SEBI.

**Curated selection (`SEBI_SELECTED_ENTRY_IDS`):** the demo pins six real circulars whose registry records live in
`backend/regulatory_sources/sebi/<entry_id>.json` (title, reference, date, `detail_url`, `pdf_url`, PDF size, text length,
content hash, `retrieved_at`; `source_mode = LIVE`, `synthetic = false`, validated by `app/connectors/registry.py`). The
connector still fetches every one of them live from www.sebi.gov.in on each scan — listing rows are filtered to the set and an
id that has dropped off the newest listing page is fetched via its registered `detail_url`. An id absent from both is
reported in `skipped` (→ `LIVE_PARTIAL`), never invented.

**Provenance per document:** `source_mode`, `synthetic` (true only for fixtures), `url` (circular page), `document_url` (PDF),
`document_bytes`, `fetched_at`, `content_hash` (sha256 of whitespace-normalised text), `document_id` (SEBI entry id),
`circular_number`, `published_date`. Persisted in `processed_documents`; shown as "Live · sebi.gov.in" or "Demo snapshot · synthetic".

**Deduplication:** `UNIQUE(tenant_id, source, document_id, content_hash)` — the same circular is processed once per tenant; a
changed PDF with the same entry id becomes a new version. Titles are never the key. A repeat scan reports `LIVE_NO_NEW_DOCUMENTS`
with zero model calls.

**Why snapshots exist:** deterministic tests and offline demos (`tests/`, `evals/scenarios`). They are fictional, flagged
`synthetic=true`, and appear in the UI, tickets and audit log as "Demo snapshot".

**Health:** `GET /api/connectors/sebi/health` — one listing request (cached 60 s; `?refresh=1`), returns `status`
(`LIVE` / `LIVE_FAILED` / `DEMO_SNAPSHOT`), `circulars_discovered`, the newest row, latency, error.

**Checks:** `uv run python scripts/live_check.py sebi` (real listing + one circular + PDF, no model calls) ·
`RUN_LIVE_SEBI_TEST=1 uv run pytest -k live_sebi` (opt-in network test) · `uv run pytest -k sebi` (mock-transport suite:
parser, invalid HTML, HTML-as-PDF, empty PDF, 403, 429, 5xx retry, timeouts, non-official host, modes, health, pipeline behaviour).

**Security:** official host allow-list, no credentials, no attempt to bypass CAPTCHA/WAF/rate limits — a block surfaces as
`LIVE_FAILED`. Circular text is untrusted input to the models (extraction prompt rules).
