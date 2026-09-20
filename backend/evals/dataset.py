"""Golden scenarios (PRD §19): each has a circular, the expected gate result and, for the stub provider, fixture outputs."""

import json
from pathlib import Path
from typing import Any

SCENARIOS_DIR = Path(__file__).resolve().parent / "scenarios"


def load_scenarios() -> list[dict[str, Any]]:
    out = []
    for f in sorted(SCENARIOS_DIR.glob("*.json")):
        sc = json.loads(f.read_text(encoding="utf-8"))
        if "document_file" in sc:
            sc["document"] = json.loads((f.parent / sc["document_file"]).resolve().read_text(encoding="utf-8"))
        out.append(sc)
    return out
