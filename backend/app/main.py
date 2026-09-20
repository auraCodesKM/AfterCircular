import logging

from dotenv import load_dotenv

load_dotenv()

from fastapi import FastAPI  # noqa: E402
from fastapi.middleware.cors import CORSMiddleware  # noqa: E402

from app.api import documents, evals, health, reviews, scan, tenants  # noqa: E402
from app.config import settings  # noqa: E402

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")

app = FastAPI(title="AfterCircular API", version="0.1.0", docs_url="/docs")
app.add_middleware(CORSMiddleware, allow_origins=settings().cors_origin_list, allow_methods=["*"], allow_headers=["*"])

app.include_router(health.router)
for r in (scan, documents, reviews, tenants, evals):
    app.include_router(r.router, prefix="/api")
