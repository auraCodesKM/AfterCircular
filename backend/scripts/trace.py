"""Print the persisted end-to-end trace of one document.   uv run python scripts/trace.py <tenant_id> <document_id|document_pk> [--md]"""

from __future__ import annotations

import json
import sys
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[1] / ".env")

from app.schemas.actions import TenantContext  # noqa: E402
from app.services.state import store  # noqa: E402
from app.services.trace import build_trace  # noqa: E402


def markdown(tr: dict) -> str:
    sm = tr["summary"]
    lines = [f"# Trace — {tr['title']} ({tr['document_id']}) · {tr['tenant_id']}", "", f"Outcome **{tr['outcome']}** · {sm['stages']} stages: {sm['completed']} completed, {sm['skipped']} skipped, {sm['failed']} failed, "
             f"{sm['awaiting_approval']} awaiting approval, {sm['blocked']} blocked · Foundry calls {sm['foundry_calls']} · Jev judgments {sm['jev_judgments']} ({sm['jev_decision_records']} records) · "
             f"Azure AI Search results {sm['azure_search_results']} · est. cost ${sm['estimated_cost_usd']} ({sm['pricing']})", ""]
    for s in tr["steps"]:
        mark = {"completed": "✅", "awaiting_approval": "●", "blocked": "○", "skipped": "○", "failed": "✗"}[s["status"]]
        lines.append(f"**[{s['order']:02d}] {mark} {s['name']} · {s['operation']}** — {s['summary']}" + (f"  \n_{('Why: ' if s['status'] == 'completed' else 'Why not: ') + s['reason']}_" if s["reason"] else ""))
        if s["telemetry"]:
            lines.append("```json\n" + json.dumps(s["telemetry"], indent=1, default=str) + "\n```")
        lines.append("")
    lines += ["## Audit events", "", "| at | event | actor | type |", "|---|---|---|---|"] + [f"| {e['at']} | {e['event']} | {e['actor']} | {e['actor_type']} |" for e in tr["audit_events"]]
    return "\n".join(lines) + "\n"


if __name__ == "__main__":
    tenant_id, ref = sys.argv[1], sys.argv[2]
    db = store()
    row = next((t for t in db.all_tenants() if t["tenant_id"] == tenant_id), None)
    t = TenantContext(tenant_id=tenant_id, company_name=row["company_name"] if row else tenant_id, github_repo=row["github_repo"] if row else "", actor="trace")
    pk = ref if ref.startswith("doc_") else next((d.id for d in db.list_documents(tenant_id, limit=100) if d.document_id == ref), ref)
    tr = build_trace(db, t, pk)
    if not tr:
        sys.exit(f"document {ref} not found for {tenant_id}")
    print(markdown(tr) if "--md" in sys.argv else json.dumps(tr, indent=2, default=str))
