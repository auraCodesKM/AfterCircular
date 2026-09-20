# AfterCircular — backend

FastAPI service that runs the regulatory-intelligence pipeline (PRD §0 Tier 0):

```
POST /api/scan
  SEBI connector (live sebi.gov.in, or labelled demo snapshot)
  → content-hash detection, versioning, idempotency (SQLite `processed_documents`)
  → obligation extraction (Foundry, structured + evidence required)
  → policy retrieval (Azure AI Search hybrid, or local BM25+vector fallback) over the tenant's GitHub repo
  → Impact Gate: cheap prefilter → impact analysis (Foundry) → deterministic routing
  → CONFLICT: memo draft → review row (AWAITING_REVIEW)
POST /api/reviews/{id}/approve   → GitHub issue (the only side effect; human-gated)
```

AI does: understand, extract, reason, draft. Code does: fetch, hash, persist, state transitions, approval, GitHub, audit.

## Run

```bash
cd backend
uv sync                      # Python ≥3.12; installs deps + dev group
cp .env.example .env         # fill in (see below) — never commit .env
uv run uvicorn app.main:app --port 8010 --reload
open http://localhost:8010/docs
```

Point the frontend at it: in `web/.env.local` set `BACKEND_URL=http://localhost:8010` and `BACKEND_API_KEY=<same as backend .env>`.

## Configuration

| Variable | Meaning |
|---|---|
| `BACKEND_API_KEY` | Shared secret with the Next.js proxy (`Authorization: Bearer`). |
| `DATABASE_PATH` | SQLite file (default `data/aftercircular.db`). Delete it to reset the demo. |
| `AI_PROVIDER` | `foundry` (real model calls) or `stub` (fixture outputs from `evals/scenarios`, labelled everywhere, no AI). |
| `FOUNDRY_ENDPOINT` / `FOUNDRY_API_KEY` / `FOUNDRY_API_VERSION` | Microsoft Foundry / Azure OpenAI resource. Empty key → Entra ID via `DefaultAzureCredential` (managed identity on Azure, `az login` locally). |
| `EXTRACTION_MODEL` / `IMPACT_MODEL` / `MEMO_MODEL` / `EMBEDDING_MODEL` | Deployment names, one per task (PRD §23). |
| `AZURE_SEARCH_ENDPOINT` / `AZURE_SEARCH_API_KEY` | Azure AI Search. Empty → in-process hybrid retriever (BM25 + cosine, RRF-fused) over SQLite. |
| `SEBI_MODE` | `live` (fetch sebi.gov.in; snapshot on failure) or `snapshot` (always the fictional demo circulars). |
| `SEBI_MAX_DOCUMENTS` | Circulars per scan (default 5). |
| `GITHUB_TOKEN` | Fallback token; normally the signed-in user's OAuth token arrives per request from the frontend. |

### Azure resources

- **Microsoft Foundry** project with three chat deployments (e.g. `gpt-4o-mini`, `gpt-4o`) and one embedding deployment (`text-embedding-3-small`, 1536 dims).
- **Azure AI Search** (Basic tier is enough): one index per tenant is created on first scan (`policies-<tenant>`), HNSW vector field + `en.microsoft` keyword analyzer, hybrid query with RRF.
- Optional: run the API on App Service / Container Apps with a managed identity that has *Cognitive Services OpenAI User* on the Foundry resource; leave `FOUNDRY_API_KEY` empty.

## Demo fallback

If `sebi.gov.in` is unreachable (or `SEBI_MODE=snapshot`), the connector serves `data/snapshot/*.json` — three **fictional** circulars, marked `source_mode = DEMO_SNAPSHOT` on the document, the scan, the dashboard badge and the GitHub issue. The pipeline still runs extraction, retrieval, impact analysis, memo, approval and issue creation on them.

