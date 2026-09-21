# AfterCircular — decision architecture

**One model should not do everything.** A generative LLM is the wrong tool for a yes/no question with consequences: it
answers in prose, its self-reported confidence is not calibrated, and every extra judgment hidden inside one prompt is a
judgment nobody can inspect or tune. AfterCircular is built as *model specialization*, not "more agents":

| Kind of work | Owner | Why |
|---|---|---|
| Fetching, parsing, hashing, persistence, state transitions, date arithmetic, dedup, thresholds, routing, approval, GitHub, audit | **Deterministic code** | Reliable, cheap, testable. Nothing here needs semantic understanding. |
| Small typed semantic judgments: does it apply? is this chunk relevant? does this clause conflict with that obligation? does the circular section support this claim? | **TypeSafe System One (Jev)** | Returns typed answers with calibrated probabilities in ~400 ms for ~$0.001 per circular. No prose to parse; every judgment is a row we can inspect and threshold. |
| Free-form synthesis: extracting obligations from a PDF, drafting a memo, resolving cases the typed judgments leave uncertain | **Microsoft Foundry (generative / reasoning)** | Jev does not generate text and is not a reasoning model. These tasks need one. |
| Finding candidate policy text | **Azure AI Search** (hybrid vector + keyword, index per tenant) | Candidate generation over the whole corpus; local BM25+vector fallback for development. |
| Every consequential decision | **A human** | AI detects, analyzes, drafts. A person approves. Only then does the system act. |

## The pipeline

```
Scan now
  │
  ▼
SEBI connector ──► normalize + content hash ──► new / new version / already processed        (code)
  │
  ▼
Obligation extraction ─────────────────────────────────────────── generative (Foundry)
  │   free-form requirements, each with a verbatim excerpt + clause
  ▼
Extraction check ──────────────────────────────────────────────── Jev, 1 request
  │   per obligation: "does the circular state this?" · "does the excerpt express it?"  + verbatim string check in code
  │   → unsupported obligations dropped, borderline ones flagged
  ▼
Applicability ─────────────────────────────────────────────────── Jev, 1 request
  │   Nouls: entity in scope? activity in scope? depends on an unstated fact?
  │   Choice: applies / does_not_apply / cannot_tell_from_profile      Score: severity
  │
  ├── does_not_apply, confidence ≥ 0.80, entity-in-scope ≤ 0.30 ──► ARCHIVED (no further model calls)
  ├── cannot_tell / low confidence ─────────────────────────────────► escalate ▸
  ▼ applies
Hybrid search (Azure AI Search | local) ──► 10 candidate chunks        (code + retrieval)
  ▼
Rerank ────────────────────────────────────────────────────────── Jev, 1 request per chunk, in parallel
  │   Noul: "does this chunk set a rule on the same subject as an obligation?"  → keep ≥ 0.45, top 5
  ▼
Alignment ─────────────────────────────────────────────────────── Jev, 1 request per kept chunk
  │   per (obligation × chunk) Choice: satisfies / conflicts / not_addressed
  │   confident conflicts → CONFLICT candidates · confident satisfies → ALIGNED evidence
  │   low confidence with P(conflicts) ≥ 0.30 ───────────────────────► escalate ▸
  ▼
Citation check ────────────────────────────────────────────────── Jev, 1 request per conflict pair
  │   string-match the excerpt in code (missing → "fabricated", dropped), then
  │   Choice: does the circular section support / contradict / say nothing about the claimed requirement
  │   contradicts or says_nothing at ≥ 0.80 → conflict dropped · < 0.80 → kept, flagged for the reviewer
  ▼
Impact Gate (code): NO → archived · ALIGNED → archived with evidence · CONFLICT with two-sided evidence → memo
                    UNCERTAIN / conflict without evidence → NEEDS_INVESTIGATION (a person)
  ▼
Memo draft ────────────────────────────────────────────────────── generative (Foundry)  "AI-generated draft — human review required"
  ▼
AWAITING_REVIEW ──► human approves ──► GitHub issue ──► audit event

▸ escalate: the reasoning model (Foundry impact analysis) is called with only the chunks in question; its policy quotes
  must exist verbatim in those chunks. If no reasoning model is configured, the case goes to a person with the reason.
```

Policy evidence is **selected, not generated**: the policy excerpt shown to the reviewer is the retrieved chunk itself, so
it is verbatim by construction. Regulatory excerpts come from the extractor and are string-matched against the circular
before anything is built on them.

## Why Jev (System One) for the judgments

From the TypeSafe docs (docs.typesafe.ai — the source of truth for the integration):

