# AfterCircular — Azure Architecture & Decision Record

Living record: architecture decisions, Azure runbook, cost strategy, TOON measurements, security, AI-103 mapping,
verification evidence. Every claim here is either **measured in this repository** or marked **NOT VERIFIED**.
Last reconciled with code + Azure state: **2026-09-22** (truthful demo rebuild, §19).
**STATUS = LIVE (controlled development/demo deployment)** — Foundry `gpt-5-mini` + `text-embedding-3-small`, Azure AI Search
`policies-dev`, Jev, all reached with Entra ID from this machine; one bounded end-to-end scan verified on 2026-09-21 (§15).
Not production: single dev resource group, local backend, SQLite, list-price cost estimates, Students subscription.

Status legend: ✅ verified · 🧪 implemented, not yet verified against Azure · ⛔ blocked on a human action · ✗ not done

---

## 1. Project Overview

**AfterCircular — "Turn regulatory change into action."**

SEBI publishes a circular → AfterCircular detects it (content hash, idempotent), extracts obligations (Foundry,
structured output), retrieves the company's own policy clauses (Azure AI Search hybrid), decides applicability /
alignment with **typed calibrated judgments (Jev / TypeSafe System One)**, escalates hard cases to a Foundry reasoning
model, drafts a memo only for a **CONFLICT**, and stops. A **person** approves or rejects. Only after approval does the
system open a GitHub issue in the company's policy repository. Everything is written to an audit trail.

The AI never edits policy. The AI never opens the issue on its own.

## 2. Architecture

```
                 ┌──────────────── Next.js 16 (web/) — Auth.js GitHub OAuth, tenant switcher, review UI ────────────────┐
                 │  server-side proxy adds: X-Tenant-*, X-Actor, X-GitHub-Token (user token never reaches the browser)   │
                 └──────────────────────────────────────────────┬─────────────────────────────────────────────────────────┘
                                                                │ Bearer BACKEND_API_KEY
┌───────────────────────────────────────────────────────────────▼──────────────────────────────────────────────────────────┐
│ FastAPI (backend/app)                                                                                                    │
│                                                                                                                          │
│  SEBI connector ─► detect (sha256 of normalized text; document_id + hash + status + analysis_id) ─► MAX_DOCUMENTS_PER_SCAN │
│      │ LIVE sebi.gov.in, else labelled DEMO_SNAPSHOT (fictional)                                                          │
│      ▼                                                                                                                   │
│  extraction ──── Foundry Responses API, strict JSON-Schema (ExtractionResult) ─────────────────────────── JSON boundary   │
│      ▼                                                                                                                   │
│  retrieval ───── Azure AI Search: BM25 + HNSW vector, server-side RRF (top-k=10) ─► dedupe + token budget ─ JSON boundary │
│      ▼                                                                                                                   │
│  decision layer (app/decisions)                                                                                          │
│      extraction_check → applicability → rerank → alignment → verification      Jev (typed Noul/Choice/Score) ─ JSON state │
│      thresholds in policy.py; uncertain band never rounded to a decision                                                  │
│      escalation ─ Foundry reasoning, context = **TOON** (obligations + policy excerpts) → strict ImpactAnalysis schema     │
│      ▼                                                                                                                   │
│  Impact Gate (code): ARCHIVED | ALIGNED | CONFLICT | NEEDS_INVESTIGATION                                                  │
│      CONFLICT only ─► memo (Foundry, context = **TOON** evidence) ─► review row AWAITING_REVIEW                            │
│                                                                                                                          │
│  POST /api/reviews/{id}/approve  (human) ─► GitHub issue (idempotent, AfterCircular-Analysis-ID in body) ─► audit          │
│                                                                                                                          │
│  Persistence: SQLite (processed_documents, analyses, decisions, reviews, audit_events, llm_calls, policy_chunks, tenants)  │
│  Guardrails: CallBudget per scan, semaphore, bounded retries, no memo for NOT_APPLICABLE/ALIGNED                           │
│  Telemetry: llm_calls(tokens, cached_tokens, attempts, estimated_cost_usd, context_format, structured_mode) + App Insights │
└──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
        Azure Functions timer (functions/) ─► POST /api/scheduled-scan  (409 until AFTERCIRCULAR_ENABLE_SCHEDULED_SCAN=true)
```

TOON/JSON boundary (see §7):

```
 typed Pydantic object ──► TOON adapter (app/toon.py) ──► model *context* (obligations, excerpts, evidence)
                       └─► JSON / JSON Schema ─────────► Foundry structured output, Jev state, Search, GitHub, SQLite
```

## 3. Azure Services

| Service | Role | Status | Cost class |
|---|---|---|---|
| Microsoft Foundry (Azure OpenAI resource) | extraction, escalation reasoning, memo, embeddings | ⛔ no resource yet | pay-per-token |
| Azure AI Search | per-tenant hybrid index (`policies-<tenant>`) | ⛔ no resource yet | **Basic tier is always-on billing**; Free tier (F, one per subscription, 50 MB, 3 indexes) is enough for the two demo tenants — whether F is still offered to this subscription is *NOT VERIFIED* — see §13 |
| Azure Container Apps | FastAPI backend, 1 replica, Azure Files volume for SQLite | 🧪 Dockerfile ready | consumption; near-zero idle |
| Azure Files (Storage account) | `/data/aftercircular.db` persistence | 🧪 | cents |
| Application Insights (Log Analytics) | traces, dependencies, logs (tokens/cost per call) | 🧪 wired via `azure-monitor-opentelemetry` | free tier 5 GB/mo |
| Azure Functions (Flex Consumption) | timer → `/api/scheduled-scan` | 🧪 code in `backend/functions/` | free grant |
| Key Vault | BACKEND_API_KEY, TYPESAFE_API_KEY, GITHUB_TOKEN references | 🧪 documented | cents |
| Managed identity + RBAC | Container App → Foundry (`Cognitive Services OpenAI User`), Search (`Search Index Data Contributor`, `Search Service Contributor`) | 🧪 documented | free |

Deliberately **not** used: AKS, Service Bus, Event Grid, Redis, Cosmos DB, PostgreSQL, multi-region (§38 of the brief; §16 ADR-6).

## 4. Microsoft Foundry

**Current deployment (2026-09-21): `gpt-5-mini`** (Global Standard, Korea Central) for extraction, impact reasoning and memo —
one deployment, three logical tasks, selected by `EXTRACTION_MODEL` / `IMPACT_MODEL` / `MEMO_MODEL`. Chosen because it is the
smallest current model with strict structured outputs and quota on this subscription. **GPT-5.6-Luna is planned but not deployed:
the subscription shows 0 TPM quota for it.** Switching is configuration only (`*_MODEL=<new deployment name>`); the provider
already omits `temperature` for reasoning-family deployments. Observed: gpt-5-mini spends 2–4× its input in output (reasoning)
tokens and takes 18–30 s per call; a one-document scan is ~1–2 minutes.

- **API**: Azure OpenAI **v1 API** (GA) at `https://<resource>.openai.azure.com/openai/v1/` (or `.services.ai.azure.com`) with the
  standard `openai` Python SDK (installed: **3.16.2**) — no `api-version`. **Responses API** (`client.responses.parse`) with
  `text_format=<Pydantic model>` → the SDK emits a **strict JSON Schema** (`to_strict_json_schema`) for the API boundary. Verified
  offline that `ExtractionResult`, `ImpactAnalysis`, `Memo` convert to strict schemas. If the service rejects a schema (400), the
  provider falls back **once, per schema** to JSON-object mode with the schema in the prompt + one repair attempt, and records
  `structured_mode=json_object`. `FOUNDRY_API=chat` switches to `chat.completions.parse` on the same v1 endpoint.
