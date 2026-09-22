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
    "Which current SEBI changes affect this company?",
    "Which circulars conflict with our policies?",
    "Why does this circular conflict with our policy?",
    "What exact SEBI evidence supports the finding?",
    "Which internal policy section is affected?",
    "Which changes are already aligned?",
    "Which publications are not applicable, and why?",
    "Which compliance item should be reviewed first, and why?",
    "What is the effective date?",
    "What needs human review?",
    "What changed in the latest live SEBI circular?",
    "Compare the two most relevant current circulars.",
    "Create a GitHub issue for this.",
]
EXTRA = ["Look up the latest SEBI circular on cyber incident reporting on sebi.gov.in."]  # Foundry Web Search, discovery only
FOLLOW_UP = ["Which circulars conflict with our policies?", "Why is the first one a conflict?", "What exact evidence proves that?", "Which policy section needs updating?", "What should we do next?"]


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
    extra = [ask(q, None) for q in EXTRA]
    chain, conv = [], None
    for q in FOLLOW_UP:
        r = ask(q, conv)
        conv = r["conversation_id"]
        chain.append(r)
    reviews_after = c.get("/api/reviews").json()
    usage = c.get("/api/usage").json()
    out = {"tenant_id": a.tenant, "at": datetime.now(UTC).isoformat(), "questions": rows, "web_lookup": extra, "follow_up_chain": chain,
           "action_refused": rows[12]["refused"], "reviews_unchanged": reviews_before == reviews_after, "usage_after": usage}
    d = Path(__file__).parent / "results"
    d.mkdir(exist_ok=True)
    slug = a.tenant.split("-1")[0]
    (d / f"ask_matrix_{slug}.json").write_text(json.dumps(out, indent=2))
    lines = [f"# Ask matrix — {a.tenant} — {out['at']}", "", "| # | question | intent | provenance | cited | summary |", "|---|---|---|---|---|---|"]
    for i, r in enumerate(rows, 1):
        n = r["narrative"] or {}
        lines.append(f"| {i} | {r['question']} | {r['intent']} | {r['kind']}{' / ' + str(n.get('model')) if n else ''}{' (composed)' if r['composed'] else ''} | {', '.join(r['cited'] or []) or '-'} | {r['summary'][:160].replace('|', '/')} |")
    lines += ["", "## Web lookup (Foundry Web Search, sebi.gov.in only — discovery, not evidence)", ""]
    for r in extra:
        lines.append(f"- **{r['question']}** → intent `{r['intent']}`, kind `{r['kind']}`: {r['summary'][:300].replace(chr(10), ' ')}")
    lines += ["", "## Follow-up chain (one conversation_id)", "", "| step | question | intent | follow_up | summary |", "|---|---|---|---|---|"]
    for i, r in enumerate(chain, 1):
        lines.append(f"| {i} | {r['question']} | {r['intent']} | {((r['judge'] or {}).get('flags') or {}).get('follow_up')} | {r['summary'][:160].replace('|', '/')} |")
    lines += ["", f"- action request (#13) refused: **{out['action_refused']}**", f"- reviews unchanged by Ask: **{out['reviews_unchanged']}**",
              f"- conversation ids in chain: {sorted({r['conversation_id'] for r in chain})}"]
    (d / f"ask_matrix_{slug}.md").write_text("\n".join(lines) + "\n")
    print("\n".join(lines))


if __name__ == "__main__":
    main()
