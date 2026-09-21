# AfterCircular — Jev-first architecture review, manual Azure setup, and live-test readiness

No code was changed for this document. Every file/line reference is to the repository at commit `3940d55`.
Portal labels change often; anything marked **VERIFY** should be checked against the screen in front of you.

---

## PART 1 — Architecture review: where Jev is, where it should be

### 1.1 Where Jev exists today

| File | Role |
|---|---|
| `backend/app/decisions/providers.py` | `TypeSafeJudgmentProvider` (SDK `typesafe_sdk`, `POST /v1/systemone`, model `jev-latest`), `FoundryJudgmentProvider` (uncalibrated emulation), `StubJudgmentProvider` (fixtures, dev only), `judge_for(task)` routing by `DECISION_ROUTES` / `DEFAULT_JUDGE` |
| `backend/app/decisions/questions.py` | question builders: `extraction_check_questions`, `applicability_questions`, `rerank_questions`, `alignment_questions`, `verification_questions` (`MAX_OBLIGATIONS = 8`) |
| `backend/app/decisions/policy.py` | every threshold (Noul band 0.30–0.70, `applicability_min_confidence` 0.60, `not_applicable_min_confidence` 0.80, `relevant_min` 0.45, `rerank_keep` 5, `alignment_min_confidence` 0.70, `conflict_probability_escalate_min` 0.30, `verify_min_confidence` 0.80) |
| `backend/app/decisions/impact.py` | the five stages + escalation + orchestration (`decide_impact`) |
| `backend/app/services/investigate.py` | **"Ask AfterCircular" router** — Jev `Choice` over 8 intents + document/policy target; code assembles the answer; **no generative call anywhere** in this path |
| `backend/app/services/pipeline.py` | calls Foundry extraction first, then `decide_impact` |
| `backend/evals/judges.py`, `tests/test_decisions.py` | calibration harness and stage tests (one live Jev test, skipped without key) |

### 1.2 Jev calls that exist, per document (today's order)

| # | Stage | Requests | When | Purpose |
|---|---|---|---|---|
| — | Foundry **extraction** | 1 Foundry | **always, first** | obligations with verbatim evidence |
| 1 | `extraction_check` | 1 | after extraction | 2 Nouls per obligation: stated? excerpt supports? (+ code verbatim check) |
| 2 | `applicability` | 1 | after 1 | 3 Nouls + Choice(applies/does_not_apply/cannot_tell) + Score(severity) |
| 3 | `rerank` | 1 per candidate (≤ 10) | applicability ≠ NO | relevance Noul per chunk |
| 4 | `alignment` | 1 per kept chunk (≤ 5), N questions each | after 3 | Choice satisfies/conflicts/not_addressed per (obligation, chunk) |
| 5 | `verification` | 1 per conflict (≤ 6) | after 4 | citation check: section supports/contradicts/says_nothing the claim |
| — | Foundry **escalation** | ≤ 1 Foundry | only uncertain/unverified | reasoning over TOON context |
| — | Foundry **memo** | ≤ 1 Foundry | only CONFLICT | draft |
| A | `ask` (investigator) | 1 per question | user question | intent + target routing |

Typical relevant document: 1 Foundry + ~15 Jev (+ ≤ 2 Foundry). **Irrelevant document today: 1 Foundry + 2 Jev** — the
extraction call is spent before anyone asks whether the circular concerns this company. That is the waste to remove.

### 1.3 Which calls should become pre-LLM gates

**Add one: `triage` (new), before extraction.** State: circular title, addressee block (SEBI circulars open with
"To, All Stock Brokers / Mutual Funds / …"), subject line, first ~1,500 characters, `applies_to` guessed by regex, plus the
company profile from the manifest. Questions (one request): `entity_in_scope` Noul, `subject_in_scope` Noul (does the subject
touch a listed segment/registration/topic), `depends_on_unstated_fact` Noul, `relevance` Choice(applies / does_not_apply /
cannot_tell), `ambiguity` Noul (is the addressee/subject explicit enough to decide from the header alone?).
Routing (code): `does_not_apply` with confidence ≥ `not_applicable_min_confidence` (0.80) **and** `entity_in_scope` ≤ 0.30 →
archive as NOT_APPLICABLE with the header as evidence, **no Foundry call**; anything else → proceed to extraction. Uncertain never
archives; the safe direction is to spend the extraction call.

