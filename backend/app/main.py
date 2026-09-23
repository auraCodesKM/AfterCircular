import logging

from dotenv import load_dotenv

load_dotenv()

from fastapi import FastAPI  # noqa: E402
from fastapi.middleware.cors import CORSMiddleware  # noqa: E402

from app.api import ask, connectors, documents, evals, health, policies, reviews, scan, system, tenants, usage  # noqa: E402
from app.config import settings  # noqa: E402

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
# The Azure SDKs log every HTTP request/response header block at INFO (including the App Insights exporter's own
# uploads). That is noise, and in Log Analytics it is billed ingestion; keep their warnings and errors only.
for noisy in ("azure", "azure.core.pipeline.policies.http_logging_policy", "azure.monitor.opentelemetry.exporter", "httpx"):
    logging.getLogger(noisy).setLevel(logging.WARNING)

if settings().applicationinsights_connection_string:
    # Azure Monitor / Application Insights: requests, dependencies (httpx → Foundry, Search, GitHub), logs and exceptions.
    # Model telemetry (tokens, cached tokens, cost, TOON/JSON) is emitted as structured log lines by the pipeline.
    from azure.monitor.opentelemetry import configure_azure_monitor  # noqa: E402

    configure_azure_monitor(connection_string=settings().applicationinsights_connection_string, logger_name="app")
    logging.getLogger(__name__).info("Application Insights exporter configured (environment=%s)", settings().environment)

_problems = settings().production_guard()
if _problems:
    # fail fast and loudly: a production container that cannot reach the real services must not start and quietly
    # degrade to fixtures, the local index or a snapshot.
    raise RuntimeError("Refusing to start in production with this configuration:\n  - " + "\n  - ".join(_problems))

app = FastAPI(title="AfterCircular API", version="0.1.0", docs_url=None if settings().is_production else "/docs", redoc_url=None)
app.add_middleware(CORSMiddleware, allow_origins=settings().cors_origin_list, allow_methods=["*"], allow_headers=["*"])

app.include_router(health.router)
for r in (scan, documents, reviews, tenants, evals, policies, ask, usage, connectors, system):
    app.include_router(r.router, prefix="/api")
