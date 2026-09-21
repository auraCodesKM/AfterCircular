"""Read-only model usage and budget view for the dashboard — sums of what llm_calls recorded, nothing derived or invented.

    GET /api/usage?period=today|all&scan_id=<id>

Costs are *estimates* from the list-price table (pricing_status=estimate) or null when a model has no price. Budgets are the
application's own circuit breakers (AFTERCIRCULAR_MAX_ESTIMATED_COST_PER_*), not Azure billing limits."""

from typing import Any, Literal

from fastapi import APIRouter, Depends

from app.api.deps import db, tenant
from app.config import settings
from app.models.provider import pricing_for
from app.schemas.actions import TenantContext
from app.services.state import StateStore, now

router = APIRouter()


@router.get("/usage")
def usage(period: Literal["today", "all"] = "today", scan_id: str | None = None, t: TenantContext = Depends(tenant), s: StateStore = Depends(db)) -> dict[str, Any]:
    cfg = settings()
    day_start = now().replace(hour=0, minute=0, second=0, microsecond=0).isoformat()
    since = day_start if period == "today" else None
    tenant_usage = s.usage(since_iso=since, tenant_id=t.tenant_id)
    spent_today_all = s.estimated_cost_since(day_start)  # the daily breaker is application-wide
    scan = s.get_scan(scan_id, t.tenant_id) if scan_id else s.latest_scan(t.tenant_id)
    scan_usage = s.usage(scan_id=scan.id) if scan else None
    for m in tenant_usage["models"]:
        m["pricing_status"] = "estimate" if pricing_for(m["model"]) else "unknown"
    deployments = {"extraction": cfg.extraction_model, "impact": cfg.impact_model, "memo": cfg.memo_model, "embedding": cfg.embedding_model}
    return {
        "period": period,
        "since": since,
        "deployments": deployments,
        "active_model": cfg.extraction_model if cfg.extraction_model == cfg.impact_model == cfg.memo_model else None,
        "pricing": {m: ("estimate" if pricing_for(m) else "unknown") for m in set(deployments.values())},
        **tenant_usage,
        "scan": {"id": scan.id, "status": scan.status, "llm_calls": scan.llm_calls, "estimated_cost_usd": scan.estimated_cost_usd, **{k: v for k, v in (scan_usage or {}).items() if k != "models"}} if scan else None,
        "budget": {
            "scan_limit_usd": cfg.max_estimated_cost_per_scan_usd,
            "daily_limit_usd": cfg.max_estimated_cost_per_day_usd,
            "max_llm_calls_per_scan": cfg.max_llm_calls_per_scan,
            "spent_today_usd": round(spent_today_all, 6),
            "daily_remaining_usd": round(max(0.0, cfg.max_estimated_cost_per_day_usd - spent_today_all), 6) if cfg.max_estimated_cost_per_day_usd else None,
            "scan_remaining_usd": round(max(0.0, cfg.max_estimated_cost_per_scan_usd - (scan.estimated_cost_usd if scan else 0.0)), 6) if cfg.max_estimated_cost_per_scan_usd else None,
            "note": "Application circuit breakers on list-price estimates; not Azure billing limits.",
        },
    }
