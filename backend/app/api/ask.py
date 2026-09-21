from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.api.deps import db, tenant
from app.schemas.actions import Investigation, TenantContext
from app.services.investigate import investigate
from app.services.state import StateStore

router = APIRouter()


class AskRequest(BaseModel):
    question: str = Field(min_length=2, max_length=500)


@router.post("/ask", response_model=Investigation)
async def ask(body: AskRequest, t: TenantContext = Depends(tenant), s: StateStore = Depends(db)) -> Investigation:
    return await investigate(s, t, body.question)


@router.get("/investigations", response_model=list[Investigation])
def list_investigations(limit: int = 20, t: TenantContext = Depends(tenant), s: StateStore = Depends(db)) -> list[Investigation]:
    return s.list_investigations(t.tenant_id, min(limit, 100))


@router.get("/investigations/{inv_id}", response_model=Investigation)
def get_investigation(inv_id: str, t: TenantContext = Depends(tenant), s: StateStore = Depends(db)) -> Investigation:
    inv = s.get_investigation(inv_id, t.tenant_id)
    if not inv:
        raise HTTPException(404, "Investigation not found")
    return inv
