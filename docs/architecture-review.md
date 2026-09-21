# AfterCircular — Independent Architecture Review & Azure / AI-103 Master Plan

Written as a second opinion on the design in `azureDecision.md` and the code in `backend/`, before anything is provisioned.
Nothing here was executed. Prices are classified, never quoted (§14). Where a Microsoft fact should be re-checked before you
rely on it, it is marked **VERIFY**.

---

## 1. Executive summary

The current design is sound in the places that matter most: a deterministic Python control plane owns state, thresholds,
approval and side effects; models only extract, judge and draft; a human is the only path to a GitHub issue; idempotency and
call budgets are enforced in code. Keep all of that.

It is weak in five places, all fixable without a rewrite:

1. **Policy corpus lifecycle is too coupled to GitHub and re-embeds everything on any commit.** Retrieval should run on a
   persistent, versioned, chunk-hashed corpus with rich metadata; GitHub is the *ingest source* and the *ticket target*, not the
   index.
2. **One index per tenant** collides with the Azure AI Search Free tier (3 indexes) and is the wrong isolation primitive.
   Use **one index with a filterable `tenant_id`** (plus `doc_id`, `version`, `effective_date`, `status`), filtered in code.
3. **Retrieval runs one blended query per circular.** Multi-obligation circulars dilute the query. Retrieve **per obligation**,
   fuse, dedupe, then let Jev rerank pairs. Embedding cost is negligible; recall improves materially.
4. **Regulatory discovery is a single HTML scraper.** Make it a connector interface with deterministic official-source
   connectors (SEBI now, RBI next), raw-document retention with hash/version, scheduled polling. Web search is not a discovery
   mechanism for authoritative documents.
5. **Azure footprint is under-specified for AI-103** in the right places: a Foundry *project* (tracing/evals surface), Azure
   AI Search as the single vector + keyword store, Blob for raw documents (phase 2), Application Insights, managed identity.
   And over-specified in one: SQLite-on-Azure-Files is fine for the demo but PostgreSQL is the honest production answer.

**Recommended MVP footprint (6 things):** resource group · Foundry resource + project · one chat deployment (`gpt-4.1-mini`) ·
one embedding deployment (`text-embedding-3-small`) · Azure AI Search **Free** · Application Insights (free tier). Backend runs
locally for the first live pass. Everything else is phase 2.

## 2. What I would change from the current design

| # | Current | Change | Why |
|---|---|---|---|
| C1 | `ensure_indexed` replaces all chunks and re-embeds the whole corpus when the repo head moves | chunk-level `content_hash`; embed only new/changed chunks; mark removed chunks `status=retired` (keep for audit) | cost, correctness, deletions/versions become first-class |
| C2 | index `policies-<tenant>` per tenant, `dims=1536` hardcoded | single index `policies-<env>` with `tenant_id`, `doc_id`, `version`, `effective_date`, `status`, `topics` filterable; dims from settings | Free tier = 3 indexes; standard multi-tenant pattern; embedding model swap safe |
| C3 | one query = summary + 6 requirements, top-10 | per-obligation hybrid query (top-5 each), RRF-style union in code, dedupe, cap `MAX_POLICY_CHUNKS` | recall on multi-obligation circulars |
| C4 | SEBI HTML listing scraper, snapshot fallback | `RegulatorConnector` interface, SEBI + RBI connectors, raw document kept (hash, version, retrieved_at), scheduled polling | scalable, auditable, RBI next |
| C5 | Jev `asyncio.gather` over all chunks unbounded | `Semaphore(MAX_CONCURRENT_CALLS)` for Jev too | same rule as Foundry |
| C6 | no Foundry project | create a Foundry **project** under the resource; connect App Insights; enable tracing | AI-103 observability/eval surface with no extra cost |
| C7 | SQLite → Azure Files for hosted demo | keep for the demo; **PostgreSQL Flexible Server** for phase 2/production (stop/start between demos) | multi-replica, backups, real DB story |
| C8 | manifest `regulator_topics` unused in retrieval | index `topics` as a collection; use as a *boost/filter hint*, never as a hard filter | cheap precision |
| C9 | prompt-caching assumed to help | measure; extraction prefix is ~800 tokens (**below the 1024-token minimum** for OpenAI-family caching — VERIFY per model) | do not claim savings |
| C10 | no input-safety layer beyond the system rule | Foundry deployment content filters (on by default) now; **Prompt Shields** on fetched circular text in phase 2 | circulars are untrusted input |

