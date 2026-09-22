import os

os.environ.setdefault("AI_PROVIDER", "stub")
os.environ.setdefault("SEBI_MODE", "snapshot")
os.environ.setdefault("BACKEND_API_KEY", "test-key")
os.environ.setdefault("DEFAULT_JUDGE", "stub")
os.environ["DECISION_ROUTES"] = ""
os.environ["SEBI_SELECTED_ENTRY_IDS"] = ""  # tests must not inherit the demo's curated set from .env
# stub provider makes no model calls, so the whole snapshot may be processed in tests
os.environ.setdefault("AFTERCIRCULAR_MAX_DOCUMENTS_PER_SCAN", "5")

import pytest  # noqa: E402

from app.schemas.actions import TenantContext  # noqa: E402
from app.services.state import StateStore  # noqa: E402


@pytest.fixture
def db() -> StateStore:
    return StateStore(":memory:")


@pytest.fixture
def tenant() -> TenantContext:
    return TenantContext(tenant_id="acme-test", company_name="Acme Securities", github_repo="acme/policies", actor="tester", github_token="x")