- **Typed answers, not prose.** A `Choice` over `satisfies / conflicts / not_addressed` maps straight onto three code
  paths; a `Noul` maps onto an `if`. No JSON repair, no regex over an explanation.
- **Calibrated probabilities.** System One models are trained (RLCD) so that probabilities reflect uncertainty across a
  population of decisions. A generative model's "confidence: 0.9" is a sentence it wrote.
- **Parallel fan-out.** Every question in a request is evaluated independently against the same state, so decomposing a
  broad judgment into atomic ones costs tokens, not round-trips. The alignment stage asks up to 8 relations per chunk in
  one call.
- **Cheap and fast.** $0.042 per million input tokens, output free; ~400 ms per request. A CONFLICT case costs ~$0.001.
- **Known limits (Jev 1.13 jaggedness page):** literal reading, no arithmetic, no date comparison, accuracy drops with
  irrelevant state, not adversarially robust, cannot generate. So: criteria are explicit and positively framed, dates and
  counts stay in code, each request carries only the chunk and obligations it needs, and every generative task stays on
  Foundry.

What Jev is deliberately **not** used for: extracting obligations (generation), writing the memo (generation), explaining
a decision in prose (the reviewer sees the typed answers and the evidence instead), deciding to open the GitHub issue
(a human does).

## Probabilities are not truth

`app/decisions/policy.py` holds every threshold, with the semantics from the Confidence and self-consistency pages:

- A Noul inside `0.30 – 0.70` is *uncertain*, never rounded to yes or no.
- Choice/Score `confidence` summarizes distribution concentration. It is a routing signal. It never authorizes a side
  effect; the GitHub issue is behind a human click regardless of any number.
- Thresholds scale with consequence: silently archiving a circular as NOT APPLICABLE needs `confidence ≥ 0.80` **and**
  entity-in-scope `≤ 0.30`; sending a case to a person needs nothing.
- Every stage writes a `DecisionRecord`: provider, versioned model id, `calibrated` flag, question ids, a digest of the
  exact state sent, the evidence ids judged, the raw answers (full probability distributions), the thresholds applied and
  the routing outcome. The reviewer sees this as the **Decision path** in the dashboard; the API serves it at
  `GET /api/analyses/{id}/decisions`.
- The UI labels model probabilities as the model's own. Foundry-emulated judgments are labelled *self-reported
  probabilities*; stub fixtures are labelled *no model calls*.

## The cascade

```
cheap typed judgment (Jev)  ── determinate ──► act on it (archive / align / conflict with verified evidence)
        │ uncertain
        ▼
reasoning model (Foundry)  ── determinate, quotes verified ──► act on it
        │ uncertain / not configured / quotes not verbatim
        ▼
a person (NEEDS_INVESTIGATION)
```

Escalation triggers are explicit and recorded: applicability `cannot_tell_from_profile` or confidence `< 0.60`; an
alignment pair below `0.70` confidence whose `P(conflicts) ≥ 0.30` (a pair torn between *satisfies* and *not_addressed*
is harmless and does not escalate); a conflict whose citation check failed. On the golden set, the NOT-APPLICABLE
circular is settled in two Jev requests with no reasoning-model call at all.

## Model routing

`DECISION_ROUTES=applicability=typesafe,rerank=typesafe,alignment=typesafe,verification=typesafe,extraction_check=typesafe`
(default judge `DEFAULT_JUDGE=typesafe`). Any task can be pointed at `foundry` (a labelled, uncalibrated emulation that
answers the same typed questions as JSON — useful for benchmarks and as a fallback) or `stub` (fixtures, for tests).
Generative tasks keep their own per-task deployments (`EXTRACTION_MODEL`, `IMPACT_MODEL`, `MEMO_MODEL`). The question
objects are the SDK's `Noul` / `Choice` / `Score` types for every provider, so a provider swap touches no business logic.

## Evaluation

`python -m evals.judges --judges typesafe,foundry,stub` runs the whole decision layer per judge over the golden
scenarios (CONFLICT, ALIGNED, not applicable, UNCERTAIN) with identical extraction input and records per case:
applicability / alignment / affected-policy correctness, evidence-verbatim rate, rerank hit rate, escalation rate, a
Brier term on the applicability distribution (calibration signal across many cases, not a per-case score), requests,
tokens, latency and priced cost. `python -m evals.run` benchmarks the generative deployments (extraction, escalation,
memo). Both write machine-readable reports that the dashboard's *Model intelligence* tab renders. No number is invented:
unpriced models show `null`, stub rows are marked as measuring the harness.

## Human oversight (unchanged invariant)

AI detects → AI analyzes → AI drafts → **a human decides** → the system executes after approval. No model modifies a
policy file, merges anything, or opens the issue on its own — not at 0.99, not at 1.00.
