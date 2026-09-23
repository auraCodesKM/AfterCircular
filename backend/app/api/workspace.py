"""Workspace demo controls. The web app resolves the tenant from the signed-in user's own workspaces; this router checks
ownership again (tenants.connected_by) and enforces the demo-only rule — see services/demo.py."""

from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.api.deps import db, tenant
from app.schemas.actions import TenantContext
from app.services import demo
from app.services.state import StateStore

router = APIRouter()


class DemoMode(BaseModel):
    enabled: bool


class DemoReset(BaseModel):
    confirm_tenant_id: str


def _call(fn, *args: Any) -> dict[str, Any]:
    try:
        return fn(*args)
    except demo.DemoError as e:
        raise HTTPException(e.status, e.detail) from None


@router.get("/workspace/demo")
def demo_status(t: TenantContext = Depends(tenant), s: StateStore = Depends(db)) -> dict[str, Any]:
    return _call(demo.status, s, t)


@router.post("/workspace/demo/mode")
def demo_mode(body: DemoMode, t: TenantContext = Depends(tenant), s: StateStore = Depends(db)) -> dict[str, Any]:
    return _call(demo.set_mode, s, t, body.enabled)


@router.post("/workspace/demo/reset")
def demo_reset(body: DemoReset, t: TenantContext = Depends(tenant), s: StateStore = Depends(db)) -> dict[str, Any]:
    return _call(demo.reset, s, t, body.confirm_tenant_id)
