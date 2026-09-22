"""Ask AfterCircular — a read/reason-only interface over the workspace.

    question ─► build_context (deterministic, bounded records with stable ids)
             ─► Jev route (1 request): intent · targets · follow-up? · action request? · answerable?
             ├─ deterministic intent  → answer assembled from records                 provenance.kind = workspace_data
             ├─ action request        → refusal; approval UI is the only path          provenance.kind = refused
             └─ reasoning intent      → Jev judgments over the records (1 request): relevance, action needed, urgency,
                                        evidence support, sufficiency                  provenance.kind = jev_reasoning
                                      → narrative: Foundry writes grounded sentences under a strict schema, every claim
                                        tied to a record id that must exist in the context (validated in code); when no
                                        narrative model is available the answer is composed from the judgments and says so

Jev (TypeSafe System One) returns typed judgments with calibrated probabilities — it does not write prose. So "reasoned
by Jev" means exactly that: the ranking, relevance and sufficiency decisions are Jev's; the sentences are rendered from
those decisions. Nothing in this module executes an action, and no answer contains a fact that is not in the context.
"""

from __future__ import annotations

import logging
import re
import time
from typing import Any

from pydantic import BaseModel, Field
from typesafe_sdk import Choice, Noul, NoulCriteria, Score

from app.config import settings
from app.decisions.providers import JudgmentError, judge_for
from app.models.provider import CallBudget, LLMProvider, ProviderError, budget_var, provider
from app.schemas.actions import Investigation, TenantContext
from app.schemas.decisions import Judgment
from app.services.ask_context import build_context, index_ids
from app.services.state import StateStore, new_id, now
from app.toon import format_context

log = logging.getLogger(__name__)

DETERMINISTIC = {
    "pending_reviews": "what is waiting for approval or review, which conflicts still need a human decision",
    "approval_status": "whether anything has been approved or rejected, who decided, whether a GitHub issue exists",
    "list_conflicts": "list which circulars conflict with internal policy (a list, not an explanation)",
    "list_not_applicable": "list which circulars do not apply to the company",
    "list_aligned": "list which circulars are already aligned with internal policy (no change needed)",
    "list_applicable": "list which circulars or SEBI changes apply to / affect this company (applicable ones, whatever their result)",
    "effective_dates": "the effective date or deadline of a circular (or of all of them when none is named)",
    "latest_changes": "a list of what arrived recently or what the last scan found — not the contents of any one circular",
    "scan_status": "when the last scan ran, whether the source is live, which source or models are in use",
    "run_scan": "asks to run, trigger or start a new scan now",
    "policy_lookup": "contents, clauses, owner or version of one specific internal policy document",
}
REASONING = {
    "explain": "what one circular says or changed, why it got its result (conflict, aligned, not applicable), the reasoning behind one verdict",
    "prioritize": "which items matter most, which are urgent, what to do first or next and why (a recommendation, not an action)",
    "evidence": "what evidence supports a conclusion, which excerpts or clauses back a verdict",
    "affected_policies": "which internal policy documents or sections are affected by a circular or by all conflicts",
    "obligations": "which obligations or requirements a circular imposes, which affect a given area",
    "compare": "what differs or changed between two circulars or between a circular and a policy",
    "summarize_work": "summarize the pending compliance work, the overall situation, what the workspace contains",
    "other_reasoning": "another question that needs reasoning over the workspace records",
}
WEB = {"web_lookup": "asks to look something up on sebi.gov.in, or about the latest/newest SEBI publication on a topic that `records` do not contain (not about any record in the workspace)"}
INTENTS = {**DETERMINISTIC, **REASONING, **WEB, "action_request": "asks the assistant itself to act now: approve, reject, create a GitHub issue, change a policy — not a question about what the company should do",
           "other": "not about this workspace, or too vague to route"}
MIN_INTENT_CONFIDENCE = 0.5
MIN_TARGET_CONFIDENCE = 0.5
URGENCY = ["none", "low", "medium", "high"]


def _keyword_intent(q: str) -> str:
    ql = q.lower()
    for intent, words in (
        ("action_request", ["create an issue", "create a github", "open an issue", "approve", "reject"]),
        ("run_scan", ["run a scan", "run scan", "scan now", "trigger", "start a scan"]),
        ("prioritize", ["priorit", "urgent", "first"]),
        ("evidence", ["evidence", "support"]),
        ("explain", ["why", "explain"]),
        ("pending_reviews", ["review", "waiting", "pending", "decide"]),
        ("approval_status", ["approved", "rejected", "anyone"]),
        ("list_not_applicable", ["not applicable", "not apply"]),
        ("list_aligned", ["already aligned", "aligned"]),
        ("effective_dates", ["effective date", "deadline"]),
        ("list_applicable", ["affect this company", "affect us", "apply to us", "applicable to us"]),
        ("list_conflicts", ["conflict"]),
        ("affected_policies", ["policy section", "sections are affected", "which polic"]),
        ("obligations", ["obligation", "requirement"]),
        ("scan_status", ["last scan", "monitoring", "source", "model", "status"]),
        ("policy_lookup", ["pol-", "sop-", "priv-"]),
        ("latest_changes", ["what changed", "latest", "new", "recent"]),
    ):
        if any(w in ql for w in words):
            return intent
    return "other"


