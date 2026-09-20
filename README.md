# AfterCircular

**From regulatory change to compliance action.**

AfterCircular continuously monitors a regulator's publications, extracts the obligations in each new document, compares them against a company's own policy documents, and — when it finds a conflict — drafts the fix and routes it through human approval. AI detects, analyzes and drafts; a human approves and merges.

Built for AI-103 (Develop AI Apps and Agents on Azure), Chitkara University.

## Why not a chat session with a PDF?

| Capability | Chat-upload Q&A | AfterCircular |
|---|---|---|
| Read a document, answer with citation | ✓ | ✓ |
| Monitor a live external source | — | ✓ |
| Remember what has already been processed | — | ✓ |
| Compare new obligations against existing policy | manual | ✓ |
| Run without being asked | — | ✓ |
| Trigger a real side effect (issue, pull request) | — | ✓ |
| Multi-tenant isolation across companies | n/a | ✓ |

## How it works

```
Dashboard "Scan now"
  → SEBI connector (live sebi.gov.in listing → circular page → PDF text; labelled demo snapshot if unreachable)
  → new document detected (content-hash keyed, versioned, per tenant — SQLite)
  → obligation extraction (Microsoft Foundry, structured output, evidence required)
  → policy retrieval over the tenant's GitHub repo (Azure AI Search hybrid vector + keyword, index per tenant;
    local BM25 + vector fallback when Search is not configured)
  → Impact Gate: cheap prefilter → impact analysis (Foundry) → deterministic routing
  → NOT APPLICABLE / ALIGNED → archived with evidence · UNCERTAIN → human, no action
  → CONFLICT → AI-drafted memo → AWAITING_REVIEW
  → human approves → GitHub issue (compliance-review template) → audit event → dashboard
```

Every circular moves through one explicit state machine (`DISCOVERED → … → COMPLETED`). `NEEDS_INVESTIGATION` stops the pipeline until a person acts. Every transition is an audit-log row. The agent never edits a policy file; the only side effect (a GitHub issue) fires after a human clicks Approve.

## Repository layout

```
web/      Next.js 16 frontend — landing page, GitHub sign-in, repository connection, operational dashboard
backend/  FastAPI pipeline — SEBI connector, state, Foundry agents, Azure AI Search, Impact Gate, approvals, GitHub, audit, evals
docs/     landing-design.md — visual/UX specification for the landing page
PRD.md    product requirements (source of truth)
```

Demo tenant: [`auraCodesKM/acme-securities-policies`](https://github.com/auraCodesKM/acme-securities-policies) (private) — a fictional SEBI-registered broker's policy corpus with an `aftercircular.yml` manifest, YAML front matter per document and numbered clauses, so citations like `POL-001 §4.1` are exact.

## Quick start

**1. Backend**

```bash
cd backend
uv sync
cp .env.example .env            # BACKEND_API_KEY, Foundry, AI Search, SEBI_MODE — see backend/README.md
uv run uvicorn app.main:app --port 8010 --reload
```

**2. Frontend**

```bash
cd web
cp .env.example .env.local      # then fill in the values below
npm install
npm run dev                     # http://localhost:3000
```

| Variable | Purpose |
|---|---|
| `AUTH_SECRET` | Session encryption key. `npx auth secret` or `openssl rand -base64 32`. |
| `AUTH_GITHUB_ID` / `AUTH_GITHUB_SECRET` | GitHub OAuth App. Callback URL `http://localhost:3000/api/auth/callback/github`. Scope `read:user user:email repo` (read policies, open issues). |
| `AUTH_TRUST_HOST` | `true` (required behind Azure's reverse proxy). |
| `BACKEND_URL` / `BACKEND_API_KEY` | FastAPI backend (`http://localhost:8010`, same key as `backend/.env`). Empty → landing + auth only, dashboard reports the backend as not configured. |

**3. Run the end-to-end scan**: `/signin` → GitHub → `/connect` (company name + the policy repository) → `/dashboard` → **Scan now**. Watch the pipeline steps; open **Review** on the CONFLICT row to read the evidence and the AI-drafted memo; **Approve & create GitHub issue**. The issue appears in the connected repository and the *Activity* tab shows every audit event. A second scan skips everything already processed.

Reset the demo: stop the backend and delete `backend/data/aftercircular.db`.

**4. Model evaluation**: `cd backend && uv run python -m evals.run --models gpt-4o-mini,gpt-4o` (needs Foundry). Results land in `evals/results/latest.json` and in the dashboard's *Model intelligence* tab.

### Azure / Foundry configuration

| Service | Setting | Notes |
|---|---|---|
| Microsoft Foundry / Azure OpenAI | `FOUNDRY_ENDPOINT`, `FOUNDRY_API_KEY` (or managed identity), `EXTRACTION_MODEL`, `IMPACT_MODEL`, `MEMO_MODEL`, `EMBEDDING_MODEL` | Deployment names per task; `AI_PROVIDER=foundry`. |
| Azure AI Search | `AZURE_SEARCH_ENDPOINT`, `AZURE_SEARCH_API_KEY` | Index per tenant, HNSW vector + keyword, hybrid RRF. Empty → local hybrid fallback (clearly reported). |
| Demo fallback | `SEBI_MODE=live\|snapshot`, `AI_PROVIDER=foundry\|stub` | Snapshot circulars are fictional and labelled `DEMO SNAPSHOT`; the stub provider returns fixtures and is labelled `stub — no model calls`. Never silently presented as live/real. |

## Tech stack

| Layer | Choice |
|---|---|
| Frontend | Next.js 16, TypeScript, Tailwind CSS v4, Auth.js v5 |
| Backend | Python, FastAPI |
| Models | Microsoft Foundry / Azure OpenAI via a provider abstraction; one deployment per task (extraction, impact, memo, embeddings) |
| Retrieval / vector store | **Azure AI Search** — HNSW vector index + keyword, hybrid (RRF); index per tenant. Local BM25+vector fallback for development |
| State | SQLite (`processed_documents`, `analyses`, `reviews`, `audit_events`, `llm_calls`), repository layer ready for Azure PostgreSQL |
| Scheduling | HTTP trigger (dashboard button) today; Azure Functions timer is the production path |
| Actions | GitHub API (read policy repo, create compliance issue; pull requests are Tier 1) |
| Evaluation | `backend/evals` — golden scenarios, per-task scoring, latency/tokens/cost per model |

## Responsible AI

- The agent never modifies a policy file directly and never merges its own pull request.
- A `CONFLICT` must cite both the regulatory clause and the policy clause; outputs without evidence are rejected.
- Uncertain applicability produces no action — it waits for a human.
- Regulatory documents are treated as untrusted input: extracted from, never executed as instructions.
- Tenant data (documents, index, conversations, channel identities) never crosses a tenant boundary.

## Status

Tier 0 vertical slice works end to end: scan → detect → extract → retrieve → Impact Gate → memo → human approval → GitHub issue → audit → dashboard, verified locally against the Acme demo repository. Not built yet (PRD Tier 1/2): pull-request creation, Telegram/email channels, multi-tenant demo with several companies, TOON payloads and gate-vs-no-gate cost measurement, Azure Functions timer, Postgres.

Deviation from PRD §8B, on purpose: the GitHub issue is created after human approval (not automatically on CONFLICT), so the demo has exactly one human gate before any side effect.

## License

Course project. Not licensed for production use.
