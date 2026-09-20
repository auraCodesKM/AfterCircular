from fastapi import APIRouter, Depends, HTTPException

from app.api.deps import db, tenant
from app.schemas.actions import AnalysisRecord, AuditEvent, ProcessedDocument, TenantContext
from app.services.state import StateStore

router = APIRouter()


@router.get("/documents", response_model=list[ProcessedDocument])
def list_documents(t: TenantContext = Depends(tenant), s: StateStore = Depends(db)) -> list[ProcessedDocument]:
    return s.list_documents(t.tenant_id)


@router.get("/documents/{pk}", response_model=ProcessedDocument)
def get_document(pk: str, t: TenantContext = Depends(tenant), s: StateStore = Depends(db)) -> ProcessedDocument:
    d = s.get_document(pk, t.tenant_id)
    if not d:
        raise HTTPException(404, "Document not found")
    return d


@router.get("/documents/{pk}/content")
def document_content(pk: str, t: TenantContext = Depends(tenant), s: StateStore = Depends(db)) -> dict:
    if not s.get_document(pk, t.tenant_id):
        raise HTTPException(404, "Document not found")
    return {"content": s.document_content(pk)}


@router.get("/analyses/{analysis_id}", response_model=AnalysisRecord)
def get_analysis(analysis_id: str, t: TenantContext = Depends(tenant), s: StateStore = Depends(db)) -> AnalysisRecord:
    a = s.get_analysis(analysis_id, t.tenant_id)
    if not a:
        raise HTTPException(404, "Analysis not found")
    return a


@router.get("/audit", response_model=list[AuditEvent])
def audit_log(document: str | None = None, limit: int = 100, t: TenantContext = Depends(tenant), s: StateStore = Depends(db)) -> list[AuditEvent]:
    return s.list_audit(t.tenant_id, limit=min(limit, 500), document_pk=document)
