from fastapi import APIRouter

from app.config import settings

router = APIRouter()


@router.get("/health")
def health() -> dict:
    s = settings()
    return {
        "ok": True,
        "ai_provider": "foundry" if s.foundry_configured else "stub",
        "retrieval": "azure-ai-search" if s.search_configured else "local-hybrid",
        "sebi_mode": s.sebi_mode,
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
