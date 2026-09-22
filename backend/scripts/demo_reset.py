"""Demo reset — wipe one tenant's derived state so the next scan rebuilds it from the real sources.

    uv run python scripts/demo_reset.py --tenant <tenant_id> [--tenant <tenant_id> ...] [--yes]

Deletes, for the named tenants only: processed documents (+ text), analyses, decision records, reviews, audit events,
model-call telemetry, investigations (Ask history), the local policy chunk cache and index metadata, and every document
in the Azure AI Search index that carries the tenant's `tenant_id` (hard delete — the corpus is rebuilt from GitHub on the
next scan). Tenant rows themselves are kept. Refuses to run when ENVIRONMENT is not `dev` or `demo`. Nothing is called
on Foundry, Jev or GitHub.
"""

from __future__ import annotations

import argparse
import asyncio
import sys
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[1] / ".env")

from app.config import settings  # noqa: E402
from app.services.state import store  # noqa: E402

TABLES = ["processed_documents", "analyses", "decisions", "reviews", "audit_events", "llm_calls", "investigations", "scans", "policy_chunks", "policy_index_meta"]


async def clear_search(tenant_id: str) -> int:
    from app.retrieval.azure_search import AzureSearchRetriever, tenant_filter

    ret = AzureSearchRetriever()

    def _do() -> int:
        ids = [r["id"] for r in ret.client.search(search_text="*", filter=tenant_filter(tenant_id, status=None), select=["id"], top=1000)]
        if ids:
            ret.client.delete_documents([{"id": i} for i in ids])
        return len(ids)

    return await asyncio.to_thread(_do)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--tenant", action="append", required=True)
    ap.add_argument("--yes", action="store_true")
    a = ap.parse_args()
    s = settings()
    if s.environment not in ("dev", "demo"):
        print(f"refusing to reset in ENVIRONMENT={s.environment}")
        sys.exit(2)
    db = store()
    known = {t["tenant_id"] for t in db.all_tenants()}
    for t in a.tenant:
        if t not in known:
            print(f"unknown tenant {t}; known: {sorted(known)}")
            sys.exit(2)
    counts = {t: {tbl: db.conn.execute(f"SELECT COUNT(*) FROM {tbl} WHERE tenant_id=?", (t,)).fetchone()[0] for tbl in TABLES} for t in a.tenant}
    for t, c in counts.items():
        print(f"{t}: " + ", ".join(f"{k}={v}" for k, v in c.items() if v))
    if not a.yes:
        print("re-run with --yes to delete the rows above (and the tenant's Azure AI Search documents)")
        return
    with db.conn:
        for t in a.tenant:
            for tbl in TABLES:
                db.conn.execute(f"DELETE FROM {tbl} WHERE tenant_id=?", (t,))
    print("SQLite rows deleted")
    if s.search_configured:
        for t in a.tenant:
            n = asyncio.run(clear_search(t))
            print(f"Azure AI Search {s.azure_search_index}: deleted {n} documents for tenant_id={t}")
    else:
        print("Azure AI Search not configured; nothing to clear there")


if __name__ == "__main__":
    main()
