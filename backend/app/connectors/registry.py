"""Regulatory source registry — the curated set of REAL SEBI circulars the demo tenants are compared against.

One JSON record per circular in regulatory_sources/sebi/<entry_id>.json, written by a live fetch (official detail URL,
official PDF URL, reference, date, bytes, text hash, retrieved_at). The registry never contains circular text; the
connector fetches every selected circular live from www.sebi.gov.in on each scan and the record is only used to
(a) choose which entry ids a scan processes (SEBI_SELECTED_ENTRY_IDS) and (b) verify provenance (hash drift is logged).
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

REGISTRY_DIR = Path(__file__).resolve().parents[2] / "regulatory_sources" / "sebi"


def load_registry() -> dict[str, dict[str, Any]]:
    out: dict[str, dict[str, Any]] = {}
    for f in sorted(REGISTRY_DIR.glob("*.json")):
        rec = json.loads(f.read_text(encoding="utf-8"))
        if rec.get("source_mode") != "LIVE" or rec.get("synthetic") is not False:
            raise ValueError(f"registry record {f.name} must be a LIVE, non-synthetic source")
        out[str(rec["entry_id"])] = rec
    return out
