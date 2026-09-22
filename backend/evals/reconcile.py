"""Telemetry reconciliation for one scan — the numbers the UI shows must be the numbers the tables hold.

    uv run python -m evals.reconcile <scan_id>

Compares: scans.llm_calls (the counter the pipeline increments) · rows in llm_calls for the scan · per-analysis
metrics blocks (extraction/impact/memo) · audit events that imply a Foundry call (OBLIGATIONS_EXTRACTED, MEMO_GENERATED,
escalation in decision_path) · Jev decision records vs analyses. Prints the comparison and exits 1 on any mismatch."""

from __future__ import annotations

import json
import sys
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[1] / ".env")

from app.services.state import store  # noqa: E402


def main(scan_id: str) -> int:
    db = store()
    scan = db.conn.execute("SELECT * FROM scans WHERE id=?", (scan_id,)).fetchone()
    if not scan:
        print(f"scan {scan_id} not found")
        return 2
    calls = [dict(r) for r in db.conn.execute("SELECT * FROM llm_calls WHERE scan_id=? ORDER BY created_at", (scan_id,))]
    ok_calls = [c for c in calls if c["ok"]]
    analyses = [dict(r) for r in db.conn.execute("SELECT id, metrics, decision_path FROM analyses WHERE scan_id=?", (scan_id,))]
    metric_calls = sum(1 for a in analyses for k in ("extraction", "impact", "memo") if isinstance(json.loads(a["metrics"]).get(k), dict) and json.loads(a["metrics"])[k].get("model"))
    events = [dict(r) for r in db.conn.execute("SELECT event_type, analysis_id FROM audit_events WHERE scan_id=?", (scan_id,))]
    implied = sum(1 for e in events if e["event_type"] in ("OBLIGATIONS_EXTRACTED", "MEMO_GENERATED")) + sum(1 for a in analyses if "foundry:escalation" in json.loads(a["decision_path"]))
    jev = db.conn.execute("SELECT COUNT(*) FROM decisions WHERE analysis_id IN (SELECT id FROM analyses WHERE scan_id=?) AND provider='typesafe'", (scan_id,)).fetchone()[0]
    rows = {
        "scans.llm_calls (pipeline counter)": scan["llm_calls"],
        "llm_calls rows (persisted telemetry, ok=1)": len(ok_calls),
        "llm_calls rows with a Foundry response_id": sum(1 for c in ok_calls if c.get("response_id")),
        "analysis.metrics blocks (extraction/impact/memo)": metric_calls,
        "audit-implied calls (OBLIGATIONS_EXTRACTED + MEMO_GENERATED + escalations)": implied,
        "llm_calls rows ok=0 (failures, not results)": len(calls) - len(ok_calls),
        "scans.estimated_cost_usd": scan["estimated_cost_usd"],
        "sum(llm_calls.estimated_cost_usd)": round(sum(c["estimated_cost_usd"] or 0 for c in ok_calls), 6),
        "Jev decision records": jev,
        "analyses": len(analyses),
    }
    for k, v in rows.items():
        print(f"{k:75s} {v}")
    consistent = scan["llm_calls"] == len(ok_calls) == metric_calls == implied and abs((scan["estimated_cost_usd"] or 0) - rows["sum(llm_calls.estimated_cost_usd)"]) < 1e-6
    print("RECONCILED" if consistent else "MISMATCH")
    return 0 if consistent else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1]))