# ---- Jev call 1: routing ---------------------------------------------------------------------------------------------
async def route(ctx: dict[str, Any], document_id: str | None) -> tuple[str, list[str], str | None, dict[str, Any], dict[str, Any]]:
    """→ (intent, target record ids, policy id, flags {follow_up, requests_action, answerable}, judge meta)."""
    judge = judge_for("ask")
    recs = ctx["records"]
    state = {"question": ctx["question"], "conversation": ctx["conversation"], "company": ctx["workspace"]["company"],
             "records": [{"id": r["id"], "title": r["title"], "circular_number": r["circular_number"], "published_date": r["published_date"], "source_mode": r["source_mode"], "impact": r["impact"],
                          "status": r["status"], "review": (r["review"] or {}).get("status")} for r in recs],
             "policies": [{"doc_id": p["doc_id"], "title": p["title"]} for p in ctx["policies"]], "pending_reviews": len(ctx["pending_reviews"])}
    qs: dict[str, Any] = {
        "intent": Choice(instructions="What is `question` asking for? Read `conversation` first: a short follow-up refers to the previous turn.", criteria=dict(INTENTS)),
        "requests_action": Noul(instructions="Does `question` ask the assistant to perform an action itself (approve, reject, create an issue, edit a policy, run something)? Asking what the company should do next is a recommendation, and asking to look something up or search sebi.gov.in is a read-only question — neither is an action.",
                                criteria=NoulCriteria(true="it asks for an action to be carried out", false="it asks for information, analysis or an explanation")),
        "follow_up": Noul(instructions="Does `question` depend on `conversation` to be understood (pronouns, 'the first one', 'that', 'which should be…')?",
                          criteria=NoulCriteria(true="it cannot be interpreted without the previous turn", false="it stands on its own")),
        "answerable": Noul(instructions="Can `question` be answered from `records`, `policies` and the scan state of this workspace?",
                           criteria=NoulCriteria(true="the workspace records contain what is needed", false="it asks about things this workspace does not track")),
    }
    if recs:
        crit = {**{r["id"]: f"{r['circular_number'] or r['document_id']}: {r['title'][:80]}" for r in recs}, "none": "no specific publication"}
        qs["document"] = Choice(instructions="Which record in `records` does `question` refer to first? 'the latest live circular' means the newest record with source_mode LIVE; 'the first conflict' means the first conflict in `conversation`; 'the finding' or 'most relevant' means a record with a result to act on (impact CONFLICT, then UNCERTAIN) — never an archived NOT_APPLICABLE one. Choose none when it refers to no specific publication, or to all of them.", criteria=crit)
        qs["document_2"] = Choice(instructions="If `question` refers to a second specific record (comparisons, 'these two'), which one? Otherwise none.", criteria=crit)
    if ctx["policies"]:
        qs["policy"] = Choice(instructions="Which internal policy in `policies` does `question` refer to? Choose none when it refers to no specific policy.",
                              criteria={**{p["doc_id"]: str(p["title"]) for p in ctx["policies"]}, "none": "no specific policy"})
    t0 = time.perf_counter()
    try:
        j = await judge.ask("ask", state, qs, context={"document_id": document_id})
    except JudgmentError as e:
        intent = _keyword_intent(ctx["question"])
        return intent, [], None, {"follow_up": bool(ctx["conversation"]), "requests_action": intent == "action_request", "answerable": True}, \
            {"provider": "keyword-fallback", "model": "-", "calibrated": False, "error": str(e)[:120], "note": "Jev unavailable: keyword routing, no model"}
    a = j.answers["intent"]
    intent = a.choice or "other"
    meta: dict[str, Any] = {"provider": j.provider, "model": j.model, "calibrated": j.calibrated, "intent_confidence": a.confidence, "intent_probabilities": a.probabilities,
                            "latency_ms": j.latency_ms or int((time.perf_counter() - t0) * 1000), "input_tokens": j.input_tokens, "output_tokens": j.output_tokens, "questions": len(qs)}
    if j.provider == "stub":
        intent = _keyword_intent(ctx["question"])
        meta["note"] = "stub judge: keyword routing (tests only)"
    elif (a.confidence or 0) < MIN_INTENT_CONFIDENCE:
        # tie-break: the intent is split between "what this circular says/changed" readings but the *target* is clear →
        # explain that circular rather than ask the person to rephrase
        doc_conf = (j.answers["document"].confidence or 0) if "document" in j.answers else 0
        top = sorted((a.probabilities or {}).items(), key=lambda kv: -kv[1])[:2]
        if doc_conf >= 0.8 and top and all(k in ("explain", "latest_changes", "compare", "evidence", "obligations", "summarize_work") for k, _ in top):
            intent = "explain"
            meta["note"] = f"intent split {', '.join(f'{k} {v:.2f}' for k, v in top)}; target clear ({doc_conf:.2f}) → explaining it"
        elif top and top[0][0] in DETERMINISTIC and top[0][1] >= 0.4:
            # a list-type reading leads (e.g. latest_changes 0.45 vs affected_policies 0.20): answer from records — no model, no guess
            intent = top[0][0]
            meta["note"] = f"intent split {', '.join(f'{k} {v:.2f}' for k, v in top)}; leading reading is deterministic → {intent}"
        elif doc_conf >= MIN_TARGET_CONFIDENCE and top and all(k in REASONING for k, _ in top):
            # split only between reasoning readings of one clear circular → take Jev's top reading; the narrative is still validated
            intent = top[0][0]
            meta["note"] = f"intent split {', '.join(f'{k} {v:.2f}' for k, v in top)}; target clear ({doc_conf:.2f}) → {intent}"
        else:
            meta["note"] = f"intent confidence {a.confidence:.2f} below {MIN_INTENT_CONFIDENCE}; asking for clarification"
            intent = "other"
    targets: list[str] = []
    for key in ("document", "document_2"):
        if key in j.answers and j.provider != "stub":
            da = j.answers[key]
            if da.choice and da.choice != "none" and (da.confidence or 0) >= MIN_TARGET_CONFIDENCE and da.choice not in targets:
                targets.append(da.choice)
            meta[f"{key}_confidence"] = da.confidence
    pol = None
    if "policy" in j.answers and j.provider != "stub":
        pa = j.answers["policy"]
        if pa.choice and pa.choice != "none" and (pa.confidence or 0) >= MIN_TARGET_CONFIDENCE:
            pol = pa.choice
    if j.provider == "stub":  # keyword targets for tests
        for r in recs:
            if r["circular_number"] and r["circular_number"].lower() in ctx["question"].lower() or r["document_id"].lower() in ctx["question"].lower():
                targets.append(r["id"])
        m2 = re.search(r"\b(POL|SOP|PRIV)-\d{3}\b", ctx["question"], re.I)
        pol = m2.group(0).upper() if m2 else None
    if j.provider == "stub":  # neutral 0.5 Nouls must not read as "yes" in tests
        flags = {"follow_up": bool(ctx["conversation"]), "requests_action": intent == "action_request", "answerable": True}
    else:
        flags = {"follow_up": (j.answers["follow_up"].noul or 0) >= 0.5, "requests_action": (j.answers["requests_action"].noul or 0) >= 0.5 or intent == "action_request",
                 "answerable": (j.answers["answerable"].noul or 0) >= 0.3}
    meta["flags"] = flags
    return intent, targets, pol, flags, meta


