import asyncio
from typing import Any

from fastapi import APIRouter, Depends, HTTPException

from app.api.deps import db, require_api_key, tenant
from app.config import settings
from app.schemas.actions import ScanRecord, ScanRequest, TenantContext
from app.services.pipeline import Scan
from app.services.state import StateStore

router = APIRouter()
_tasks: set[asyncio.Task] = set()


@router.post("/scan", response_model=ScanRecord, status_code=202)
async def start_scan(body: ScanRequest | None = None, t: TenantContext = Depends(tenant), s: StateStore = Depends(db)) -> ScanRecord:
    if not settings().enable_live_scan:
        raise HTTPException(409, "Scanning is disabled on this backend (AFTERCIRCULAR_ENABLE_LIVE_SCAN=false)")
    if running := s.running_scan(t.tenant_id):
        return running
    scan = Scan(s, t, force=bool(body and body.force))
    task = asyncio.create_task(scan.run())
    _tasks.add(task)
    task.add_done_callback(_tasks.discard)
    return scan.rec


@router.get("/scans/latest", response_model=ScanRecord | None)
def latest(t: TenantContext = Depends(tenant), s: StateStore = Depends(db)) -> ScanRecord | None:
    return s.latest_scan(t.tenant_id)


@router.get("/scans/{scan_id}", response_model=ScanRecord)
def get_scan(scan_id: str, t: TenantContext = Depends(tenant), s: StateStore = Depends(db)) -> ScanRecord:
    rec = s.get_scan(scan_id, t.tenant_id)
    if not rec:
        raise HTTPException(404, "Scan not found")
    return rec


@router.post("/scheduled-scan", dependencies=[Depends(require_api_key)])
async def scheduled_scan(s: StateStore = Depends(db)) -> dict:
    """One bounded scan per connected company, for the timer (Azure Functions / Container Apps Job). Same Scan service as
    the interactive endpoint; disabled until AFTERCIRCULAR_ENABLE_SCHEDULED_SCAN=true and a server-side GITHUB_TOKEN exists.
    Runs sequentially so the per-scan budgets are the total budget of the tick."""
    cfg = settings()
    if not cfg.enable_scheduled_scan:
        raise HTTPException(409, "Scheduled scanning is disabled (AFTERCIRCULAR_ENABLE_SCHEDULED_SCAN=false)")
    if not cfg.github_token:
        raise HTTPException(409, "Scheduled scanning needs a server-side GITHUB_TOKEN to read policy repositories")
    results: list[dict[str, Any]] = []
    for row in s.all_tenants():
        t = TenantContext(tenant_id=row["tenant_id"], company_name=row["company_name"], github_repo=row["github_repo"],
                          default_branch=row["default_branch"], actor="scheduler", github_token=None)
        if s.running_scan(t.tenant_id):
            results.append({"tenant_id": t.tenant_id, "status": "ALREADY_RUNNING"})
            continue
        rec = await Scan(s, t).run()
        results.append({"tenant_id": t.tenant_id, "scan_id": rec.id, "status": rec.status, "new": rec.new_documents, "llm_calls": rec.llm_calls})
    return {"scans": results}
