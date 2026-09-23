# AfterCircular

**From regulatory change to compliance action.**

AfterCircular watches the Securities and Exchange Board of India (SEBI) for new circulars, extracts the obligations each
one imposes, checks them against a company's own policy documents, and — when it finds a conflict — drafts a compliance
memo and routes it to a person. Only after that person approves does anything happen outside the system: a GitHub issue
in the company's policy repository.

AI detects, analyses and drafts. A person decides.

Built for **AI-103 — Develop AI Apps and Agents on Azure** (Chitkara University).

| | |
|---|---|
| Live deployment | Azure Container Apps (Korea Central) — see [`DEPLOYMENT.md`](DEPLOYMENT.md) |
| Models | Microsoft Foundry `gpt-5-mini` (Responses API) · `text-embedding-3-small` · Jev (TypeSafe System One) for typed judgments |
| Retrieval | Azure AI Search — hybrid vector + keyword over each tenant's policy repository |
| Source | the official `www.sebi.gov.in` listing, circular pages and PDFs — no snapshots in production |

---

## Contents

1. [What it does](#what-it-does)
2. [Architecture](#architecture)
3. [Azure services](#azure-services)
4. [Repository layout](#repository-layout)
5. [Run it locally](#run-it-locally)
6. [Deploy it to Azure](#deploy-it-to-azure)
7. [Demo walkthrough](#demo-walkthrough)
8. [Testing and evaluation](#testing-and-evaluation)
9. [Cost and safety guards](#cost-and-safety-guards)
10. [Responsible AI and security](#responsible-ai-and-security)
11. [Known limitations](#known-limitations)
12. [Documentation](#documentation)

---

## What it does

| Capability | Upload a PDF to a chatbot | AfterCircular |
|---|---|---|
| Answer questions about a document, with citations | ✓ | ✓ |
| Monitor a live regulator and remember what it already processed | — | ✓ |
| Compare new obligations against the company's own policies | manual | ✓ (clause-level, both sides cited) |
| Decide applicability and alignment with calibrated probabilities | — | ✓ (Jev) |
| Take a real action — only after a human approves | — | ✓ (GitHub issue) |
| Keep companies isolated from each other | n/a | ✓ (tenant-scoped state, index and audit) |

A company connects its policy repository (any GitHub repository with an `aftercircular.yml` manifest). Each scan:

```
SEBI (live)  → fetch listing, circular pages and PDFs → content-hash detection and versioning (per tenant)
             → Jev triage: is this circular addressed to this kind of company?   not applicable → archived, no model call
             → Foundry: extract obligations, each with verbatim evidence          → Jev checks every obligation is supported
             → embeddings + Azure AI Search hybrid retrieval over the policy repository
             → Jev rerank and alignment (satisfies / conflicts / not addressed), citation check
             → deterministic Impact Gate on calibrated probabilities; uncertain → Foundry reasoning → still uncertain → a person
             → CONFLICT with two-sided evidence → Foundry drafts a memo → review AWAITING_REVIEW
             → a person approves → GitHub issue in the policy repository → audit event
```

The dashboard shows each stage live, a per-document trace (which service ran, why, latency, tokens, cost), the review
queue, the audit log, model usage, and **Ask** — a chat that answers from the workspace's records: Jev routes the
question and judges relevance and sufficiency, GPT-5 mini writes the answer, and every claim is validated against the
records it cites. Ask never takes an action; "approve it and open the issue" is refused.

## Architecture

```
Browser ──HTTPS──► Web (Next.js 16, Auth.js GitHub sign-in)          external ingress
                     │ server-side proxy: backend key + tenant headers + the user's GitHub token
                     ▼
                   API (FastAPI)                                      internal ingress, one replica
                     ├── SQLite on an Azure Files share (/data)       scans, documents, analyses, decisions, reviews, audit, telemetry
                     ├── Microsoft Foundry (managed identity)         gpt-5-mini · text-embedding-3-small
                     ├── Azure AI Search (managed identity)           policies-dev, tenant-filtered hybrid retrieval
                     ├── Jev / TypeSafe System One                    typed judgments with calibrated probabilities
                     ├── GitHub                                       read the policy repository; open an issue after approval
                     └── SEBI relay (Azure Container Instance)        www.sebi.gov.in drops TLS from Azure Korea Central
                   Application Insights + Log Analytics               dependencies, traces, container logs
```

**Model specialisation, not more agents.** Code owns control flow, hashing, thresholds, routing, approval, GitHub and
audit. Jev supplies fast, calibrated, typed judgments. Foundry handles generation and the hard reasoning cases. Azure
AI Search finds evidence. A person makes every consequential decision. Design, thresholds and trade-offs:
[`docs/architecture.md`](docs/architecture.md) and [`docs/ProductionArchitecture.md`](docs/ProductionArchitecture.md).

Every circular moves through one state machine (`DISCOVERED → … → COMPLETED`, or `NEEDS_INVESTIGATION` until a person
acts). Every transition is an audit row and every model judgment is a decision record (provider, model version, state
digest, evidence ids, probabilities, thresholds, routing).

## Azure services

| Service | Resource | Used for |
|---|---|---|
| Microsoft Foundry (AI Services) | `aif-aftercircular-dev`, project `proj-aftercircular-dev` | `gpt-5-mini` — obligation extraction, impact reasoning, memo drafting, Ask answers; `text-embedding-3-small` — policy and query embeddings |
| Azure AI Search (Free) | `srch-aftercircular-dev`, index `policies-dev` | hybrid (HNSW vector + keyword, RRF) retrieval, one index partitioned by `tenant_id` |
| Azure Container Apps | `acae-aftercircular-dev` → `aca-aftercircular-web`, `aca-aftercircular-api` | hosting; the API is internal-only |
| Azure Container Registry (Basic) | `acraftercirculardev` | images tagged by commit SHA |
| Azure Files | `staftercirculardev/aftercircular-data` | durable SQLite state for the single API replica |
| Azure Container Instances | `aci-aftercircular-sebi-relay` (East Asia) | CONNECT-only relay for the SEBI connector |
| Managed identities + RBAC | `id-aftercircular-api`, `id-aftercircular-web` | Foundry, Search and ACR access without keys |
| Application Insights + Log Analytics | `appi-aftercircular-dev`, `log-aftercircular-dev` | telemetry and logs |

## Repository layout

```
backend/            FastAPI service
  app/connectors/   SEBI connector (live listing → detail page → PDF text; LIVE_FAILED instead of any fallback)
  app/decisions/    Jev questions, routing thresholds, triage and impact decisions
  app/agents/       Foundry tasks: obligation extraction, impact analysis, memo
  app/retrieval/    Azure AI Search (and a local hybrid index for development)
  app/services/     scan pipeline, Impact Gate, reviews → GitHub, Ask, traces, demo reset, audit, state (SQLite)
  evals/            model and judge benchmarks, retrieval and Ask evaluations
  tests/            pytest suite (no network: stub provider, fixture policy corpus)
web/                Next.js 16 dashboard (App Router, Tailwind v4, Auth.js v5)
infra/sebi-proxy/   the SEBI relay (stdlib CONNECT tunnel) and its tests
scripts/            azure-build.sh · azure-deploy.sh · azure-smoke-test.sh
docs/               architecture, Azure setup runbook, demo runbook, SEBI connector, index schema
DEPLOYMENT.md       reproducible Azure deployment, verified state, problems and fixes
PRD.md              product requirements
```

Demo tenants (fictional companies, real structure): [`auraCodesKM/acme-securities-policies`](https://github.com/auraCodesKM/acme-securities-policies)
(a stock broker) and [`auraCodesKM/nimbus-amc-policies`](https://github.com/auraCodesKM/nimbus-amc-policies) (an asset
manager). The same SEBI circulars produce different results for each — which is the point.

## Run it locally

### Prerequisites

- Python 3.12 and [`uv`](https://docs.astral.sh/uv/) · Node.js 22 and npm · Azure CLI (`az login`)
- An Azure subscription with a Foundry resource (`gpt-5-mini` and `text-embedding-3-small` deployments) and an Azure AI
  Search service — [`DEPLOYMENT.md`](DEPLOYMENT.md) steps 0–2 create them; your user needs *Cognitive Services OpenAI User*
  and *Search Index Data Contributor* on them
- A TypeSafe API key for Jev ([console.typesafe.ai](https://console.typesafe.ai))
- A GitHub OAuth App with callback `http://localhost:3000/api/auth/callback/github`, and a policy repository with an
  `aftercircular.yml` manifest (fork one of the demo tenants)

### 1. Backend

```bash
cd backend
uv sync
cp .env.example .env
uv run uvicorn app.main:app --port 8010 --reload
```

Fill in `backend/.env` (it is git-ignored; never commit it):

| Variable | Value |
|---|---|
| `BACKEND_API_KEY` | any long random string — the web app sends the same one |
| `ENVIRONMENT` | `dev` |
| `AI_PROVIDER`, `FOUNDRY_ENDPOINT`, `FOUNDRY_API` | `foundry`, `https://<foundry>.openai.azure.com`, `responses` |
| `EXTRACTION_MODEL`, `IMPACT_MODEL`, `MEMO_MODEL`, `EMBEDDING_MODEL` | your deployment names (`gpt-5-mini`, `text-embedding-3-small`) |
| `AZURE_SEARCH_ENDPOINT`, `AZURE_SEARCH_INDEX` | `https://<search>.search.windows.net`, `policies-dev` |
| `SEBI_MODE`, `SEBI_SELECTED_ENTRY_IDS` | `live`, e.g. `102584,102762,102914,102986,103915,104387` |
| `TYPESAFE_API_KEY` | your Jev key |

Foundry and Search authenticate with `az login` (Entra ID) — leave their API-key variables empty. Every other setting,
including the cost limits, is documented in [`backend/.env.example`](backend/.env.example).

### 2. Frontend

```bash
cd web
npm install
cp .env.example .env.local
npm run dev          # http://localhost:3000
```

| Variable | Value |
|---|---|
| `AUTH_SECRET` | `npx auth secret` or `openssl rand -base64 32` |
| `AUTH_GITHUB_ID`, `AUTH_GITHUB_SECRET` | your GitHub OAuth App (scope `read:user user:email repo`) |
| `AUTH_TRUST_HOST` | `true` |
| `BACKEND_URL`, `BACKEND_API_KEY` | `http://localhost:8010`, the same key as the backend |

### 3. First scan

Sign in with GitHub → **Connect** (company name + policy repository) → **Scan now**. A scan of six circulars takes about
five minutes and a few US cents of model usage.

### Production-like, with containers

```bash
AC_UID=$(id -u) AC_GID=$(id -g) docker compose up --build     # web :3000, api :8010, database in ./backend/data
```

Inside a container `az login` is not available: export a service principal (`AZURE_TENANT_ID`, `AZURE_CLIENT_ID`,
`AZURE_CLIENT_SECRET`) for Foundry and Search, or run the backend on the host.

## Deploy it to Azure

[`DEPLOYMENT.md`](DEPLOYMENT.md) is the complete, verified runbook — Foundry and model deployments, Azure AI Search,
monitoring, ACR, Azure Files, a WorkloadProfiles Container Apps environment (created through ARM), managed identities
and roles, the SEBI relay, both container apps with every setting, GitHub sign-in, verification, operations, teardown,
and every problem we hit with its fix. In short:

```bash
./scripts/azure-build.sh                                   # build both images for linux/amd64, tag with the commit SHA, push to ACR
GIT_SHA=<sha> ./scripts/azure-deploy.sh                    # point both container apps at that tag
WEB_FQDN=<web fqdn> ./scripts/azure-smoke-test.sh          # web, API health (from inside the environment), production config
```

In production the API refuses to start without Foundry, Azure AI Search, `SEBI_MODE=live`, a Jev key, a real backend
key, explicit CORS and a mounted database path. There is no silent fallback to fixtures, a local index or a snapshot.

## Demo walkthrough

1. **Overview → Scan now.** Watch the stages: SEBI → triage → extraction → retrieval → analysis → Impact Gate → memo → review.
2. **Documents.** The same circulars land differently per company — e.g. circular 102584 (unpaid securities) is a conflict
   for Acme's POL-001 (seven trading days vs SEBI's five), while 102986 (certification for Specialized Investment Funds)
   is a conflict for Nimbus's POL-002.
3. **Open a conflict.** Both sides of the evidence, the Jev decisions with probabilities, the Azure AI Search results with
   ranks, every Foundry call with tokens and cost.
4. **Ask.** *Why is the latest conflict a conflict?* · *Which exact policy clauses does it affect?* · *What did Jev decide
   at each stage?* · *What did Azure AI Search retrieve?* · *How much did this analysis cost?* Then *Approve the review and
   create the GitHub issue now* — refused: approval is a human action.
5. **Reviews → Approve.** One GitHub issue appears in the policy repository; the Activity log records who approved what.

**Resetting a demo.** Profile → **Demo controls** lists your workspaces. Every workspace starts *Live* and can never be
reset. Mark one as a demo workspace, then **Reset demo**: it clears that workspace's scans, documents, analyses,
decisions, reviews, conversations and activity, and keeps the workspace, its GitHub connection, the policy index (no
re-embedding), the model-cost records and any GitHub issues already opened. Only the person who connected the workspace
can do this, the server checks it, and every reset is audited. Locally, `cd backend && uv run python scripts/demo_reset.py
--tenant <id> --yes` performs a full reset including the policy index (dev/demo environments only).

Detailed script: [`docs/DEMO_RUNBOOK.md`](docs/DEMO_RUNBOOK.md).

## Testing and evaluation

```bash
cd backend && uv run pytest -q && uv run mypy app scripts evals         # 170+ tests, no network
cd backend && uv run pytest -q ../infra/sebi-proxy                       # the relay's CONNECT-only contract
cd web && npx tsc --noEmit && npm run lint && npm test                   # types, lint, Vitest
```

The suite uses a stub provider and a vendored copy of the Acme policy corpus
([`backend/tests/fixtures/acme-securities-policies`](backend/tests/fixtures/acme-securities-policies)); it never calls
Azure, SEBI, Jev or GitHub. CI ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)) runs all of it plus `next build`,
both Docker builds and a liveness check of the API image on every push.

Model evaluation (these do call models): `uv run python -m evals.judges` benchmarks the judgment layer (Jev vs Foundry),
`uv run python -m evals.run` the generative deployments; results appear in the dashboard's *Models* view.

## Cost and safety guards

- **Per scan:** at most `AFTERCIRCULAR_MAX_LLM_CALLS_PER_SCAN` (12) generative calls and an estimated
  `AFTERCIRCULAR_MAX_ESTIMATED_COST_PER_SCAN_USD` ($0.50). **Per day, application-wide:** $5. Checked before every call;
  a scan that hits a limit stops visibly with a `BUDGET_EXCEEDED` audit event.
- **Triage first:** circulars not addressed to the company's kind of entity are archived by Jev with no generative call.
- **Policy index reuse:** chunks are re-embedded only when the repository commit changes.
- **Ask:** one narrative call at low reasoning effort per question; answers assembled from stored records need no GPT call (only Jev's routing).
- Observed spend for development, testing and the live deployment so far: about **$1.65** of the $100 student credit
  (Azure Cost Management) — see [`DEPLOYMENT.md`](DEPLOYMENT.md).

## Responsible AI and security

- The only side effect — a GitHub issue — requires a person to press Approve. The agent never edits or merges a policy.
- A `CONFLICT` needs evidence on both sides: policy excerpts are retrieved chunks (verbatim by construction); regulatory
  excerpts are string-matched against the circular and checked by a typed citation question.
- Probabilities route cases; they never authorise an action. Uncertainty escalates to a reasoning model, then to a person.
- Regulatory documents are untrusted input: extracted from, never executed as instructions.
- Tenants are isolated in the database, the search index (`tenant_id` filter) and the audit log.
- No Azure keys in the apps: Foundry, Search and ACR use managed identities with resource-scoped roles. Remaining secrets
  (backend key, Jev key, GitHub OAuth app, relay password) are Container Apps / Container Instance secrets — never in an
  image, a workflow or git (`.env` files are ignored).
- The API has no public ingress; CORS allows only the web app's origin; the interactive API docs are off in production.
- The SEBI relay tunnels only `CONNECT www.sebi.gov.in:443` with a password and never sees plaintext: the API verifies
  SEBI's certificate end to end.

## Known limitations

- SQLite on Azure Files means exactly one API replica; scaling out requires moving state to PostgreSQL.
- A deployment during a running scan interrupts it; the scan is marked failed on restart and its unfinished
  publications are retried by the next scan.
- The SEBI relay exists because SEBI does not complete TLS from Azure Korea Central; it is a public endpoint protected by
  a password (Container Instances hides client addresses, so no IP allowlist).
- Scans are triggered from the dashboard; a scheduled trigger (`/api/scheduled-scan`) exists but is disabled.
- Pull-request creation, email/Telegram channels and PostgreSQL are future work (see [`PRD.md`](PRD.md)).

## Documentation

| Document | Contents |
|---|---|
| [`DEPLOYMENT.md`](DEPLOYMENT.md) | Azure deployment runbook, verified state, costs, problems and fixes |
| [`docs/architecture.md`](docs/architecture.md) | decision architecture, cascade, thresholds |
| [`docs/ProductionArchitecture.md`](docs/ProductionArchitecture.md) | production design |
| [`docs/azure-setup-runbook.md`](docs/azure-setup-runbook.md) | first-time Azure discovery and setup |
| [`docs/sebi-connector.md`](docs/sebi-connector.md) | how the live SEBI source is read |
| [`docs/DEMO_RUNBOOK.md`](docs/DEMO_RUNBOOK.md) | the demo script |
| [`docs/AI103_MAPPING.md`](docs/AI103_MAPPING.md) | how the project maps to the AI-103 course |
| [`PRD.md`](PRD.md) | product requirements |

## License

Course project for AI-103. Not licensed for production use.