# ---- Jev call 2: judgments over the selected records ----------------------------------------------------------------------
def reasoning_questions(intent: str, records: list[dict[str, Any]]) -> dict[str, Any]:
    qs: dict[str, Any] = {
        "sufficient": Noul(instructions="Do `records` contain enough evidence to answer `question` without guessing?",
                           criteria=NoulCriteria(true="the verdicts, evidence and dates in the records settle the question", false="the records do not contain what the question needs")),
    }
    for r in records:
        i = r["id"]
        qs[f"{i}:relevant"] = Noul(instructions=f"Is record `{i}` relevant to `question`?",
                                   criteria=NoulCriteria(true="the question is about this record or its verdict/evidence bears on the answer", false="this record does not bear on the question"))
        if intent in ("prioritize", "summarize_work", "other_reasoning"):
            qs[f"{i}:action_needed"] = Noul(instructions=f"Does record `{i}` still need a human action (a decision, a policy change) according to its status, verdict and review state?",
                                            criteria=NoulCriteria(true="a conflict is awaiting review or an applicable requirement is not yet addressed", false="it is archived, not applicable, aligned, or already decided"))
            qs[f"{i}:urgency"] = Score(instructions=f"How urgent is record `{i}` for the company, considering its effective date, severity, verdict, confidence and review state?",
                                       criteria=["None: not applicable, aligned, or already decided", "Low: applicable but no conflict, or effective date far away",
                                                 "Medium: conflict awaiting review with time before the effective date", "High: conflict awaiting review that is effective already or within weeks, or prohibitive severity"])
        if intent in ("evidence", "explain", "affected_policies", "compare"):
            for e in r["regulatory_evidence"] + r["policy_evidence"]:
                qs[f"{e['id']}:supports"] = Noul(instructions=f"Does excerpt `{e['id']}` support the verdict recorded on `{r['id']}` ({r.get('applicability')}/{r.get('alignment')})?",
                                                 criteria=NoulCriteria(true="the excerpt states the rule or requirement the verdict rests on", false="the excerpt is about something else or does not bear on the verdict"))
        if intent == "obligations":
            for o in r["obligations"]:
                qs[f"{o['id']}:relevant"] = Noul(instructions=f"Is obligation `{o['id']}` what `question` asks about?",
                                                 criteria=NoulCriteria(true="the obligation concerns the area or requirement the question names", false="it concerns something else"))
    return qs


def judgments_to_dict(j: Judgment, records: list[dict[str, Any]]) -> dict[str, Any]:
    out: dict[str, Any] = {"sufficient": j.answers["sufficient"].noul, "records": {}}
    for r in records:
        i = r["id"]
        entry: dict[str, Any] = {"relevant": j.answers[f"{i}:relevant"].noul}
        if f"{i}:urgency" in j.answers:
            s = j.answers[f"{i}:urgency"]
            entry["urgency_score"], entry["urgency"], entry["urgency_confidence"] = s.score, URGENCY[min(3, max(0, round(s.score or 0)))], s.confidence
            entry["action_needed"] = j.answers[f"{i}:action_needed"].noul
        ev = {k.split(":")[0]: v.noul for k, v in j.answers.items() if k.startswith(i + ".") and k.endswith(":supports")}
        if ev:
            entry["evidence_supports"] = ev
        ob = {k.split(":")[0]: v.noul for k, v in j.answers.items() if k.startswith(i + ".O") and k.endswith(":relevant")}
        if ob:
            entry["obligations_relevant"] = ob
        out["records"][i] = entry
    return out


