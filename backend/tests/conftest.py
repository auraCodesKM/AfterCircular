import os

os.environ.setdefault("AI_PROVIDER", "stub")
os.environ.setdefault("SEBI_MODE", "snapshot")
os.environ.setdefault("BACKEND_API_KEY", "test-key")
os.environ.setdefault("DEFAULT_JUDGE", "stub")
os.environ["DECISION_ROUTES"] = ""

import pytest  # noqa: E402

from app.schemas.actions import TenantContext  # noqa: E402
from app.services.state import StateStore  # noqa: E402


@pytest.fixture
def db() -> StateStore:
    return StateStore(":memory:")


@pytest.fixture
def tenant() -> TenantContext:
    return TenantContext(tenant_id="acme-test", company_name="Acme Securities", github_repo="acme/policies", actor="tester", github_token="x")