Things I looked for and would **not** change: Jev as the decision primitive (§9), Responses API + Python orchestration (§10),
the Impact Gate and human approval (§15), the guardrail values (§14), TOON at the context layer only (§14).

## 3. Complete system architecture

```
 EXTERNAL REGULATORY DISCOVERY                         INTERNAL POLICY CORPUS
 ┌──────────────────────────────┐                      ┌──────────────────────────────────────────┐
 │ RegulatorConnector[SEBI|RBI] │  timer (Functions)   │ GitHub policy repo (ingest source, git = │
 │  official listing → PDF/HTML │◄──────────────────   │ versioned original store)                 │
 │  hash, version, retrieved_at │                      │  (phase 2: Blob container for uploads,    │
 └──────────────┬───────────────┘                      │   PDF/DOCX via Document Intelligence)     │
                ▼                                      └───────────────┬──────────────────────────┘
 regulatory_documents (DB) + raw (Blob, phase 2)                       ▼
                │                                       extraction → normalize → section chunks → chunk hash
                ▼                                                       ▼
 Foundry: extraction (strict schema) ──► obligations       policy_documents / policy_chunks (DB, metadata)
                │                                                       ▼
                │  per-obligation query (BM25 + vector, RRF) ◄── Azure AI Search index policies-<env>
                ▼                                                (vectors + keyword + filters, tenant_id)
 candidates → Jev rerank → Jev alignment per (obligation, chunk) → Jev citation check
                ▼
 Impact Gate (code): NOT_APPLICABLE | ALIGNED | CONFLICT | UNCERTAIN → escalation: Foundry reasoning (TOON context)
                ▼
 CONFLICT → Foundry memo (strict schema) → review AWAITING_REVIEW ──► HUMAN (web UI) ──► approve/reject
                                                                                        ▼
                                                            GitHub issue (idempotent by analysis id) → audit_events
 Cross-cutting: App Insights/OTel traces · llm_calls telemetry · Key Vault + managed identity (hosted) · evals (sampled)
```

Boundaries: the FastAPI service is the only process that talks to Foundry, Search, Jev, GitHub. The web app never holds
Azure credentials. Tenancy is a header set by the trusted web server and enforced in every query and every Search filter.

## 4. Regulatory data pipeline

**Discovery is not retrieval.** Authoritative documents come from known official pages; you do not "search the web" for a
SEBI circular, you list the circulars page. Options evaluated:

| Option | Verdict |
|---|---|
| Deterministic HTTP connector per regulator (listing page → detail → PDF) | **Use.** Deterministic, auditable, testable with recorded fixtures. SEBI: circulars listing (HTML) + PDF. RBI: notifications listing; RBI publishes RSS feeds for notifications/press releases (**VERIFY** current feed URLs) — prefer RSS when it exists. |
| RSS/Atom feeds | Use where the regulator offers them (cheapest polling signal); still fetch the document itself. |
| Web search (Bing grounding via Foundry Agents) | **Reject for discovery.** Non-deterministic, may surface mirrors/commentary, per-query cost, no completeness guarantee. Possible later for *enrichment* (news about a circular), never as the source of record. |
| Azure AI Search crawling websites | **Reject.** Indexers target Azure data sources (Blob, SQL, Cosmos), not arbitrary regulator sites. |
| Document Intelligence for PDFs | Phase 2. `pypdf` is enough for born-digital SEBI PDFs; Document Intelligence `prebuilt-layout` (F0 tier, 500 pages/month free — **VERIFY**) for scanned or table-heavy circulars/annexures. |

Record per document (already in `processed_documents`, extend): `source`, `jurisdiction`, `document_id`, `circular_number`,
`title`, `source_url`, `published_date`, `effective_date`, `content_hash` (sha256 of normalized text), `document_version`,
`previous_hash`, `retrieved_at`, `source_mode` (LIVE / DEMO_SNAPSHOT), `raw_blob_path` (phase 2). Versioning: same
`document_id` + new hash ⇒ new version row; old analysis stays linked to the old version. Scheduling: Functions timer → the
same `/api/scheduled-scan` (already built, disabled) with `MAX_DOCUMENTS_PER_SCAN`.

## 5. Internal company document pipeline

**Where things live (MVP → phase 2):**

