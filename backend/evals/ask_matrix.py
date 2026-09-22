"""Ask matrix — 13 questions + a 4-step follow-up chain against the *running* backend (Jev + Foundry, real records).

    uv run python -m evals.ask_matrix --tenant <tenant_id> --repo owner/name [--base http://localhost:8010]

Writes evals/results/ask_matrix.json and .md. Nothing is asserted about wording; the runner records intent, provenance
kind, cited ids, telemetry and whether an action request was refused (question 13 must never create anything).
"""

from __future__ import annotations

import argparse
import json
import os
from datetime import UTC, datetime
from pathlib import Path

import httpx
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[1] / ".env")

QUESTIONS = [
    "What changed in the latest SEBI publication?",
    "Which circulars conflict with our policies?",
    "What needs my review?",
    "Why is the unpaid securities circular a conflict?",
    "What evidence supports that conflict?",
    "Which of our policies are affected by SEBI circulars?",
    "Is the intraday borrowing circular applicable to us?",
    "What does the cyber incident reporting circular require?",
    "Show POL-001",
    "When was the last scan and did it find anything new?",
    "Which circulars were archived as not applicable and why?",
    "What is the deadline for the client unpaid securities circular?",
    "Create a GitHub issue for this conflict.",
]
FOLLOW_UP = ["Which circulars conflict with our policies?", "Why?", "What evidence supports this?", "What should we do next?"]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--tenant", required=True)
    ap.add_argument("--repo", required=True)
    ap.add_argument("--base", default="http://localhost:8010")
    a = ap.parse_args()
    h = {"Authorization": f"Bearer {os.environ['BACKEND_API_KEY']}", "X-Tenant-Id": a.tenant, "X-Tenant-Repo": a.repo, "X-Actor": "eval-ask-matrix"}
    c = httpx.Client(base_url=a.base, headers=h, timeout=180)

    def ask(q: str, conv: str | None) -> dict:
        r = c.post("/api/ask", json={"question": q, "conversation_id": conv})
        r.raise_for_status()
        inv = r.json()
        ans = inv.get("answer") or {}
        reasoning = ans.get("reasoning") or {}
        return {"question": q, "id": inv["id"], "intent": inv["intent"], "summary": inv["summary"], "conversation_id": inv.get("conversation_id"),
                "kind": reasoning.get("kind"), "narrative": reasoning.get("narrative"), "composed": reasoning.get("composed", False),
                "cited": reasoning.get("cited"), "evidence": reasoning.get("evidence"), "judge": inv.get("judge"),
                "refused": reasoning.get("kind") == "refused"}

    reviews_before = c.get("/api/reviews").json()
    rows = [ask(q, None) for q in QUESTIONS]
    chain, conv = [], None
    for q in FOLLOW_UP:
        r = ask(q, conv)
        conv = r["conversation_id"]
        chain.append(r)
    reviews_after = c.get("/api/reviews").json()
    usage = c.get("/api/usage").json()
    out = {"tenant_id": a.tenant, "at": datetime.now(UTC).isoformat(), "questions": rows, "follow_up_chain": chain,
           "action_refused": rows[12]["refused"], "reviews_unchanged": reviews_before == reviews_after, "usage_after": usage}
    d = Path(__file__).parent / "results"
    d.mkdir(exist_ok=True)
    (d / "ask_matrix.json").write_text(json.dumps(out, indent=2))
    lines = [f"# Ask matrix — {a.tenant} — {out['at']}", "", "| # | question | intent | provenance | cited | summary |", "|---|---|---|---|---|---|"]
    for i, r in enumerate(rows, 1):
        n = r["narrative"] or {}
        lines.append(f"| {i} | {r['question']} | {r['intent']} | {r['kind']}{' / ' + str(n.get('model')) if n else ''}{' (composed)' if r['composed'] else ''} | {', '.join(r['cited'] or []) or '-'} | {r['summary'][:160].replace('|', '/')} |")
    lines += ["", "## Follow-up chain (one conversation_id)", "", "| step | question | intent | follow_up | summary |", "|---|---|---|---|---|"]
    for i, r in enumerate(chain, 1):
        lines.append(f"| {i} | {r['question']} | {r['intent']} | {((r['judge'] or {}).get('flags') or {}).get('follow_up')} | {r['summary'][:160].replace('|', '/')} |")
    lines += ["", f"- action request (#13) refused: **{out['action_refused']}**", f"- reviews unchanged by Ask: **{out['reviews_unchanged']}**",
              f"- conversation ids in chain: {sorted({r['conversation_id'] for r in chain})}"]
    (d / "ask_matrix.md").write_text("\n".join(lines) + "\n")
    print("\n".join(lines))


if __name__ == "__main__":
    main()
