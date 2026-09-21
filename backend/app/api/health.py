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
    }