# ---- narrative (Foundry, strict schema, grounded) --------------------------------------------------------------------------
class AskPoint(BaseModel):
    record_id: str = Field(description="An id from `records`, e.g. D2")
    claim: str = Field(description="One or two sentences about this record, grounded only in its fields and evidence")
    evidence_ids: list[str] = Field(description="Ids of the obligations/excerpts the claim rests on, e.g. D2.P1")


class AskAnswer(BaseModel):
    summary: str = Field(description="Two to four plain sentences answering the question directly")
    points: list[AskPoint]
    insufficient_evidence: bool = Field(description="True when the records do not contain what the question needs")
    caveat: str | None = Field(default=None, description="What the workspace cannot tell, if anything")


NARRATIVE_SYSTEM = """You write the answer for a compliance workspace assistant. You are given the user's question, the previous turns, the
workspace records (TOON tables) and the typed judgments a calibrated judge already made about them (relevance, urgency,
whether evidence supports the verdict, whether evidence is sufficient).

Rules — these are absolute:
- Every claim must be about a record in `records`, cited by its id; every evidence id must exist in that record. Never mention a
  circular, policy, clause, date, review state, issue or action that is not in the records.
- Follow the judge's judgments: rank by its urgency scores, keep only records it marked relevant, do not contradict a verdict.
- Quote evidence text verbatim when citing it. Do not compute new scores or invent priorities beyond the judge's urgency levels.
- If `judgments.sufficient` is below 0.5 or the records lack what the question needs, set insufficient_evidence=true and write
  exactly: "I don't have enough evidence in this workspace to determine that." then say what the workspace does contain.
- A record whose impact is NOT_APPLICABLE was archived at triage: its `reason` and its header excerpt (R1) fully answer what it
  is and why it does not apply — say that; it is not insufficient evidence. A record with no obligations was never extracted.
- `caveat` is only for a specific thing the workspace cannot tell (e.g. "no effective date is recorded"); leave it null otherwise
  and never repeat the answer or the insufficient-evidence sentence there.
- Company and policies are a fictional PoC tenant; records with synthetic=true are fictional demo circulars — say so if asked.
- Never offer to approve, reject or create issues; a person does that in the review screen.
- Plain language, no marketing tone, no legal certainty."""


async def narrate(llm: LLMProvider, ctx: dict[str, Any], records: list[dict[str, Any]], judgments: dict[str, Any], intent: str) -> tuple[AskAnswer | None, dict[str, Any] | None]:
    rows = [{k: v for k, v in r.items() if k not in ("document_pk", "analysis_id", "url", "document_url", "decision_path", "triage", "regulatory_source", "policy_sources")} for r in records]
    block = format_context({"records": rows}, prefer="toon" if settings().toon_context else "json")
    convo = "\n".join(f"Q: {t['question']}\nA: {t['answer_summary']}" for t in ctx["conversation"]) or "(none)"
    user = (f"COMPANY: {ctx['workspace']['company']} (fictional PoC tenant)\nINTENT: {intent}\nPREVIOUS TURNS\n{convo}\n\nQUESTION\n{ctx['question']}\n\n"
            f"JUDGMENTS (calibrated, by Jev)\n{format_context(judgments, prefer='json').text}\n\nRECORDS ({block.format})\n{block.text}")
    try:
        ans, res = await llm.structured("ask", NARRATIVE_SYSTEM, user, AskAnswer, context={"document_id": records[0]["document_id"] if records else None, "context_format": block.format})
    except ProviderError as e:
        log.warning("ask narrative unavailable: %s", e)
        return None, {"error": str(e)[:160]}
    return ans, {"provider": res.provider, "model": res.model, "latency_ms": res.latency_ms, "input_tokens": res.input_tokens, "output_tokens": res.output_tokens, "response_id": res.response_id,
                 "cached_tokens": res.cached_tokens, "estimated_cost_usd": res.estimated_cost_usd, "structured_mode": res.structured_mode, "context_format": res.context_format, "attempts": res.attempts}


def validate_answer(ans: AskAnswer, ids: dict[str, dict[str, Any]], allowed_records: set[str]) -> tuple[AskAnswer, list[str]]:
    """Drop any claim or evidence id that is not in the context. Grounding is enforced here, not trusted."""
    dropped: list[str] = []
    points = []
    for p in ans.points:
        if p.record_id not in ids or p.record_id not in allowed_records:
            dropped.append(p.record_id)
            continue
        ev = [e for e in p.evidence_ids if e in ids and ids[e].get("record") == p.record_id]
        dropped += [e for e in p.evidence_ids if e not in ev]
        points.append(AskPoint(record_id=p.record_id, claim=p.claim, evidence_ids=ev))
    caveat = ans.caveat
    if caveat and (not ans.insufficient_evidence and caveat.lower().startswith("i don't have enough evidence") or len(caveat) > 300):
        caveat = None  # a contradiction or an essay is not a caveat
    return AskAnswer(summary=ans.summary, points=points, insufficient_evidence=ans.insufficient_evidence or (not points and not ans.insufficient_evidence and bool(ans.points)), caveat=caveat), dropped


