"""Demo reset from the app — the deployed counterpart of scripts/demo_reset.py, deliberately narrower.

Safety model:
  * Only the workspace owner (tenants.connected_by == the signed-in GitHub id) can change or reset a workspace.
  * Only a workspace its owner explicitly marked as a demo workspace can be reset. Every workspace starts as a normal
    one, so live regulatory history is never wiped unless someone chose "demo" for that workspace first.
  * Production must opt in (AFTERCIRCULAR_ENABLE_DEMO_RESET); dev/demo environments always allow it.
  * The reset is one transaction scoped by tenant_id; running it twice is harmless (the second clears nothing).

Cleared (this tenant's runtime state, so the next scan re-processes the same circulars): scans, processed documents and
their text, analyses, decisions, reviews, investigations, and audit events other than the DEMO_* trail.

Kept, unlike scripts/demo_reset.py:
  * policy_chunks / policy_index_meta and the tenant's Azure AI Search documents — the next scan finds the index current
    at the same commit, so a reset never re-embeds the policy corpus;
  * llm_calls — the daily cost breaker sums them, so deleting them would let reset → scan → reset exceed the daily cap.
Never touched: the tenant row, GitHub (repository, issues, OAuth), Azure resources, other tenants, source configuration.
"""

from __future__ import annotations

from typing import Any

from app.config import settings
from app.schemas.actions import TenantContext
from app.services import audit
from app.services.state import StateStore, now

# order matters only for readability; there are no FK constraints
CLEARED = ("decisions", "analyses", "reviews", "investigations", "scans", "processed_documents")
PRESERVED = ["workspace and tenant configuration", "connected GitHub repository and OAuth", "policy index (chunks, embeddings, Azure AI Search documents)",
             "model-usage and cost telemetry (the daily cost breaker counts it)", "GitHub issues already opened", "the demo-reset audit trail"]
KEEP_AUDIT = "DEMO_%"


class DemoError(Exception):
    def __init__(self, status: int, detail: str):
        super().__init__(detail)
        self.status, self.detail = status, detail


def _owned(db: StateStore, t: TenantContext) -> dict[str, Any]:
    row = db.conn.execute("SELECT * FROM tenants WHERE tenant_id=?", (t.tenant_id,)).fetchone()
    if not row:
        raise DemoError(404, "Workspace not found")
    if not t.actor_id or row["connected_by"] != t.actor_id:
        raise DemoError(403, "Only the person who connected this workspace can manage its demo state")
    return dict(row)


def _allowed() -> None:
    s = settings()
    if not (s.enable_demo_reset or s.environment in ("dev", "demo")):
        raise DemoError(403, "Demo reset is not enabled on this deployment (AFTERCIRCULAR_ENABLE_DEMO_RESET)")


def _counts(db: StateStore, tenant_id: str) -> dict[str, int]:
    c = {tbl: db.conn.execute(f"SELECT COUNT(*) FROM {tbl} WHERE tenant_id=?", (tenant_id,)).fetchone()[0] for tbl in CLEARED}
    c["audit_events"] = db.conn.execute("SELECT COUNT(*) FROM audit_events WHERE tenant_id=? AND event_type NOT LIKE ?", (tenant_id, KEEP_AUDIT)).fetchone()[0]
    return c


def _issues(db: StateStore, tenant_id: str) -> list[str]:
    rows = db.conn.execute("SELECT DISTINCT ticket_url FROM reviews WHERE tenant_id=? AND ticket_url IS NOT NULL", (tenant_id,)).fetchall()
    return [r[0] for r in rows]


def status(db: StateStore, t: TenantContext) -> dict[str, Any]:
    row = _owned(db, t)
    s = settings()
    live = db.conn.execute("SELECT COUNT(*) FROM processed_documents WHERE tenant_id=? AND source_mode='LIVE'", (t.tenant_id,)).fetchone()[0]
    return {"tenant_id": t.tenant_id, "company_name": row["company_name"], "demo": bool(row.get("demo")),
            "reset_available": bool(s.enable_demo_reset or s.environment in ("dev", "demo")), "scan_running": db.running_scan(t.tenant_id) is not None,
            "will_reset": _counts(db, t.tenant_id), "live_documents": live, "github_issues_kept": _issues(db, t.tenant_id), "preserved": PRESERVED}


def set_mode(db: StateStore, t: TenantContext, enabled: bool) -> dict[str, Any]:
    row = _owned(db, t)
    if bool(row.get("demo")) != enabled:
        with db.conn:
            db.conn.execute("UPDATE tenants SET demo=? WHERE tenant_id=?", (int(enabled), t.tenant_id))
        audit.record(db, t.tenant_id, "DEMO_MODE_CHANGED", actor=t.actor, actor_type="human", demo=enabled)
    return status(db, t)


def reset(db: StateStore, t: TenantContext, confirm_tenant_id: str) -> dict[str, Any]:
    _allowed()
    row = _owned(db, t)
    if confirm_tenant_id != t.tenant_id:
        raise DemoError(400, "Confirmation does not name this workspace")
    if not row.get("demo"):
        raise DemoError(409, "This is not a demo workspace. Mark it as a demo workspace first; live workspaces are never reset.")
    if db.running_scan(t.tenant_id):
        raise DemoError(409, "A scan is running for this workspace; reset after it finishes")
    counts, issues = _counts(db, t.tenant_id), _issues(db, t.tenant_id)
    audit.record(db, t.tenant_id, "DEMO_RESET_REQUESTED", actor=t.actor, actor_type="human", will_reset=counts)
    with db.conn:  # one transaction: all of this tenant's runtime state, or nothing
        for tbl in CLEARED:
            db.conn.execute(f"DELETE FROM {tbl} WHERE tenant_id=?", (t.tenant_id,))
        db.conn.execute("DELETE FROM audit_events WHERE tenant_id=? AND event_type NOT LIKE ?", (t.tenant_id, KEEP_AUDIT))
    at = now()
    audit.record(db, t.tenant_id, "DEMO_RESET_COMPLETED", actor=t.actor, actor_type="human", records_reset=counts, github_issues_kept=len(issues))
    return {"tenant": t.tenant_id, "company_name": row["company_name"], "reset_completed": True, "records_reset": counts,
            "preserved": PRESERVED, "github_issues_kept": issues, "timestamp": at.isoformat()}