- **Auth**: `FOUNDRY_API_KEY` for local dev; empty key → `DefaultAzureCredential` bearer-token provider (managed identity in Azure,
  `az login` locally). Scope `https://cognitiveservices.azure.com/.default`.
- **Deployments**: names come only from `EXTRACTION_MODEL`, `IMPACT_MODEL`, `MEMO_MODEL`, `EMBEDDING_MODEL`. Nothing is hardcoded.
  Recommended for credits: extraction + memo on a mini model (`gpt-4.1-mini` or `gpt-4o-mini`), escalation on `gpt-4.1`/`gpt-4o`
  (it is reached only for cases Jev cannot settle), `text-embedding-3-small` (1536 dims, matches the Search index).
- **Prompt caching**: stable content first (`instructions` = system rules + schema; dynamic circular/evidence in `input`). Cached
  tokens are read from `usage.input_tokens_details.cached_tokens` and stored per call. Savings are **NOT VERIFIED** until live.
- **Bounded retries**: SDK `max_retries=AFTERCIRCULAR_MAX_RETRIES` (2) with exponential backoff; structured repair = 1 attempt; timeout 90 s.
- **Concurrency**: `asyncio.Semaphore(AFTERCIRCULAR_MAX_CONCURRENT_CALLS)` (2).
- **Fail-safe**: `AI_PROVIDER=foundry` with an empty endpoint raises in `demo`/`production`; the fixture stub is allowed only in `dev` and
  is labelled `provider=stub` on every record and in `/health`.

## 5. Azure AI Search

- **One index per environment** (`AZURE_SEARCH_INDEX=policies-dev`); tenants isolated by the filterable `tenant_id` field —
  every query and readiness check carries `tenant_id eq '<tenant>' and status eq 'active'`. Schema: `docs/azure/policies-dev.index.json`
  (= `index_definition()` in code, asserted equal by a test). The app validates an existing index and never rewrites it.
- Fields: `id` (key), `tenant_id`, `doc_id`, `title`(searchable), `category`, `path`, `version`, `effective_date`(DateTimeOffset),
  `status` (`active`/`retired`), `section`, `regulator`, `jurisdiction`, `topics`, `commit_sha`, `chunk_hash`, `text` (`en.microsoft`),
  `vector` (`EMBEDDING_DIMENSIONS`=1536, HNSW cosine). Removed repository chunks are retired, not deleted; unchanged chunks
  (same `chunk_hash`) reuse the vector cached in SQLite — no re-embedding.
- **Hybrid** = `search_text` (BM25) + `vector_queries` (HNSW) in one request → the service fuses with **RRF**. `top=10`, then the
  decision layer reranks with Jev and `budget_chunks` dedupes and enforces `MAX_POLICY_CHUNKS=8` / `MAX_EVIDENCE_TOKENS=3000`.
- **Semantic ranker** (L2): opt-in via `AZURE_SEARCH_SEMANTIC_CONFIG` (adds a semantic configuration on `title`/`text`). Off by default:
  billed per query and not yet measured to help on a 40-chunk corpus.
- Re-indexing happens only when the repository head SHA changes (`policy_index_meta.commit_sha`) — embeddings are never regenerated
  for an unchanged corpus.
- Auth: key, or `DefaultAzureCredential` when the key is empty.
- Local fallback: `LocalRetriever` (in-process BM25 + cosine) is what runs today; `/health.retrieval` states which one is active.

## 6. Jev / System-1

