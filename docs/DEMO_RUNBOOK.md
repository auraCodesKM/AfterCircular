# AfterCircular — 5-minute demo runbook

**One sentence:** real SEBI regulation + a fictional company's policies + real Microsoft Foundry, Azure AI Search and Jev
execution = a compliance-automation PoC where a person keeps the last word.

## Before you start (2 minutes, once)

```bash
cd backend && uv run uvicorn app.main:app --port 8010      # .env: SEBI_MODE=live, SEBI_SELECTED_ENTRY_IDS=<curated real circulars>
cd web && npm run dev                                       # http://localhost:3000, sign in with GitHub
```
`az login` must be valid (Foundry + Search use Entra ID). Two tenants exist: **Acme Securities Pvt. Ltd.** (fictional stock
broker + DP, repo `auraCodesKM/acme-securities-policies`) and **Nimbus Asset Management** (fictional AMC, repo
`auraCodesKM/nimbus-amc-policies`). To rehearse from a clean slate: `uv run python scripts/demo_reset.py --tenant <id> --yes`,
then **Scan now** once: with `AFTERCIRCULAR_MAX_DOCUMENTS_PER_SCAN=6` one click processes all six curated circulars (≈ 4 min,
≈ $0.05–0.06 with gpt-5-mini, 6–8 Foundry calls). Rehearsed three times on 2026-09-22 with the same outcomes (SIF certification →
CONFLICT POL-002 §4.2). The workspace is left in that state: Nimbus scanned, review pending, nothing approved.

## The demo (≈ 5 minutes) — start in **Nimbus Asset Management**

| # | Screen / action | What to say (all of it is verifiable on screen) |
|---|---|---|
| 1 | **Overview** — status strip | "Source: **Connected to SEBI**. AI: **Microsoft Foundry · gpt-5-mini**. Retrieval: **Azure AI Search**. Reasoning support: Jev. Action: **Human approval → GitHub**." The company and its policies are fictional; everything else is live. |
| 2 | Click **Scan now** (optional if already scanned) | The connector reads SEBI's official listing, fetches the six curated circulars' pages and PDFs live, hashes them, skips anything already processed. |
| 3 | **Documents** → open *Certification Requirements for Distribution of Specialized Investment Funds* (Jul 21, 2026) | Row shows `SEBI · HO/24/13/17(1)2026-IMD-POD-1/I/16895/2026 · LIVE`. |
| 4 | In the sheet: **Open SEBI source ↗** / **PDF ↗** | The exact page on www.sebi.gov.in and the exact PDF. Real regulation. |
| 5 | Section *How this analysis was produced* | **Execution summary** (stages executed/skipped, Foundry calls + tokens + latency, Jev judgments, Search results, estimated cost "list-price estimate, not an Azure invoice", context efficiency = measured same-payload TOON vs JSON, ≈6% on this run), chips "✓ SEBI · ✓ Microsoft Foundry · 3 calls · ✓ Azure AI Search · ✓ Jev · N typed judgments", then the grouped timeline (Source → Reasoning → Decision → Action): SEBI → connector → Foundry extraction (response id, tokens, latency) → embeddings → Azure AI Search (k=10, RRF, *View retrieved clauses*) → Jev → Foundry impact → Jev cross-check → **Impact Gate · deterministic** → Foundry memo → **Human decision** divider → ○ GitHub *waiting for human approval*. Every node is read from the stored run; "Not run" nodes say why. |
| 6 | *What changed* — extracted obligations | Foundry's structured extraction (strict JSON schema), each obligation with a verbatim excerpt and clause number. |
| 7 | *Evidence* — left column | Real requirement (NISM Series V-D certification for SIF distributors) with **LIVE** badge, date, reference, Open SEBI source. |
| 8 | *Evidence* — right column | Fictional policy: POL-002 §4.2 still requires NISM Series XIII — **Open on GitHub ↗** opens the exact file in `auraCodesKM/nimbus-amc-policies`. |
| 9 | *Why this result?* and *Decision details* (expand) | Six lines: regulatory evidence → policy evidence → applicability → alignment → verification → Impact Gate. Below, Jev's calibrated probabilities per stage ("Reasoning support (Jev) → Microsoft Foundry → deterministic gate → human review"). |
| 10 | **Human review required** panel | "AI identified a conflict and drafted a memo. No external action has been taken." Approve / Reject. |
| 11 | **Ask** (from the analysis page) → "Why is the latest conflict a conflict?" · "Which exact policy clause conflicts?" · "Why did Microsoft Foundry run?" · "What did Jev decide?" · "How many tokens did Foundry use?" · "Why are we using TOON?" | Header says *context: this analysis*; pipeline/telemetry questions are answered straight from the stored trace (no model call, the compact timeline is shown inline); reasoning questions show **Regulator says / Internal policy says / System conclusion**, source cards (SEBI · LIVE · §21.10.1 → Open SEBI source / Open PDF; GitHub · INTERNAL · POL-002 §4.2 → Open on GitHub) and the execution strip: Jev intent → records selected → evidence assembled → Microsoft Foundry gpt-5-mini (response id, tokens). Follow-ups keep the thread. |
| 12 | Ask → "Create a GitHub issue for this." | Refused: "This action requires human approval…" — Ask never acts. ("What should we do next?" is a prioritised recommendation, not an action.) |
| 13 | **Approve & open issue** | Real GitHub issue in `auraCodesKM/nimbus-amc-policies`, body carries the SEBI page, PDF, policy file link and `AfterCircular-Analysis-ID`. Click **Issue #N ↗**. Approve again → same issue, no duplicate. |
| 14 | Switch to **Acme Securities Pvt. Ltd.** (sidebar footer) | The *same* six real circulars, a different fictional corpus: *Handling of Client's Unpaid Securities* → **CONFLICT** POL-001 §5.1 (seven vs five trading days); *Intraday borrowing (mutual funds)* and *Commodity position limits* → **NOT APPLICABLE**, archived at triage with **0 Foundry calls**; *SWP/STP demat* → **ALIGNED**. |
| 15 | **Scan now** again | "Connected to SEBI · No new publications since last scan" — 0 new, 6 already processed, **0 model calls**. Deduplication by content hash. |
| 16 | **Models** | *Architecture · what is actually running*: Microsoft Foundry ● Connected (last response id, requests today), Azure AI Search ● Connected (documents in index, hybrid, tenant filter, indexed commit), Embeddings 1536-d, SEBI ● LIVE (last fetch), Jev ● reasoning support (decisions today), GitHub (issues created). "Not recorded" wherever a value is missing. |

## Optional: Foundry Web Search (discovery only)

Ask → "Look up the latest SEBI circular on cyber incident reporting on sebi.gov.in." → Microsoft Foundry Web Search restricted to
sebi.gov.in returns titles and exact URLs; the footer says *discovery, not compliance evidence*. Nothing enters an analysis
until the SEBI connector fetches it (Scan now).

## Responsible-AI points to make explicitly

Human oversight (approval is the only path to a side effect) · AI recommendation ≠ decision · no autonomous policy edits ·
evidence required on both sides before a conflict is shown · exact source provenance (official SEBI page/PDF, GitHub file) ·
uncertainty stays uncertain (NEEDS_INVESTIGATION) · tenant isolation (Search filter, per-tenant rows) · no confidential company
data (fictional tenants) · cost circuit breakers and bounded retries.

## If something is off

- Status strip says "SEBI connection failed": live mode never falls back; check network, then `uv run python scripts/live_check.py sebi`.
- "Foundry call failed … 401/403": `az login` expired.
- A review is "waiting in another company's workspace": switch company in the sidebar footer.
