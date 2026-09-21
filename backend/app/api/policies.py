"""Read-only view of the tenant's indexed policy corpus (what retrieval searches)."""

from typing import Any

from fastapi import APIRouter, Depends, HTTPException

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
    by_id = {m["doc_id"]: m for m in (meta or {}).get("documents", [])}
    for doc_id, d in docs.items():
        d.update({k: v for k, v in by_id.get(doc_id, {}).items() if k not in ("sections",)})
    # which processed circulars affect each policy (from the stored impact analyses)
    affected: dict[str, list[dict[str, str]]] = {}
    for pd in s.list_documents(t.tenant_id, limit=100):
        a = s.get_analysis(pd.analysis_id, t.tenant_id) if pd.analysis_id else None
        for pid in ((a.impact or {}).get("affected_policies", []) if a else []):
            affected.setdefault(pid, []).append({"document_pk": pd.id, "title": pd.title, "circular_number": pd.circular_number or pd.document_id, "impact": pd.impact or ""})
    for doc_id, d in docs.items():
        d["affected_by"] = affected.get(doc_id, [])
    index = {k: v for k, v in (meta or {}).items() if k != "documents"} if meta else None
    return {"index": index, "documents": sorted(docs.values(), key=lambda d: d["doc_id"])}


@router.get("/policies/{doc_id}")
def get_policy(doc_id: str, t: TenantContext = Depends(tenant), s: StateStore = Depends(db)) -> dict[str, Any]:
    chunks = [c for c in s.policy_chunks(t.tenant_id) if c["doc_id"] == doc_id]
    if not chunks:
        raise HTTPException(404, "Policy not indexed")
    meta: dict[str, Any] = next((m for m in (s.policy_index_meta(t.tenant_id) or {}).get("documents", []) if m["doc_id"] == doc_id), {})
    return {**meta, "doc_id": doc_id, "title": chunks[0]["title"], "path": chunks[0]["path"], "version": chunks[0]["version"],
            "sections": [{"chunk_id": c["chunk_id"], "section": c["section"], "text": c["text"].split("\n", 1)[-1]} for c in chunks]}
