"""TOON vs JSON token benchmark on representative AfterCircular payloads — local, fixed data, no model calls.

    uv run python -m evals.toon_benchmark            # prints a markdown table + writes evals/results/toon_benchmark.json

Payloads (from the fixed evaluation scenarios and the fictional Acme policy corpus):
  - 5 obligations, 10 obligations            (extraction output as impact-analysis context)
  - 20 policy chunks                          (retrieved evidence)
  - company profile                           (manifest company block)
  - impact-analysis evidence                  (regulatory + policy evidence lists)
  - full impact prompt context                (obligations + budgeted chunks, as the agent builds it)

Tokens are counted with tiktoken o200k_base (GPT-4o/4.1/5 family). Parsing reliability = TOON encode→decode round-trip
equality with the source object. Accuracy/latency against a live model are NOT measured here; `--live` in a later
phase records them from real calls, one per payload, and only when a Foundry deployment is configured.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

from app.services.policies import chunk_markdown, parse_front_matter
from app.toon import compact_json, count_tokens, from_toon, pretty_json, to_toon
from evals.dataset import load_scenarios

ROOT = Path(__file__).resolve().parent
CORPUS = ROOT.parents[2] / "acme-securities-policies"


def _obligations(n: int) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for sc in load_scenarios():
        ext = sc.get("fixtures", {}).get("extraction", {})
        for o in ext.get("obligations", []):
            rows.append({"i": len(rows) + 1, "area": o["affected_area"], "requirement": o["requirement"], "deadline": o.get("deadline") or "",
                         "section": o["evidence"]["section"], "evidence": o["evidence"]["text"]})
    while len(rows) < n:  # the scenarios hold ~15; repeat with new indices if a bigger table is requested
        rows.append(dict(rows[len(rows) % max(1, len(rows) // 2 or 1)], i=len(rows) + 1))
    return rows[:n]


def _chunks(n: int) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    if not CORPUS.exists():
        return rows
    for p in sorted(CORPUS.glob("**/*.md")):
        if p.name in {"README.md", "CHANGELOG.md"}:
            continue
        meta, body = parse_front_matter(p.read_text(encoding="utf-8"))
        doc_id = str(meta.get("doc_id") or p.stem)
        for c in chunk_markdown(doc_id, str(meta.get("title") or p.stem), p.relative_to(CORPUS).as_posix(), str(meta.get("version") or ""), body):
            rows.append({"doc_id": c["doc_id"], "section": c["section"], "version": c.get("version") or "", "path": c["path"], "text": c["text"]})
    return rows[:n]


def _profile() -> dict[str, Any]:
    import yaml

    man = yaml.safe_load((CORPUS / "aftercircular.yml").read_text(encoding="utf-8")) if CORPUS.exists() else {}
    c = man.get("company", {})
    return {"legal_name": c.get("legal_name"), "sector": c.get("sector"), "country": c.get("country"), "regulator": c.get("regulator"),
            "registrations": [f"{r.get('authority')} {r.get('type')}" for r in c.get("registrations", [])],
            "exchanges": c.get("exchanges", []), "segments": c.get("segments", [])}


def _evidence() -> dict[str, Any]:
    for sc in load_scenarios():
        imp = sc.get("fixtures", {}).get("impact", {})
        if imp.get("policy_evidence"):
            return {"regulatory_evidence": imp["regulatory_evidence"], "policy_evidence": imp["policy_evidence"]}
    return {"regulatory_evidence": [], "policy_evidence": []}


def legacy_text(payload: Any) -> str | None:
    """The hand-written prompt format the agents used before TOON (numbered lines / bracketed headers), for honesty:
    TOON's saving is measured against it too, not only against JSON."""
    if isinstance(payload, dict) and set(payload) <= {"obligations", "policy_excerpts"}:
        parts = []
        for o in payload.get("obligations", []):
            parts.append(f"{o['i']}. [{o['area']}] {o['requirement']} (deadline: {o['deadline'] or 'none stated'}) — evidence §{o['section']}: \"{o['evidence']}\"")
        for c in payload.get("policy_excerpts", []):
            parts.append(f"[{c['doc_id']} §{c['section']}] (version {c['version'] or 'n/a'}, {c['path']})\n{c['text']}")
        return "\n".join(parts)
    return None


def measure(name: str, payload: Any) -> dict[str, Any]:
    pj, cj = pretty_json(payload), compact_json(payload)
    row: dict[str, Any] = {"payload": name, "pretty_json": count_tokens(pj), "compact_json": count_tokens(cj)}
    legacy = legacy_text(payload)
    row["legacy_text"] = count_tokens(legacy) if legacy is not None else None
    try:
        t = to_toon(payload)
        row["toon"] = count_tokens(t)
        row["toon_round_trip"] = from_toon(t) == payload
    except Exception as e:  # noqa: BLE001
        row["toon"], row["toon_round_trip"], row["error"] = None, False, f"{type(e).__name__}: {e}"[:120]
    if row["toon"]:
        row["saving_vs_compact_pct"] = round(100 * (row["compact_json"] - row["toon"]) / row["compact_json"], 1)
        row["saving_vs_pretty_pct"] = round(100 * (row["pretty_json"] - row["toon"]) / row["pretty_json"], 1)
        if row["legacy_text"]:
            row["saving_vs_legacy_pct"] = round(100 * (row["legacy_text"] - row["toon"]) / row["legacy_text"], 1)
    return row


def run() -> list[dict[str, Any]]:
    chunks20 = _chunks(20)
    payloads = [
        ("5 obligations", {"obligations": _obligations(5)}),
        ("10 obligations", {"obligations": _obligations(10)}),
        ("20 policy chunks", {"policy_excerpts": chunks20}),
        ("company profile", _profile()),
        ("impact evidence", _evidence()),
        ("impact prompt context (10 obligations + 8 chunks)", {"obligations": _obligations(10), "policy_excerpts": chunks20[:8]}),
    ]
    return [measure(n, p) for n, p in payloads]


def markdown(rows: list[dict[str, Any]]) -> str:
    out = ["| Payload | Pretty JSON | Compact JSON | Legacy text | TOON | vs compact | vs pretty | vs legacy | Round-trip |",
           "|---|---:|---:|---:|---:|---:|---:|---:|:--:|"]
    for r in rows:
        out.append(f"| {r['payload']} | {r['pretty_json']} | {r['compact_json']} | {r['legacy_text'] if r['legacy_text'] else '—'} | "
                   f"{r['toon'] if r['toon'] is not None else '—'} | {r.get('saving_vs_compact_pct', '—')}% | {r.get('saving_vs_pretty_pct', '—')}% | "
                   f"{str(r['saving_vs_legacy_pct']) + '%' if r.get('saving_vs_legacy_pct') is not None else '—'} | {'✓' if r.get('toon_round_trip') else '✗'} |")
    return "\n".join(out)


if __name__ == "__main__":
    rows = run()
    (ROOT / "results").mkdir(exist_ok=True)
    (ROOT / "results" / "toon_benchmark.json").write_text(json.dumps({"tokenizer": "o200k_base", "rows": rows}, indent=2), encoding="utf-8")
    print(markdown(rows))
    if any(not r.get("toon_round_trip") for r in rows):
        print("\nWARNING: at least one payload did not round-trip through TOON", file=sys.stderr)
