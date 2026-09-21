"""Review lifecycle A–N: conflict → persisted AWAITING_REVIEW → list/detail → human decision → exactly one (mocked) GitHub
issue on approval, none on rejection → idempotent decisions → repeat scans never reopen decided reviews → tenant isolation."""

import pytest

from app.api.reviews import get_review, list_reviews
from app.schemas.actions import TenantContext
from app.services.pipeline import Scan
from app.services.reviews import ReviewError, decide
from tests.test_pipeline_e2e import FakeGH as RepoGH


class IssueGH:
    """Mocked GitHub side effect for approvals — counts issue creations, never touches the network."""

    created: list[dict] = []

    def __init__(self, token):
        pass

    async def find_issue(self, repo, marker):
        return next((i for i in IssueGH.created if i["marker"] == marker), None)

    async def create_issue(self, repo, payload):
        import re

        m = re.search(r"AfterCircular-Analysis-ID: (\S+?)_?$", payload.body, re.M)
        issue = {"number": 100 + len(IssueGH.created), "html_url": f"https://github.com/{repo}/issues/{100 + len(IssueGH.created)}",
                 "marker": f"AfterCircular-Analysis-ID: {m.group(1) if m else ''}"}
        IssueGH.created.append(issue)
        return issue


@pytest.fixture(autouse=True)
def fakes(monkeypatch):
    IssueGH.created = []
    monkeypatch.setattr("app.services.pipeline.GitHubClient", RepoGH)
    monkeypatch.setattr("app.services.reviews.GitHubClient", IssueGH)


async def _conflict_review(db, tenant):
    rec = await Scan(db, tenant).run()
    assert rec.status == "COMPLETED", rec.error
    pending = db.list_reviews(tenant.tenant_id, "AWAITING_REVIEW")
    assert len(pending) == 1  # DEMO-2026-014 is the one CONFLICT in the snapshot for the Acme manifest
    return pending[0]


# A + B + C: conflict creates a persisted AWAITING_REVIEW row that the list and detail endpoints return
async def test_conflict_creates_persisted_awaiting_review_visible_in_list_and_detail(db, tenant):
    rev = await _conflict_review(db, tenant)
    assert rev.status == "AWAITING_REVIEW" and rev.decided_at is None and rev.ticket_id is None
    doc = db.get_document(rev.document_pk, tenant.tenant_id)
    assert doc.document_id == "DEMO-2026-014" and doc.status == "AWAITING_REVIEW" and rev.analysis_id == doc.analysis_id
    listed = list_reviews(status=None, t=tenant, s=db)
    assert [r.id for r in listed] == [rev.id]
    assert [r.id for r in list_reviews(status="AWAITING_REVIEW", t=tenant, s=db)] == [rev.id]
    assert get_review(rev.id, t=tenant, s=db).status == "AWAITING_REVIEW"
    # M: the Overview "needs review" number is the count of persisted AWAITING_REVIEW rows, nothing else
    assert len(db.list_reviews(tenant.tenant_id, "AWAITING_REVIEW")) == 1
    # the analysis the reviewer opens carries the two-sided evidence and the draft memo
    a = db.get_analysis(rev.analysis_id, tenant.tenant_id)
    assert a.gate_outcome == "CONFLICT" and a.impact["regulatory_evidence"] and a.impact["policy_evidence"] and a.memo


# D + F + H: approve → APPROVED, exactly one issue, repeated approval refused
async def test_approval_transitions_the_same_row_and_creates_exactly_one_issue(db, tenant):
    rev = await _conflict_review(db, tenant)
    out = await decide(db, tenant, rev.id, "approve", "go")
    assert out.id == rev.id and out.status == "APPROVED" and out.ticket_id == "100" and out.decided_by == tenant.actor
    assert len(IssueGH.created) == 1
    with pytest.raises(ReviewError):
        await decide(db, tenant, rev.id, "approve", "again")
    assert len(IssueGH.created) == 1 and db.get_review(rev.id, tenant.tenant_id).ticket_id == "100"
    assert db.list_reviews(tenant.tenant_id, "AWAITING_REVIEW") == []


# E + G + I: reject → REJECTED, zero issues, repeated rejection refused
async def test_rejection_records_the_decision_and_creates_no_issue(db, tenant):
    rev = await _conflict_review(db, tenant)
    out = await decide(db, tenant, rev.id, "reject", "not for us")
    assert out.id == rev.id and out.status == "REJECTED" and out.ticket_id is None and out.note == "not for us"
    assert IssueGH.created == []
    with pytest.raises(ReviewError):
        await decide(db, tenant, rev.id, "reject", "still no")
    assert IssueGH.created == [] and db.get_document(rev.document_pk, tenant.tenant_id).status == "REJECTED"
    assert [r.id for r in list_reviews(status=None, t=tenant, s=db)] == [rev.id]  # decided reviews stay in history


# J + K: a repeat scan (even forced) never reopens a decided review and never duplicates it
@pytest.mark.parametrize("decision", ["approve", "reject"])
async def test_repeat_scan_does_not_reopen_a_decided_review(db, tenant, decision):
    rev = await _conflict_review(db, tenant)
    await decide(db, tenant, rev.id, decision, None)
    again = await Scan(db, tenant).run()
    assert again.new_documents == 0 and again.llm_calls == 0
    forced = await Scan(db, tenant, force=True).run()
    assert forced.status == "COMPLETED", forced.error
    rows = db.list_reviews(tenant.tenant_id)
    assert len(rows) == 1 and rows[0].id == rev.id
    if decision == "approve":
        assert rows[0].status == "APPROVED" and rows[0].ticket_id == "100" and len(IssueGH.created) == 1
        assert db.get_document(rev.document_pk, tenant.tenant_id).status == "COMPLETED"
    else:
        # a rejected conflict that recurs is presented again to a person — it is never silently dropped or auto-ticketed
        assert rows[0].status == "AWAITING_REVIEW" and IssueGH.created == []


# L: tenant isolation — another company's context cannot list, read or decide this review
async def test_other_tenant_cannot_see_or_decide_the_review(db, tenant):
    rev = await _conflict_review(db, tenant)
    other = TenantContext(tenant_id="nimbus-test", company_name="Nimbus", github_repo="acme/policies", default_branch="main", actor="someone", github_token="t")
    assert list_reviews(status=None, t=other, s=db) == []
    from fastapi import HTTPException

    with pytest.raises(HTTPException):
        get_review(rev.id, t=other, s=db)
    with pytest.raises(ReviewError):
        await decide(db, other, rev.id, "approve", None)
    assert IssueGH.created == [] and db.get_review(rev.id, tenant.tenant_id).status == "AWAITING_REVIEW"


# N: an AWAITING_REVIEW row stays exactly that until a human decides — scans do not decide
async def test_pending_review_survives_repeat_scans_until_a_human_decides(db, tenant):
    rev = await _conflict_review(db, tenant)
    await Scan(db, tenant).run()
    await Scan(db, tenant, force=True).run()
    rows = db.list_reviews(tenant.tenant_id)
    assert len(rows) == 1 and rows[0].id == rev.id and rows[0].status == "AWAITING_REVIEW" and rows[0].decided_at is None
    assert IssueGH.created == []
