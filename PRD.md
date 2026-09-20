# AfterCircular — Product Requirements Document (SOLE SOURCE OF TRUTH)

**Course**: AI-103 — Develop AI Apps and Agents on Azure, Chitkara University
**Deadline**: Presentation-ready by 23 Sep 2026; present 24–25 Sep 2026
**Team size**: 4–5
**Tagline**: *From regulatory change to compliance action.*

---

## 0. BUILD PRIORITY — read this before writing any code

Everything below is the full vision. Not all of it ships by the 23rd. Build strictly in this order — do not start Tier 1 until Tier 0 works end-to-end and is demoable.

**Tier 0 — must work, non-negotiable**
- SEBI circular fetch → persistent state (seen/unseen), keyed by `content_hash` for versioning
- Obligation extraction → structured JSON, with evidence citations required in the output schema (no free-floating claims)
- Azure AI Search **vector** index over internal policy corpus (hybrid retrieval)
- Impact Gate v1 (2-state: ALIGNED / CONFLICT, plus UNCERTAIN as a non-action state) using a cheap classifier or small-model call
- Explicit pipeline state machine (section 19) driving the dashboard
- On CONFLICT: draft memo + **auto-create** a GitHub Issue (the Issue *is* the human review request — not itself an autonomous change, so it does not wait on approval)
- Human-approval step gates PR creation specifically (see section 8B) — that's the one action that proposes an actual policy text change
- Idempotency: re-running a scan never creates a duplicate Issue/PR for a circular already processed
- Audit log of every action (section 20)
- One dashboard screen showing the pipeline run live ("Scan Now" button)

**Tier 1 — build only after Tier 0 is solid**
- Telegram + email as additional notification channels, same agent persona
- Multi-tenant isolation demoed with 2–3 fictional companies live
- GitHub Pull Request creation (approved fixes only)
- TOON instead of JSON for structured payloads + measured token savings
- Gate-vs-no-gate LLM call/cost comparison, with real numbers
- Golden eval dataset (section 20) + a static 2-model comparison table (section 21) — not a live dashboard

**Tier 2 — describe in README/deck as future scope, do not build**
- Multiple regulators/countries, Entra ID auth, Key Vault, full production security stack, Postgres/production infra
- Live Foundry Model Router integration, a "Model Lab" dashboard, benchmarking 3–5+ models — real engineering value, wrong time budget for this deadline

---

## 1. Problem

Regulations change continuously; internal company policies don't update themselves. Compliance teams manually diff new regulator publications against internal policy — slow, reactive, and caught late, usually during an audit.

A document-upload chat session (ChatGPT/Claude with a PDF) doesn't solve this: it only answers when prompted, has no persistent memory of what it already checked, doesn't watch anything continuously, and can't take real action.

**AfterCircular** continuously monitors a regulator, remembers what it has already processed, compares new obligations against a company's actual policy documents, and — when a conflict is found — drafts a fix and routes it through human approval before anything changes.

## 2. Differentiation (put this slide in the deck verbatim)

| Capability | Chat-upload Q&A | AfterCircular |
|---|---|---|
| Read a doc, answer with citation | ✓ | ✓ |
| Monitor a live external source | — | ✓ |
| Remember what's already processed | — | ✓ |
| Compare new vs. existing policy automatically | Manual | ✓ |
| Run without being asked | — | ✓ |
| Trigger a real side effect (ticket, PR) | — | ✓ |
| Multi-channel, persona-consistent interaction | — | ✓ |
| Multi-tenant isolation across companies | N/A | ✓ |

Framing for the video: *"Chat AI answers questions about information you give it. AfterCircular watches for changes and turns the ones that matter into a human-reviewed action."*

## 3. MVP scope (Tier 0)

