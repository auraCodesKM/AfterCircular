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
    }
