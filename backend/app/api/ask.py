from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.api.deps import db, tenant
from app.schemas.actions import Investigation, TenantContext
from app.services.investigate import investigate
from app.services.state import StateStore

router = APIRouter()


class AskFocus(BaseModel):
    """What the person is looking at when they ask (the analysis page, a policy). Resolved against this tenant's records only;
    an id that does not belong to the tenant is ignored. It makes 'this circular' / 'it' unambiguous on the first turn."""

    document_pk: str | None = Field(default=None, max_length=64)
    analysis_id: str | None = Field(default=None, max_length=64)
    document_id: str | None = Field(default=None, max_length=64)
    policy_ids: list[str] = Field(default_factory=list, max_length=8)


class AskRequest(BaseModel):
    question: str = Field(min_length=2, max_length=500)
    conversation_id: str | None = Field(default=None, max_length=64, description="Send the id from the first answer to make this a follow-up")
    context: AskFocus | None = None


@router.post("/ask", response_model=Investigation)
async def ask(body: AskRequest, t: TenantContext = Depends(tenant), s: StateStore = Depends(db)) -> Investigation:
    return await investigate(s, t, body.question, conversation_id=body.conversation_id, focus=body.context.model_dump() if body.context else None)


@router.get("/investigations", response_model=list[Investigation])
def list_investigations(limit: int = 20, t: TenantContext = Depends(tenant), s: StateStore = Depends(db)) -> list[Investigation]:
    return s.list_investigations(t.tenant_id, min(limit, 100))


@router.get("/investigations/{inv_id}", response_model=Investigation)
def get_investigation(inv_id: str, t: TenantContext = Depends(tenant), s: StateStore = Depends(db)) -> Investigation:
    inv = s.get_investigation(inv_id, t.tenant_id)
    if not inv:
        raise HTTPException(404, "Investigation not found")
    return inv
