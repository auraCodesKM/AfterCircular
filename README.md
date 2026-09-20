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
Regulatory source (SEBI circulars, fetched on a timer)
  → new document detected (content-hash keyed, per tenant)
  → obligation extraction (structured output, evidence required)
  → Azure AI Search (hybrid vector + keyword retrieval, index per tenant)
  → impact gate (cheap filter → full model only when needed)
  → ALIGNED | CONFLICT | UNCERTAIN
  → CONFLICT: draft memo + GitHub Issue (the review request)
  → human approval → pull request → human merge
```

Every circular moves through one explicit state machine (`DISCOVERED → … → MERGED`). `UNCERTAIN` and `NEEDS_INVESTIGATION` stop the pipeline until a person acts. Every action is an audit-log row.

## Repository layout

```
web/    Next.js 16 frontend — landing page, brand system, GitHub sign-in, repository connection
docs/   landing-design.md — visual/UX specification for the landing page
PRD.md  product requirements (source of truth)
```

The FastAPI backend (fetcher, extraction, Azure AI Search, impact gate, GitHub tools, audit log) lives in `backend/` once it lands.

## Frontend quick start

```bash
cd web
cp .env.example .env.local     # then fill in the values below
npm install
npm run dev                    # http://localhost:3000
```

| Variable | Purpose |
|---|---|
| `AUTH_SECRET` | Session encryption key. `npx auth secret` or `openssl rand -base64 32`. |
| `AUTH_GITHUB_ID` / `AUTH_GITHUB_SECRET` | GitHub OAuth App. Callback URL `http://localhost:3000/api/auth/callback/github`. |
| `AUTH_TRUST_HOST` | `true` (required behind Azure's reverse proxy). |
| `BACKEND_URL` / `BACKEND_API_KEY` | FastAPI backend. Empty → a dev-only JSON tenant store is used. |

Sign-in flow: `/signin` → GitHub OAuth → `/connect` (name the company, choose its policy repository) → `/dashboard`. Repository access is re-verified server-side; the OAuth token lives only in the encrypted session cookie.

## Tech stack

| Layer | Choice |
|---|---|
| Frontend | Next.js 16, TypeScript, Tailwind CSS v4, Auth.js v5 |
| Backend | Python, FastAPI |
| Models | Microsoft Foundry / Azure OpenAI, task-based model roles |
| Retrieval / vector store | Azure AI Search (HNSW vector index + keyword, hybrid) |
| Scheduling | Azure Functions (timer in production, HTTP trigger for demo) |
| Actions | GitHub API (Issues, Pull Requests) |
| Structured LLM payloads | TOON |

## Responsible AI

- The agent never modifies a policy file directly and never merges its own pull request.
- A `CONFLICT` must cite both the regulatory clause and the policy clause; outputs without evidence are rejected.
- Uncertain applicability produces no action — it waits for a human.
- Regulatory documents are treated as untrusted input: extracted from, never executed as instructions.
- Tenant data (documents, index, conversations, channel identities) never crosses a tenant boundary.

## Status

Landing page, brand system, GitHub sign-in and repository connection are complete. Pipeline backend, dashboard, evaluation harness and notification channels are in progress — see `PRD.md` §0 for the build order.

## License

Course project. Not licensed for production use.
