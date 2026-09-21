"""Serves the latest machine-readable model-evaluation report (evals/results/latest.json) to the dashboard."""

import json
from pathlib import Path

from fastapi import APIRouter, Depends

from app.api.deps import require_api_key

router = APIRouter(dependencies=[Depends(require_api_key)])
RESULTS_DIR = Path(__file__).resolve().parents[2] / "evals" / "results"
RESULTS = RESULTS_DIR / "latest.json"
JUDGES = RESULTS_DIR / "judges-latest.json"


@router.get("/evals/latest")
def latest() -> dict:
    out: dict = {"available": RESULTS.exists(), "judges": None}
    if RESULTS.exists():
        out.update(json.loads(RESULTS.read_text(encoding="utf-8")))
    else:
        out["message"] = "No generative-model evaluation yet. Run `python -m evals.run` in backend/."
    if JUDGES.exists():
        out["judges"] = json.loads(JUDGES.read_text(encoding="utf-8"))
    return out
