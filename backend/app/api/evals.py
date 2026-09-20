"""Serves the latest machine-readable model-evaluation report (evals/results/latest.json) to the dashboard."""

import json
from pathlib import Path

from fastapi import APIRouter, Depends

from app.api.deps import require_api_key

router = APIRouter(dependencies=[Depends(require_api_key)])
RESULTS = Path(__file__).resolve().parents[2] / "evals" / "results" / "latest.json"


@router.get("/evals/latest")
def latest() -> dict:
    if not RESULTS.exists():
        return {"available": False, "message": "No evaluation has been run yet. Run `python -m evals.run` in backend/."}
    return {"available": True, **json.loads(RESULTS.read_text(encoding="utf-8"))}
