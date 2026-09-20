"""Model evaluation harness: `python -m evals.run [--models a,b] [--corpus DIR] [--tasks extraction,impact,memo]`.

Runs every golden scenario through extraction → local hybrid retrieval → impact analysis (→ memo on CONFLICT) for each
configured Foundry deployment and writes evals/results/<timestamp>.json + latest.json.

Scoring (documented, task-specific — no single magic number):
  extraction.json_valid        schema-valid output within the retry budget
  extraction.evidence_accuracy share of obligations whose evidence.text is a verbatim substring of the circular
  extraction.count_ok          at least `expected.min_obligations` obligations
  impact.json_valid            schema-valid output
  impact.applicability_ok      == expected.applicability
  impact.alignment_ok          == expected.alignment (only scored when applicability is YES)
  impact.affected_ok           set(affected_policies) == set(expected.affected_policies)
  impact.evidence_accuracy     share of policy_evidence excerpts found verbatim in a retrieved chunk of that doc_id,
                               and regulatory_evidence excerpts found verbatim in the circular
  memo.json_valid              schema-valid memo when a CONFLICT was found
  quality_score                per task: mean of that task's boolean/ratio checks above (0..1)
  estimated_cost               from evals/pricing.json; null when the model has no price entry
"""

import argparse
import asyncio
import json
import os
import statistics
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from app.agents.impact_analysis import analyze_impact
from app.agents.memo_generation import generate_memo
from app.agents.obligation_extraction import extract_obligations
from app.config import settings
from app.models.provider import LLMResult, ProviderError, provider
from app.retrieval.local import LocalRetriever
from app.schemas.impact import PolicyChunk
from app.schemas.regulatory import RegulatoryDocument
from app.services.policies import chunk_markdown, company_profile, parse_front_matter
from app.services.state import StateStore
from evals.dataset import load_scenarios

ROOT = Path(__file__).resolve().parent
RESULTS = ROOT / "results"
PRICING = json.loads((ROOT / "pricing.json").read_text(encoding="utf-8"))


def _norm(s: str) -> str:
    return " ".join(s.split()).lower()


def verbatim(needle: str, hay: str) -> bool:
    n = _norm(needle)
    return len(n) >= 12 and n in _norm(hay)


def load_local_corpus(corpus_dir: Path) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    import yaml

    manifest = yaml.safe_load((corpus_dir / "aftercircular.yml").read_text(encoding="utf-8"))
    chunks: list[dict[str, Any]] = []
    for d in manifest["documents"]:
        meta, body = parse_front_matter((corpus_dir / d["path"]).read_text(encoding="utf-8"))
        chunks.extend(chunk_markdown(str(meta.get("doc_id", d["id"])), str(meta.get("title", d["title"])), d["path"], str(meta.get("version", "")), body))
    return manifest, chunks


def cost(model: str, inp: int | None, out: int | None) -> float | None:
    p = PRICING.get(model)
    if not p or inp is None or out is None:
        return None
    return round((inp * p["input"] + out * p["output"]) / 1_000_000, 6)


def usage(res: LLMResult) -> dict[str, Any]:
    return {"model": res.model, "latency_ms": res.latency_ms, "input_tokens": res.input_tokens, "output_tokens": res.output_tokens,
            "attempts": res.attempts, "estimated_cost": cost(res.model, res.input_tokens, res.output_tokens)}


