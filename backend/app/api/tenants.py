"""Tenant store endpoints used by web/lib/tenant-store.ts when BACKEND_URL is set."""

from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.api.deps import db, require_api_key
from app.services.state import StateStore

router = APIRouter(dependencies=[Depends(require_api_key)])


class TenantIn(BaseModel):
    tenantId: str
    companyName: str
    githubRepo: str
    defaultBranch: str = "main"
    connectedBy: str
    connectedByLogin: str
    connectedAt: str


def _out(r: dict[str, Any]) -> TenantIn:
    return TenantIn(tenantId=r["tenant_id"], companyName=r["company_name"], githubRepo=r["github_repo"], defaultBranch=r["default_branch"],
                    connectedBy=r["connected_by"], connectedByLogin=r["connected_by_login"], connectedAt=r["connected_at"])


@router.put("/tenants", response_model=TenantIn)
def upsert(body: TenantIn, s: StateStore = Depends(db)) -> TenantIn:
    s.upsert_tenant({"tenant_id": body.tenantId, "company_name": body.companyName, "github_repo": body.githubRepo, "default_branch": body.defaultBranch,
                     "connected_by": body.connectedBy, "connected_by_login": body.connectedByLogin, "connected_at": body.connectedAt})
    return body


@router.get("/tenants/by-owner/{github_id}", response_model=TenantIn)
def by_owner(github_id: str, s: StateStore = Depends(db)) -> TenantIn:
    r = s.tenant_by_owner(github_id)
    if not r:
        raise HTTPException(404, "No tenant for this owner")
    return _out(r)


@router.get("/tenants/by-owner/{github_id}/all", response_model=list[TenantIn])
def all_by_owner(github_id: str, s: StateStore = Depends(db)) -> list[TenantIn]:
    """Every company this GitHub user connected; each is an isolated tenant_id."""
    return [_out(r) for r in s.tenants_by_owner(github_id)]
