import asyncio

from fastapi import APIRouter, Depends, HTTPException

from app.api.deps import db, tenant
from app.schemas.actions import ScanRecord, ScanRequest, TenantContext
from app.services.pipeline import Scan
from app.services.state import StateStore

router = APIRouter()
_tasks: set[asyncio.Task] = set()


@router.post("/scan", response_model=ScanRecord, status_code=202)
async def start_scan(body: ScanRequest | None = None, t: TenantContext = Depends(tenant), s: StateStore = Depends(db)) -> ScanRecord:
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