async def run_scenario(llm, ret: LocalRetriever, sc: dict[str, Any], model: str, profile: str, tasks: set[str]) -> dict[str, Any]:
    doc = RegulatoryDocument.model_validate(sc["document"]).with_hash()
    exp = sc["expected"]
    r: dict[str, Any] = {"scenario": sc["id"], "model": model, "tasks": {}}

    # extraction
    t: dict[str, Any] = {"json_valid": False, "evidence_accuracy": None, "count_ok": False, "error": None}
    r["tasks"]["extraction"] = t
    try:
        extraction, res = await extract_obligations(llm, doc, model=model)
        t.update(json_valid=True, **usage(res))
        obs = extraction.obligations
        t["evidence_accuracy"] = (sum(verbatim(o.evidence.text, doc.content) for o in obs) / len(obs)) if obs else 0.0
        t["count_ok"] = len(obs) >= exp.get("min_obligations", 1)
        t["obligations"] = len(obs)
    except ProviderError as e:
        t["error"] = str(e)[:300]
        return r
    if "impact" not in tasks:
        return r

    # retrieval (local hybrid, keyword-only unless the provider embeds)
    query = " ".join([extraction.summary, *(o.requirement for o in extraction.obligations[:6])])[:2000]
    vec = await llm.embed([query])
    chunks: list[PolicyChunk] = await ret.search("eval", query, vec[0] if vec else None, k=6)
    r["retrieved"] = [c.chunk_id for c in chunks]

    # impact
    t = {"json_valid": False, "applicability_ok": False, "alignment_ok": None, "affected_ok": False, "evidence_accuracy": None, "error": None}
    r["tasks"]["impact"] = t
    try:
        impact, res = await analyze_impact(llm, extraction, chunks, profile, model=model, document_id=doc.document_id)
        t.update(json_valid=True, **usage(res))
        t["applicability"] = impact.applicability
        t["alignment"] = impact.alignment
        t["applicability_ok"] = impact.applicability == exp["applicability"]
        if exp["applicability"] == "YES":
            t["alignment_ok"] = impact.alignment == exp["alignment"]
        t["affected_ok"] = set(impact.affected_policies) == set(exp.get("affected_policies", []))
        checks = [verbatim(e.text, doc.content) for e in impact.regulatory_evidence]
        by_doc: dict[str, str] = {}
        for c in chunks:
            by_doc[c.doc_id] = by_doc.get(c.doc_id, "") + "\n" + c.text
        checks += [verbatim(e.text, by_doc.get(e.doc_id, "")) for e in impact.policy_evidence]
        t["evidence_accuracy"] = (sum(checks) / len(checks)) if checks else (1.0 if impact.applicability != "YES" or impact.alignment != "CONFLICT" else 0.0)
    except ProviderError as e:
        t["error"] = str(e)[:300]
        return r

    # memo (only on CONFLICT, only when requested)
    if "memo" in tasks and impact.applicability == "YES" and impact.alignment == "CONFLICT":
        t = {"json_valid": False, "error": None}
        r["tasks"]["memo"] = t
        try:
            _, res = await generate_memo(llm, extraction, impact, chunks, model=model, document_id=doc.document_id)
            t.update(json_valid=True, **usage(res))
        except ProviderError as e:
            t["error"] = str(e)[:300]
    return r


def quality(task: str, t: dict[str, Any]) -> float:
    keys = {"extraction": ["json_valid", "evidence_accuracy", "count_ok"], "impact": ["json_valid", "applicability_ok", "alignment_ok", "affected_ok", "evidence_accuracy"], "memo": ["json_valid"]}[task]
    vals = [float(t[k]) for k in keys if t.get(k) is not None]
    return round(sum(vals) / len(vals), 3) if vals else 0.0


