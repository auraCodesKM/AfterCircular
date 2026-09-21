"""Read-only view of the tenant's indexed policy corpus (what retrieval searches)."""

from typing import Any

from fastapi import APIRouter, Depends

from app.api.deps import db, tenant
from app.schemas.actions import TenantContext
from app.services.state import StateStore

router = APIRouter()


@router.get("/policies")
def list_policies(t: TenantContext = Depends(tenant), s: StateStore = Depends(db)) -> dict[str, Any]:
    meta = s.policy_index_meta(t.tenant_id)
    docs: dict[str, dict[str, Any]] = {}
    for c in s.policy_chunks(t.tenant_id):
        d = docs.setdefault(c["doc_id"], {"doc_id": c["doc_id"], "title": c["title"], "path": c["path"], "version": c["version"], "sections": [], "embedded": False})
        d["sections"].append(c["section"])
        d["embedded"] = d["embedded"] or bool(c["embedding"])
    return {"index": meta, "documents": sorted(docs.values(), key=lambda d: d["doc_id"])}