With `AI_PROVIDER=stub` the three agents return fixtures from `evals/scenarios` (matched by circular id) so the plumbing can be exercised without a model; every record says `provider = stub` and the dashboard shows an amber "stub — no model calls" badge. Live circulars have no fixtures and fail with a clear message until Foundry is configured.

## Tenant model

Requests carry the tenant in headers set by the trusted frontend (`X-Tenant-Id`, `X-Tenant-Repo`, `X-Tenant-Company`, `X-Tenant-Branch`, `X-Actor`, `X-GitHub-Token`). Every table is keyed by `tenant_id`; the search index is per tenant (PRD §6).

The policy corpus is read from the tenant repository's default branch: `aftercircular.yml` lists the documents, each Markdown file's YAML front matter (`doc_id`, `version`, `owner`, …) is the metadata, and every `##`/`###` section becomes one chunk (`POL-001#4.1`) so citations are exact. Re-indexing happens only when the branch head moves.

## State machine

```
DISCOVERED → EXTRACTING → RETRIEVING → ANALYZING
   ├─ applicability NO ............................ ARCHIVED (impact NOT_APPLICABLE)
   ├─ UNCERTAIN / CONFLICT without evidence ....... NEEDS_INVESTIGATION (human, no action)
   ├─ YES + ALIGNED ............................... ARCHIVED (impact ALIGNED)
   └─ YES + CONFLICT → DRAFTING → AWAITING_REVIEW → APPROVED → COMPLETED (issue)
                                                  └→ REJECTED
FAILED (retried on the next scan)
```

Idempotency: `(tenant, source, document_id, content_hash)` is unique; same hash → skipped; new hash → `document_version + 1` with `previous_hash`. An approved review is never re-opened, and the issue search by `AfterCircular-Analysis-ID` prevents a second issue for the same analysis.

## API

```
GET  /health
POST /api/scan                     {force?: bool}   → 202 ScanRecord (poll it)
GET  /api/scans/latest | /api/scans/{id}
GET  /api/documents | /api/documents/{id} | /api/documents/{id}/content
GET  /api/analyses/{id}
GET  /api/reviews?status= | /api/reviews/{id}
POST /api/reviews/{id}/approve | /reject          {note?}
GET  /api/audit?limit=&document=
GET  /api/evals/latest
PUT  /api/tenants, GET /api/tenants/by-owner/{githubId}
```

## Tests and evaluation

```bash
uv run pytest            # hashing, detection/versioning, connector parsing + fallback, schemas, gate, retrieval,
                         # approval transitions, ticket payload, full stub pipeline incl. idempotency
uv run mypy app evals
uv run python -m evals.run --models gpt-4o-mini,gpt-4o   # needs FOUNDRY_*; corpus from ../acme-securities-policies (or --corpus)
```

`evals/run.py` runs every golden scenario (CONFLICT, ALIGNED, not-applicable, UNCERTAIN) per model, scores extraction / impact / memo with documented task-specific checks (schema validity, verbatim-evidence accuracy, applicability/alignment/affected-policy match), records latency and tokens, estimates cost from `evals/pricing.json` (null when a model has no price entry), and writes `evals/results/latest.json`, which the dashboard's *Model intelligence* tab reads. With the stub provider the report is explicitly marked as measuring the harness, not a model.

## Layout

```
app/
  main.py, config.py
  api/          health, scan, documents (+analyses, audit), reviews, tenants, evals
  connectors/   base.RegulatorySource, sebi.SEBIConnector (live + snapshot)
  agents/       obligation_extraction, impact_analysis, memo_generation (prompts + structured calls)
  models/       provider.LLMProvider → FoundryProvider | StubProvider
  retrieval/    base (RRF), local (BM25+cosine), azure_search (index-per-tenant hybrid)
  services/     state (SQLite repo), pipeline (Scan), gate, policies, reviews, tickets, audit
  schemas/      regulatory, obligations, impact, actions
  tools/        github (read repo, find/create issue)
data/snapshot/  fictional demo circulars
evals/          dataset, scenarios/, pricing.json, run.py
tests/
```
