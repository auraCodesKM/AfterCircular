"""Judge evaluation: `python -m evals.judges [--judges typesafe,foundry,stub] [--corpus DIR]`.

Runs the full decision layer (extraction_check → applicability → rerank → alignment → verification → escalation) for every
golden scenario, once per judge, with extraction taken from the scenario fixtures so every judge sees identical input.

Per scenario × judge it records (never invents):
  applicability_ok       decision == expected.applicability
  alignment_ok           decision == expected.alignment (scored only when expected applicability is YES)
  affected_ok            set(affected_policies) == expected
  evidence_verbatim      every regulatory excerpt is verbatim in the circular and every policy excerpt verbatim in the corpus
  rerank_hit             the expected policy section (expected.policy_evidence_sections) survived rerank (when retrieval ran)
  escalated              the judge left the case to the reasoning model / human (reason recorded)
  brier                  (1 - P(expected applicability option))² on the applicability Choice — lower is better; a calibration
                         signal only across many scenarios, meaningless for one
  requests, input_tokens, latency_ms (sum over the case), estimated_cost from evals/pricing.json (null if unpriced)
Aggregates per judge are plain means. With 4 scenarios these are smoke numbers; the harness is built for more.
"""

import argparse
import asyncio
import os
import json
import statistics
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from app.config import settings
from app.decisions import impact as I
from app.decisions.providers import FoundryJudgmentProvider, JudgmentProvider, StubJudgmentProvider, TypeSafeJudgmentProvider
from app.models.provider import StubProvider
from app.retrieval.local import LocalRetriever
from app.schemas.obligations import ExtractionResult
from app.services.policies import company_profile
from app.services.state import StateStore
from evals.dataset import load_scenarios
from evals.run import PRICING, ROOT, RESULTS, load_local_corpus, verbatim

EXPECTED_CHOICE = {"YES": "applies", "NO": "does_not_apply", "UNCERTAIN": "cannot_tell_from_profile"}


def make_judge(name: str) -> JudgmentProvider:
    factory: dict[str, type[JudgmentProvider]] = {"typesafe": TypeSafeJudgmentProvider, "foundry": FoundryJudgmentProvider, "stub": StubJudgmentProvider}
    return factory[name]()


async def run_case(judge: JudgmentProvider, sc: dict[str, Any], ret: LocalRetriever, manifest: dict[str, Any], profile: str, corpus_text: str) -> dict[str, Any]:
    I.judge_for = lambda task: judge  # type: ignore[assignment]
    doc, exp = sc["document"], sc["expected"]
    extraction = ExtractionResult.model_validate(sc["fixtures"]["extraction"])
    query = " ".join([extraction.summary, *(o.requirement for o in extraction.obligations[:6])])[:2000]
    candidates = await ret.search("eval", query, None, k=10)
    t0 = time.perf_counter()
    d = await I.decide_impact(analysis_id=f"eval-{sc['id']}", tenant_id="eval", document_id=doc["document_id"], extraction=extraction, circular_text=doc["content"],
                              candidates=candidates, manifest=manifest, company_name=manifest["company"]["short_name"], profile=profile, llm=StubProvider())
    wall = int((time.perf_counter() - t0) * 1000)
    imp = d.impact
    model_recs = [r for r in d.records if r.provider not in ("code",)]
    app_rec = next((r for r in d.records if r.stage == "applicability" and r.answers), None)
    p_expected = (app_rec.answers["applicability"].probabilities or {}).get(EXPECTED_CHOICE[exp["applicability"]], 0.0) if app_rec else None
    kept = {c.chunk_id for c in d.kept_chunks}
    wanted = {s.replace(" §", "#") for s in exp.get("policy_evidence_sections", [])}
    tokens = sum(r.input_tokens or 0 for r in model_recs)
    models = sorted({r.model for r in model_recs})
    price = next((PRICING.get(m) for m in models if PRICING.get(m)), None)
    return {
        "scenario": sc["id"], "judge": judge.name, "models": models, "calibrated": judge.calibrated,
        "applicability": imp.applicability if imp else None, "alignment": imp.alignment if imp else None,
        "applicability_ok": bool(imp and imp.applicability == exp["applicability"]),
        "alignment_ok": (imp.alignment == exp["alignment"]) if (imp and exp["applicability"] == "YES") else None,
        "affected_ok": bool(imp and set(imp.affected_policies) == set(exp.get("affected_policies", []))),
        "evidence_verbatim": bool(imp and all(verbatim(e.text, doc["content"]) for e in imp.regulatory_evidence) and all(verbatim(e.text, corpus_text) for e in imp.policy_evidence)),
        "rerank_hit": (bool(wanted & kept) if wanted and d.kept_chunks else None),
        "escalated": d.escalation_reason is not None, "escalation_reason": d.escalation_reason,
        "brier": round((1 - p_expected) ** 2, 4) if p_expected is not None else None,
        "path": d.path, "requests": len(model_recs), "input_tokens": tokens, "latency_ms": sum(r.latency_ms for r in model_recs), "wall_ms": wall,
        "estimated_cost": round(tokens * price["input"] / 1_000_000, 6) if price else None,
    }