- **Regulator**: SEBI circular listing (public, updates frequently — verify it's live before demo day; cache a snapshot as fallback).
- **Fictional org**: Acme Securities Pvt. Ltd.
- **Internal policy corpus**: 5–8 fictional PDFs (position limits, trading risk, penalty policy, compliance manual, escalation matrix, derivatives SOP).
- **Side effect**: GitHub Issue.
- **Impact Gate**: `APPLICABILITY (YES/NO/UNCERTAIN)` → `ALIGNMENT (ALIGNED/CONFLICT)`.

### Explicitly out of scope for MVP
RBI, multiple regulators, multiple industries, real confidential data, autonomous policy edits without human approval, knowledge graphs, full enterprise auth/IAM.

## 4. Product surfaces (from the hand-drawn sketch)

**Landing / Home**
- Hero with background video (asset to be supplied separately — placeholder `bg.mp4` for now).
- Product name, tagline, Sign In CTA.
- Visual style: simple shadcn/ui + Tailwind, monochrome black/white, no gradients, no decorative filler — clean like Linear/Vercel/Claude, not a generic AI-startup template.

**Sign In**
- Minimal form; logo asset placeholder `sign.svg`/`.jpg` (to be supplied).

**Main Dashboard**
- Left nav: Dashboard, Regulations, Policies, Company, GitHub, Settings.
- Main panel: regulatory activity summary (new changes / needs review / no impact), recent activity feed, "Scan Now" button.
- Chat surface for talking to the agent directly, in addition to Telegram/email channels (Tier 1).

**GitHub connection screen**
- OAuth connect → pick a repo → system auto-extracts relevant company documents from it (privacy policy, legal docs, compliance docs, regulations, SOPs) rather than requiring manual upload.

## 5. The agent's voice (Boardy.ai-style) — Tier 1

Boardy.ai's actual differentiator isn't voice tech — it's that it holds one consistent identity and memory of you across phone, email, and LinkedIn, with no dashboard-first feel, and talks like a person, not a script. That's the model to copy for tone, not literally voice calls.

Apply that here:
- **One persona, one memory, three surfaces**: whether a compliance officer talks to AfterCircular on the dashboard, gets a Telegram message, or receives an email, it should read as the same "person" continuing the same conversation, not three different bots.
- **Natural language, not templated alerts.** Instead of "ALERT: SEBI-2026-014 CONFLICT DETECTED," write like a colleague: *"Hey — SEBI just published something that looks like it conflicts with your Position Limits Policy. Want me to draft the fix?"*
- **Context carries across channels.** If a user asks a follow-up over email about something first raised on Telegram, the agent should already know what "it" refers to — this requires the conversation/session to be keyed by tenant + user, not by channel.
- Keep this to prompt design + shared conversation state — do not attempt actual voice calls, that's out of scope entirely.

## 6. Multi-tenant isolation

**Requirement**: each company's data, conversation history, and channel identities (their Telegram chat ID, their email addresses, their GitHub repo) must never leak into another company's session.

**Azure's own multi-tenant guidance for Azure AI Search names exactly two patterns** — use this directly in the README as your architecture justification:
- **Index-per-tenant**: all tenants share one Azure AI Search service; each gets its own index. Cheapest, fastest to build, good isolation. **Use this for the MVP/demo.**
- **Service-per-tenant**: each tenant gets a fully separate Search service. Maximum isolation, highest cost/ops overhead. **Describe as the production path for large enterprise customers, don't build it.**

Apply the same `tenant_id` partitioning everywhere else too:
- `processed_documents`, `conversations`, `channel_identities` tables all keyed by `tenant_id`.
- Telegram bot and email inbox route incoming messages to the right tenant by matching the sender's known chat ID / email address to a `channel_identities` row — never by inferring from message content.
- One shared Azure deployment (one Function app, one Search service, one backend) is enough for the demo; you do not need separate Azure deployments per company for a course project — that would be over-engineering for the time available.

**Demo idea (good one, keep it)**: register 2–3 team members' own phones (Telegram) and personal emails as "different companies," each with a different internal policy corpus. Trigger a scan live and show each "company" gets only its own relevant notification, on its own channel, with zero cross-talk. That single demo beat proves the isolation claim better than any slide.

## 7. Vector database requirement

**Azure AI Search's vector index (HNSW) is your vector DB.** This isn't a gap to fill — you already have it in the architecture via hybrid (vector + keyword) retrieval over the policy corpus. Say so explicitly in the README's tech stack section so it's not missed by a grader skimming for the word "vector."

## 8. GitHub integration (expanded)

Two distinct GitHub touchpoints — don't conflate them:

**A. Source of company policy (input)**
- Company connects a GitHub repo via OAuth.
- System extracts relevant docs from it (legal, privacy, compliance, regulations, SOPs) — not source code, not secrets.
- On new commits to that repo (webhook or polling), re-index the changed docs — the "latest policy" is always whatever's on the repo's default branch, not a stale upload.

**B. Compliance action (output)**
- CONFLICT detected → draft memo → **GitHub Issue auto-created** (Tier 0). The Issue *is* the human review request — creating it is not itself a policy change, so it does not wait on approval.
- Human reads the Issue and clicks **Approve** → agent opens a **Pull Request** with the proposed text change to the actual policy file (Tier 1). **This is the gated step** — a PR proposes an actual content change, so it requires explicit human approval first.
- Human reviews and merges the PR — that's what actually updates the policy. The agent never merges its own PR.

This resolves the one contradiction worth calling out explicitly: "human approval before any side effect" means *before any side effect that changes something* — Issue creation is notification, not change, so it fires immediately; PR creation is a proposed change, so it waits on a human click. Keep this distinction exact in the implementation — it removes the double-approval friction and gives you a clean one-click "Approve" moment for the demo.

## 9. Impact Gate — and why it means fewer LLM calls

**Jev status**: not usable right now (waitlisted). Use a cheap fallback for the gate instead — a small/cheap model call (e.g., a mini model) or a simple embedding-similarity threshold — and say so honestly in the README ("designed for a fast structured-decision model; current implementation uses \[X\] as a stand-in").

**Why the gate matters even with a fallback**: without it, every retrieved policy chunk would need a full, expensive LLM reasoning call to check relevance and conflict. With the gate:
1. Cheap pass filters obviously-irrelevant chunks (no expensive call).
2. Only chunks that pass the cheap filter go to the expensive model for the actual applicability/alignment judgment.

**Build this comparison into `evals/`** — run the same 15–20 test circular/policy pairs both ways and report:
- Total LLM calls: gated vs. ungated
- Estimated cost: gated vs. ungated
- Latency: gated vs. ungated

Put these numbers on a slide. "We reduced LLM calls by X% and cost by Y%" is a concrete, defensible result — stronger than any architecture diagram alone.

## 10. TOON instead of JSON

Use TOON (Token-Oriented Object Notation) for structured payloads passed to the LLM — obligation extraction output, retrieved-chunk lists, gate results. TOON is a lossless, more compact encoding of the same JSON data model; published benchmarks show roughly **30–60% fewer tokens** on uniform, tabular structured data (it falls back toward JSON-level size on deeply nested/non-uniform data, so use it where your data actually is tabular — obligation lists, chunk arrays).

**Build this comparison into `evals/` too** — run the same payloads through both encodings and report actual token counts and estimated $ savings for your specific data, not just the cited benchmark number. Store data internally as JSON/Python objects as normal; convert to TOON only at the point of sending to the LLM.

## 11. Architecture

```
                    Dashboard / Telegram / Email
                    (same agent persona, shared conversation state)
                              │
                    tenant_id resolved by channel identity
                              │
                              ↓
                   Azure Function (HTTP: demo button; Timer: prod)
                              │
                              ↓
   ┌──────────────────────────┴──────────────────────────┐
   │                                                       │
   ↓                                                       ↓
SEBI Fetcher                                    GitHub Connector
(public circulars)                        (company docs; watches commits)
   │                                                       │
   ↓                                                       ↓
New circular? → hash check → processed_documents (per tenant)
   │ (yes)
   ↓
Document extraction → Obligation Extraction Agent → structured JSON (TOON on LLM calls)
   │
   ↓
Azure AI Search — hybrid vector+keyword retrieval, index-per-tenant
   │
   ↓
Impact Gate (cheap filter → expensive call only when needed)
   │
   ┌────────────┴────────────┐
   ↓                         ↓
ALIGNED                  CONFLICT
   │                         │
Archive              Draft memo (draft_policy_update)
                             │
                             ↓
                   create_compliance_ticket() → GitHub Issue
                             │
                    Human reviews + approves
                             │
                             ↓
                  create_policy_update_pr() → GitHub PR
                             │
                    Human reviews + merges
                             │
                             ↓
                   Notify (Telegram/email/dashboard, tenant-scoped)
                             │
                             ↓
                   Update processed_documents state
```

## 12. Agent tools

**draft_policy_update(circular_obligation, current_policy_excerpt, evidence)** → memo text (regulatory change, current policy, gap, proposed amendment, effective date, evidence).

**create_compliance_ticket(tenant_id, circular_id, affected_policy, severity, reason)** → GitHub Issue ID.

**create_policy_update_pr(tenant_id, repo, file_path, proposed_diff, ticket_id)** → PR URL. *(Tier 1)*

**notify(tenant_id, channel, message)** → routes to the right Telegram chat / email address for that tenant, in the shared agent persona. *(Tier 1 for Telegram/email; dashboard notification is Tier 0.)*

Human approval is a hard gate before `create_policy_update_pr` ever fires — the agent drafts, a human decides.

## 13. Data model

```
tenants
- tenant_id, company_name, github_repo, telegram_chat_id, email_address

processed_documents
- id, tenant_id, source, circular_number, title, published_date, url,
  content_hash, processed_at, status, impact, ticket_id, pr_id

channel_identities
- tenant_id, channel (telegram|email|dashboard), external_id
```
SQLite or a JSON file is enough for MVP — the property that matters is persistence + tenant partitioning, not the storage engine.

## 14. Tech stack

| Layer | Choice |
|---|---|
| Frontend | Next.js + TypeScript + Tailwind + shadcn/ui |
| Backend / agent orchestration | Python + FastAPI |
| Foundation models | Microsoft Foundry / Azure OpenAI |
| Vector + hybrid retrieval | **Azure AI Search** (this is your vector DB) |
| Scheduling | Azure Functions (timer in prod, HTTP button in demo) |
| State store | SQLite/JSON (MVP) |
| External actions | GitHub API (Issues + PRs) |
| Notifications (Tier 1) | Telegram Bot API, email (SMTP/SendGrid) |
| Structured LLM payloads | TOON |
| Secrets | `.env`, excluded via `.gitignore` — never Key Vault-level for MVP, that's fine to say plainly |

## 15. Responsible AI / human oversight

Hard rule, state this explicitly in the README and video: **AI detects → analyzes → drafts. A human approves. Only then does a side effect (ticket, PR) fire, and only a human merges.** The agent never modifies a policy file directly.

## 16. Demo script (5 min)

1. **0:00–0:30** — Dashboard shows stale state ("last scan: Sept 8"). Two or three "companies" visible (multi-tenant).
2. **0:30–1:15** — Click **Scan SEBI Now**. Live pipeline runs.
3. **1:15–2:00** — New circular found, obligation extracted, shown in structured form.
4. **2:00–2:45** — Retrieval + Impact Gate: applicability YES, alignment CONFLICT — for one tenant only, not the others (prove isolation).
5. **2:45–3:15** — Memo drafted, GitHub Issue created live, PR opened after mock approval click.
6. **3:15–3:45** — Notification fires on that tenant's Telegram/email only — show the other "company's" phone stays silent.
7. **3:45–4:15** — Quick numbers slide: LLM calls saved by the gate (%), tokens saved by TOON (%), with your actual measured numbers.
8. **4:15–5:00** — Close on the differentiation table.

## 17. Pipeline state machine

Drive the dashboard off one explicit state per circular, not ad-hoc flags:

```
DISCOVERED → EXTRACTING → INDEXING → ANALYZING
                                        │
                     ┌──────────────────┼──────────────────┐
                     ↓                  ↓                  ↓
                 ALIGNED            CONFLICT           UNCERTAIN
                     │                  │                  │
                 ARCHIVED           DRAFTED        NEEDS_INVESTIGATION
                                        │             (human review,
                                AWAITING_APPROVAL      no auto action)
                                        │
                                    APPROVED
                                        │
                                   PR_CREATED
                                        │
                                     MERGED
```
`UNCERTAIN` and `NEEDS_INVESTIGATION` are terminal-until-human-acts states — the system never guesses past them. This is your clearest Responsible AI evidence: it visibly does nothing when it isn't sure, instead of quietly hallucinating a confident answer.

## 18. Hardening — audit, evidence, versioning, idempotency

**Audit log** — every action gets a row, no exceptions:
```
audit_events: event_id, tenant_id, actor_type (agent|human|system),
              action, timestamp, circular_id, input_reference,
              decision, approval_status, resulting_ticket_id, resulting_pr_id
```
This is what makes "who/what caused this compliance action" answerable — critical for a compliance product's credibility, and an easy win for the responsible-AI grading line.

**Evidence citations are a hard requirement, not a nice-to-have.** Every CONFLICT output must contain both sides, not a bare assertion:
> "SEBI requires X [Circular §3.2], while Acme's Position Limits Policy states Y [Policy §4.1]."

Never accept a model output that just says "these conflict" with no pointer to where. Enforce this in the output schema — reject/retry if evidence fields are empty.

**Document versioning** — same URL, different `content_hash` = new version, not a duplicate:
```
processed_documents adds: document_version, previous_hash, supersedes_document_id
```

**Idempotency** — re-running a scan must never double-create an Issue or PR:
```
hash already processed? → YES → skip
                        → NO  → process → Issue already exists for this circular? → YES → don't duplicate
```
Also add basic retry/backoff for SEBI fetch, GitHub API, and model calls — a single flaky network call shouldn't crash a live demo.

**Uncertainty handling** — this is the failure-mode story graders actually want to see:
- `UNCERTAIN` applicability → no policy action, route to human review, do not guess.
- Insufficient evidence to support a CONFLICT claim → mark `NEEDS_INVESTIGATION`, never fabricate a citation to fill the gap.

## 19. Evaluation contract & golden dataset

Define pass/fail criteria per component, not just "does it run":

| Component | Must satisfy |
|---|---|
| Obligation extraction | Valid structured output; required fields present; no unsupported/invented obligations; evidence attached |
| Impact analysis | Applicability accuracy; alignment accuracy; evidence correctness against the golden set |
| Tool calling | Correct tool selected; valid arguments; no unauthorized side effects fired |

**Golden eval set** (`evals/`, one folder per scenario — realistically 10–15 given student Azure quota, not hundreds):
```
evals/circular_001/ { policy, expected_applicability, expected_alignment, expected_evidence }
```
Cover at minimum: obvious ALIGNED, obvious CONFLICT, irrelevant regulation, ambiguous applicability, conflicting wording, duplicate circular (idempotency check), updated circular (versioning check), a case with deliberately poor evidence (should trigger `NEEDS_INVESTIGATION`, not a confident wrong answer).

This eval set is also what section 9 (gate savings) and section 10 (TOON savings) run against — one dataset, three measurements.

## 20. AI-103 concepts demonstrated (map this directly for the grader)

| AI-103 concept | Where it lives in AfterCircular |
|---|---|
| Foundry / foundation models | Obligation extraction, impact analysis, memo generation |
| Prompt engineering | Structured-output prompts for each of the above |
| Agent architecture, task planning, state | Pipeline state machine (section 17), routing logic |
| RAG / knowledge grounding | Azure AI Search over the policy corpus |
| Vector search + hybrid search | Azure AI Search vector index + keyword fusion |
| Embeddings | Underlying the vector index |
| Function / tool calling | `create_compliance_ticket`, `create_policy_update_pr`, `notify` |
| Human-in-the-loop | PR-creation approval gate (section 8B) |
| Responsible AI | Uncertainty handling (section 18), no-autonomous-merge rule |
| Agent orchestration | Router between ALIGNED / CONFLICT / UNCERTAIN paths |
| Azure Functions | Scan trigger (timer in prod, button in demo) |
| Evaluation | Golden dataset + gate/TOON measurement (sections 9, 10, 19) |
| Monitoring / observability | Audit log + run-level metrics (section 21) |

## 21. Observability

Log per pipeline run, not just per final outcome:
```
run_id, tenant_id, circular_id, agent, model_used, latency,
input_tokens, output_tokens, retrieval_count, gate_result,
llm_call_count, tool_calls, errors, final_state
```
This is what makes your gate-savings and TOON-savings numbers credible — they're computed from this table, not eyeballed.

## 22. Security boundaries (state these explicitly even though full Tier 2 security isn't built)

- Regulatory documents (SEBI) = public, untrusted input — never assume their content is safe to execute as instructions, only to extract structured data from.
- Company documents = tenant-private — never cross tenant boundaries (section 6).
- LLM calls receive only the specific retrieved chunks needed for that call, not the full corpus.
- Notifications never include full confidential document text — summary + citation only.
- GitHub token: minimum required scope (single repo, issues+PR permissions only).

## 23. Model configuration — scaled down from full "Model Intelligence Layer"

The bigger version of this (live Foundry Model Router integration, a "Model Lab" dashboard, benchmarking 3–5+ models with leaderboards) is genuinely good engineering — and genuinely a second project's worth of time. Don't build the live version. Build the cheap version that earns the same claim:

- **Task-based model config**, not hardcoded model names:
```yaml
tasks:
  obligation_extraction: { model: cost-model }
  impact_gate: { model: cheapest-acceptable }
  impact_analysis: { model: quality-model }
  memo_generation: { model: balanced-model }
```
- Run your golden eval set (section 19) against **two** candidate models, not five. Report one static comparison table (accuracy, latency, cost) as a slide/screenshot in the deck — not a live interactive dashboard.
- This earns "we tested multiple models and picked deliberately" honestly, without needing Model Router, multiple live deployments, or a dashboard nobody has time to build well.
- Mention live Model Router + full model benchmarking explicitly as future scope in the README — that's a true and reasonable thing to say without having built it.

## 24. Team split (5)

1. SEBI fetcher + GitHub docs connector + persistent state + idempotency/versioning
2. Azure AI Search indexing (vector + hybrid, index-per-tenant)
3. Impact Gate + obligation extraction + eval harness (gate savings, TOON savings, golden dataset) — strongest member
4. Agent orchestration + GitHub Issue/PR tools + notification channels + audit log
5. Dashboard UI (state machine-driven), Azure infra, README, video, deck

## 25. Risks & mitigations

| Risk | Mitigation |
|---|---|
| SEBI site down/changed during demo | Cache a known-good snapshot; demo can run fully offline against it |
| Jev unavailable | Documented fallback classifier; architecture story unchanged |
| Telegram/email delivery flaky live | Rehearse beforehand; have a recorded backup clip of the notification firing |
| Multi-tenant + PR + TOON + eval is a lot for the time left | Tier 0 first, always — see section 0 |
| GitHub PAT/webhook auth issues | Fine-grained PAT scoped to one repo, stored in `.env`, verified before recording |
| Duplicate Issues/PRs from a re-run scan | Idempotency check (section 18) before any create call |
| Model-comparison scope creep | Two models, one static table — section 23, not a live dashboard |

## 26. Definition of done

- [ ] Tier 0 fully working end-to-end, demoed live
- [ ] At least one CONFLICT, one ALIGNED, and one UNCERTAIN case shown
- [ ] GitHub Issue created automatically on CONFLICT; PR created only after human approval — demoed live
- [ ] Re-running a scan does not duplicate any Issue/PR
- [ ] Vector search explicitly named in README
- [ ] Gate and TOON savings numbers measured and shown, not just claimed
- [ ] Evidence citations present on every CONFLICT output — no bare assertions
- [ ] Audit log covers every action taken
- [ ] No credentials committed — verified before final push
- [ ] README covers: problem, architecture, tech stack, setup, limitations, responsible AI, AI-103 concept mapping
- [ ] Team can answer: what problem, what we built, which AI-103 concepts, can we demo it working