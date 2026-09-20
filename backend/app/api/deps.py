from fastapi import Depends, Header, HTTPException, status

from app.config import settings
from app.schemas.actions import TenantContext
from app.services.state import StateStore, store


def require_api_key(authorization: str = Header(default="")) -> None:
    if authorization != f"Bearer {settings().backend_api_key}":
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid backend API key")


def db() -> StateStore:
    return store()


def tenant(
    _: None = Depends(require_api_key),
    x_tenant_id: str = Header(default=""),
    x_tenant_company: str = Header(default=""),
    x_tenant_repo: str = Header(default=""),
    x_tenant_branch: str = Header(default="main"),
    x_actor: str = Header(default="system"),
    x_github_token: str | None = Header(default=None),
) -> TenantContext:
    """Tenant identity comes from the trusted frontend (it verified the GitHub session), never from the request body."""
    if not x_tenant_id or not x_tenant_repo:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "X-Tenant-Id and X-Tenant-Repo headers are required")
    return TenantContext(tenant_id=x_tenant_id, company_name=x_tenant_company or x_tenant_id, github_repo=x_tenant_repo,
                         default_branch=x_tenant_branch or "main", actor=x_actor or "system", github_token=x_github_token)
