"""Regulatory-source health: ONE bounded request to the official listing, cached for a minute. Never touches models."""

import time
from typing import Any

from fastapi import APIRouter, Depends

from app.api.deps import require_api_key
from app.connectors.sebi import SEBIConnector

router = APIRouter(dependencies=[Depends(require_api_key)])
_cache: dict[str, Any] = {"at": 0.0, "value": None}
CACHE_SECONDS = 60


@router.get("/connectors/sebi/health")
async def sebi_health(refresh: bool = False) -> dict[str, Any]:
    if not refresh and _cache["value"] is not None and time.monotonic() - _cache["at"] < CACHE_SECONDS:
        return {**_cache["value"], "cached": True}
    value = await SEBIConnector().check()
    _cache["at"], _cache["value"] = time.monotonic(), value
    return {**value, "cached": False}
