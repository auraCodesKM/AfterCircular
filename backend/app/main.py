import logging

from dotenv import load_dotenv

load_dotenv()

from fastapi import FastAPI  # noqa: E402
from fastapi.middleware.cors import CORSMiddleware  # noqa: E402

from app.api import ask, documents, evals, health, policies, reviews, scan, tenants  # noqa: E402
from app.config import settings  # noqa: E402

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")

if settings().applicationinsights_connection_string:
    # Azure Monitor / Application Insights: requests, dependencies (httpx → Foundry, Search, GitHub), logs and exceptions.
    # Model telemetry (tokens, cached tokens, cost, TOON/JSON) is emitted as structured log lines by the pipeline.
    from azure.monitor.opentelemetry import configure_azure_monitor  # noqa: E402

    configure_azure_monitor(connection_string=settings().applicationinsights_connection_string, logger_name="app")
    logging.getLogger(__name__).info("Application Insights exporter configured (environment=%s)", settings().environment)

app = FastAPI(title="AfterCircular API", version="0.1.0", docs_url="/docs")
app.add_middleware(CORSMiddleware, allow_origins=settings().cors_origin_list, allow_methods=["*"], allow_headers=["*"])

app.include_router(health.router)
for r in (scan, documents, reviews, tenants, evals, policies, ask):
    app.include_router(r.router, prefix="/api")