def summarize(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    out = []
    for model in sorted({r["model"] for r in rows}):
        for task in ("extraction", "impact", "memo"):
            ts = [r["tasks"][task] for r in rows if r["model"] == model and task in r["tasks"]]
            if not ts:
                continue
            lat = [t["latency_ms"] for t in ts if t.get("latency_ms") is not None]
            costs = [t["estimated_cost"] for t in ts if t.get("estimated_cost") is not None]
            ev = [t["evidence_accuracy"] for t in ts if t.get("evidence_accuracy") is not None]
            out.append({
                "model": model, "task": task, "runs": len(ts),
                "quality_score": round(statistics.mean(quality(task, t) for t in ts), 3),
                "json_valid_rate": round(sum(t["json_valid"] for t in ts) / len(ts), 3),
                "evidence_accuracy": round(statistics.mean(ev), 3) if ev else None,
                "latency_ms_median": int(statistics.median(lat)) if lat else None,
                "input_tokens": sum(t.get("input_tokens") or 0 for t in ts) or None,
                "output_tokens": sum(t.get("output_tokens") or 0 for t in ts) or None,
                "estimated_cost_total": round(sum(costs), 6) if costs and len(costs) == len(ts) else None,
                "errors": sum(1 for t in ts if t.get("error")),
            })
    return out


def recommend(summary: list[dict[str, Any]]) -> dict[str, Any]:
    """Best quality per task; ties broken by cost then latency. Reported as a suggestion with the numbers beside it."""
    rec: dict[str, Any] = {}
    for task in ("extraction", "impact", "memo"):
        rows = [s for s in summary if s["task"] == task and s["errors"] == 0]
        if not rows:
            continue
        best = sorted(rows, key=lambda s: (-s["quality_score"], s["estimated_cost_total"] if s["estimated_cost_total"] is not None else 1e9, s["latency_ms_median"] or 1e9))[0]
        rec[task] = {"model": best["model"], "quality_score": best["quality_score"], "estimated_cost_total": best["estimated_cost_total"], "latency_ms_median": best["latency_ms_median"]}
    return rec


async def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--models", default=settings().eval_models or ",".join(dict.fromkeys([settings().extraction_model, settings().impact_model, settings().memo_model])))
    ap.add_argument("--corpus", default=os.environ.get("EVAL_CORPUS_DIR", str(ROOT.parents[2] / "acme-securities-policies")))
    ap.add_argument("--tasks", default="extraction,impact,memo")
    args = ap.parse_args()
    corpus = Path(args.corpus)
    if not (corpus / "aftercircular.yml").exists():
        print(f"corpus not found at {corpus} (set --corpus or EVAL_CORPUS_DIR to a checkout of the policy repo)", file=sys.stderr)
        return 2

    llm = provider()
    models = [m.strip() for m in args.models.split(",") if m.strip()] if llm.name != "stub" else ["stub-fixture"]
    tasks = {t.strip() for t in args.tasks.split(",")}
    db = StateStore(":memory:")
    manifest, chunks = load_local_corpus(corpus)
    vectors = await llm.embed([c["text"] for c in chunks])
    for i, c in enumerate(chunks):
        c["embedding"] = vectors[i] if vectors else None
    db.replace_policy_chunks("eval", str(corpus), "local", chunks)
    ret = LocalRetriever(db)
    from app.schemas.actions import TenantContext

    profile = company_profile(manifest, TenantContext(tenant_id="eval", company_name=manifest["company"]["short_name"], github_repo="local"))

    rows: list[dict[str, Any]] = []
    t0 = time.time()
    for model in models:
        for sc in load_scenarios():
            print(f"[{model}] {sc['id']} ...", end=" ", flush=True)
            row = await run_scenario(llm, ret, sc, None if model == "stub-fixture" else model, profile, tasks)  # type: ignore[arg-type]
            row["model"] = model
            imp = row["tasks"].get("impact", {})
            print(f"extraction={row['tasks']['extraction'].get('json_valid')} impact={imp.get('applicability')}/{imp.get('alignment')} err={imp.get('error') or row['tasks']['extraction'].get('error')}")
            rows.append(row)

    summary = summarize(rows)
    report = {
        "generated_at": datetime.now(timezone.utc).isoformat(), "provider": llm.name, "models": models, "scenarios": [s["id"] for s in load_scenarios()],
        "retrieval": "local-hybrid" + (" (vector+keyword)" if vectors else " (keyword only — no embedding model)"),
        "duration_s": round(time.time() - t0, 1), "scoring": __doc__.split("Scoring")[1].strip(), "summary": summary, "recommendation": recommend(summary), "runs": rows,
    }
    if llm.name == "stub":
        report["warning"] = "Provider is 'stub': outputs are fixtures, not model calls. These numbers measure the harness, not any model."
    RESULTS.mkdir(exist_ok=True)
    name = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ") + ".json"
    (RESULTS / name).write_text(json.dumps(report, indent=2), encoding="utf-8")
    (RESULTS / "latest.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(f"\nwrote evals/results/{name}")
    for s in summary:
        print(f"  {s['model']:<24} {s['task']:<11} quality={s['quality_score']:<6} json={s['json_valid_rate']:<5} evidence={s['evidence_accuracy']} latency={s['latency_ms_median']}ms cost={s['estimated_cost_total']} errors={s['errors']}")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