def summarize(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    out = []
    for judge in sorted({r["judge"] for r in rows}):
        rs = [r for r in rows if r["judge"] == judge]
        def mean(key):
            v = [r[key] for r in rs if r[key] is not None]
            return round(statistics.mean(v), 3) if v else None
        out.append({"judge": judge, "models": sorted({m for r in rs for m in r["models"]}), "calibrated": rs[0]["calibrated"], "cases": len(rs),
                    "applicability_accuracy": mean("applicability_ok"), "alignment_accuracy": mean("alignment_ok"), "affected_accuracy": mean("affected_ok"),
                    "evidence_verbatim_rate": mean("evidence_verbatim"), "rerank_hit_rate": mean("rerank_hit"), "escalation_rate": mean("escalated"),
                    "brier_mean": mean("brier"), "requests_per_case": mean("requests"), "input_tokens_per_case": mean("input_tokens"),
                    "latency_ms_per_case": mean("latency_ms"), "estimated_cost_per_case": mean("estimated_cost")})
    return out


async def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--judges", default="typesafe,stub")
    ap.add_argument("--corpus", default=os.environ.get("EVAL_CORPUS_DIR", str(ROOT.parents[2] / "acme-securities-policies")))
    args = ap.parse_args()
    corpus = Path(args.corpus)
    if not (corpus / "aftercircular.yml").exists():
        print(f"corpus not found at {corpus}", file=sys.stderr)
        return 2
    manifest, chunks = load_local_corpus(corpus)
    corpus_text = "\n".join(c["text"] for c in chunks)
    db = StateStore(":memory:")
    db.replace_policy_chunks("eval", str(corpus), "local", chunks)
    ret = LocalRetriever(db)
    from app.schemas.actions import TenantContext

    profile = company_profile(manifest, TenantContext(tenant_id="eval", company_name=manifest["company"]["short_name"], github_repo="local"))
    rows = []
    for name in [j.strip() for j in args.judges.split(",") if j.strip()]:
        if name == "typesafe" and not settings().typesafe_api_key:
            print("skipping typesafe: TYPESAFE_API_KEY not set")
            continue
        if name == "foundry" and not settings().foundry_configured:
            print("skipping foundry: FOUNDRY_ENDPOINT not set")
            continue
        judge = make_judge(name)
        for sc in load_scenarios():
            row = await run_case(judge, sc, ret, manifest, profile, corpus_text)
            rows.append(row)
            print(f"[{name:8}] {sc['id']:<42} {row['applicability']}/{row['alignment']} ok={row['applicability_ok']}/{row['alignment_ok']} esc={row['escalated']} req={row['requests']} tok={row['input_tokens']} {row['latency_ms']}ms")
        await judge.aclose()
    summary = summarize(rows)
    report = {"generated_at": datetime.now(timezone.utc).isoformat(), "scenarios": [s["id"] for s in load_scenarios()], "thresholds": I.thresholds(),
              "scoring": __doc__.split("Per scenario")[1].strip(), "summary": summary, "runs": rows,
              "note": "Stub rows measure the harness only. Brier is a calibration signal across many cases, not a per-case score."}
    RESULTS.mkdir(exist_ok=True)
    (RESULTS / "judges-latest.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    (RESULTS / f"judges-{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    print("\nwrote evals/results/judges-latest.json")
    for s in summary:
        print(f"  {s['judge']:<9} applicability={s['applicability_accuracy']} alignment={s['alignment_accuracy']} affected={s['affected_accuracy']} evidence={s['evidence_verbatim_rate']} rerank={s['rerank_hit_rate']} escalation={s['escalation_rate']} brier={s['brier_mean']} req/case={s['requests_per_case']} tok/case={s['input_tokens_per_case']} cost/case={s['estimated_cost_per_case']}")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