| Artifact | MVP | Phase 2 / production |
|---|---|---|
| Original documents | GitHub repository (git history = versions; commit SHA recorded) | + Blob container `policies/<tenant>/<doc_id>/<version>/original.*` for uploads and immutable snapshots of each indexed build |
| Extracted text + chunks | `policy_chunks` (SQLite) with `chunk_hash` | same table in PostgreSQL |
| Embeddings | **Azure AI Search only** (vector field) — not duplicated in the DB | same |
| Metadata | `policy_documents` (new table: tenant, doc_id, title, category, version, effective_date, status, source path, commit) + on every Search document | same |
| Manifest (`aftercircular.yml`) | source of `doc_id`, category, topics, regulator, effective dates | same, plus optional upload UI |

**Lifecycle:** import (git head or upload) → text (markdown as-is; PDF via pypdf, Document Intelligence later) → normalize
(whitespace, front-matter) → **section chunking** (current `chunk_markdown`: one chunk per numbered clause, keeps `§` ids —
right granularity for evidence) → chunk metadata → `chunk_hash` diff against the previous build → embed **only new/changed
chunks** → upsert to Search; retired chunks flagged `status=retired` (filtered out of retrieval, kept for audit) → retrieval
per obligation → Jev rerank → evidence.

**Metadata on every Search document** (all filterable except `text`/`vector`): `id` (`<tenant>|<doc_id>|<version>|<section>`
hashed), `tenant_id`, `doc_id`, `title`, `category`, `path`, `version`, `section`, `effective_date`, `status`, `regulator`,
`jurisdiction`, `topics` (collection), `commit_sha`, `chunk_hash`, `text`, `vector`. That is the full association the brief asks
for: company → policy → document → section → chunk → effective date → regulator → jurisdiction → version.

**Alternatives compared for the corpus store:**

| Architecture | Verdict |
|---|---|
| **Blob (phase 2) + Azure AI Search + DB for metadata** | **Choose.** One vector+keyword engine with filters, RRF, optional semantic ranker; nothing to operate; the AI-103 RAG service. |
| Blob + PostgreSQL/pgvector (+ separate keyword) | Rejected for MVP: you must build hybrid fusion, BM25 (`tsvector`), filters and reranking yourself; you also need Postgres from day one. Reasonable only if Search were unavailable. |
| Cosmos DB vector search | Rejected: document model mismatch with a relational audit workload; vector search is newer and adds a second data engine. |
| Separate vector DB (Qdrant, Pinecone…) | Rejected: another external dependency, no Azure story, duplicates Search. |

Multi-tenant, versions, updates, deletions, re-indexing, effective dates, access control are all handled by the metadata +
filter design above without new services. Access control = tenant filter enforced server-side (only the backend can query).

## 6. Vector / embedding / search architecture

- **Do we need a separate vector database? No.** Azure AI Search stores the vectors, does BM25, fuses with RRF, filters by
  tenant/version/status, and (on Basic+) offers a semantic reranker. One engine, one bill (Free tier: none).
- **Index:** `policies-<env>` (dev/demo/prod), HNSW, cosine, dims = embedding model (1536 for `text-embedding-3-small`;
  `text-embedding-3-large` = 3072 costs ~6× per token and is not needed for clause-level English policy text).
- **Hybrid query:** `search_text` (BM25, `en.microsoft` analyzer) + `vector_queries` (k=10) + `$filter: tenant_id eq '…' and
  status eq 'active'`, `top=5` per obligation. RRF is applied server-side whenever both are present.
- **Semantic ranker:** not on Free (**VERIFY** current tier matrix); Jev rerank fills that role and is measured. Revisit on Basic.
- **What gets embedded:** policy **chunks** (once, on change) and regulatory **obligations** (query side, per scan). Not whole
  circulars: a whole-circular vector averages away the individual requirements — exactly what §7 needs to keep separate.

## 7. Regulatory → policy semantic matching