- SDK `typesafe-sdk` 0.7.0, `POST /v1/systemone`, model `jev-latest` (**live: `jev-1.13.0`**).
- Narrow typed questions only (Noul / Choice / Score): **triage before extraction** (header + company profile; certain
  NOT_APPLICABLE archives with no Foundry call, uncertain proceeds; skipped by a free prefilter when the addressee names the
  company's own entity type), extraction check, applicability (skipped when triage was ≥ 0.90 confident), relevance rerank,
  alignment per (obligation, chunk), citation verification, **cross-check of the reasoning model's conclusion after escalation**
  (disagreement → human), and intent routing for `/api/ask`. Thresholds live in `app/decisions/policy.py`; the Noul band
  0.30–0.70 is *uncertain*, never rounded.
- **State is sent as a JSON dict** — the API accepts `str | dict | list`, and the questions reference paths such as
  `obligations[i].requirement`, so JSON is the correct representation at this boundary. TOON is **not** used for Jev (see §7).
- Calibration: probabilities are calibrated by the provider; the Foundry emulation (`FoundryJudgmentProvider`) is labelled
  `calibrated=False` and is the documented fallback when Jev is unavailable and Foundry is configured. Fixtures are never used
  outside `ENVIRONMENT=dev`.
- Retries: `RetryPolicy(max_retries=AFTERCIRCULAR_MAX_RETRIES)`.
- ✅ **Verified live 2026-09-21** (`scripts/live_check.py jev`): applicability Choice `applies` p=0.99, `entity_in_scope` Noul 0.99,
  latency 1106 ms, 899 input / 122 output tokens, `calibrated=True`.

### Ask AfterCircular (workspace Q&A) — what is real
Jev returns typed judgments, not prose, so the split is: **Jev routes** (intent, targets, follow-up, action request, answerable —
one request) and **Jev judges** the selected records (relevance, action needed, urgency Score, evidence support, sufficiency —
one request); **Foundry `gpt-5-mini` writes** the sentences under a strict schema where every claim carries a record id and
evidence ids that **code validates against the context** (unknown ids are dropped and counted); when no narrative model is
available the sentences are composed from the judgments and the answer says so. Deterministic questions (counts, lists, scan
status, approvals) are answered from records and labelled "Workspace data". Action requests are refused — the review screen is
the only path to a GitHub issue. Follow-ups share a `conversation_id`; the previous turns and the records they cited are fed
back as bounded context. Every answer stores the Jev route/judgment telemetry (model, latency, tokens) and the narrative
call's telemetry (also in `llm_calls`, task `ask`), and the UI prints them — "Not recorded" when absent, never a placeholder.
The context builder (`services/ask_context.py`) caps records (8), obligations (6), evidence (4 each) and text length.
Verified live 2026-09-21 with the 10-question set (`evals/results/ask_smartness.json`): 7 reasoning answers grounded in
D-ids with quoted evidence, 3 deterministic, 1 refusal; the "latest live circular" answer correctly said the workspace only
holds that circular's header because triage archived it without extraction.

## 7. TOON Token Optimization

### Why TOON?
JSON repeats every key for every record. AfterCircular's prompts are dominated by *repeated uniform records*: obligations,
retrieved policy chunks, evidence pairs. TOON (Token-Oriented Object Notation, spec at toonformat.dev) writes the header once and
one row per record, and round-trips losslessly.

### Implementation actually used
`toon-format` **0.9.0b1** (official Python implementation, github.com/toon-format/toon-python) — `encode`/`decode`. The
version on PyPI tagged 0.1.0 is older; the beta is the spec-tracking one. Wrapped in `backend/app/toon.py`:
`format_context()` (typed → TOON, round-trip check, one-shot fallback to compact JSON with `TOON_FALLBACK` logged),
`validate_toon()` (TOON → Pydantic), `compare()` / `count_tokens()` (tiktoken `o200k_base`).

### Where TOON is used
| Boundary | Format | Why |
|---|---|---|
| Foundry **impact escalation** prompt: obligations table + policy excerpts (`app/agents/impact_analysis.py`) | **TOON** | repeated uniform records |
| Foundry **memo** prompt: evidence lists + affected policy text (`app/agents/memo_generation.py`) | **TOON** | repeated uniform records |
| Telemetry | `llm_calls.context_format` = `toon` / `json` / `mixed` per call | measured, not assumed |

### Where JSON remains required
| Boundary | Format | Why |
|---|---|---|
| Foundry **structured output** | JSON Schema (strict) | the API takes a JSON Schema; output is JSON |
| Jev `state` | JSON dict | API contract; questions address JSON paths |
| Azure AI Search documents / queries | JSON | REST contract |
| GitHub issue body | Markdown/JSON API | API contract |
| SQLite columns (`extraction`, `impact`, `memo`, `decisions`) | JSON | queryable, typed on read |
| Web ↔ backend | JSON | REST contract |
| Extraction prompt | plain circular text | no repeated structure; nothing to gain |

### Adapter architecture
```
Pydantic model ──model_dump──► plain dict ──toon_format.encode──► TOON text ──► prompt (context)
                                    └──json.dumps(separators)──► compact JSON (fallback / boundary)
TOON text ──toon_format.decode──► dict ──Model.model_validate──► typed object (validate_toon)
```
Validation: every context block is decoded again and compared to the source object before it is used (`format_context`).
Fallback: on any encoder/round-trip failure → compact JSON once, `fallback=True`, warning `TOON_FALLBACK`. No retry loop.

### Benchmark — measured (`uv run python -m evals.toon_benchmark`, tokenizer o200k_base, fixed local data, 2026-09-21)

| Payload | Pretty JSON | Compact JSON | Legacy text¹ | TOON | vs compact | vs pretty | vs legacy | Round-trip |
|---|---:|---:|---:|---:|---:|---:|---:|:--:|
| 5 obligations | 557 | 448 | 413 | 398 | 11.2% | 28.5% | 3.6% | ✓ |
| 10 obligations | 1075 | 860 | 794 | 746 | 13.3% | 30.6% | 6.0% | ✓ |
| 20 policy chunks | 2253 | 1891 | 1698 | 1674 | 11.5% | 25.7% | 1.4% | ✓ |
| company profile | 109 | 70 | — | 68 | 2.9% | 37.6% | — | ✓ |
| impact evidence | 179 | 138 | — | 132 | 4.3% | 26.3% | — | ✓ |
| impact prompt context (10 obligations + 8 chunks) | 1868 | 1510 | 1379 | 1316 | 12.8% | 29.6% | 4.6% | ✓ |

¹ the hand-written numbered-line format the agents used before TOON. Output tokens, latency, accuracy and cost against a live
model: **NOT VERIFIED** — `scripts/live_check.py toon-live` runs the identical impact payload as TOON and compact JSON (2 calls)
once a Foundry deployment exists, and writes `evals/results/toon_live.json`.

### Decision
- TOON **is** used for repeated structured context in the two Foundry reasoning prompts: **11–13 % fewer input tokens than compact
  JSON, ~30 % fewer than pretty JSON**, lossless round-trip on all payloads. Against the previous bespoke text format the saving is
  small (1–6 %); the real gain is a *standard, parseable, validated* representation instead of ad-hoc prose, at no token cost.
- TOON is **not** used for single objects (company profile: 2.9 %), for Jev state, or at any API boundary that specifies JSON.
- Free-text values (verbatim clauses) dominate these payloads, so the ceiling for any structural format is modest; the larger
  levers are the ones in §8.

## 8. Token & Cost Optimization

### Application cost circuit breakers (not Azure billing limits)
`AFTERCIRCULAR_MAX_ESTIMATED_COST_PER_SCAN_USD=0.50` and `AFTERCIRCULAR_MAX_ESTIMATED_COST_PER_DAY_USD=5.00` (0 disables). `CallBudget`
checks *before* each generative call: calls ≥ `MAX_LLM_CALLS_PER_SCAN`, or estimated scan spend ≥ scan limit, or spend today
(all tenants) ≥ daily limit → `BudgetExceeded` with reason `BUDGET_EXCEEDED:calls|scan_cost|daily_cost`; the document is marked
FAILED (retryable), a `BUDGET_EXCEEDED` audit event is written, no memo/review/ticket follows. A day already at the limit refuses
the scan before any call. Unknown-priced models add $0 and are counted (`unknown_pricing_calls`). Tested for below/at/above,
unknown pricing, repair attempts, multiple stages, concurrency, and both pipeline-level paths.

### Usage telemetry
`GET /api/usage?period=today|all[&scan_id=]` (tenant-scoped, Bearer + tenant headers): per-model requests, input/output/cached
tokens, estimated cost, avg latency, errors, retried, TOON calls, `pricing_status`; latest-scan spend; budgets and remaining.
Rendered on the dashboard **Models** page (values only from the backend; "Not available" otherwise).

### Pricing status
`DEFAULT_PRICING` (and `evals/pricing.json`) hold a **list-price snapshot as known to this repository — unverified against the
subscription's price sheet**. Every call records `pricing_status = estimate | unknown`; a model without a price gets
`estimated_cost_usd = null`, never a guess. Override with `MODEL_PRICING_JSON`. gpt-5-mini is mapped (0.25 / 0.025 / 2.00 per 1M).

### Cost report (2026-09-21, before any provisioning)

Resource status: every row **UNKNOWN** until discovery (§12). Price classes below use `DEFAULT_PRICING` in
`backend/app/models/provider.py` — a list-price snapshot **as known to this code, not verified against your subscription's price
sheet**: treat every $ figure as **ESTIMATE** until checked on the Azure pricing page for your region.

| Item | Class | Basis | Figure |
|---|---|---|---|
| One document, extraction (mini model) | ESTIMATE | ~4–6k input (circular + schema), ~1–2k output at gpt-4.1-mini list price | ≈ $0.004–0.006 |
| One document, Jev judgments (3–8 requests) | MEASURED earlier in project | ~$0.001/case observed on the golden set | ≈ $0.001 |
| One document, Foundry escalation (only when Jev is uncertain) | ESTIMATE | ~1.5–2.5k input (TOON context) + ~1k output at gpt-4.1 list price | ≈ $0.01–0.015, often $0 |
| One document, memo (CONFLICT only) | ESTIMATE | ~2k input + ~0.8k output at gpt-4.1-mini | ≈ $0.002 |
| Embeddings: query + first corpus index (~40 chunks, ~8k tokens) | ESTIMATE | text-embedding-3-small $0.02/1M | < $0.001; re-index only on repo change |
| **One scan (1 document, dev limits)** | ESTIMATE | sum, ≤ 10 model calls by budget | **≈ $0.01–0.03** |
| Azure AI Search Free (F) | FREE | if the subscription still offers it | $0 |
| Azure AI Search Basic | FIXED | always-on hourly billing; exact monthly figure | UNKNOWN — check pricing page for your region |
| Application Insights | FREE up to 5 GB/mo | demo telemetry is KB | $0 |
| Container Apps (1 replica, consumption) + Azure Files | ESTIMATE | idle-scaled; only if hosted in Azure | low single-digit $/mo — UNKNOWN exact |
| Key Vault | FIXED (per operation) | a few hundred reads | cents |
| Azure Functions Flex Consumption timer | FREE grant | one tick/day | $0 |
| **One month demo (local backend, Search Free, ~30 bounded scans)** | ESTIMATE | 30 × $0.03 upper bound | **< $1 in model tokens** |
| **One month demo (hosted, Search Basic)** | ESTIMATE + UNKNOWN | tokens < $1 + Search Basic (UNKNOWN) + Container Apps (UNKNOWN) | dominated by Search Basic |

What to check to remove UNKNOWN: Azure AI Search Basic hourly price and Free-tier availability for the subscription; Container Apps
consumption price in the chosen region; the model list prices for the deployments you actually have.

| Lever | Mechanism | Status |
|---|---|---|
| Idempotency | `document_id + content_hash + status + analysis_id`; processed docs skipped, no model call | ✅ tests |
| Bounded scan | `AFTERCIRCULAR_MAX_DOCUMENTS_PER_SCAN=1` (dev); extra new docs are *deferred*, not inserted | ✅ tests |
| Call budget | `CallBudget` per scan via contextvar; `BudgetExceeded` stops the scan (`AFTERCIRCULAR_MAX_LLM_CALLS_PER_SCAN=10`) | ✅ tests |
| Retries | SDK max 2 + backoff; structured repair 1; Jev 2 | ✅ config |
| Concurrency | semaphore 2 | ✅ |
| Deterministic early exits | no obligations → ARCHIVED without judgments; Jev decides most cases; Foundry reasoning only on escalation | ✅ |
| No memo for NOT_APPLICABLE / ALIGNED | gate in `pipeline.process` | ✅ tests |
| Retrieval limits | top-k 10 → Jev rerank keep 5 → `MAX_POLICY_CHUNKS` 8, dedupe, `MAX_EVIDENCE_TOKENS` 3000, never cut inside a chunk | ✅ tests |
| TOON context | §7 | ✅ measured locally |
| Prompt caching | stable instructions first; `cached_tokens` recorded | 🧪 needs live calls |
| Model routing | cheap deployment for extraction/memo, reasoning deployment only on escalation | 🧪 needs deployments |
| Embeddings | regenerated only on repository head change | ✅ |
| Scheduled scan | disabled until manual live tests pass | ✅ 409 when disabled |
| Cost telemetry | `estimated_cost_usd` per call from a list-price table (override `MODEL_PRICING_JSON`) — an estimate, labelled | ✅ |

## 9. Security

- Secrets only in `backend/.env` / `web/.env.local` (git-ignored) locally; Key Vault references in Azure. **No secret in this file.**
- Azure auth: managed identity + `DefaultAzureCredential` + RBAC for Foundry and Search; API keys only for local dev.
- GitHub user token: encrypted JWT server-side, forwarded backend-to-backend in a header, never in the browser.
- Backend API key: `Authorization: Bearer` on every route; tenant identity from headers set by the trusted frontend.
- Circular text is untrusted input: the extraction prompt says so; models only extract from it.
- Logs: no secrets, no full policy text; the App Insights exporter receives structured token/cost fields, not prompts.
- ⚠ The GitHub OAuth client secret was pasted into chat earlier in this project — **rotate it before the demo** (GitHub → Developer
  settings → OAuth App → "Generate a new client secret"), then update `web/.env.local`.

## 10. Responsible AI

- Human-in-the-loop by construction: the only external side effect (GitHub issue) is behind `POST /reviews/{id}/approve`.
- Evidence or nothing: obligations carry verbatim excerpts + clause; a CONFLICT must cite both sides; a citation check (Jev) and a
  verbatim string check in code run before a conflict is shown.
- Uncertainty is a first-class outcome: `NEEDS_INVESTIGATION` routes to a person; Noul band never rounded.
- Transparency: every record shows provider, model, calibrated flag, decision path, `LIVE` vs `DEMO_SNAPSHOT` (fictional data is
  labelled in the UI and in the data itself).
- Drafts are labelled "AI-generated draft — human review required" and are never presented as approved.
- No silent degradation: stub outputs are impossible outside `dev`; failures say which provider failed.

## 11. AI-103 Mapping

| AI-103 area | AfterCircular |
|---|---|
| Plan and manage an Azure AI solution | this document; environments dev/demo/production; cost guardrails; RBAC |
| Generative AI with Microsoft Foundry | Responses API, structured outputs, deployments per task, prompt caching telemetry |
| Retrieval-augmented generation | Azure AI Search hybrid (BM25 + vector + RRF), per-tenant indexes, evidence budgets |
| Agents / orchestration | deterministic pipeline + typed judgments + escalation + human approval + tool (GitHub) |
| Responsible AI | §10 |
| Evaluation | `evals/` (golden scenarios, judge calibration), TOON benchmark, live checks with recorded telemetry |
| Monitoring | Application Insights via OpenTelemetry distro; per-call token/cost/format telemetry in SQLite |
| Security | §9 |

## 12. Azure Resources

### Discovery log

| Date | Method | Result |
|---|---|---|
| 2026-09-21 (phase 1) | MCP tool search for "azure / foundry / subscription / resource" | **no Azure MCP** — servers present: Canva, Claude Docs, Eraser, Gmail, Google Calendar/Drive, Notion, Figma, shadcn, agentation |
| 2026-09-21 (phase 2) | `which az azd`, `~/.azure`, `AZURE_*`/`ARM_*` env, `backend/.env` keys | `az` and `azd` **not installed**; no `~/.azure`; no Azure variables set anywhere |
| 2026-09-21 (phase 2) | `DefaultAzureCredential(...).get_token(management.azure.com)` — zero-cost probe | `ClientAuthenticationError`: no environment, CLI, PowerShell, azd, or broker credential on this machine |

**Conclusion: discovery is BLOCKED.** Nothing in Azure can be listed or inspected from this machine today, so the inventory below
is **UNKNOWN**, not "none". No resource was created, changed, or deleted. Zero model calls were made. Not installed: `azure-cli`
(a large Homebrew package) — needs your approval, then `az login` needs you.

### Inventory — reported by the owner (portal, 2026-09-21); not yet inspected from this machine

| Resource | Name | Region | Notes |
|---|---|---|---|
| Resource group | `rg-aftercircular-dev` | Korea Central | |
| Foundry resource / project | `aif-aftercircular-dev` / `proj-aftercircular-dev` | Korea Central | chat deployment: **not yet reported** |
| Embedding deployment | `text-embedding-3-small` (Global Standard, v1, 500K TPM) | Korea Central | 1536 dims |
| Azure AI Search | `srch-aftercircular-dev`, **Free**, 1 replica / 1 partition, `https://srch-aftercircular-dev.search.windows.net` | Korea Central | RBAC: owner has Search Index Data Contributor |
| Search index | `policies-dev` — created from `docs/azure/policies-dev.index.json` | | shared, `tenant_id` filter |

### Inventory template (read-only discovery after `az login`)

| Resource | Status | Name | Region | SKU | Endpoint | Reusable | Ongoing cost | Needed |
|---|---|---|---|---|---|---|---|---|
| Subscription / tenant | UNKNOWN | | | | | | | yes |
| Resource group | UNKNOWN | | | | | | | yes |
| Foundry / Azure OpenAI resource | UNKNOWN | | | | | | pay-per-token | yes |
| Model deployments | UNKNOWN | | | | | | pay-per-token | yes (1 chat + 1 embedding minimum) |
| Azure AI Search | UNKNOWN | | | | | | Free: none · Basic+: always-on | yes |
| Storage account | UNKNOWN | | | | | | cents | only for Container Apps volume |
| Key Vault | UNKNOWN | | | | | | cents | only for Azure hosting |
| Application Insights | UNKNOWN | | | | | | 5 GB/mo free | optional |
| Container Apps / App Service / Functions | UNKNOWN | | | | | | consumption | only for Azure hosting |

Read-only discovery commands (no cost, run after login — I will run these, they change nothing):
```bash
az account show; az account list -o table
az group list -o table
az cognitiveservices account list -o table                                   # Foundry / Azure OpenAI resources
az cognitiveservices account deployment list -g <rg> -n <name> -o table       # model deployments
az cognitiveservices usage list -l <region> -o table                          # quota
az search service list -o table
az storage account list -o table; az keyvault list -o table
az monitor app-insights component show --app <name> -g <rg> 2>/dev/null; az resource list --resource-type microsoft.insights/components -o table
az containerapp list -o table; az functionapp list -o table; az webapp list -o table
```

Target (minimum) — to be created by the human in §13, all in one resource group `rg-aftercircular`, one region (e.g. `swedencentral`
or `eastus2`, whichever has quota for the chosen models):

| Resource | Name (suggested) | SKU | Notes |
|---|---|---|---|
| Azure OpenAI / Foundry resource | `aoai-aftercircular` | S0 | deployments: `gpt-4.1-mini` (extraction, memo), `gpt-4.1` (escalation), `text-embedding-3-small` |
| Azure AI Search | `srch-aftercircular` | **Free (F)** if available in the subscription (one per subscription), else Basic | Free has 50 MB / 3 indexes — enough for 2 demo tenants |
| Log Analytics + Application Insights | `appi-aftercircular` | pay-as-you-go | 5 GB/mo free |
| Storage account | `staftercircular` | Standard LRS | Azure Files share `data` (SQLite) |
| Container Apps environment + app | `ca-aftercircular-api` | consumption, min 0/1 replica | image from `backend/Dockerfile` |
| Key Vault | `kv-aftercircular` | standard | secrets → Container App references |
| Function App | `func-aftercircular` | Flex Consumption | only after §14 step 8 |

## 13. Human Azure Actions

**Next action (unblocks discovery, costs nothing):**
1. Approve installing the Azure CLI (`brew install azure-cli`, ~500 MB) — or install it yourself.
2. Run `az login` in a terminal on this machine (interactive browser sign-in; I cannot do it). If you have several subscriptions,
   `az account set --subscription <the one with credits>`.
3. Say "discovery" — I will run only the read-only commands in §12 and fill the inventory before proposing anything.

Provisioning steps below are the *proposal* for what is missing; none of it runs without your explicit approval per resource.

These need your Azure account; I cannot and did not run them. Costs: Foundry is per token (the guardrails keep a scan at ≤ 10 calls);
**Azure AI Search Basic is the one always-on charge** — use the **Free** tier if your subscription still has it.

1. Install the CLI and log in: `brew install azure-cli && az login` (then tell me — I can inspect and script the rest read-only first).
2. Create the resource group and the Foundry resource; deploy three models. In the portal (Foundry → Deployments) or:
   ```bash
   az group create -n rg-aftercircular -l swedencentral
   az cognitiveservices account create -n aoai-aftercircular -g rg-aftercircular -l swedencentral --kind OpenAI --sku S0 --custom-domain aoai-aftercircular
   az cognitiveservices account deployment create -g rg-aftercircular -n aoai-aftercircular --deployment-name gpt-4.1-mini --model-name gpt-4.1-mini --model-version 2025-04-14 --model-format OpenAI --sku-name GlobalStandard --sku-capacity 10
   az cognitiveservices account deployment create -g rg-aftercircular -n aoai-aftercircular --deployment-name gpt-4.1 --model-name gpt-4.1 --model-version 2025-04-14 --model-format OpenAI --sku-name GlobalStandard --sku-capacity 10
   az cognitiveservices account deployment create -g rg-aftercircular -n aoai-aftercircular --deployment-name text-embedding-3-small --model-name text-embedding-3-small --model-version 1 --model-format OpenAI --sku-name Standard --sku-capacity 10
   ```
   (Model versions/regions vary by subscription — pick what the portal offers; the deployment *names* are what go in `.env`.)
3. Put into `backend/.env`: `FOUNDRY_ENDPOINT=https://aoai-aftercircular.openai.azure.com`, `FOUNDRY_API_KEY=<key1>` (local only),
   `EXTRACTION_MODEL=gpt-4.1-mini`, `MEMO_MODEL=gpt-4.1-mini`, `IMPACT_MODEL=gpt-4.1`, `EMBEDDING_MODEL=text-embedding-3-small`.
4. Create Search (Free if possible): `az search service create -n srch-aftercircular -g rg-aftercircular --sku free -l swedencentral`
   then `AZURE_SEARCH_ENDPOINT=https://srch-aftercircular.search.windows.net`, `AZURE_SEARCH_API_KEY=<admin key>`.
5. (Optional, for §24 observability) `az monitor app-insights component create --app appi-aftercircular -g rg-aftercircular -l swedencentral`
   → `APPLICATIONINSIGHTS_CONNECTION_STRING=…`.
6. Then run the staged tests in §14 **one at a time** and paste the outputs here (§15).

Deployment to Container Apps / Functions (§14 steps 9–10) is a second phase, after the live pipeline passes locally.

## 14. Deployment Runbook

Local, staged (each step is one bounded call; stop on the first failure, diagnose, do not loop):

| # | Test | Command | Calls |
|---|---|---|---|
| 0 | static/unit | `cd backend && uv run pytest -q && uv run mypy app` | 0 |
| 1 | Foundry smoke | `uv run python scripts/live_check.py smoke` | 1 |
| 2 | extraction | `uv run python scripts/live_check.py extract` | 1 |
| 2b | embedding | `uv run python scripts/live_check.py embed` | 1 |
| 3 | Search index + hybrid query | `uv run python scripts/live_check.py search` | 1 embed batch + 1 query embed + 1 search |
| 4 | Jev | `uv run python scripts/live_check.py jev` | 1 (✅ done) |
| 5 | impact reasoning (TOON) | `uv run python scripts/live_check.py impact` | 1 |
| 6 | memo | `uv run python scripts/live_check.py memo` | 1 |
| 7 | full pipeline, 1 document | start API with `AFTERCIRCULAR_MAX_DOCUMENTS_PER_SCAN=1`, click **Scan now** in the UI (Acme tenant) | ≤ 10 |
| 8 | approval | Reviews → Approve in the UI | 0 |
| 9 | GitHub issue | check the repository issue with `AfterCircular-Analysis-ID` | 0 |
| 10 | idempotency | **Scan now** again → `skipped_documents=1`, `llm_calls=0`, no new issue | 0 |
| 11 | TOON benchmark | `uv run python -m evals.toon_benchmark` (✅ done) and `scripts/live_check.py toon-live` | 0 / 2 |

Azure (phase 2, after 1–10 pass):
```bash
az acr create -n acraftercircular -g rg-aftercircular --sku Basic && az acr build -r acraftercircular -t aftercircular-api:1 backend/
az storage account create -n staftercircular -g rg-aftercircular --sku Standard_LRS && az storage share-rm create --storage-account staftercircular -n data
az containerapp env create -n cae-aftercircular -g rg-aftercircular -l swedencentral
az containerapp env storage set -n cae-aftercircular -g rg-aftercircular --storage-name data --azure-file-account-name staftercircular --azure-file-account-key <key> --azure-file-share-name data --access-mode ReadWrite
az containerapp create -n ca-aftercircular-api -g rg-aftercircular --environment cae-aftercircular --image acraftercircular.azurecr.io/aftercircular-api:1 \
  --registry-server acraftercircular.azurecr.io --system-assigned --min-replicas 1 --max-replicas 1 --target-port 8000 --ingress external \
  --env-vars AI_PROVIDER=foundry FOUNDRY_ENDPOINT=... ENVIRONMENT=demo AFTERCIRCULAR_MAX_DOCUMENTS_PER_SCAN=1 ...   # secrets via --secrets / Key Vault refs
# mount: az containerapp update ... --yaml (volume "data" → /data)
# RBAC for the app's identity:
az role assignment create --assignee <principalId> --role "Cognitive Services OpenAI User" --scope <aoai resource id>
az role assignment create --assignee <principalId> --role "Search Index Data Contributor" --scope <search resource id>
az role assignment create --assignee <principalId> --role "Search Service Contributor" --scope <search resource id>
```
Web: set `BACKEND_URL` to the Container App FQDN and deploy `web/` (Vercel or Static Web Apps hybrid) — out of the backend scope.

## 15. Verification Evidence

| Item | Evidence | Status |
|---|---|---|
| Unit/static | `38 passed, 1 skipped`; `mypy: Success: no issues found in 50 source files` (2026-09-21) | ✅ |
| Strict schema conversion | `to_strict_json_schema` OK for ExtractionResult (2159 chars), ImpactAnalysis (2193), Memo (853) | ✅ offline |
| TOON round-trip + tokens | table in §7, `backend/evals/results/toon_benchmark.json` | ✅ |
| Jev live | §6 (jev-1.13.0, p=0.99, 1106 ms) | ✅ |
| Foundry smoke / extraction / impact / memo | ✅ 2026-09-21, deployment `gpt-5-mini` (Global Standard, Korea Central), Entra auth, `structured_mode=json_schema` on all four. smoke 63 in / 102 out, 7.5 s; extraction 1236 in / 3969 out, 29.9 s, 8 obligations, est. $0.008; impact (TOON context) 1436 in / 1616 out, 17.7 s, YES/CONFLICT, est. $0.0036; memo (TOON) 869 in / 3647 out, 30.1 s, est. $0.0075. cached_tokens 0 (prefixes < 1024 tokens, as predicted). | ✅ |
| Azure AI Search hybrid | ✅ 2026-09-21: `policies-dev`, Entra auth, 82 chunks upserted (tenant_id=live-check, 1536-d vectors), hybrid query 271 ms → POL-001 §4.1 first; second run reused readiness | ✅ |
| Prompt caching effect | measured 0 cached tokens on all four calls — the stable prefixes are below the 1024-token minimum; no saving to claim | ✅ measured |
| End-to-end (live Foundry + Search + Jev) | ✅ 2026-09-21 `evals/results/live_e2e.{json,md}`: 3 snapshot documents, 1 forced scan (Acme tenant) — 4 Foundry calls, 4,432 in / 11,571 out tokens, 0 cached, est. $0.0243, 42 Jev decision records, 82 chunks in `policies-dev`, avg Foundry latency 22.8 s, 0 retries/errors. DEMO-014 → YES/CONFLICT POL-001 (memo, review already approved → idempotent); DEMO-016 → archived at **triage** with 0 Foundry calls; DEMO-015 → YES/CONFLICT POL-001 §8 (golden label said ALIGNED — a defensible two-sided finding, now AWAITING_REVIEW; reported as a mismatch, label unchanged). Repeat scan: 0 new, 3 skipped, 0 calls. Approval/GitHub not exercised live (mocked in tests; manual step). | ✅ 3/4 live cases |
| Idempotency | live repeat scan 2026-09-21: `new=0, skipped=3, llm_calls=0`; existing approved review not re-opened | ✅ |
| Live SEBI source | ✅ 2026-09-21 `scripts/live_check.py sebi`: listing 25 circulars (606 ms); circular 104387 "Review of Position Limits … Commodity Derivatives Segment" (Sep 09, 2026, ref HO/47/16/13(5)2026-MRD-POD1/I/20735/2026), PDF 328,567 bytes, 6,748 chars, `source_mode=LIVE`, `synthetic=false`. Full pipeline on it (Acme tenant): connect LIVE_SUCCESS → detect 1 new → **Jev triage archived it as NOT_APPLICABLE** (addressed to commodity-derivatives exchanges; P(concerns)=0.01) with **0 Foundry calls**; repeat scan `LIVE_NO_NEW_DOCUMENTS`, 0 new / 1 skipped / 0 calls. | ✅ |
| App Insights | exporter configured in code only | 🧪 |
| Scheduled scan | `/api/scheduled-scan` returns 409 when disabled (default) | ✅ code |

## 16. Architecture Decision Records

- **ADR-1 Foundry via the v1 Responses API with strict structured outputs.** Current GA surface, no api-version churn, native JSON
  Schema enforcement, prompt-cache fields in `usage`. Chat completions kept as a config switch. *Alternative rejected*: the
  Azure AI Inference SDK (older surface).
- **ADR-2 TOON at the context layer only** (§7). JSON Schema at the output boundary; JSON for Jev state. Measured, not assumed.
- **ADR-3 Jev stays the decision primitive**; Foundry reasoning is an escalation rung; fixtures are dev-only. No silent fallback.
- **ADR-4 SQLite on Azure Files instead of PostgreSQL.** Single replica, tiny dataset, cents/month; the schema is plain SQL so a
  move to Azure Database for PostgreSQL Flexible Server is a driver swap when multi-replica is needed. Not justified now.
- **ADR-5 Azure AI Search Free/Basic, one index per tenant, semantic ranker off.** RRF hybrid is included; semantic L2 is per-query
  billing with no measured benefit on a 40-chunk corpus.
- **ADR-6 No AKS/Service Bus/Event Grid/Redis/Cosmos.** A timer → HTTP call to the same service is the whole scheduler.
- **ADR-7 Scheduled scans run through `/api/scheduled-scan`,** which is a 409 no-op until explicitly enabled and needs a server-side
  GitHub token — enabling the Function alone cannot spend credits.
- **ADR-8 Cost guardrails are configuration, enforced in code** (`CallBudget`, `max_documents_per_scan`, semaphore, bounded retries).
- **ADR-9 Estimated cost uses a list-price table** (`DEFAULT_PRICING`, override `MODEL_PRICING_JSON`) and is labelled an estimate.

## 17. Presentation Explanation

- **WHAT** — a regulatory-change-to-action system: SEBI circular in, reviewed policy-change issue out, human in between.
- **WHY** — compliance teams miss or mis-scope circulars; the expensive part is deciding *applies / conflicts / where*.
- **HOW** — deterministic pipeline; models only extract, judge and draft; code owns state, thresholds, approval, side effects.
- **WHY AZURE** — one tenant boundary for models, search, identity, monitoring; managed identity removes secrets from the app.
- **WHY FOUNDRY** — deployment-per-task routing, strict structured outputs, prompt caching, token telemetry in every response.
- **WHY AZURE AI SEARCH** — hybrid BM25 + vector with RRF built in; per-tenant indexes; nothing to operate.
- **WHY JEV** — typed questions with *calibrated* probabilities are cheaper and more auditable than "ask GPT to classify";
  thresholds become constants, not prompt tweaks.
- **WHY TOON** — the prompts are tables of records; TOON writes the header once. Measured 11–13 % fewer input tokens than compact JSON.
- **WHY NOT JSON EVERYWHERE / WHEN JSON STAYS** — Foundry structured output, Jev state, Search, GitHub and the database are JSON
  contracts; forcing TOON there would break correctness for a few percent of tokens.
- **WHY HUMAN APPROVAL** — a policy issue in a company repository is consequential; the AI drafts, a person decides.
- **HALLUCINATION CONTROL** — verbatim evidence required, string-checked in code, citation-checked by Jev; no evidence → UNCERTAIN → human.
- **COST CONTROL** — idempotency, 1 document per dev scan, ≤ 10 calls per scan, no memo unless CONFLICT, bounded retries, cheap
  model first, reasoning model only on escalation.
- **HOW TOON REDUCES TOKENS / MEASURED SAVINGS** — §7 table: 448 → 398 (5 obligations), 1510 → 1316 (impact context).
- **UNCERTAIN AI** — `NEEDS_INVESTIGATION`, shown as such, never archived silently (archiving needs p ≥ 0.80).
- **SECURITY** — §9. **MONITORING** — App Insights + `llm_calls`. **EVALUATION** — golden scenarios, judge calibration, TOON benchmark, staged live checks.

## 18. Known Limitations

- Prompt-cache savings, live TOON accuracy/latency and live end-to-end cost are unmeasured.
- Approval → GitHub issue: exercised live on 2026-09-22 with the Foundry pipeline (§19); the earlier stub-era issues #2–#5 in
  `acme-securities-policies` came from fictional snapshot circulars and were closed with a note saying so.
- Pricing figures are an unverified list-price snapshot; the Azure Cost analysis blade is the source of truth.
- The live SEBI connector (official site, scan-triggered, `docs/sebi-connector.md`) depends on sebi.gov.in being reachable and its
  HTML stable; in `live` mode a failure is reported as LIVE_FAILED — there is no silent fallback. The fictional snapshot exists for
  tests and explicit demo mode only. Monitoring is not continuous: each scan fetches the newest `SEBI_MAX_DOCUMENTS` rows, or
  the curated `SEBI_SELECTED_ENTRY_IDS` (still fetched live; the registry only pins the set).
- Scenario matrix: 10/14 live cases match the designed expectation (§19). The four mismatches are all *more cautious* than
  expected (NEEDS_INVESTIGATION instead of ALIGNED/ARCHIVED), never a false conflict; they are reported, not tuned away.
- TOON: one document's obligations (103915, section "2.") fails the round-trip check in toon-format 0.9.0b1 (decodes as
  float) → the adapter records `context_format=mixed` and sends compact JSON for that block.
