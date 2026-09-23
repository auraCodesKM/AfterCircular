from fastapi import APIRouter, Response, status

from app.config import settings
from app.services.state import store

router = APIRouter()


@router.get("/health/live")
def live() -> dict:
    """Liveness: the process is up. No I/O, no model call — safe to probe every few seconds."""
    return {"ok": True}


@router.get("/health/ready")
def ready(response: Response) -> dict:
    """Readiness: the state store answers and the production configuration holds. Still cheap: one SQLite read, no
    Foundry/Search/SEBI call (those are exercised by the pipeline, not by a probe)."""
    problems: list[str] = []
    try:
        store().conn.execute("SELECT 1").fetchone()
    except Exception as e:  # noqa: BLE001
        problems.append(f"state store unavailable: {type(e).__name__}")
    problems += settings().production_guard()
    if problems:
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
    return {"ok": not problems, "problems": problems, "environment": settings().environment}


@router.get("/health")
def health() -> dict:
    s = settings()
    return {
        "ok": True,
        "ai_provider": "foundry" if s.foundry_configured else "stub",
        "retrieval": "azure-ai-search" if s.search_configured else "local-hybrid",
        "sebi_mode": "demo_snapshot" if s.sebi_mode == "snapshot" else s.sebi_mode,
        "models": {"extraction": s.extraction_model, "impact": s.impact_model, "memo": s.memo_model, "embedding": s.embedding_model},
        "judge": {"default": s.default_judge if (s.default_judge != "typesafe" or s.typesafe_api_key) else "stub", "model": s.typesafe_model,
                  "typesafe_configured": bool(s.typesafe_api_key), "routes": s.decision_routes},
        "environment": s.environment,
        "foundry": {"configured": s.foundry_configured, "api": s.foundry_api, "auth": "api-key" if s.foundry_api_key else "entra-id"} if s.foundry_configured else None,
        "guardrails": {"max_documents_per_scan": s.max_documents_per_scan, "max_llm_calls_per_scan": s.max_llm_calls_per_scan,
                       "max_retries": s.max_retries, "max_concurrent_calls": s.max_concurrent_calls,
                       "live_scan": s.enable_live_scan, "scheduled_scan": s.enable_scheduled_scan, "toon_context": s.toon_context},
        "observability": "application-insights" if s.applicationinsights_connection_string else "logs-only",
    }