Chosen flow (the brief's option: extract first, embed each obligation, search, rerank, reason):

1. Foundry extracts N obligations with verbatim evidence (`requirement`, `affected_area`, `deadline`, `applies_to`).
2. Jev checks each obligation is actually stated (drops hallucinated ones) and code checks the excerpt is verbatim.
3. Jev applicability at circular level (company profile from the manifest) → NO ⇒ stop, archive with evidence.
4. For each kept obligation: hybrid query with `requirement` text (BM25 + vector), top-5, tenant filter → union → dedupe by
   `chunk_hash` → cap 8–12 candidates by fused rank.
5. Jev rerank: relevance Noul per (obligation, chunk); keep ≥ 0.45, top 5.
6. Jev alignment: Choice `satisfies / conflicts / not_addressed` per pair, batched per chunk (one request, N questions).
7. Code aggregates: any `conflicts` above threshold with citations ⇒ CONFLICT; all `satisfies` ⇒ ALIGNED; low-confidence pairs
   where conflict is plausible ⇒ escalation to Foundry reasoning with the TOON-encoded pairs; still unclear ⇒ UNCERTAIN → human.
8. Jev citation check on the final evidence; Foundry memo only for CONFLICT.

"Every six months" vs "annually": the obligation embedding and the BM25 terms (`position limits`, `review`) retrieve POL-001 §4.1;
Jev alignment reads both clauses and returns `conflicts` — the numeric mismatch is exactly the kind of narrow judgment Jev is for.

## 8. Foundry architecture

- **Resource kind:** a **Foundry resource** (`Microsoft.CognitiveServices/accounts`, kind `AIServices`) with one **project**.
  The project gives the portal surface AI-103 cares about — tracing, evaluation runs, model catalog, agents — for the same
  per-token price as a bare Azure OpenAI account. Inference stays on the OpenAI-compatible **v1** endpoint the code already uses.
- **API:** Responses API with strict JSON-Schema structured outputs (`responses.parse`) — current GA surface; keeps outputs
  typed and refusals/parse failures explicit. Chat Completions remains a config switch.
- **Deployments (MVP):** `gpt-4.1-mini` for extraction, memo *and* reasoning-escalation to start; add `gpt-4.1` (or `gpt-5-mini`,
  **VERIFY** availability/quota for Students) as `IMPACT_MODEL` only if evaluation shows escalation quality is insufficient.
  `text-embedding-3-small` for vectors. GlobalStandard SKU (per token, $0 idle); never Provisioned.
- **Prompt caching:** only meaningful for prefixes ≥ 1024 tokens on the 4o/4.1/5 families (**VERIFY**); the extraction prefix
  is under that. Expect little; record `cached_tokens` and report what is measured.
- **Content filters:** on by default per deployment — say so in the RAI section; do not disable.
- **Foundry Agent Service / Agent Framework:** not for the pipeline (§10).

## 9. Jev architecture

Keep Jev as the **decision primitive**; it is the most defensible part of the design: calibrated probabilities on narrow typed
questions, thresholds as constants, cheap. Division of labour:

| Task | Owner | Reason |
|---|---|---|
| Understand a circular, extract obligations with evidence | Foundry (generative, strict schema) | open-ended language understanding |
| Is obligation *i* actually stated / supported? | Jev Noul + code verbatim check | narrow, calibrated, cheap |
| Does the circular apply to this company? entity in scope? depends on unstated fact? | Jev Noul/Choice | calibrated; thresholds scale with consequence |
| Is chunk *c* relevant to obligation *i*? | Jev Noul (rerank) | replaces semantic ranker on Free tier |
| Does chunk *c* satisfy / conflict / not address obligation *i*? | Jev Choice | the core comparison; needs probabilities, not prose |
| Severity | Jev Score | ordinal, calibrated |
| Citation supports the claim? | Jev Choice | verification before a human sees it |
| Explain a conflict, weigh ambiguous pairs, draft a memo | Foundry reasoning/generation | needs language, not a probability |
| Final routing, thresholds, budgets, idempotency, approval, GitHub | deterministic Python | authority and auditability |
| Intent routing for the "Ask" investigator | Jev Choice | already built |

Challenge accepted and answered: could Foundry do the classification instead? Yes, and `FoundryJudgmentProvider` exists for
exactly that comparison — but its confidences are self-reported and uncalibrated; keep it as the labelled fallback and as an
evaluation baseline (AI-103: model comparison), not as the default. Change C5: bound Jev concurrency.

## 10. Agent / orchestration architecture

**Recommendation: Responses API + plain Python orchestration (current). Not an agent loop.**

- Who owns state? The FastAPI service (DB). Who chooses the next step? Code (`pipeline.py`, `decisions/impact.py`) with fixed
  stages. Who calls tools? Code (Search, Jev, GitHub client). Who controls permissions? Code + tenant headers + RBAC. Who can
  create a GitHub ticket? Only `/reviews/{id}/approve`. Who approves? A signed-in human in the web UI.
- Foundry Agent Service / Microsoft Agent Framework would move step selection into a model loop: harder to bound cost, harder
  to audit, no benefit for a fixed compliance workflow. **Rejected for the pipeline.**
- Where an agent is legitimately useful (nice-to-have, AI-103 "agents" coverage): the **investigator ("Ask")** as a Foundry
  agent with three **read-only** function tools (`list_documents`, `get_analysis`, `list_audit`) — no write tools, so it cannot
  cross the approval boundary. Today's Jev-routed investigator already works; this is an optional showcase, not a dependency.

## 11. Database + storage architecture

| Need | MVP (local + hosted demo) | Phase 2 / production |
|---|---|---|
| Application state (documents, versions, analyses, decisions, reviews, audit, llm_calls, tenants, policy metadata) | SQLite (file; Azure Files when hosted, 1 replica) | **Azure Database for PostgreSQL Flexible Server**, Burstable B1ms, stop when idle |
| Raw regulatory PDFs, uploaded policy originals, index-build snapshots | not stored (snapshot JSON + GitHub) | **Blob Storage** (Standard LRS), containers `regulatory-raw`, `policies` |
| Vectors + keyword | Azure AI Search | same |
| Secrets | `.env` | Key Vault references |

Why PostgreSQL over Azure SQL / Cosmos: the workload is relational and audit-shaped (joins across documents → analyses →
decisions → reviews → audit; ordered event logs; idempotency constraints via UNIQUE). The schema is already plain SQL (SQLite
dialect), so the port is a driver change. Azure SQL fits too but is pricier at the low end; Cosmos would force a document model
and RU planning for no gain. Students free-tier eligibility for Flexible Server B1ms: **VERIFY**.

## 12. Azure services — accept / reject

| Service | Verdict | Role |
|---|---|---|
| Microsoft Foundry resource + project, model deployments, Responses API, structured outputs | **MVP** | extraction, reasoning, memo, embeddings; tracing/evals surface |
| Prompt caching | measure | likely small (§8) |
| Foundry Agent Service / Agent Framework | optional showcase only | read-only investigator |
| Azure AI Search (vector + BM25 + RRF + filters) | **MVP** | policy index |
| Semantic ranker | later, Basic+ | compare with Jev rerank |
| Embeddings (`text-embedding-3-small`) | **MVP** | chunk + obligation vectors |
| Web search / Bing grounding | reject for discovery | not authoritative |
| Document Intelligence | phase 2 | scanned/table PDFs |
| Blob Storage | phase 2 | raw + originals + snapshots |
| PostgreSQL Flexible Server | phase 2/prod | state |
| Cosmos DB, Azure SQL | reject | see §11 |
| Azure Functions (timer) | phase 2 | scheduled polling via the same API |
| Container Apps | phase 2 hosting | backend (consumption free grant) |
| App Service | reject | F1 free tier CPU-minute cap makes multi-minute scans unreliable; B1 costs more than Container Apps consumption |
| Application Insights / Azure Monitor | **MVP (free tier)** | traces, dependencies, token/cost logs; connect to the Foundry project |
| Key Vault + Managed Identity + RBAC | phase 2 (hosted); identity-based auth already used locally | secrets and least privilege |
| Azure AI Evaluation SDK / Foundry evaluations | phase 2, sampled | groundedness/relevance on ≤ 5 memos |
| Content Safety — Prompt Shields | phase 2 | untrusted circular text |
| AKS, Service Bus, Event Grid, Redis, APIM, Data Factory, Fabric | reject | no requirement |

## 13. AI-103 concept mapping

| Component | What it is | Why AfterCircular uses it | AI-103 concept |
|---|---|---|---|
| Foundry project + deployments | managed model hosting and project workspace | typed extraction, reasoning, memo; tracing and evals in one place | plan/manage an Azure AI solution; generative AI with Foundry |
| Responses API + structured outputs | typed model I/O | schema-enforced obligations/impact/memo; fewer parse failures | prompt engineering, structured outputs |
| Azure AI Search hybrid | vector + keyword + RRF with filters | find the policy clauses a circular touches | RAG, vector search, hybrid retrieval |
| Embeddings | text → vectors | chunk and obligation vectors | embeddings |
| Jev (TypeSafe) | calibrated typed judgments | applicability/alignment/severity with probabilities | model selection & evaluation, calibration (non-Azure, explicitly justified) |
| Deterministic gate + human approval | code and UI | uncertainty stays uncertain; a person decides | Responsible AI, human oversight |
| Application Insights + OTel | telemetry | tokens, cost, latency, errors per call and per scan | monitoring |
| Managed identity + RBAC + Key Vault | identity and secrets | no keys in hosted config | security |
| Evaluation (golden set, judge calibration, TOON benchmark, sampled AI Evaluation SDK) | measurement | prove accuracy and cost claims | evaluation |
| Content filters / Prompt Shields | input/output safety | circulars are untrusted | Responsible AI |

Presentation story in one line: *"A deterministic compliance pipeline that uses Foundry to read, Azure AI Search to find,
calibrated judgments to decide, and a human to act — measured end to end."*

## 14. Cost optimization

Per call, in order of cheapness: **code** (hash, verbatim checks, routing, dedupe) → **Jev** (narrow questions, ~10³ tokens)
→ **small model** (`gpt-4.1-mini`: extraction, memo, first-pass reasoning) → **stronger model** (only escalations, only if
measured to help). Keep the current guardrails exactly (`MAX_DOCUMENTS_PER_SCAN=1`, `MAX_LLM_CALLS_PER_SCAN=10`,
`MAX_RETRIES=2`, `MAX_CONCURRENT_CALLS=2`, scheduled off); add Jev concurrency bound (C5) and chunk-level re-embedding (C1).
Context budgets, dedupe, top-k, TOON for repeated records (measured −11…13 % vs compact JSON), evaluation by sampling (≤ 5 cases
live, the rest on fixtures), one-call-per-step live tests.

Cost classes (no prices invented):

| Resource | Class | Tier |
|---|---|---|
| Resource group, managed identity, RBAC | FREE | MVP |
| Foundry resource + project | FREE to hold; deployments PAY-PER-USE (GlobalStandard, $0 idle) | MVP |
| Chat deployment (`gpt-4.1-mini`), embedding deployment | PAY-PER-USE | MVP |
| Stronger reasoning deployment | PAY-PER-USE, POTENTIALLY EXPENSIVE if used per document — gate behind escalation | optional |
| Azure AI Search Free | FREE (one per subscription; VERIFY availability) | MVP |
| Azure AI Search Basic | ALWAYS-ON BILLING | production only |
| Application Insights | FREE tier (5 GB/mo) | MVP |
| Blob Storage | PAY-PER-USE (cents) | phase 2 |
| PostgreSQL Flexible Server B1ms | ALWAYS-ON BILLING unless stopped; free-tier eligibility UNKNOWN / MUST VERIFY | phase 2 |
| Container Apps consumption | FREE grant then PAY-PER-USE; UNKNOWN exact | phase 2 |
| Azure Container Registry Basic | ALWAYS-ON BILLING (small) | phase 2 |
| Key Vault | PAY-PER-USE (cents) | phase 2 |
| Functions Flex Consumption | FREE grant | phase 2 |
| Document Intelligence F0 | FREE tier (page cap; VERIFY) | phase 2 |
| Content Safety F0 | FREE tier (rate cap; VERIFY) | phase 2 |

## 15. Security + Responsible AI

- **Human oversight:** approve/reject is the only path to an external effect; approval is idempotent; rejection is recorded.
- **Grounding:** obligations need verbatim excerpts; conflicts need citations on both sides; verbatim checked in code; citation
  checked by Jev; no evidence ⇒ UNCERTAIN, never CONFLICT.
- **Uncertainty:** YES / NO / UNCERTAIN preserved end to end; the Noul band 0.30–0.70 is never rounded; archiving as NOT
  APPLICABLE needs p ≥ 0.80 because silence is the riskier error.
- **Calibration:** Jev probabilities evaluated on the golden set; Foundry-emulated judgments labelled `calibrated=False`.
- **Auditability:** every decision record stores provider, model, question ids, state digest, answers, thresholds applied.
- **Security:** managed identity + RBAC (Cognitive Services OpenAI User; Search Index Data Contributor/Reader; Storage Blob Data
  Contributor), Key Vault references, no keys in the browser, tenant filter on every query, circulars treated as untrusted
  input, content filters on, Prompt Shields in phase 2.
- **Privacy:** policy text stays in the tenant's Search partition and DB rows; prompts are not logged; telemetry carries ids and
  counts only.
- **Reliability:** bounded retries, budgets, idempotency, no silent stub outside dev, failures named by provider.

## 16. Evaluation strategy

1. **Golden scenarios** (exists): applicability, alignment, gate outcome, evidence correctness on fixtures — free, run in CI.
2. **Judge calibration** (exists): Jev vs Foundry-emulation vs fixtures on the same questions; report Brier-style calibration.
3. **Retrieval quality:** recall@5 of the known relevant clause per obligation (fixtures label `POL-001 §4.1` etc.) — local, free.
4. **Extraction quality:** schema validity rate, evidence verbatim rate, obligation count vs labelled — 1 live call per document.
5. **Memo quality:** Azure AI Evaluation SDK groundedness/relevance on ≤ 5 memos (phase 2, sampled; judge calls cost tokens).
6. **TOON:** local token benchmark (done) + 2-call live A/B (`toon-live`).
7. **Cost/latency:** from `llm_calls` per scan; report per-document cost with cached tokens.

## 17. Observability

Application Insights via the Azure Monitor OpenTelemetry distro (already wired): requests, dependencies (Foundry, Search, Jev,
GitHub as HTTP), exceptions, structured `llm_call` logs (task, model, tokens, cached, cost, format, mode, attempts). Add
`opentelemetry-instrumentation-openai-v2` so `gen_ai.*` spans appear in the Foundry project's Tracing view (phase 2). Correlate
with `scan_id` / `analysis_id` / `review_id` as span attributes. Keep prompts out of telemetry.

## 18. Deployment architecture

GitHub → GitHub Actions (tests, mypy, image build) → ACR → **Azure Container Apps** (consumption, min 1 replica during demos,
system-assigned identity, Azure Files volume for SQLite until PostgreSQL) → Foundry / Search / Storage / App Insights. Web
(Next.js) on Vercel or Azure Static Web Apps Free. Functions timer for polling. All of this **after** the local Azure-connected
pipeline passes TEST 1–10. During development: backend local, Search + Foundry in Azure, DB local; production: everything hosted.

Why Container Apps: free monthly grant, per-second billing, scale-to-zero option, managed identity, volume mounts, one image
from the existing Dockerfile. App Service rejected (§12), Functions for the API rejected (long-running scans).

## 19. MVP vs Phase 2 vs Production

| | MVP (prove the pipeline) | Phase 2 (hosted demo, AI-103 depth) | Production |
|---|---|---|---|
| Models | 1 chat + 1 embedding deployment | + reasoning deployment if measured | same + quota |
| Retrieval | Search Free, single index, per-obligation queries | + Document Intelligence, Blob originals | Search Basic + semantic ranker (measured) |
| State | SQLite local | SQLite on Azure Files (1 replica) or PostgreSQL | PostgreSQL |
| Hosting | local backend | Container Apps + Functions timer | same + CI/CD gates |
| Security | az login identity, `.env` | managed identity, Key Vault | + private endpoints if required |
| RAI | filters on, gate, human approval | + Prompt Shields, AI Evaluation SDK | + periodic calibration review |
| Observability | App Insights (free) | + Foundry tracing | alerts |

## 20. Exact Azure resources to create (MVP only)

| # | Resource | Name | Notes |
|---|---|---|---|
| 1 | Resource group | `rg-aftercircular-dev` | region chosen for model availability (**VERIFY** in portal; e.g. `swedencentral`, `eastus2`) |
| 2 | Foundry resource (AI Services) | `aif-aftercircular-dev` | custom subdomain = name; S0; identity: system-assigned |
| 3 | Foundry project | `proj-aftercircular-dev` | under #2 |
| 4 | Chat deployment | `gpt-4.1-mini` | GlobalStandard, capacity 10 (TPM units — VERIFY unit), model version from catalog |
| 5 | Embedding deployment | `text-embedding-3-small` | Standard, capacity 10 |
| 6 | Azure AI Search | `srch-aftercircular-dev` | **Free** SKU; if unavailable → STOP and decide |
| 7 | Application Insights (+ Log Analytics workspace) | `appi-aftercircular-dev` / `log-aftercircular-dev` | free tier; connect to project |

Not created for MVP: storage, database, Key Vault, ACR, Container Apps, Functions, Document Intelligence, Content Safety.

Naming convention (Azure limits respected): `<type>-aftercircular-<env>` with hyphens where allowed; storage accounts and ACR
have no hyphens: `staftercirculardev`, `acraftercirculardev`; Key Vault `kv-aftercircular-dev` (3–24 chars, globally unique);
Search index `policies-dev`; Container App `ca-aftercircular-api-dev`, environment `cae-aftercircular-dev`; Function app
`func-aftercircular-dev`; PostgreSQL `psql-aftercircular-dev`; Blob containers `policies`, `regulatory-raw`.

## 21. Exact order to create them (manual, portal or CLI; nothing executed here)

1. Resource group.
2. Foundry resource (kind AIServices) → wait for provisioning → note the endpoint (`https://aif-aftercircular-dev.openai.azure.com`
   or `…services.ai.azure.com`; both expose `/openai/v1/` — **VERIFY** which the portal shows).
3. Foundry project inside it.
4. Chat deployment `gpt-4.1-mini` (GlobalStandard). Check quota page first; on a Students subscription some models need a
   quota request — if `gpt-4.1-mini` is unavailable, `gpt-4o-mini` is an acceptable substitute (same code path).
5. Embedding deployment `text-embedding-3-small`.
6. Azure AI Search **Free**. If the CLI/portal says Free is unavailable in the subscription or region: STOP; the local hybrid
   retriever stays in place for the first live test.
7. Application Insights (creates a Log Analytics workspace) → connect to the Foundry project (Project → Tracing).
8. RBAC on the Foundry resource for your user: `Cognitive Services OpenAI User` (lets `FOUNDRY_API_KEY` stay empty).
9. RBAC on Search for your user: `Search Index Data Contributor` + `Search Service Contributor`; enable RBAC auth on the service.
10. Fill `backend/.env` non-secret values; keep keys empty if RBAC works.
Then: `DISCOVERY COMPLETE` → read-only inventory → approve live tests one call at a time.

## 22. What you should learn / configure manually

Portal skills worth having for the viva: Foundry model catalog + quota page; deployment creation (SKU, capacity, version);
project Tracing/Evaluation tabs; Azure AI Search index explorer (see your chunks and vectors); RBAC assignment on a resource;
Application Insights → Transaction search (see one scan's spans); Cost Management → Cost analysis (show the demo's real spend).

## 23. What Claude Code should automate (after your approval, one step at a time)

Read-only inventory; `.env` non-secret scaffolding; index schema creation and chunk-hash incremental indexing (C1/C2); per-
obligation retrieval (C3); connector interface + RBI connector skeleton (C4); Jev concurrency bound (C5); embedding dims from
settings; live tests (one call each); telemetry/OTel enrichment; GitHub Actions workflow; Container Apps YAML; PostgreSQL port
when phase 2 starts; Prompt Shields + AI Evaluation SDK sampling (phase 2).

## 24. Risks / trade-offs

| Risk | Mitigation |
|---|---|
| Azure OpenAI model availability/quota on Azure for Students | check quota first; accept `gpt-4o-mini` substitute; keep stub for dev only |
| Search Free tier unavailable | local hybrid retriever for the first live test; decide Basic separately |
| SEBI site changes / blocks scraping | fixtures + labelled snapshot fallback; RSS where available; scheduled polling low-frequency |
| Strict schema rejected by the service for a model | per-schema fallback to JSON mode (already built) |
| Jev outage | Foundry-emulation judge labelled uncalibrated; never fixtures outside dev |
| Prompt injection via circular text | untrusted-input rules, code verbatim checks, Prompt Shields (phase 2) |
| Credit burn from loops | budgets, one-call tests, scheduled off, stop-on-failure rule |
| SQLite on Azure Files under concurrency | single replica; PostgreSQL in phase 2 |
| Over-scoping for the deadline | MVP = 7 resources, everything else explicitly deferred |

## 25. Final recommended architecture

**MVP:** Foundry resource + project (`gpt-4.1-mini`, `text-embedding-3-small`, Responses API, strict outputs) · Azure AI Search
Free with one filtered multi-tenant index and chunk-hash incremental indexing · per-obligation hybrid retrieval → Jev rerank →
Jev alignment → code gate → Foundry escalation/memo · human approval → GitHub · SQLite locally · Application Insights · identity-
based auth. **Phase 2:** Blob originals, PostgreSQL, Container Apps + Functions timer, Key Vault + managed identity, Document
Intelligence, Prompt Shields, Foundry tracing + AI Evaluation SDK sampling, RBI connector. **Never:** agent loops owning
state, a separate vector DB, web search as a source of record, AI-initiated policy edits or tickets.
