# AfterCircular — production architecture

Two containers in one Azure Container Apps environment. The API is internal: only the web app reaches it, server-side,
which is where the backend key and the signed-in user's GitHub token stay. Nothing in the diagram is aspirational —
every edge exists in the code and is exercised by the deployed system.

```mermaid
flowchart TB
  user([Compliance officer]):::human
  sebi[(www.sebi.gov.in<br/>official circulars + PDFs)]:::ext
  gh[(GitHub<br/>policy repos + issues)]:::ext
  jev[(TypeSafe System One · Jev<br/>typed judgments)]:::ext

  subgraph ACA["Azure Container Apps · acae-aftercircular-dev · Korea Central"]
    web["aca-aftercircular-web<br/>Next.js standalone · external HTTPS ingress<br/>Auth.js GitHub OAuth · server-side proxy"]:::app
    api["aca-aftercircular-api<br/>FastAPI · internal ingress · 1 replica<br/>pipeline · impact gate · audit"]:::app
    files[("Azure Files share<br/>/data/aftercircular.db")]:::store
  end

  subgraph AI["Azure AI · rg-aftercircular-dev"]
    foundry["Microsoft Foundry · aif-aftercircular-dev<br/>gpt-5-mini · Responses API · JSON Schema"]:::azure
    embed["text-embedding-3-small · 1536-d"]:::azure
    search["Azure AI Search · srch-aftercircular-dev<br/>policies-dev · BM25 + vector + RRF · tenant filter"]:::azure
  end

  subgraph OBS["Observability"]
    appi["Application Insights · appi-aftercircular-dev"]:::azure
    law["Log Analytics · log-aftercircular-dev"]:::azure
  end

  acr[("Azure Container Registry<br/>aftercircular-api|web:&lt;git sha&gt;")]:::azure

  user -->|HTTPS| web
  web -->|"HTTP (env-internal)<br/>X-Tenant-*, X-Actor, X-GitHub-Token"| api
  api -->|"scan: listing → circular → PDF<br/>SEBI_MODE=live, no snapshot fallback"| sebi
  api -->|managed identity| foundry
  api -->|managed identity| embed
  api -->|managed identity| search
  api -->|typed judgments| jev
  api -->|"read policies · create issue after approval"| gh
  api --- files
  api -.-> appi
  web -.-> law
  api -.-> law
  acr -.->|managed identity pull| web
  acr -.->|managed identity pull| api

  classDef app fill:#0f172a,stroke:#38bdf8,color:#e2e8f0
  classDef azure fill:#0b1220,stroke:#60a5fa,color:#dbeafe
  classDef ext fill:#111827,stroke:#94a3b8,color:#e5e7eb
  classDef store fill:#111827,stroke:#f59e0b,color:#fde68a
  classDef human fill:#052e16,stroke:#4ade80,color:#dcfce7
```

## One document, end to end

```mermaid
sequenceDiagram
  autonumber
  participant P as Person
  participant W as Web (ACA)
  participant A as API (ACA)
  participant S as SEBI
  participant J as Jev
  participant F as Foundry gpt-5-mini
  participant X as Azure AI Search
  participant G as GitHub

  P->>W: Scan now
  W->>A: POST /api/scan (server-side, backend key)
  A->>S: listing → circular page → PDF
  A->>A: content hash · already processed?
  A->>J: triage (or code prefilter)
  alt out of scope
    A->>A: ARCHIVED — no generative call
  else in scope
    A->>F: obligation extraction (JSON Schema)
    A->>F: embed the query (text-embedding-3-small)
    A->>X: hybrid retrieval, tenant filter
    A->>J: extraction check · applicability · rerank · alignment
    opt uncertain
      A->>F: impact analysis (escalation)
      A->>J: verification / cross-check
    end
    A->>A: deterministic Impact Gate
    opt CONFLICT
      A->>F: memo draft
      A->>A: review AWAITING_REVIEW
      P->>W: Approve
      W->>A: POST /api/reviews/{id}/approve (user's GitHub token)
      A->>G: create issue (idempotent)
    end
  end
```

## Why this shape

- **Container Apps, not AKS/App Service.** Two stateless HTTP containers, scale-to-few, managed identity, built-in
  ingress and revisions. No cluster to operate, no Students credit burned on idle nodes.
- **API internal.** The browser has no reason to reach it: the web app already proxies every call so the backend key and
  the user's GitHub token never leave the server.
- **One API replica.** The database is a single SQLite file on the share; one writer avoids cross-replica locking.
  Scaling past that means PostgreSQL, not more replicas (`azureDecision.md` §21).
- **Managed identity everywhere it works** — Foundry, Search, ACR. Static secrets remain only for services outside Azure
  (GitHub, Jev) and the shared frontend↔API key.
- **Official SEBI connector stays authoritative.** Foundry Web Search exists only behind the Ask `web_lookup` intent and
  is labelled discovery; a publication becomes evidence only after the connector fetches, hashes and analyses it.

## Known, accepted

- **React hydration warning (#418) on two dashboard pages in a production build.** Both pages render correctly (HTTP 200,
  content verified in a headless browser); React re-renders the affected subtree on the client. Not reproducible in the
  dev server, and no user-visible defect was found. Tracked, not fixed — the deterministic UTC timestamps and pinned
  number formatting removed the mismatches that were locatable.
- **One API replica.** The database is a single SQLite file on a share; horizontal scale requires PostgreSQL first.
- **Entra ID inside a local container** needs a dev service principal; the host's `az login` is not visible in the image.
  In Azure the managed identity covers it, so this affects only `docker compose`.
