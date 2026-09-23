"""Human approval: the only place a side effect (GitHub issue) is executed, and only after a human decision."""

from app.schemas.actions import ReviewRecord, TenantContext
from app.services import audit
from app.services.state import StateStore, now
from app.services.tickets import MARKER, build_ticket
from app.tools.github import GitHubClient


class ReviewError(RuntimeError):
    pass


def transition(rev: ReviewRecord, decision: str) -> ReviewRecord:
    """Pure state transition, tested. AWAITING_REVIEW → APPROVED | REJECTED; anything else is refused."""
    if rev.status != "AWAITING_REVIEW":
        raise ReviewError(f"Review {rev.id} is already {rev.status}")
    if decision not in ("approve", "reject"):
        raise ReviewError(f"Unknown decision {decision!r}")
    return rev.model_copy(update={"status": "APPROVED" if decision == "approve" else "REJECTED", "decided_at": now()})


async def decide(db: StateStore, tenant: TenantContext, review_id: str, decision: str, note: str | None) -> ReviewRecord:
    rev = db.get_review(review_id, tenant.tenant_id)
    if not rev:
        raise ReviewError("Review not found")
    if decision == "approve" and rev.status == "APPROVED" and not rev.ticket_id:
        # the person already approved, but the GitHub call failed (outage, revoked token). Re-running the approval
        # retries only the side effect; `find_issue` on the analysis marker keeps it idempotent.
        return await create_ticket(db, tenant, rev)
    rev = transition(rev, decision).model_copy(update={"decided_by": tenant.actor, "note": note})
    db.upsert_review(rev)
    if rev.status == "REJECTED":
        db.update_document(rev.document_pk, status="REJECTED")
        audit.record(db, tenant.tenant_id, "REJECTED", actor=tenant.actor, actor_type="human", document_pk=rev.document_pk, analysis_id=rev.analysis_id, review_id=rev.id, note=note)
        return rev
    db.update_document(rev.document_pk, status="APPROVED")
    audit.record(db, tenant.tenant_id, "APPROVED", actor=tenant.actor, actor_type="human", document_pk=rev.document_pk, analysis_id=rev.analysis_id, review_id=rev.id, note=note)
    return await create_ticket(db, tenant, rev)


async def create_ticket(db: StateStore, tenant: TenantContext, rev: ReviewRecord) -> ReviewRecord:
    doc = db.get_document(rev.document_pk, tenant.tenant_id)
    analysis = db.get_analysis(rev.analysis_id, tenant.tenant_id)
    if not doc or not analysis or not analysis.impact:
        raise ReviewError("Analysis missing for this review")
    gh = GitHubClient(tenant.github_token)
    existing = await gh.find_issue(tenant.github_repo, f"{MARKER} {analysis.id}")
    if existing:
        issue = existing
    else:
        issue = await gh.create_issue(tenant.github_repo, build_ticket(doc, analysis, rev))
    rev = rev.model_copy(update={"ticket_id": str(issue["number"]), "ticket_url": issue["html_url"]})
    db.upsert_review(rev)
    db.update_document(doc.id, status="COMPLETED", ticket_id=rev.ticket_id, ticket_url=rev.ticket_url)
    audit.record(db, tenant.tenant_id, "TICKET_CREATED", actor="aftercircular", actor_type="agent", document_pk=doc.id, analysis_id=analysis.id,
                 review_id=rev.id, ticket_id=rev.ticket_id, ticket_url=rev.ticket_url, reused=bool(existing))
    return rev