**Move, not add: `applicability` stays post-extraction but becomes conditional.** It still adds value after extraction because
obligations make "activity in scope" precise (an AMC circular can still bind a broker's distribution arm). Run it only when
triage was `cannot_tell` or `applies` with confidence < 0.90, or when extraction's `applies_to` disagrees with the addressee
regex. Otherwise reuse the triage judgment (recorded as such). Saves one Jev call on clear-cut circulars; never skips it
when there is doubt.

**Nothing else moves earlier.** Rerank, alignment, verification need retrieved evidence by definition.

### 1.4 Which calls remain post-retrieval verification

`extraction_check` (guards Foundry's extraction — keep, it is the cheapest hallucination filter you have), `rerank` (halves the
alignment fan-out and replaces the semantic ranker on the Free tier), `alignment` (the core comparison), `verification` (citation
check before a human sees a conflict). All four stay exactly where they are.

**Add one: `cross_check` after Foundry escalation** (1 request, only when escalation ran). Take the pair(s) Foundry cited
(`policy_evidence` × the obligation it names) and ask the same `alignment` Choice. Disagreement rule in §1.8.

### 1.5 Jev router for "Ask AfterCircular" — it already exists; extend, don't rebuild

`investigate.route()` already does Jev intent + target routing and the answer is assembled from the DB — the three examples in
the brief already behave as wanted except for clarification:

| Question | Today | Recommended |
|---|---|---|
| "What changed?" | intent `latest_changes`, list from DB | same, **plus** when `intent_confidence` < 0.5 or the target is ambiguous (several documents plausible: top-2 document probabilities within 0.2 of each other) → return a **clarification** card ("Did you mean the latest scan, or a specific circular: A / B?") instead of `other` |
| "Show unresolved SEBI conflicts" | `conflicts` → DB query | same (deterministic; no model) |
| "Why did the latest SEBI circular conflict with our AML policy?" | `explain_document` → stored analysis (evidence, decision path, escalation reason) — **no new reasoning call** | same by default. Add an explicit `deep_explain` intent that is only executed behind a user click ("Explain further") and one Foundry call under the scan budget; never automatically |

Add two questions to the existing single request (no extra call): `ambiguity` Noul ("does the question need a clarifying detail
before it can be answered precisely?") and `needs_reasoning` Noul ("does answering require weighing evidence rather than
listing facts?"). Latency stays one Jev request.

### 1.6 Deterministic checks before Jev (so Jev calls aren't wasted either)

In `pipeline.detect()` / a new `prefilter()` step, in this order, all free:
1. content hash already processed → skip (exists).
2. `document_type` not in {circular, master circular, guideline} (press releases, orders, informal guidance) → archive as
   `NOT_APPLICABLE:document_type` without any model call.
3. regulator/jurisdiction not in the manifest's `regulator` list → archive.
4. addressee regex on the first 30 lines (`^To,?\s*(.+?)(?=\n\s*\n|Sub)`): map phrases (stock brokers, mutual funds, AMCs,
   depositories, AIFs, portfolio managers, RTAs…) to entity types; if the manifest's registration types have **no** overlap and
   the addressee block is unambiguous → *still* ask Jev triage (archiving is consequential) but pass `addressee_match=false`
   so the header question is cheap and confident; if overlap → skip triage, go straight to extraction (`applies` is likely).
5. title keyword overlap with manifest `regulator_topics` recorded as a feature, not a decision.
6. effective date older than the tenant's connection date by > 1 year and status "superseded" (when the source says so) → archive.
7. length sanity: empty / < 300 chars (PDF extraction failed) → `NEEDS_INVESTIGATION:unreadable`, no model calls.

Rerank/alignment pre-checks: skip `rerank` when hybrid retrieval returned ≤ `rerank_keep` candidates (nothing to cut); skip
`alignment` for chunks whose `doc_id` was retired; dedupe identical chunk text before any judgment (exists in `budget_chunks`).

### 1.7 When Jev is uncertain

Never rounded. Triage uncertain → extract (spend Foundry, do not archive). Applicability uncertain → Foundry escalation, then
human. Rerank uncertain (Noul in band) → keep the chunk (recall over precision). Alignment below confidence with P(conflicts)
≥ 0.30 → escalation; below 0.30 → harmless, treated as not addressed. Verification below 0.80 → keep the conflict, flag "human
should confirm". Ask router below 0.5 → clarification, not a guess. All of this is already the policy in `policy.py` except the
triage and clarification rules, which follow the same shape.

### 1.8 When Jev and Foundry disagree

| Jev (pairs) | Foundry (escalation) | Outcome |
|---|---|---|
| conflicts, verified | — (escalation not run) | CONFLICT |
| uncertain | CONFLICT with policy evidence | run `cross_check` on the cited pair: Jev `conflicts` ≥ 0.70 → CONFLICT (both recorded); Jev `satisfies` ≥ 0.70 → **UNCERTAIN → human**, both opinions shown; otherwise UNCERTAIN |
| uncertain | ALIGNED | if any pair had P(conflicts) ≥ 0.50 → UNCERTAIN → human; else ALIGNED with the escalation recorded |
| uncertain | NOT_APPLICABLE | never archive on Foundry's word alone after Jev said applicable → UNCERTAIN → human |
| any | Foundry error / schema failure | current behaviour: human, no guess |

Rule: disagreement is information, and it always resolves toward a person, never toward silence (archive) or toward a ticket.

### 1.9 Where Jev reduces Foundry calls/latency vs where it only adds latency

| Placement | Foundry calls saved | Added latency | Verdict |
|---|---|---|---|
| `triage` before extraction | 1 extraction per irrelevant circular (for a single-sector company this is most SEBI circulars) | ~1 s on relevant ones | **add** |
| deterministic prefilter | saves even the triage call on press releases / wrong regulator | 0 | **add** |
| conditional `applicability` | 1 Jev call on clear cases; 0 Foundry | −1 s | **add** |
| `rerank` | halves alignment fan-out; enables Free-tier Search | ~1 s (parallel) | keep |
| `alignment` + `verification` | avoids Foundry reasoning on every document (escalation only when uncertain) — this is the main saver already in place | ~2 s | keep |
| `cross_check` after escalation | 0 Foundry; prevents a wrong ticket | ~1 s, rare | **add** |
| Jev before **memo** | none — memo only runs after CONFLICT is already verified | +1 s | **do not add** |
| Jev before **extraction on every doc regardless of prefilter** | none beyond triage | +1 s | do not add |
| Jev in Ask | prevents any generative call (already true) | ~1 s | keep; add clarification |
| a second Jev "second opinion" on every alignment pair | none | +100 % Jev calls | do not add |

Bound Jev fan-out with the same `Semaphore(MAX_CONCURRENT_CALLS)` as Foundry (today `asyncio.gather` is unbounded).

### 1.10 Final recommended execution flow

```
connector (SEBI/RBI, deterministic) → hash/dedup → prefilter (type, regulator, addressee, length)         [code, 0 calls]
  └─ archived:document_type / unreadable
  ↓
Jev triage (1 request; skipped when addressee clearly matches)                                            [Jev, ≤1]
  ├─ does_not_apply ≥0.80 & entity_in_scope ≤0.30 → ARCHIVE NOT_APPLICABLE (header evidence)             0 Foundry
  └─ applies / cannot_tell ↓
Foundry extraction (strict schema)                                                                        [Foundry, 1]
  ↓
Jev extraction_check (1) → code verbatim check                                                            [Jev, 1]
Jev applicability (only if triage <0.90 or applies_to ≠ addressee)                                        [Jev, 0–1]
  ├─ NO ≥0.80 → ARCHIVE
  ↓
Azure AI Search: per-obligation hybrid (BM25+vector, RRF, tenant filter) → union, dedupe                  [Search, ≤8; embed 1]
Jev rerank (≤10, parallel, bounded)                                                                       [Jev, ≤10]
Jev alignment (≤5 chunks × N obligations)                                                                 [Jev, ≤5]
Jev verification (≤6 conflicts)                                                                           [Jev, ≤6]
  ↓ code gate
  ├─ ALIGNED → archive (evidence)            ├─ CONFLICT verified → Foundry memo (1) → review → HUMAN → GitHub
  └─ uncertain → Foundry escalation (1, TOON) → Jev cross_check (1) → CONFLICT | ALIGNED | UNCERTAIN→human
Ask: Jev route (1) → deterministic answer | clarification | (user-clicked) deep_explain → Foundry (1)
```
Budget per relevant document: Foundry 1–3, Jev ≤ 24, embeddings 1 batch. Per irrelevant document: Foundry 0, Jev ≤ 1.
`MAX_LLM_CALLS_PER_SCAN=10` already covers three documents' worst case; keep it.

---

## PART 2 — Manual Azure Portal setup (MVP, credit-safe)

Backend stays **local**. Create in this order. Names below fit Azure limits; region: pick the one where the model catalog shows
your chosen chat + embedding models with quota (§3) — decide the region **before** step 2 because resources can't move.

### Classification

| Resource | Status | Why | Credit risk |
|---|---|---|---|
| Resource group `rg-aftercircular-dev` | REQUIRED | container | none |
| Foundry resource `aif-aftercircular-dev` | REQUIRED | models | none until deployments are used |
| Foundry project `proj-aftercircular-dev` | REQUIRED (for AI-103; not for inference) | tracing/evals/catalog surface | none |
| Chat deployment | REQUIRED | extraction, reasoning, memo | pay-per-token; $0 idle (Global Standard). Never "Provisioned" |
| Embedding deployment | REQUIRED for vector search | chunk + obligation vectors | pay-per-token; negligible |
| Azure AI Search `srch-aftercircular-dev` **Free** | REQUIRED (if Free available) | hybrid index | Free = $0. **Basic = always-on billing → do not pick** |
| Search index `policies-dev` | REQUIRED | the corpus | none (inside the service) |
| Application Insights `appi-aftercircular-dev` + Log Analytics | OPTIONAL now (recommended: it's free and the exporter is already wired) | traces/tokens/cost view; connect to the project | free tier (5 GB/mo) — a demo emits KB |
| Storage account, Blob | PHASE 2 | raw PDFs/originals when hosting | cents |
| Key Vault, managed identity | PHASE 2 | only meaningful once the backend runs in Azure | cents |
| Container Apps, ACR, Functions | PHASE 2 | hosting/scheduling after local live tests pass | free grants / small |
| PostgreSQL | PHASE 2 | multi-replica state | always-on unless stopped |
| Document Intelligence, Content Safety | PHASE 2 | scanned PDFs, Prompt Shields | free tiers exist |
| AKS, Cosmos, Service Bus, Event Grid, Redis, APIM | NOT NEEDED | — | — |

### Click-by-click

**Step 1 — Resource group** (portal.azure.com)
Search bar → "Resource groups" → **+ Create** → Subscription: *Azure for Students* → Name `rg-aftercircular-dev` → Region: the
one you chose → Review + create → Create.

**Step 2 — Foundry resource**
Search bar → "Azure AI Foundry" (or "AI Foundry" / "Foundry" — VERIFY current listing name) → **+ Create** → choose the
**Azure AI Foundry resource** option (kind *AIServices*, not the older "Azure OpenAI" account, so a project can live under it) →
Subscription / RG `rg-aftercircular-dev` / Region → Name `aif-aftercircular-dev` → Pricing tier **S0** (the only tier; billing is
per use) → Networking: All networks (default; fine for a local backend) → Identity: system-assigned On → Review + create.
When deployed, open the resource → **Keys and Endpoint**: note the endpoint URL (it will be `https://aif-aftercircular-dev.openai.azure.com/`
or `https://aif-aftercircular-dev.services.ai.azure.com/` — both support `/openai/v1/`; VERIFY which is shown). Do **not** copy
keys anywhere yet; we will try identity first.

**Step 3 — Foundry project**
Open ai.azure.com → sign in → **+ Create project** (or "New project") → choose the existing resource `aif-aftercircular-dev` →
Name `proj-aftercircular-dev` → Create. Note the **project endpoint** shown on the project Overview (`…/api/projects/proj-aftercircular-dev`).
It is for tracing/evals only; inference uses the resource endpoint.

**Step 4 — Chat deployment** (after §3 selection)
Project → **Models + endpoints** (or "Deployments") → **+ Deploy model → Deploy base model** → search the model chosen in §3 →
Confirm → Deployment name = **the model name** (e.g. `gpt-4.1-mini`; keep names = model for clarity) → Deployment type
**Global Standard** → Model version: the default/latest non-retiring one (see "Model deprecations" — VERIFY) → Tokens per minute
rate limit: **10K** (lowest sensible; raise later) → Content filter: default → Deploy.

**Step 5 — Embedding deployment**
Same path → `text-embedding-3-small` (or what the catalog offers, §3) → Deployment type **Standard** (embeddings usually only
offer Standard) → TPM 10K–20K → Deploy. Note its dimensions (1536 for 3-small; 3072 for 3-large).

**Step 6 — Azure AI Search**
Portal search bar → "AI Search" → **+ Create** → Subscription / RG → Service name `srch-aftercircular-dev` (must be globally
unique, lowercase, hyphens ok) → Location: same region as above (VERIFY Free is offered there; Free is not in every region) →
**Pricing tier → "Change Pricing Tier" → Free** → Review + create. If Free is greyed out ("already used in this subscription" or
unavailable in region): **stop** — do not pick Basic; tell me, we keep the built-in local hybrid retriever for the first live test.
After creation: **Settings → Keys** → set API access control to **Both** (key + role-based) — VERIFY label; **Access control (IAM)**
→ Add role assignment → **Search Index Data Contributor** and **Search Service Contributor** → your user.

**Step 7 — Search index `policies-dev`**
Recommended: let the backend create it (one approved, free call — `SearchIndexClient.create_or_update_index`) so the vector
profile is exactly right, then inspect it in the portal (**Indexes → policies-dev → Fields**). If you want to build it by hand:
Search service → **Indexes → + Add index** → name `policies-dev` → add the fields in §4 → for `vector`: **+ Add vector field**,
dimensions = embedding dims, create a vector profile with algorithm **HNSW** (cosine) → Create. Any mismatch is reconciled by
the code later (types can't be changed; if in doubt delete the empty index and let the code create it).

**Step 8 — Application Insights (optional now)**
Portal → "Application Insights" → **+ Create** → RG → Name `appi-aftercircular-dev` → Region → Workspace: create new
`log-aftercircular-dev` → Review + create. Copy the **Connection string** into `backend/.env` yourself (it is a credential-ish
value; treat as secret). Then in the Foundry project → **Tracing** → connect this resource (VERIFY location of the button).

**Step 9 — RBAC for your user on the Foundry resource**
Foundry resource → **Access control (IAM)** → Add role assignment → **Cognitive Services OpenAI User** (data-plane; Owner/Contributor
is *not* enough for the v1 API with Entra tokens — VERIFY) → your user. Takes ~5 minutes to propagate. This lets
`FOUNDRY_API_KEY` stay empty locally via `az login`.

**Step 10 — Cost guard**
Subscription → **Cost Management → Budgets → + Add** → monthly amount e.g. $20 → alerts at 50/80/100 %. Free, and the
single most useful thing on a Students subscription.

---

## PART 3 — Model selection (inspect first, then choose)

Where to look (three places, no cost):
1. **ai.azure.com → Model catalog** → filters: *Deployment options = Azure OpenAI/Foundry models*, *Region availability = your
   region*, *Capabilities = chat / embeddings*. Open a model card → "Deployment options" shows Global Standard vs Provisioned.
2. **Project → Management center → Quota** (or Azure portal → resource → **Quotas**): per model per region: TPM used/available.
   0 available ⇒ that model needs a quota request on this subscription; pick another.
3. **Model deprecations / lifecycle** page (search "model retirements" in Learn — VERIFY link) — avoid versions with a retirement
   date inside the project timeline.

Selection rule for the MVP:
- Chat: the **smallest current "mini"-class model with Global Standard availability and quota** in your region. Candidates in
  order of preference (if present): `gpt-4.1-mini` → `gpt-5-mini` → `gpt-4o-mini`. Requirements the code needs: structured
  outputs (JSON Schema, strict) and the Responses API — all three support them (VERIFY on the card for `gpt-5-mini`; it may also
  need `temperature` omitted — the provider passes `temperature=0`, which is one config change if rejected).
- Embedding: `text-embedding-3-small` (1536 dims) unless unavailable; `text-embedding-3-large` only if 3-small is absent (set
  dimensions accordingly; 6× the token price for no measured gain here).

One chat deployment **can and should** serve extraction, impact reasoning and memo: set `EXTRACTION_MODEL`, `IMPACT_MODEL`,
`MEMO_MODEL` to the same deployment name. The code routes by task name, so a second deployment later is a one-line env change.

A second, stronger model is justified only when measured: run `evals` on the golden set with the mini model as `IMPACT_MODEL`;
if escalation flips a labelled CONFLICT/ALIGNED case or the memo's `proposed_amendment` is unusable in ≥ 2 of 5 samples, deploy
`gpt-4.1` (or `gpt-5`) as `IMPACT_MODEL` only — it is reached only for escalations, so its cost stays bounded.

---

## PART 4 — Azure AI Search architecture (confirmed, with one change to the code plan)

**One index per environment, tenant isolation by filter.** Today's code creates `policies-<tenant_id>` (`azure_search.py:index_name`);
that will change to a single `AZURE_SEARCH_INDEX=policies-dev` with a `$filter` on `tenant_id` — a code change to approve
after the resources exist. The Free tier's 3-index limit makes the single index mandatory, not just cleaner.

Fields (Edm types; attributes):

| Field | Type | Attributes |
|---|---|---|
| `id` | String | key (hash of `tenant|doc_id|version|section`) |
| `tenant_id` | String | filterable, facetable |
| `doc_id` | String | filterable, facetable |
| `title` | String | searchable |
| `category` | String | filterable |
| `path` | String | retrievable |
| `version` | String | filterable |
| `effective_date` | DateTimeOffset | filterable, sortable |
| `status` | String | filterable (`active` / `retired`) |
| `section` | String | retrievable |
| `regulator` | String | filterable |
| `jurisdiction` | String | filterable |
| `topics` | Collection(String) | filterable, facetable |
| `commit_sha` | String | filterable |
| `chunk_hash` | String | filterable |
| `text` | String | searchable, analyzer `en.microsoft` |
| `vector` | Collection(Single) | searchable, dimensions = embedding dims, vector profile `hnsw` (cosine) |

Capabilities confirmed for this design: **vector search** (HNSW) — yes on all current tiers including Free (VERIFY current
Free-tier vector storage quota); **BM25 full-text** — yes; **hybrid** — one query with `search_text` + `vector_queries`; **RRF** —
applied by the service automatically for hybrid; **semantic ranker** — not on Free (needs Basic+, per-query billing; VERIFY) →
Jev rerank stands in, measured. Filters: `tenant_id eq 'x' and status eq 'active'` on every query, set by the backend only.
No Pinecone/Qdrant/pgvector.

---

## PART 5 — What Claude Code needs from Azure (exact variable names from `backend/app/config.py`)

| Variable / credential | Required? | Where obtained in Azure | Used by | Secret? |
|---|---|---|---|---|
| `AI_PROVIDER=foundry` | yes | — | `models/provider.py` | no |
| `FOUNDRY_ENDPOINT` | yes | Foundry resource → Keys and Endpoint (resource endpoint, not project) | `FoundryProvider` (`<endpoint>/openai/v1/`) | no |
| `FOUNDRY_API_KEY` | **no** if RBAC works (leave empty → `DefaultAzureCredential` via `az login`) | resource → Keys and Endpoint → Key 1 | `FoundryProvider` | **yes** |
| `FOUNDRY_PROJECT_ENDPOINT` | optional (docs/tracing only) | project Overview | recorded, not used for inference | no |
| `FOUNDRY_API` (`responses` default / `chat`) | no | — | `FoundryProvider` | no |
| `EXTRACTION_MODEL`, `IMPACT_MODEL`, `MEMO_MODEL` | yes | deployment names (Models + endpoints) | task routing | no |
| `EMBEDDING_MODEL` | yes (vector search) | embedding deployment name | `embed()` | no |
| API version | **not needed** (v1 API) | — | — | — |
| `AZURE_SEARCH_ENDPOINT` | yes (else local retriever) | Search service Overview → Url | `AzureSearchRetriever` | no |
| `AZURE_SEARCH_API_KEY` | **no** if RBAC roles assigned (empty → `DefaultAzureCredential`) | Search → Keys → Admin key | `AzureSearchRetriever` | **yes** |
| `AZURE_SEARCH_SEMANTIC_CONFIG` | no (empty on Free) | — | optional L2 | no |
| Search API version | not needed (SDK default) | — | — | — |
| `TYPESAFE_API_KEY` (alias `TYPE_SAFE_API_KEY`, already set) | yes | console.typesafe.ai | `TypeSafeJudgmentProvider` | **yes** |
| `TYPESAFE_MODEL` (`jev-latest`) | no | — | same | no |
| Jev endpoint | not configurable (SDK default host) | — | — | — |
| `DEFAULT_JUDGE`, `DECISION_ROUTES`, `DECISION_THRESHOLDS` | no | — | `judge_for`, `policy.py` | no |
| GitHub repository | per tenant (web connect flow; header `X-Tenant-Repo`) | — | `GitHubClient` | no |
| GitHub user token | via signed-in session (`X-GitHub-Token`) | GitHub OAuth | issue creation on approval | **yes** (never in `.env`) |
| `GITHUB_TOKEN` (backend fallback) | **no** for tests — keep empty so no scheduled/approval path can create issues without a person's session | GitHub PAT | `GitHubClient` fallback | **yes** |
| `APPLICATIONINSIGHTS_CONNECTION_STRING` | optional | App Insights → Overview | `main.py` exporter | treat as secret |
| `ENVIRONMENT=dev` | yes (stub allowed only here) | — | provider/judge fail-safes | no |
| `AFTERCIRCULAR_MAX_DOCUMENTS_PER_SCAN=1`, `…MAX_LLM_CALLS_PER_SCAN=10`, `…MAX_RETRIES=2`, `…MAX_CONCURRENT_CALLS=2`, `…ENABLE_LIVE_SCAN=true`, `…ENABLE_SCHEDULED_SCAN=false` | yes (defaults already match) | — | pipeline/provider | no |
| `TOON_CONTEXT`, `MAX_OBLIGATIONS_IN_CONTEXT`, `MAX_POLICY_CHUNKS`, `MAX_EVIDENCE_ITEMS`, `MAX_EVIDENCE_TOKENS`, `MAX_CONTEXT_TOKENS` | no (defaults) | — | `agents/context.py` | no |
| `SEBI_MODE=snapshot` for the first live test (`live` later), `SEBI_MAX_DOCUMENTS=5` | yes | — | connector | no |
| `BACKEND_API_KEY`, `DATABASE_PATH`, `CORS_ORIGINS` | existing | — | API/proxy | key: yes |
| web: `BACKEND_URL`, `BACKEND_API_KEY`, `AUTH_SECRET`, `AUTH_GITHUB_ID/SECRET` | existing | — | Next.js | secrets except URL |

A. **Exist in code:** everything above except the two below.
B. **To add (with the single-index code change):** `AZURE_SEARCH_INDEX` (default `policies-dev`), `EMBEDDING_DIMENSIONS` (default 1536).
C. **Not secrets:** endpoints, deployment names, index name, flags, budgets, environment, project endpoint.
D. **Never commit:** `FOUNDRY_API_KEY`, `AZURE_SEARCH_API_KEY`, `TYPESAFE_API_KEY`, `GITHUB_TOKEN`, `APPLICATIONINSIGHTS_CONNECTION_STRING`,
   `BACKEND_API_KEY`, `AUTH_*` (`.env` and `.env.local` are git-ignored — verified).
E. **Replaced by managed identity later:** `FOUNDRY_API_KEY`, `AZURE_SEARCH_API_KEY` (already optional today via `DefaultAzureCredential`).

---

## PART 6 — Live test plan (bounded; one call per step; stop on first failure)

All commands run in `backend/`. Prerequisite each time: `az login` session valid (identity path) and `backend/.env` filled.

| # | Command | Proves | Foundry | Jev | Search | GitHub |
|---|---|---|---|---|---|---|
| 0 | `uv run pytest -q && uv run mypy app` | nothing regressed; stub-only | 0 | 0 | 0 | 0 |
| 0b | `uv run python -m evals.toon_benchmark` | TOON token table (local) | 0 | 0 | 0 | 0 |
| 1 | `uv run python scripts/live_check.py smoke` | Responses API + strict schema + auth on your deployment; prints tokens/latency/cost | **1** (~60 tokens) | 0 | 0 | 0 |
| 2 | `uv run python scripts/live_check.py extract` | real obligation extraction on DEMO-2026-014 (fictional, sanitized); writes `evals/results/live_extraction_demo014.json` | **1** (~5k in / ~1.5k out) | 0 | 0 | 0 |
| 3 | `uv run python scripts/live_check.py embed` | embedding deployment, dims, latency | **1 embed** | 0 | 0 | 0 |
| 4 | `uv run python scripts/live_check.py jev` | Jev applicability (already passed once) | 0 | **1** | 0 | 0 |
| 5 | `uv run python scripts/live_check.py search` | index creation + hybrid query returns POL-001. **Note:** this embeds the Acme corpus (~40 chunks, one batched call, < $0.001) and creates index `policies-live-check` under today's per-tenant naming — say "approve corpus embedding" first | **2 embed** | 0 | **1 index + 1 query** | 0 |
| 6 | `uv run python scripts/live_check.py impact` | impact reasoning with TOON context, expects YES/CONFLICT | **1** | 0 | 0 | 0 |
| 7 | `uv run python scripts/live_check.py memo` | memo draft (this step is only meaningful because 6 said CONFLICT) | **1** | 0 | 0 | 0 |
| 8 | UI: switch to Acme tenant → **Scan now** (with `SEBI_MODE=snapshot`, `MAX_DOCUMENTS_PER_SCAN=1`) | full pipeline on one document: extraction → retrieval → Jev stages → gate → memo → review row | ≤ 3 | ≤ 24 | ≤ 10 | 0 |
| 9 | UI: **Scan now** again | idempotency: `1 already processed`, `llm_calls = 0` | 0 | 0 | 0 | 0 |
| 10 | UI: Reviews → **Approve** (only when you decide to) | the one side effect: issue with `AfterCircular-Analysis-ID`; approve twice → same issue | 0 | 0 | 0 | **1 issue** |
| 11 | `uv run python scripts/live_check.py toon-live` | same impact payload as TOON and JSON → tokens/latency/decision | **2** | 0 | 0 | 0 |
| — | `uv run python -m evals.run` | **not now** — runs every scenario × task × model | many | — | — | — |
| — | `uv run pytest -k live` | the single live Jev test in `tests/test_decisions.py::test_live_jev_applicability` | 0 | 1 | 0 | 0 |

Preventing accidental GitHub issues: issues are created **only** by `POST /api/reviews/{id}/approve`, which the UI calls when
you click Approve; keep `GITHUB_TOKEN` empty in `backend/.env` (no server-side path can create one), keep
`AFTERCIRCULAR_ENABLE_SCHEDULED_SCAN=false`, and simply do not click Approve until step 10. The Nimbus tenant already has an
`AWAITING_REVIEW` row from the stub run — leave it alone or reject it.

Credit envelope for the whole plan: ≈ 12 Foundry chat calls + 4 embedding calls ≈ **cents**, far inside $100. The `evals.run`
harness and repeated scans are the only things that could grow cost; both are off this list.

What success looks like: each `live_check` step prints a JSON block like
`{"model": "<deployment>", "provider": "foundry", "latency_ms": …, "input_tokens": …, "output_tokens": …, "cached_tokens": 0|n, "estimated_cost_usd": 0.00x, "context_format": "toon", "structured_mode": "json_schema", "attempts": 1}`
and exits 0; step 8 ends with a green "Scan completed · 1 new · 0 already processed" toast and one document in **Needs review**
with `decision_path` showing `typesafe:…` stages and `foundry` only at extraction/memo; step 9 shows `1 already processed`.

---

## PART 7 — AFTERCIRCULAR — READY FOR FIRST AZURE LIVE TEST

LOCAL
[ ] `brew install azure-cli` done; `az version` prints
[ ] `az login` done; `az account show` = Azure for Students, `state: Enabled`
[ ] `cd backend && uv sync` clean; `uv run pytest -q` → 38 passed; `uv run mypy app` clean
[ ] backend on :8010 restarted after `.env` edits; web on :3000 pointing at it (`BACKEND_URL`)
[ ] local corpus clone at `~/Desktop/acme-securities-policies` (used by `live_check.py search`)

AZURE
[ ] `rg-aftercircular-dev` exists in the chosen region
[ ] Budget alert set in Cost Management
[ ] Remaining Students credit noted (Education → Overview)

FOUNDRY
[ ] `aif-aftercircular-dev` created (AIServices kind), endpoint noted
[ ] `proj-aftercircular-dev` created; project endpoint noted (optional)
[ ] chat deployment exists, **Global Standard**, TPM 10K, name recorded
[ ] embedding deployment exists, dims recorded
[ ] your user has **Cognitive Services OpenAI User** on the resource (or you decided to use Key 1 locally)
[ ] quota page shows available TPM for both models

JEV
[ ] `TYPE_SAFE_API_KEY` present in `backend/.env` (already)
[ ] `uv run python scripts/live_check.py jev` passed (already once; re-run is optional)

AI SEARCH
[ ] `srch-aftercircular-dev` created on **Free** (or explicitly deferred → local retriever)
[ ] API access = key **and** RBAC; your user has Search Index Data Contributor + Search Service Contributor
[ ] index `policies-dev` created by code (approved) or by hand per PART 4
[ ] `AZURE_SEARCH_INDEX` single-index code change approved (or first test on per-tenant naming, knowing the Free-tier 3-index cap)

GITHUB
[ ] signed in to the web app as the repo owner; Acme tenant selected
[ ] `GITHUB_TOKEN` **empty** in `backend/.env`; scheduled scan **false**
[ ] you know that only the Approve button creates an issue

ENV VARIABLES (`backend/.env`, never committed)
[ ] `AI_PROVIDER=foundry`, `FOUNDRY_ENDPOINT`, `FOUNDRY_API=responses`
[ ] `EXTRACTION_MODEL` = `IMPACT_MODEL` = `MEMO_MODEL` = chat deployment; `EMBEDDING_MODEL` = embedding deployment
[ ] `FOUNDRY_API_KEY` empty (identity) — or set locally only if RBAC fails
[ ] `AZURE_SEARCH_ENDPOINT` set (or empty for local retriever); `AZURE_SEARCH_API_KEY` empty (RBAC) or set locally
[ ] `ENVIRONMENT=dev`, `SEBI_MODE=snapshot`, `SEBI_MAX_DOCUMENTS=5`
[ ] `AFTERCIRCULAR_MAX_DOCUMENTS_PER_SCAN=1`, `…MAX_LLM_CALLS_PER_SCAN=10`, `…MAX_RETRIES=2`, `…MAX_CONCURRENT_CALLS=2`, `…ENABLE_SCHEDULED_SCAN=false`
[ ] `APPLICATIONINSIGHTS_CONNECTION_STRING` set only if App Insights was created
[ ] `git status` shows no `.env` files

SAFETY / COST
[ ] no Provisioned/PTU deployments anywhere; Search not on Basic
[ ] `evals.run` will not be executed against live models in this phase
[ ] one `live_check` step at a time; stop and report on the first non-zero exit
[ ] corpus embedding (~40 chunks) explicitly approved before step 5

FIRST LIVE TEST
[ ] `uv run python scripts/live_check.py smoke` → exit 0, `structured_mode: json_schema`, tokens printed → paste the JSON block into `azureDecision.md` §15