- Semantic ranker not evaluated. `MAX_CONTEXT_TOKENS` is a documented budget; only the evidence budget is enforced in code today.
- Scheduled scans need a server-side `GITHUB_TOKEN` (user OAuth tokens live only in browser sessions).
- SQLite on Azure Files means one replica; fine for a demo, not for scale.

## 19. Truthful demo rebuild — 2026-09-22

Goal: a pitch-ready PoC with **real SEBI data, fictional company data, real AI/cloud execution, no fake system behaviour**.

**Real regulatory sources.** `backend/regulatory_sources/sebi/<entry_id>.json` — six real circulars, each record written from a
live fetch (title, reference, date, `detail_url`, `pdf_url`, PDF bytes, text length, content hash, `retrieved_at`;
`source_mode=LIVE`, `synthetic=false`, validated on load). `SEBI_SELECTED_ENTRY_IDS` pins them; every scan still fetches them
from www.sebi.gov.in. 103277 was dropped (scanned PDF, no extractable text — reported, not OCR'd).

| entry | circular | reference | date |
|---|---|---|---|
| 102584 | Handling of Client's Unpaid Securities by Trading Members | HO/38/11/(9)2026-MIRSD-POD/I/15382/2026 | 2026-07-03 |
| 102762 | Intraday borrowing facility availed by mutual funds | HO/(92)2026-IMD-POD-2/I/16006/2026 | 2026-07-10 |
| 102914 | SWP/STP standing instructions for demat units | HO/47/14/13(2)2026-MRD-POD2/I/16590/2026 | 2026-07-17 |
| 102986 | Certification requirements for distribution of SIFs | HO/24/13/17(1)2026-IMD-POD-1/I/16895/2026 | 2026-07-21 |
| 103915 | Cyber incident reporting portal (FIRE format) | HO/(449)2026-ITD-5_DIV1/I/19448/2026 | 2026-08-24 |
| 104387 | Position limits, commodity derivatives segment | HO/47/16/13(5)2026-MRD-POD1/ I/20735/2026 | 2026-09-09 |

**Fictional tenants (redesigned corpora, structured front matter, no regulatory text copied).**
`auraCodesKM/acme-securities-policies` @ `bbad523` (stock broker + DP: POL-001 unpaid securities — deliberate conflict:
7 trading days, internal-only, no pledge notice; POL-002 cyber — aligned; POL-003 no commodity segment; POL-004; POL-005 DP;
SOP-001) and `auraCodesKM/nimbus-amc-policies` @ `a84ddcd` (AMC + one SIF: POL-001 intraday borrowing — aligned; POL-002 SIF
distributors still on NISM Series XIII — conflict; POL-003 vague cyber reporting — uncertain; POL-004; POL-005; SOP-001).

**Provenance.** `pipeline.provenance()` stores `regulatory_source` (detail/PDF URL, reference, LIVE/DEMO, synthetic) and
`policy_sources` (GitHub blob URL per policy at the indexed commit) on every analysis; the UI shows *Open SEBI source*, *PDF*,
*Open on GitHub*, and the Ask evidence chips link to the same. The GitHub issue body carries the PDF URL and the policy file link.

**Live scenario matrix — final fresh run 2026-09-22 04:20–04:30 UTC** (`scripts/demo_reset.py` on both tenants → Azure AI Search
tenant documents deleted and re-indexed from GitHub HEAD → `evals/live_e2e.py`; `evals/results/live_e2e_<tenant>.md`):

| tenant | scan | Foundry calls | est. cost | Jev records | chunks @ commit | result |
|---|---|---:|---:|---:|---|---|
| Nimbus | scan_b27f0182a2e6 | 8 | $0.0558 | 72 | 46 @ a84ddcd | 102986 **CONFLICT** POL-002 §4.2 (extraction → escalation → memo, all Foundry; review → **approved → nimbus-amc-policies#1**) · 102584/104387 **ARCHIVED** at triage (0 Foundry) · 103915 NEEDS_INVESTIGATION (designed) · 102762 NEEDS_INVESTIGATION (expected ALIGNED; 3 pairs < 0.7) · 102914 NEEDS_INVESTIGATION (no policy addresses the depository directions) · repeat scan 0 new / 6 skipped / 0 calls. **5/7** |
| Acme | scan_6932b27011be | 6 | $0.0519 | 61 | 48 @ bbad523 | 102584 **CONFLICT** POL-001 §5.1 (memo, AWAITING_REVIEW for the live click) · 102762 / 102986 / 104387 **ARCHIVED** at triage (0 Foundry; 102986 now archived thanks to `not_registered_for`) · 102914 NEEDS_INVESTIGATION (expected) · 103915 NEEDS_INVESTIGATION (Foundry said conflict, Jev cross-check disagreed → person) · repeat scan via API `LIVE_NO_NEW_DOCUMENTS` 0 new / 6 skipped / 0 calls. **6/7** |

Telemetry reconciliation (`evals/reconcile.py`): both scans **RECONCILED** — pipeline counter = `llm_calls` rows (each with a
Foundry `response_id`) = `analysis.metrics` blocks = audit-implied calls; cost sums equal. Mismatches against the designed
expectation are all *more cautious* (NEEDS_INVESTIGATION instead of ALIGNED); none is a false conflict; nothing was tuned.

**Ask matrix** (`evals/results/ask_matrix_<tenant>.md`, live Jev + gpt-5-mini, 13 questions of the brief + a sebi.gov.in web
lookup + a 5-turn follow-up chain on one `conversation_id`): deterministic intents (`list_conflicts`, `list_applicable`,
`list_aligned`, `list_not_applicable`, `effective_dates`, `pending_reviews`, `latest_changes`) answer from records with no
model call; reasoning intents (`explain`, `evidence`, `affected_policies`, `prioritize`, `compare`) narrate with Foundry and are
validated against record ids; "Compare the two most relevant current circulars" honestly returned *not enough evidence*
(Jev sufficiency 0.34); "Create a GitHub issue for this." → **refused**, reviews unchanged; the web lookup returned the FIRE-format
circular page + PDF on sebi.gov.in, labelled discovery only.

**Human approval → real GitHub issue.** Fresh run 2026-09-22 04:45 UTC: `POST /api/reviews/rev_b4f59ae0d374/approve` as
`auraCodesKM` (audit `APPROVED` actor_type=human → `TICKET_CREATED` actor_type=agent) opened
**https://github.com/auraCodesKM/nimbus-amc-policies/issues/1** — "[Compliance] SEBI HO/24/13/17(1)2026-IMD-POD-1/I/16895/2026 vs
POL-002 §4.2 Specialized Investment Fund strategies" with the official page, PDF, verbatim §21.10.1/21.10.3/21.10.4 excerpts,
POL-002 §4.2 linked to the GitHub file, the Foundry memo and `AfterCircular-Analysis-ID`. Second approve →
`409 Review rev_b4f59ae0d374 is already APPROVED`. The earlier rehearsal's `acme-securities-policies#6` (03:49 UTC, same path)
was closed with a note when the workspace was reset; Acme's 102584 review is AWAITING_REVIEW for the live click.
Full persisted traces: `docs/traces/TRACE_nimbus_102986.md` (13/13 steps ran, incl. Foundry extraction, escalation and memo)
and `docs/traces/TRACE_acme_102584.md`.

## 20. Final Azure architecture decisions (2026-09-22, Phase 13A–13K)

Everything in this section was **executed** on 2026-09-22, not inferred from configuration. Evidence files:
`backend/evals/results/live_smoke.json`, `retrieval_eval.{json,md}`, `live_e2e_<tenant>.md`, `ask_matrix_<tenant>.md`,
`evals/reconcile.py` output, `scripts/trace.py` output in `docs/traces/TRACE_*.md`.

| # | Decision | Why | Proof |
|---|---|---|---|
| 1 | **Microsoft Foundry** is the AI layer | One resource (`aif-aftercircular-dev`, project `proj-aftercircular-dev`, Korea Central) hosts the chat and embedding deployments behind Entra ID; strict JSON-schema structured outputs on the v1 Responses API give validated `ExtractionResult` / `ImpactAnalysis` / `Memo` / `AskAnswer` objects the code can check before use. | Every Foundry call is persisted in `llm_calls` with the service's own `response_id` (e.g. smoke `resp_00ee5c4f55a3…`, 63→147 tokens, 4.7 s, `json_schema`); `/api/system` shows *connected* only when such a row exists. |
| 2 | **gpt-5-mini** | Reasoning-class model at ~$0.25/$2 per 1M tokens; a full 6-circular scan costs ≈ $0.055; latency 20–30 s per structured call is acceptable for a batch pipeline; `temperature` is omitted for the gpt-5 family (provider handles it). | `usage`/`/api/system`: 31 Foundry requests all time, 0 errors; controlled failure with `EXTRACTION_MODEL=does-not-exist` → `NotFoundError 404 DeploymentNotFound`, no result fabricated (tests `test_foundry_unavailable_fails_the_document_not_the_truth`, failed call recorded with `ok=0`). |
| 3 | **Azure AI Search** for internal policy retrieval | The corpus is the tenant's GitHub repository, chunked by clause, filtered by `tenant_id`; the service gives BM25 + HNSW vector + RRF in one query and an index we can inspect (`policies-dev`, 94 documents after the rebuild: Acme 48, Nimbus 46). | `retrieval_eval.md`: expected policy at rank 1 in **8/8** scenario queries; cross-tenant bait queries return **0 foreign rows**; a chunk re-embedded from its current text is its own nearest neighbour (cosine score 1.0), `chunk_hash` matches, index commit = repo HEAD. |
| 4 | **Hybrid search** (BM25 + vector, RRF) | Compliance text needs exact terms ("five trading days", "NISM Series V-D", "cyber incident") *and* semantic matches; RRF fusion needs no tuning. | Scores in `retrieval_eval.md` are RRF (≈ 0.033 max); every analysis stores `metrics.retrieval` = query, k, method, embedding model, commits, timing, and the chunk list with `commit_sha` / `chunk_hash`. |
| 5 | **text-embedding-3-small**, 1536-d | Cheapest Foundry embedding with good retrieval quality; 1536 keeps the Free-tier index small (94 vectors). | Vector reality check above; `embedding_dimensions=1536` in index schema `docs/azure/policies-dev.index.json`. |
| 6 | **SEBI connector separate from Azure AI Search** | The regulatory source is acquisition (official listing → page → PDF → hash → registry), not retrieval. Azure AI Search holds *only* internal policy chunks; a circular never enters the index. | `app/connectors/sebi.py`, `regulatory_sources/sebi/*.json`; `/api/system.sebi` reports live scans and fetch timestamps. |
| 7 | **Foundry Web Search: enabled, discovery only** | The Responses API `web_search` tool works on this deployment with `filters.allowed_domains=["sebi.gov.in"]` (probe: `resp_081d1eb7…`, 3 search calls, url citations to the 103915 page and PDF, 11,983→1,327 tokens). | `provider.web_search`, `investigate.web_lookup`, `ASK_WEB_SEARCH` flag. |
| 8 | Where it is used | Only the Ask intent `web_lookup` ("look up / latest SEBI publication not in the workspace"). Never in the scan pipeline, never in impact analysis, never in the memo. | Answer footer *"Microsoft Foundry Web Search … discovery, not compliance evidence"*; telemetry task `ask_web`. |
| 9 | Why Web Search is **not** the compliance source | Evidence must be the official PDF text, hashed and stored, with verbatim excerpts verified in code; web snippets are neither complete nor verifiable. Off-domain citations are dropped (`web_dropped_off_domain`). | tests `test_web_lookup_is_discovery_only_and_drops_off_domain_citations`, `test_web_lookup_without_foundry_never_invents_a_result`. |
| 10 | **Semantic ranker: not enabled** | Probe on `srch-aftercircular-dev` (Free tier): `queryType=semantic` → *"This index must have valid semantic configurations defined"*; adding one is possible but paid beyond the free monthly quota and hybrid RRF already ranks the expected clause first in 8/8 checks. Revisit only if a retrieval miss is observed. | `AZURE_SEARCH_SEMANTIC_CONFIG` stays empty; `/api/system.search.semantic_ranker=false`. |
| 11 | **Why Jev exists** (reasoning support) | Typed, calibrated Noul/Choice/Score judgments make routing auditable and cheap: triage archives out-of-scope circulars with **0 Foundry calls**, alignment/verification decide when Foundry must be escalated to, and a cross-check keeps a person in the loop when Jev and Foundry disagree. Jev never writes prose. | `decisions` table (181 records before the reset; see §19 runs), Decision details in the UI, `Reasoning support · Jev` label. |
| 12 | **Human approval architecture** | The only path to a side effect is `POST /api/reviews/{id}/approve` under the signed-in GitHub user; Ask refuses actions; a rejected review has no side effect; re-approval is idempotent. | audit `APPROVED` (actor_type human) → `TICKET_CREATED` (agent); issue `acme-securities-policies#6`; `409 already APPROVED` on repeat. |
| 13 | **Cost controls** | `CallBudget`: max 10 calls / $0.50 per scan, $5 / day application-wide, `BUDGET_EXCEEDED` audit event; content-hash dedup (repeat scan = 0 calls); triage before any Foundry call; deterministic Ask intents make no model call; embeddings batched per query; bounded retries (2). | `evals/reconcile.py`: pipeline counter = telemetry rows = metrics blocks = audit-implied calls, cost sums equal (both scans RECONCILED); repeat scans `LIVE_NO_NEW_DOCUMENTS`, 0 calls. |
| 14 | **Responsible AI controls** | AI detects and explains; a person decides. No autonomous policy edits, no issue without approval, two-sided verbatim evidence before any CONFLICT, uncertainty preserved as NEEDS_INVESTIGATION, fictional tenants only, tenant isolation in the index, every claim in Ask validated against record ids. | `services/gate.py`, `investigate.validate_answer`, `docs/AI103_MAPPING.md`. |