def compose_from_judgments(ctx: dict[str, Any], records: list[dict[str, Any]], judgments: dict[str, Any], intent: str) -> AskAnswer:
    """No narrative model: sentences assembled from the records and Jev's judgments only."""
    js = judgments["records"]
    rel = [r for r in records if (js.get(r["id"], {}).get("relevant") or 0) >= 0.5]
    if (judgments.get("sufficient") or 0) < 0.5 or not rel:
        have = ", ".join(f"{r['circular_number'] or r['document_id']} ({r['gate'] or r['status']})" for r in records[:5]) or "no processed publications"
        return AskAnswer(summary=f"I don't have enough evidence in this workspace to determine that. The workspace contains: {have}.", points=[], insufficient_evidence=True, caveat=None)
    if intent in ("prioritize", "summarize_work"):
        rel.sort(key=lambda r: -(js[r["id"]].get("urgency_score") or 0))
    points = []
    for r in rel:
        j = js[r["id"]]
        bits = [f"{r['applicability'] or r['status']}" + (f"/{r['alignment']}" if r.get("alignment") else "")]
        if r.get("affected_policies"):
            bits.append("affects " + ", ".join(r["affected_policies"]))
        if r.get("effective_date"):
            bits.append(f"effective {r['effective_date']}")
        if r.get("review"):
            bits.append(f"review {r['review']['status']}")
        if "urgency" in j:
            bits.append(f"urgency {j['urgency']} (Jev)")
        ev = [e["id"] for e in r["regulatory_evidence"] + r["policy_evidence"] if (j.get("evidence_supports") or {}).get(e["id"], 1.0) >= 0.5]
        points.append(AskPoint(record_id=r["id"], claim=f"{r['circular_number'] or r['document_id']}: " + "; ".join(bits) + (f". {r['reason']}" if r.get("reason") else ""), evidence_ids=ev[:4]))
    return AskAnswer(summary=f"{len(points)} record(s) are relevant, ranked by Jev's urgency judgments; no narrative model was available, so the sentences below are assembled from the records.",
                     points=points, insufficient_evidence=False, caveat=None)


