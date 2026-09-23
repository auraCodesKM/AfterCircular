"""Fail-closed contract: every critical dependency, when it is down, must produce an explicit failure — never a
fabricated answer, a fake success badge, invented telemetry or a downstream side effect.

Covers the gaps not already asserted elsewhere: GitHub outage during approval, an unreadable database, and the startup
refusal for stub/snapshot in production. (Foundry outage: test_cost_guard_and_safety; Azure AI Search outage: same
file; SEBI outage: test_sebi_live_connector; Jev outage: test_decisions::test_judge_outage_degrades_to_human.)
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.services.reviews import ReviewError, decide
from app.tools.github import GitHubError
from tests.test_reviews_and_tickets import _seed


async def test_github_outage_leaves_the_review_open_and_invents_no_issue(db, tenant, monkeypatch):
    _seed(db, tenant)

    class DownGH:
        def __init__(self, token):
            pass

        async def find_issue(self, repo, marker):
            return None

        async def create_issue(self, repo, payload):
            raise GitHubError("503 from api.github.com")

    monkeypatch.setattr("app.services.reviews.GitHubClient", DownGH)
    with pytest.raises(GitHubError):
        await decide(db, tenant, "rev_1", "approve", "go")
    review = db.get_review("rev_1", tenant.tenant_id)
    # the human decision is recorded (it really happened and belongs in the audit trail); the side effect is not faked
    assert review.status == "APPROVED" and review.decided_by == tenant.actor
    assert review.ticket_id is None and review.ticket_url is None, "no issue number is invented when GitHub refused"
    events = {e.event_type for e in db.list_audit(tenant.tenant_id)}
    assert "APPROVED" in events and "TICKET_CREATED" not in events
    assert db.get_document("doc_1", tenant.tenant_id).status != "COMPLETED"

    # once GitHub is back, approving again retries only the side effect — and creates exactly one issue
    created = {"n": 0}

    class UpGH:
        def __init__(self, token):
            pass

        async def find_issue(self, repo, marker):
            return {"number": 11, "html_url": "https://github.com/x/y/issues/11"} if created["n"] else None

        async def create_issue(self, repo, payload):
            created["n"] += 1
            return {"number": 11, "html_url": "https://github.com/x/y/issues/11"}

    monkeypatch.setattr("app.services.reviews.GitHubClient", UpGH)
    rev = await decide(db, tenant, "rev_1", "approve", None)
    assert rev.ticket_id == "11" and created["n"] == 1
    with pytest.raises(ReviewError):  # once the issue exists the review is closed: a further approve is refused
        await decide(db, tenant, "rev_1", "approve", None)
    assert created["n"] == 1


def test_readiness_fails_when_the_state_store_cannot_be_read(monkeypatch):
    from app.api import health as health_api

    class Broken:
        @property
        def conn(self):
            raise RuntimeError("database file is not readable")

    monkeypatch.setattr(health_api, "store", lambda: Broken())
    from app.main import app

    with TestClient(app) as c:
        r = c.get("/health/ready")
        assert r.status_code == 503 and r.json()["ok"] is False
        assert "state store unavailable" in " ".join(r.json()["problems"])
        assert c.get("/health/live").status_code == 200, "liveness stays up: the process is fine, its dependency is not"


@pytest.mark.parametrize(
    "override,needle",
    [
        ({"AI_PROVIDER": "stub", "FOUNDRY_ENDPOINT": ""}, "FOUNDRY_ENDPOINT"),
        ({"SEBI_MODE": "demo_snapshot"}, "SEBI_MODE"),
        ({"SEBI_MODE": "live_with_snapshot_fallback"}, "SEBI_MODE"),
        ({"AZURE_SEARCH_ENDPOINT": ""}, "AZURE_SEARCH_ENDPOINT"),
        ({"CORS_ORIGINS": "*"}, "CORS_ORIGINS"),
        ({"BACKEND_API_KEY": "change-me"}, "BACKEND_API_KEY"),
        ({"DATABASE_PATH": "data/aftercircular.db"}, "DATABASE_PATH"),
        ({"TYPESAFE_API_KEY": "", "TYPE_SAFE_API_KEY": ""}, "TYPESAFE_API_KEY"),
        ({"DEFAULT_JUDGE": "stub"}, "stub judge"),
    ],
)
def test_production_refuses_each_unsafe_configuration(override, needle):
    base = dict(ENVIRONMENT="production", AI_PROVIDER="foundry", FOUNDRY_ENDPOINT="https://aif.example/",
                AZURE_SEARCH_ENDPOINT="https://srch.example", SEBI_MODE="live", BACKEND_API_KEY="real-secret",
                CORS_ORIGINS="https://web.example", DATABASE_PATH="/data/aftercircular.db", TYPESAFE_API_KEY="jev-key", DEFAULT_JUDGE="typesafe")
    problems = Settings(**{**base, **override}).production_guard()  # type: ignore[arg-type]
    assert any(needle in p for p in problems), (override, problems)
