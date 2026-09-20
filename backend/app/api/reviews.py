from fastapi import APIRouter, Depends, HTTPException

from app.api.deps import db, tenant
from app.schemas.actions import ReviewDecisionRequest, ReviewRecord, TenantContext
from app.services.reviews import ReviewError, decide
from app.services.state import StateStore
from app.tools.github import GitHubError

router = APIRouter()


@router.get("/reviews", response_model=list[ReviewRecord])
def list_reviews(status: str | None = None, t: TenantContext = Depends(tenant), s: StateStore = Depends(db)) -> list[ReviewRecord]:
    return s.list_reviews(t.tenant_id, status)


@router.get("/reviews/{review_id}", response_model=ReviewRecord)
def get_review(review_id: str, t: TenantContext = Depends(tenant), s: StateStore = Depends(db)) -> ReviewRecord:
    r = s.get_review(review_id, t.tenant_id)
    if not r:
        raise HTTPException(404, "Review not found")
    return r


async def _decide(review_id: str, decision: str, body: ReviewDecisionRequest | None, t: TenantContext, s: StateStore) -> ReviewRecord:
    try:
        return await decide(s, t, review_id, decision, body.note if body else None)
    except ReviewError as e:
        raise HTTPException(409, str(e)) from e
    except GitHubError as e:
        raise HTTPException(502, str(e)) from e


@router.post("/reviews/{review_id}/approve", response_model=ReviewRecord)
async def approve(review_id: str, body: ReviewDecisionRequest | None = None, t: TenantContext = Depends(tenant), s: StateStore = Depends(db)) -> ReviewRecord:
    return await _decide(review_id, "approve", body, t, s)


@router.post("/reviews/{review_id}/reject", response_model=ReviewRecord)
async def reject(review_id: str, body: ReviewDecisionRequest | None = None, t: TenantContext = Depends(tenant), s: StateStore = Depends(db)) -> ReviewRecord:
    return await _decide(review_id, "reject", body, t, s)