# ---- deterministic answers ----------------------------------------------------------------------------------------------
def _cards(records: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """The DocCard shape the UI renders (same fields as before, plus the record id, provenance and review)."""
    out = []
    for r in records:
        rv = r.get("review") or {}
        out.append({k: r[k] for k in ("id", "document_pk", "document_id", "circular_number", "title", "published_date", "effective_date", "source_mode", "synthetic", "url", "document_url", "status", "impact",
                                      "analysis_id", "applicability", "alignment", "gate", "severity", "confidence", "affected_policies", "reason", "review", "regulatory_evidence", "policy_evidence",
                                      "decision_path", "escalation_reason", "recommended_action", "regulatory_source", "policy_sources")}
                   | {"source": r["regulator"], "ticket_id": rv.get("ticket_id"), "ticket_url": rv.get("ticket_url")})
    return out


def targets_of(ctx: dict[str, Any]) -> list[str]:
    return list(ctx.get("_targets") or [])


SIGNIFICANCE = {"CONFLICT": 0, "UNCERTAIN": 1, "ALIGNED": 2, "NOT_APPLICABLE": 3}


def by_significance(recs: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Untargeted reasoning questions ("the finding", "the two most relevant") start from what matters: conflicts, then open
    questions, then aligned, then archived — a stable rule, not a guess."""
    return sorted(recs, key=lambda r: (SIGNIFICANCE.get(r["impact"] or "", 4), -(r["confidence"] or 0)))


def deterministic(intent: str, ctx: dict[str, Any], db: StateStore, tenant: TenantContext, pol: str | None) -> tuple[str, dict[str, Any]]:
    recs = ctx["records"]
    answer: dict[str, Any] = {}
    if intent == "run_scan":
        return "A scan is a human-triggered action here. Use Scan now; nothing runs from a question.", {"actions": [{"label": "Scan now", "kind": "scan"}]}
    if intent == "scan_status":
        s = ctx["latest_scan"]
        if not s:
            return "No scan has run yet.", {}
        src = {"LIVE_SUCCESS": "live SEBI (official site)", "LIVE_NO_NEW_DOCUMENTS": "live SEBI, nothing new", "LIVE_PARTIAL": "live SEBI (partial)", "LIVE_FAILED": "live SEBI — connection failed",
               "DEMO_SNAPSHOT": "the fictional demo snapshot", "DEMO_SNAPSHOT_FALLBACK": "the demo snapshot after a live failure"}.get(s["source_status"] or "", s["source_mode"] or "unknown source")
        return f"Last scan {s['status'].lower()} at {s['at'][:16].replace('T', ' ')} UTC from {src}: {s['new']} new, {s['skipped']} already processed, {s['llm_calls']} model calls.", {"scan": s}
    if intent == "pending_reviews":
        pend = [r for r in recs if r["review"] and r["review"]["status"] == "AWAITING_REVIEW"]
        return (f"{len(pend)} conflict{'s' if len(pend) != 1 else ''} waiting for your decision." if pend else "Nothing is waiting for your decision."), {"documents": _cards(pend)}
    if intent == "approval_status":
        decided = [r for r in recs if r["review"] and r["review"]["status"] in ("APPROVED", "REJECTED")]
        if not decided:
            return "No review has been approved or rejected yet in this workspace.", {"documents": []}
        parts = [f"{r['circular_number'] or r['document_id']}: {r['review']['status'].lower()} by @{r['review']['decided_by']}" + (f", GitHub issue #{r['review']['ticket_id']}" if r['review'].get('ticket_id') else "") for r in decided]
        return "; ".join(parts) + ".", {"documents": _cards(decided)}
    if intent == "list_conflicts":
        c = [r for r in recs if r["impact"] == "CONFLICT"]
        return (f"{len(c)} of {len(recs)} processed circulars conflict with internal policy: " + ", ".join(r["circular_number"] or r["document_id"] for r in c) + "." if c else "No processed circular conflicts with internal policy."), {"documents": _cards(c)}
    if intent == "list_not_applicable":
        n = [r for r in recs if r["impact"] == "NOT_APPLICABLE"]
        return (f"{len(n)} of {len(recs)} processed circulars do not apply to {tenant.company_name}: " + ", ".join(r["circular_number"] or r["document_id"] for r in n) + "." if n else "No processed circular was judged not applicable."), {"documents": _cards(n)}
    if intent == "list_aligned":
        al = [r for r in recs if r["impact"] == "ALIGNED"]
        return (f"{len(al)} of {len(recs)} processed circulars are already aligned with internal policy: " + ", ".join(r["circular_number"] or r["document_id"] for r in al) + "." if al else "No processed circular has been judged aligned yet."), {"documents": _cards(al)}
    if intent == "list_applicable":
        ap = [r for r in recs if r["applicability"] == "YES" or r["impact"] in ("CONFLICT", "ALIGNED", "UNCERTAIN")]
        by = {k: [r for r in ap if r["impact"] == k] for k in ("CONFLICT", "UNCERTAIN", "ALIGNED")}
        parts = [f"{len(v)} {k.lower().replace('uncertain', 'needing investigation')}" for k, v in by.items() if v]
        return (f"{len(ap)} of {len(recs)} processed circulars apply to {tenant.company_name}" + (f" ({', '.join(parts)})" if parts else "") + ": " + ", ".join(r["circular_number"] or r["document_id"] for r in ap) + "."
                if ap else f"None of the {len(recs)} processed circulars applies to {tenant.company_name}."), {"documents": _cards(ap)}
    if intent == "effective_dates":
        sel = [r for r in recs if r["id"] in targets_of(ctx)] or [r for r in recs if r["impact"] in ("CONFLICT", "UNCERTAIN", "ALIGNED")] or recs
        parts = [f"{r['circular_number'] or r['document_id']}: {r['effective_date'] or 'no effective date recorded'}" for r in sel]
        return ("; ".join(parts) + "." if parts else "No publications processed yet."), {"documents": _cards(sel)}
    if intent == "latest_changes":
        recent = recs[:5]
        if not recent:
            return "No publications processed yet. Run a scan.", {}
        counts = {k: sum(1 for r in recent if r["impact"] == k) for k in ("CONFLICT", "ALIGNED", "NOT_APPLICABLE")}
        rest = len(recent) - sum(counts.values())
        return (f"{len(recent)} recent publication{'s' if len(recent) != 1 else ''}: {counts['CONFLICT']} conflict, {counts['ALIGNED']} aligned, {counts['NOT_APPLICABLE']} not applicable" + (f", {rest} pending or uncertain." if rest else ".")), {"documents": _cards(recent)}
    if intent == "policy_lookup":
        pdoc = next((p for p in ctx["policies"] if p["doc_id"] == pol), None) if pol else None
        if not pdoc:
            return ("Which policy? Name a document id such as POL-001." if ctx["policies"] else "No policies are indexed yet — run a scan to read the repository."), {"policies": ctx["policies"]}
        chunks = [c for c in db.policy_chunks(tenant.tenant_id) if c["doc_id"] == pol]
        affected = [r for r in recs if pol in (r["affected_policies"] or [])]
        answer = {"policy": {**pdoc, "sections": [{"section": c["section"], "text": c["text"].split("\n", 1)[-1]} for c in chunks]}, "documents": _cards(affected)}
        return f"{pdoc['doc_id']} — {pdoc['title']}, version {pdoc.get('version') or '—'}, {len(chunks)} sections." + (f" Affected by {len(affected)} circular(s)." if affected else " No processed circular affects it."), answer
    return "Nothing to show.", {}


# ---- Foundry Web Search (discovery only) ------------------------------------------------------------------------------
WEB_DOMAINS = ["sebi.gov.in"]
WEB_SYSTEM = ("You look up SEBI publications for a compliance analyst. Use only search results from sebi.gov.in. Answer in at most four sentences: "
              "title, date, reference number if visible, and the exact URL of each publication. If nothing relevant is found, say so. Never assess "
              "applicability or compliance — that is done elsewhere from the official PDF.")


async def web_lookup(db: StateStore, tenant: TenantContext, question: str) -> tuple[str, dict[str, Any]]:
    """Foundry Web Search restricted to sebi.gov.in. Discovery, not evidence: nothing here enters an analysis; the SEBI
    connector remains the only path by which a circular is fetched, hashed and analysed. Citations outside the domain are dropped."""
    p = provider()
    if not settings().ask_web_search or not hasattr(p, "web_search"):
        return ("Looking up sebi.gov.in from Ask is disabled in this workspace. Run a scan to fetch publications through the official SEBI connector.",
                {"kind": "clarify", "actions": [{"label": "Scan now", "kind": "scan"}]})
    budget_var.set(CallBudget(1, settings().max_estimated_cost_per_scan_usd, settings().max_estimated_cost_per_day_usd,
                              db.estimated_cost_since(now().replace(hour=0, minute=0, second=0, microsecond=0).isoformat())))
    try:
        cites, res = await p.web_search("impact", WEB_SYSTEM, question, WEB_DOMAINS)
    except ProviderError as e:
        return (f"Foundry web search failed: {str(e)[:160]}", {"kind": "clarify"})
    finally:
        budget_var.set(None)
    kept = [c for c in cites if any(c["url"].split("/")[2].endswith(d) for d in WEB_DOMAINS if "//" in c["url"])]
    dropped = len(cites) - len(kept)
    db.record_llm_call(tenant_id=tenant.tenant_id, scan_id=None, task="ask_web", model=res.model, provider=res.provider, latency_ms=res.latency_ms, input_tokens=res.input_tokens,
                       output_tokens=res.output_tokens, cached_tokens=res.cached_tokens, attempts=res.attempts, estimated_cost_usd=res.estimated_cost_usd, context_format=None,
                       structured_mode=None, pricing_status=res.pricing_status, response_id=res.response_id, ok=1)
    summary = res.text.strip() or "No sebi.gov.in result was returned."
    return summary, {"web_sources": kept, "web_dropped_off_domain": dropped, "kind": "web_search",
                     "caveat": "Found with Microsoft Foundry Web Search restricted to sebi.gov.in. Discovery only — a publication becomes evidence only after the SEBI connector fetches and analyses it (Scan now).",
                     "telemetry": {"provider": res.provider, "model": res.model, "latency_ms": res.latency_ms, "input_tokens": res.input_tokens, "output_tokens": res.output_tokens,
                                   "response_id": res.response_id, "estimated_cost_usd": res.estimated_cost_usd, "tool": "web_search", "allowed_domains": WEB_DOMAINS}}


# ---- orchestration --------------------------------------------------------------------------------------------------------
async def investigate(db: StateStore, tenant: TenantContext, question: str, conversation_id: str | None = None) -> Investigation:
    ctx = build_context(db, tenant, question.strip(), conversation_id)
    ids = index_ids(ctx)
    first_doc = ctx["records"][0]["document_id"] if ctx["records"] else None
    intent, targets, pol, flags, judge = await route(ctx, first_doc)
    ctx["_targets"] = targets
    answer: dict[str, Any] = {"intent": intent}
    reasoning: dict[str, Any] = {"kind": "workspace_data", "jev_route": judge, "sources": 0, "cited": []}
    summary: str

    if intent == "web_lookup":  # a read-only lookup on sebi.gov.in is not an action, even when phrased imperatively
        summary, extra = await web_lookup(db, tenant, question)
        answer.update(extra)
        reasoning["kind"] = extra.get("kind", "web_search")
        reasoning["narrative"] = extra.pop("telemetry", None)
    elif flags["requests_action"] or intent == "action_request":
        summary = ("This action requires human approval. Ask AfterCircular only reads and reasons; approving, rejecting and opening GitHub issues happen in the "
                   "review screen, under your GitHub login." + (f" {len(ctx['pending_reviews'])} analysis is currently awaiting review." if len(ctx["pending_reviews"]) == 1 else f" {len(ctx['pending_reviews'])} analyses are currently awaiting review." if ctx["pending_reviews"] else ""))
        reasoning["kind"] = "refused"
        answer["actions"] = [{"label": "Open reviews", "kind": "reviews"}]
        intent = "action_request"
    elif intent in DETERMINISTIC:
        summary, extra = deterministic(intent, ctx, db, tenant, pol)
        answer.update(extra)
        reasoning["sources"] = len(extra.get("documents", [])) if isinstance(extra.get("documents"), list) else (1 if extra else 0)
        reasoning["cited"] = [d["id"] for d in extra.get("documents", [])] if isinstance(extra.get("documents"), list) else []
    elif intent in REASONING and ctx["records"]:
        weak_target = bool(targets) and (judge.get("document_confidence") or 0) < 0.7 and not flags["follow_up"]
        selected = [r for r in ctx["records"] if r["id"] in targets] if targets and not weak_target else by_significance([r for r in ctx["records"] if r.get("analysis_id")] or ctx["records"])
        if weak_target:  # the judge was not sure which record is meant: reason over all of them, most significant first, target included
            judge["note"] = (judge.get("note") or "") + f" target {targets[0]} below 0.70 → reasoning over all records"
        if intent == "compare" and len(selected) < 2:  # "the two most relevant" → the two most significant records
            selected = (selected + [r for r in by_significance(ctx["records"]) if r not in selected])[:2]
        if flags["follow_up"] and not targets and ctx["conversation"]:
            prev = list(ctx["conversation"][-1].get("records_cited") or [])
            if prev:
                by_id = {r["id"]: r for r in ctx["records"]}
                selected = [by_id[i] for i in prev if i in by_id] or selected  # in the order the previous answer cited them
        judge2 = judge_for("ask")
        qs = reasoning_questions(intent, selected)
        state = {"question": question, "conversation": ctx["conversation"], "company": ctx["workspace"]["company"],
                 "records": [{k: v for k, v in r.items() if k not in ("document_pk", "analysis_id", "url", "document_url", "triage", "regulatory_source", "policy_sources")} for r in selected]}
        t0 = time.perf_counter()
        try:
            j = await judge2.ask("ask_reason", state, qs, context={"document_id": first_doc})
            judgments = judgments_to_dict(j, selected)
            reasoning["jev_judgments"] = {"provider": j.provider, "model": j.model, "calibrated": j.calibrated, "questions": len(qs), "latency_ms": j.latency_ms or int((time.perf_counter() - t0) * 1000),
                                          "input_tokens": j.input_tokens, "output_tokens": j.output_tokens, "results": judgments}
        except JudgmentError as e:
            judgments = None
            reasoning["jev_judgments"] = {"error": str(e)[:160]}
        if judgments is None or judge2.name == "stub" and not isinstance(judgments.get("sufficient"), float):
            summary = "The reasoning judge is unavailable, so I can only show the records rather than reason over them."
            reasoning["kind"] = "workspace_data"
            answer["documents"] = _cards(selected)
        else:
            reasoning["kind"] = "jev_reasoning"
            ans: AskAnswer | None = None
            if settings().ask_narrative:
                budget_var.set(CallBudget(1, settings().max_estimated_cost_per_scan_usd, settings().max_estimated_cost_per_day_usd,
                                          db.estimated_cost_since(now().replace(hour=0, minute=0, second=0, microsecond=0).isoformat())))
                try:
                    ans, nar = await narrate(provider(), ctx, selected, judgments, intent)
                except ProviderError as e:
                    ans, nar = None, {"error": str(e)[:160]}
                finally:
                    budget_var.set(None)
                if nar and "error" not in nar:
                    db.record_llm_call(tenant_id=tenant.tenant_id, scan_id=None, task="ask", model=nar["model"], provider=nar["provider"], latency_ms=nar["latency_ms"],
                                       input_tokens=nar["input_tokens"], output_tokens=nar["output_tokens"], cached_tokens=nar["cached_tokens"], attempts=nar["attempts"],
                                       estimated_cost_usd=nar["estimated_cost_usd"], context_format=nar["context_format"], structured_mode=nar["structured_mode"],
                                       pricing_status="estimate" if nar["estimated_cost_usd"] is not None else "unknown", response_id=nar.get("response_id"), ok=1)
                reasoning["narrative"] = nar
            else:
                reasoning["narrative"] = None
            dropped: list[str] = []
            if ans is not None:
                ans, dropped = validate_answer(ans, ids, {r["id"] for r in selected})
            if ans is None or (not ans.points and not ans.insufficient_evidence):
                ans = compose_from_judgments(ctx, selected, judgments, intent)
                reasoning["composed"] = True
            summary = ans.summary
            answer["points"] = [{"record_id": p.record_id, "claim": p.claim, "evidence_ids": p.evidence_ids, "evidence": [ids[e] for e in p.evidence_ids]} for p in ans.points]
            answer["insufficient_evidence"] = ans.insufficient_evidence
            answer["caveat"] = ans.caveat
            cited = list(dict.fromkeys(p.record_id for p in ans.points))
            by_id = {r["id"]: r for r in selected}
            answer["documents"] = _cards([by_id[c] for c in dict.fromkeys(cited) if c in by_id])  # in the answer's order
            reasoning.update({"sources": len(cited), "cited": cited, "dropped_uncited": dropped,
                              "evidence": {"regulatory": sum(1 for p in ans.points for e in p.evidence_ids if ".R" in e), "policy": sum(1 for p in ans.points for e in p.evidence_ids if ".P" in e),
                                           "obligations": sum(1 for p in ans.points for e in p.evidence_ids if ".O" in e)}})
    elif intent in REASONING:
        summary = "I don't have enough evidence in this workspace to determine that: no publications have been processed yet. Run a scan first."
        answer["insufficient_evidence"] = True
        reasoning["kind"] = "jev_reasoning"
    else:
        summary = ("I couldn't route that to something this workspace knows. Try: what changed, which circulars conflict, which should be prioritized and why, "
                   "what evidence supports a conflict, or show POL-001.")
        answer["suggestions"] = ["What changed in the latest scan?", "Which circulars conflict with our policies?", "Which should be prioritized and why?", "What needs my review?"]
        reasoning["kind"] = "clarify"

    reasoning["workspace"] = tenant.company_name
    answer["reasoning"] = reasoning
    target_rec = next((r for r in ctx["records"] if r["id"] in (targets[:1] or reasoning.get("cited", [])[:1])), None)
    inv = Investigation(id=new_id("inv"), tenant_id=tenant.tenant_id, question=question.strip()[:500], intent=intent, summary=summary,
                        document_pk=target_rec["document_pk"] if target_rec else None, analysis_id=target_rec["analysis_id"] if target_rec else None,
                        policy_id=pol if intent == "policy_lookup" else None, answer=answer, judge=judge, conversation_id=conversation_id or new_id("conv"),
                        actor=tenant.actor, created_at=now())
    return db.save_investigation(inv)
