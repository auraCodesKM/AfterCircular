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
then Scan now (≈ 1–2 min per circular with gpt-5-mini; the eval runner processes all six at once).

## The demo (≈ 5 minutes)

| # | Screen / action | What to say (all of it is verifiable on screen) |
|---|---|---|
| 1 | **Overview** — status strip | "Source: **Connected to SEBI**. AI: **Microsoft Foundry · gpt-5-mini**. Retrieval: **Azure AI Search**. Reasoning support: Jev. Approval: **Human**." The company and its policies are fictional; everything else is live. |
| 2 | Click **Scan now** (optional if already scanned) | The connector reads SEBI's official listing, fetches the curated circulars' pages and PDFs live, hashes them, skips anything already processed. |
| 3 | **Documents** → open *Handling of Client's Unpaid Securities by Trading Members* (Jul 03, 2026) | Row shows `SEBI · HO/38/11/(9)2026-MIRSD-POD/I/15382/2026 · LIVE`. |
| 4 | In the sheet: **Open SEBI source ↗** / **PDF ↗** | The exact page on www.sebi.gov.in and the exact PDF. Real regulation. |
| 5 | Section *How this analysis was produced* | "AI extraction: **Microsoft Foundry · gpt-5-mini**. Retrieved policies: **Azure AI Search · N candidate clauses**. Reasoning: Jev typed judgments." Nothing here is a label — it is read from the stored run. |
| 6 | *What changed* — extracted obligations | Foundry's structured extraction (strict JSON schema), each obligation with a verbatim excerpt and clause number. |
| 7 | *Evidence* — left column | Real requirement: §46.4 "…maximum period (shall not exceed five trading days from the pay-out date)…" with **LIVE** badge, date, reference, Open SEBI source. |
| 8 | *Evidence* — right column | Fictional policy: POL-001 §5.1 "…within seven trading days…" — **Open on GitHub ↗** opens the exact file in the tenant repository. |
| 9 | *Decision details* (expand) | Jev: extraction check → applicability → relevance → alignment per pair → citation verification, each with calibrated probabilities; escalation to Foundry only when uncertain. |
| 10 | **Human review required** panel | "AI identified a conflict and drafted a memo. No external action has been taken." Approve / Reject. |
| 11 | **Approve & open issue** | Real GitHub issue in the fictional company's repository (Acme's rehearsal produced `acme-securities-policies#6`), body carries the SEBI page, PDF, policy file link and `AfterCircular-Analysis-ID`. Click **Issue #N ↗**. Approve again → same issue, no duplicate. If Acme is already approved, use the Nimbus review (102986 vs POL-002). |
| 12 | **Ask** (⌘K) → "Why is this a conflict?" | Footer: *Reasoned by Jev · N typed judgments · Written by Foundry gpt-5-mini … every claim validated against the records*. Claims cite `SEBI … §46.4 LIVE ↗` and `POL-001 §5.1 · GitHub ↗`. |
| 13 | Ask → "What evidence supports this?" | Follow-up keeps the thread; quotes the same real excerpt and the fictional clause with links. |
| 14 | Ask → "Create a GitHub issue for this conflict." | Refused: "This action requires human approval…" — Ask never acts. ("What should we do next?" is answered as a prioritised recommendation, not an action.) |
| 15 | **Scan now** again | "Connected to SEBI · No new publications since last scan" — 0 new, N already processed, **0 model calls**. Deduplication by content hash. |
| 16 | **Models** | Microsoft Foundry first: real request/token/cost/latency telemetry for gpt-5-mini; embeddings text-embedding-3-small; Azure AI Search policies-dev; Jev as reasoning support. "Not recorded" wherever a value is missing. |

## Second company (optional, 1 minute)

Switch to **Nimbus Asset Management** (sidebar footer). The *same* real circulars produce different results because the fictional
corpus is different: *Intraday borrowing facility availed by mutual funds* → **ALIGNED** (POL-001 mirrors the circular);
*Certification Requirements for Distribution of SIFs* → **CONFLICT** (POL-002 still requires NISM Series XIII, the circular
requires Series V-D); *Handling of Client's Unpaid Securities* → **NOT APPLICABLE** (archived at triage, zero Foundry calls).

## Responsible-AI points to make explicitly

Human oversight (approval is the only path to a side effect) · AI recommendation ≠ decision · no autonomous policy edits ·
evidence required on both sides before a conflict is shown · exact source provenance (official SEBI page/PDF, GitHub file) ·
uncertainty stays uncertain (NEEDS_INVESTIGATION) · tenant isolation (Search filter, per-tenant rows) · no confidential company
data (fictional tenants) · cost circuit breakers and bounded retries.

## If something is off

- Status strip says "SEBI connection failed": live mode never falls back; check network, then `uv run python scripts/live_check.py sebi`.
- "Foundry call failed … 401/403": `az login` expired.
- A review is "waiting in another company's workspace": switch company in the sidebar footer.
