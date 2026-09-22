"""Staged live verification against real Azure — one bounded call per step, run ONE step at a time.

    uv run python scripts/live_check.py smoke      # TEST 1: one minimal Foundry Responses call (~50 tokens)
    uv run python scripts/live_check.py extract    # TEST 2: one real obligation extraction (DEMO-2026-014 snapshot text)
    uv run python scripts/live_check.py embed      # one embedding call (needed by search)
    uv run python scripts/live_check.py search     # TEST 3: upsert the Acme corpus into the shared index (tenant_id=live-check) + one hybrid query
    uv run python scripts/live_check.py jev        # TEST 4: one Jev applicability judgment
    uv run python scripts/live_check.py impact     # TEST 5: one Foundry impact-reasoning call (TOON context)
    uv run python scripts/live_check.py memo       # TEST 6: one memo call
    uv run python scripts/live_check.py toon-live  # TEST 11b: same impact payload as TOON and compact JSON, 2 calls
    uv run python scripts/live_check.py sebi       # SEBI CONNECTOR CHECK: real listing → one real circular page → real PDF → text (no model calls)

Every step prints tokens / cached tokens / latency / estimated cost from the real response and exits non-zero on failure.
The end-to-end tests (TEST 7–10) go through the running API: see azureDecision.md §14. Nothing here retries beyond the
provider's bounded policy, nothing loops, nothing runs more than the calls listed above.
"""

from __future__ import annotations

import asyncio
import json
import sys
import time
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[1] / ".env")

from app.config import settings  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
SNAPSHOT = ROOT / "data" / "snapshot" / "demo-014-index-position-limits.json"
CORPUS = ROOT.parents[1] / "acme-securities-policies"


def _need(cond: bool, msg: str) -> None:
    if not cond:
        print(f"BLOCKED: {msg}")
        sys.exit(2)


def _print(res) -> None:
    print(json.dumps({"model": res.model, "provider": res.provider, "latency_ms": res.latency_ms, "input_tokens": res.input_tokens,
                      "output_tokens": res.output_tokens, "cached_tokens": res.cached_tokens, "estimated_cost_usd": res.estimated_cost_usd,
                      "context_format": res.context_format, "structured_mode": res.structured_mode, "attempts": res.attempts}, indent=1))


def _doc():
    from app.schemas.regulatory import RegulatoryDocument

    raw = json.loads(SNAPSHOT.read_text(encoding="utf-8"))
    return RegulatoryDocument(source=raw["source"], jurisdiction=raw["jurisdiction"], document_id=raw["document_id"], circular_number=raw["circular_number"],
                              title=raw["title"], url=raw["url"], content=raw["content"], published_date=raw.get("published_date"),
                              effective_date=raw.get("effective_date")).with_hash()


def _fixture(task: str):
    from evals.dataset import load_scenarios

    for sc in load_scenarios():
        if sc["document"]["document_id"] == "DEMO-2026-014":
            return sc["fixtures"][task]
    raise SystemExit("scenario fixture missing")


async def smoke() -> None:
    from pydantic import BaseModel

    from app.models.provider import FoundryProvider

    class Ping(BaseModel):
        ok: bool
        echo: str

    s = settings()
    _need(s.foundry_configured, "FOUNDRY_ENDPOINT not set in backend/.env")
    print(f"endpoint={s.foundry_endpoint.rstrip('/')}/openai/v1/ api={s.foundry_api} auth={'api-key' if s.foundry_api_key else 'entra-id'} "
          f"deployments: extraction={s.extraction_model} impact={s.impact_model} memo={s.memo_model}")
    p = FoundryProvider()
    try:
        obj, res = await p.structured("extraction", "Reply with ok=true and echo the user's word.", "aftercircular", Ping)
    finally:
        await p.aclose()
    print("parsed:", obj.model_dump())
    _print(res)
    _need(obj.ok and "aftercircular" in obj.echo.lower(), "unexpected smoke output")
    _need(res.structured_mode == "json_schema", f"strict structured output not in effect (mode={res.structured_mode}); the schema was rejected — see log")
    _need(res.input_tokens is not None and res.output_tokens is not None, "usage/telemetry missing from the response")
    (ROOT / "evals" / "results").mkdir(exist_ok=True)
    (ROOT / "evals" / "results" / "live_smoke.json").write_text(res.model_dump_json(indent=2), encoding="utf-8")
    print("OK: Entra auth, deployment reachable, strict structured output, telemetry recorded → evals/results/live_smoke.json")


async def extract() -> None:
    from app.agents.obligation_extraction import extract_obligations
    from app.models.provider import FoundryProvider

    _need(settings().foundry_configured, "FOUNDRY_ENDPOINT not set")
    p = FoundryProvider()
    try:
        ext, res = await extract_obligations(p, _doc())
    finally:
        await p.aclose()
    print(f"{len(ext.obligations)} obligations; applies_to={ext.applies_to}; effective={ext.effective_date}")
    for o in ext.obligations:
        print(f" - [{o.affected_area}] {o.requirement[:110]} (§{o.evidence.section})")
    _print(res)
    (ROOT / "evals" / "results").mkdir(exist_ok=True)
    (ROOT / "evals" / "results" / "live_extraction_demo014.json").write_text(ext.model_dump_json(indent=2), encoding="utf-8")
    _need(len(ext.obligations) >= 1, "no obligations extracted")


async def embed() -> None:
    from app.models.provider import FoundryProvider

    _need(settings().foundry_configured, "FOUNDRY_ENDPOINT not set")
    t0 = time.perf_counter()
    p = FoundryProvider()
    try:
        vec = await p.embed(["client-level position limits for index derivatives"])
    finally:
        await p.aclose()
    _need(vec is not None, "embedding call failed (see log)")
    assert vec is not None
    print(f"embedding dims={len(vec[0])} latency_ms={int((time.perf_counter() - t0) * 1000)} model={settings().embedding_model}")


async def search() -> None:
    """Shared index `AZURE_SEARCH_INDEX`, tenant_id='live-check'. Upserts the local Acme corpus once (one embedding batch if
    Foundry is configured), then runs ONE hybrid query with the tenant filter."""
    from app.models.provider import FoundryProvider
    from app.retrieval.azure_search import AzureSearchRetriever

    s = settings()
    _need(s.search_configured, "AZURE_SEARCH_ENDPOINT not set")
    _need(CORPUS.exists(), f"local corpus not found at {CORPUS}")
    ret = AzureSearchRetriever()
    llm = FoundryProvider() if s.foundry_configured else None
    tenant = "live-check"
    print(f"index={ret.index_name} dims={ret.dims} auth={'api-key' if s.azure_search_api_key else 'entra-id'}")
    try:
        await _search_body(ret, llm, tenant)
    finally:
        # leave the shared index holding only the real tenant corpora: the check's fixture rows are removed again
        from app.retrieval.azure_search import tenant_filter

        ids = [r["id"] for r in ret.client.search(search_text="*", filter=tenant_filter(tenant, status=None), select=["id"], top=1000)]
        if ids:
            ret.client.delete_documents([{"id": i} for i in ids])
            print(f"cleaned up {len(ids)} fixture chunks for tenant_id={tenant}")
        if llm:
            await llm.aclose()


async def _search_body(ret, llm, tenant: str) -> None:
    import yaml

    from app.services.policies import chunk_markdown, enrich_chunks, parse_front_matter

    if not await ret.is_ready(tenant):
        manifest = yaml.safe_load((CORPUS / "aftercircular.yml").read_text(encoding="utf-8"))
        chunks: list[dict] = []
        docs: list[dict] = []
        for d in manifest.get("documents", []):
            meta, body = parse_front_matter((CORPUS / d["path"]).read_text(encoding="utf-8"))
            doc_id, title = str(meta.get("doc_id", d["id"])), str(meta.get("title", d.get("title", d["id"])))
            version = str(meta["version"]) if meta.get("version") is not None else None
            chunks += chunk_markdown(doc_id, title, d["path"], version, body)
            docs.append({"doc_id": doc_id, "category": d.get("category"), "effective_date": meta.get("effective_date"), "topics": d.get("topics", [])})
        enrich_chunks(chunks, docs, manifest, "live-check")
        vectors = await llm.embed([c["text"] for c in chunks]) if llm else None
        for i, c in enumerate(chunks):
            c["embedding"] = vectors[i] if vectors else None
        await ret.index(tenant, chunks)
        print(f"upserted {len(chunks)} chunks for tenant_id={tenant} (vectors={'yes' if vectors else 'no'})")
        await asyncio.sleep(2)
    q = "client-level position limits for index derivatives reviewed every six months"
    vec = (await llm.embed([q])) if llm else None
    _need(llm is None or vec is not None, "query embedding failed (check FOUNDRY_ENDPOINT / EMBEDDING_MODEL / RBAC)")
    t0 = time.perf_counter()
    hits = await ret.search(tenant, q, vec[0] if vec else None, k=5)
    print(f"{len(hits)} hits in {int((time.perf_counter() - t0) * 1000)} ms (hybrid={'yes' if vec else 'keyword-only'})")
    for h in hits:
        print(f" - {h.doc_id} §{h.section} score={h.score:.3f} {h.text[:80]!r}")
    _need(any(h.doc_id == "POL-001" for h in hits), "POL-001 not in the top-5 for a position-limits query")


async def jev() -> None:
    from app.decisions import questions as Q
    from app.decisions.providers import TypeSafeJudgmentProvider

    _need(bool(settings().typesafe_api_key), "TYPESAFE_API_KEY not set")
    state = {"company": {"legal_name": "Acme Securities Private Limited", "sector": "securities-broking", "registrations": ["SEBI stock-broker"]},
             "circular": {"title": "Revision of client-level position limits for index derivatives", "applies_to": ["stock brokers"],
                          "summary": "Raises client-level index derivative limits and requires six-monthly review of internal limit frameworks.",
                          "obligations": ["Review the internal position limit policy at least every six months."]}}
    j = await TypeSafeJudgmentProvider().ask("applicability", state, Q.applicability_questions())
    print(json.dumps({k: v.model_dump(exclude_none=True) for k, v in j.answers.items()}, indent=1))
    print(f"model={j.model} calibrated={j.calibrated} latency_ms={j.latency_ms} in={j.input_tokens} out={j.output_tokens}")


async def impact() -> None:
    from app.agents.impact_analysis import analyze_impact
    from app.models.provider import FoundryProvider
    from app.schemas.impact import PolicyChunk
    from app.schemas.obligations import ExtractionResult

    _need(settings().foundry_configured, "FOUNDRY_ENDPOINT not set")
    ext = ExtractionResult.model_validate(_fixture("extraction"))
    chunks = [PolicyChunk(chunk_id=f"c{i}", doc_id=e["doc_id"], title="", path="policies/POL-001-position-limits-policy.md", section=e["section"], text=e["text"], score=0.9 - i * 0.1)
              for i, e in enumerate(_fixture("impact")["policy_evidence"])]
    p = FoundryProvider()
    try:
        imp, res = await analyze_impact(p, ext, chunks, "Acme Securities Private Limited — SEBI-registered stock broker (NSE, BSE); cash equity, equity and currency derivatives.")
    finally:
        await p.aclose()
    print(json.dumps(imp.model_dump(), indent=1)[:1500])
    _print(res)
    _need(imp.applicability == "YES" and imp.alignment == "CONFLICT", f"expected YES/CONFLICT, got {imp.applicability}/{imp.alignment}")


async def memo() -> None:
    from app.agents.memo_generation import generate_memo
    from app.models.provider import FoundryProvider
    from app.schemas.impact import ImpactAnalysis, PolicyChunk
    from app.schemas.obligations import ExtractionResult

    _need(settings().foundry_configured, "FOUNDRY_ENDPOINT not set")
    ext = ExtractionResult.model_validate(_fixture("extraction"))
    imp = ImpactAnalysis.model_validate(_fixture("impact"))
    chunks = [PolicyChunk(chunk_id=f"c{i}", doc_id=e.doc_id, title="", path="policies/POL-001-position-limits-policy.md", section=e.section, text=e.text, score=0.9)
              for i, e in enumerate(imp.policy_evidence)]
    p = FoundryProvider()
    try:
        m, res = await generate_memo(p, ext, imp, chunks, document_id="DEMO-2026-014")
    finally:
        await p.aclose()
    print(json.dumps(m.model_dump(), indent=1)[:2000])
    _print(res)
    _need(bool(m.proposed_amendment) and m.disclaimer.startswith("AI-generated"), "memo incomplete")


async def toon_live() -> None:
    """TEST 11b: identical impact payload as TOON and as compact JSON — 2 calls — records tokens, latency, decision."""
    from app.agents.impact_analysis import analyze_impact
    from app.models.provider import FoundryProvider
    from app.schemas.impact import PolicyChunk
    from app.schemas.obligations import ExtractionResult

    _need(settings().foundry_configured, "FOUNDRY_ENDPOINT not set")
    ext = ExtractionResult.model_validate(_fixture("extraction"))
    chunks = [PolicyChunk(chunk_id=f"c{i}", doc_id=e["doc_id"], title="", path="policies/POL-001-position-limits-policy.md", section=e["section"], text=e["text"], score=0.9 - i * 0.1)
              for i, e in enumerate(_fixture("impact")["policy_evidence"])]
    profile = "Acme Securities Private Limited — SEBI-registered stock broker (NSE, BSE); cash equity, equity and currency derivatives."
    p = FoundryProvider()
    out = {}
    for fmt in ("toon", "json"):
        settings().toon_context = fmt == "toon"
        imp, res = await analyze_impact(p, ext, chunks, profile)
        out[fmt] = {"input_tokens": res.input_tokens, "output_tokens": res.output_tokens, "cached_tokens": res.cached_tokens, "latency_ms": res.latency_ms,
                    "estimated_cost_usd": res.estimated_cost_usd, "applicability": imp.applicability, "alignment": imp.alignment,
                    "affected_policies": imp.affected_policies, "structured_mode": res.structured_mode, "model": res.model}
    await p.aclose()
    print(json.dumps(out, indent=1))
    (ROOT / "evals" / "results").mkdir(exist_ok=True)
    (ROOT / "evals" / "results" / "toon_live.json").write_text(json.dumps(out, indent=2), encoding="utf-8")


async def sebi() -> None:
    """Real request to the official SEBI site: listing, then ONE circular page and its PDF. Zero model calls."""
    from app.connectors.sebi import LISTING_URL, SEBIConnector

    c = SEBIConnector(mode="live")
    health = await c.check()
    print("SEBI CONNECTOR CHECK\n--------------------")
    print(f"mode: {c.mode.upper()}\nlisting: {'OK' if health['status'] == 'LIVE' else 'FAILED'} ({LISTING_URL}, {health.get('latency_ms')} ms)")
    _need(health["status"] == "LIVE", f"listing failed: {health.get('error')}")
    print(f"circulars discovered: {health['circulars_discovered']}\n")
    res = await c.fetch_documents(1)
    _need(res.status in ("LIVE_SUCCESS", "LIVE_PARTIAL"), f"fetch failed: {res.error}")
    d = res.documents[0]
    print("selected circular:")
    print(f"date: {d.published_date}\ntitle: {d.title}\nreference: {d.circular_number or 'n/a'}\ndetail: OK ({d.url})\npdf: OK ({d.document_url})")
    print(f"pdf_bytes: {d.document_bytes}\ntext_extraction: OK\ntext_chars: {len(d.content)}\ncontent_hash: {d.content_hash[:16]}…")
    print(f"source_mode: {d.source_mode}\nsynthetic: {str(d.synthetic).lower()}\nfetched_at: {d.fetched_at.isoformat()}")
    if res.warnings:
        print("warnings:", *res.warnings, sep="\n  ")
    (ROOT / "evals" / "results").mkdir(exist_ok=True)
    (ROOT / "evals" / "results" / "live_sebi.json").write_text(json.dumps({**health, "document": {k: v for k, v in d.model_dump(mode="json").items() if k != "content"}, "text_preview": d.content[:600]}, indent=2), encoding="utf-8")


STEPS = {"sebi": sebi, "smoke": smoke, "extract": extract, "embed": embed, "search": search, "jev": jev, "impact": impact, "memo": memo, "toon-live": toon_live}

if __name__ == "__main__":
    step = sys.argv[1] if len(sys.argv) > 1 else ""
    if step not in STEPS:
        print(__doc__)
        sys.exit(1)
    try:
        asyncio.run(STEPS[step]())
    except Exception as e:  # noqa: BLE001 — one line, no traceback wall; the provider already bounded retries
        msg = str(e)
        hint = ""
        if "DeploymentNotFound" in msg:
            hint = " → deploy the chat model in Foundry and set EXTRACTION_MODEL/IMPACT_MODEL/MEMO_MODEL to its deployment name"
        elif "401" in msg or "403" in msg or "PermissionDenied" in msg:
            hint = " → check `az login` and the Cognitive Services OpenAI User role on the Foundry resource"
        print(f"FAILED ({type(e).__name__}): {msg[:300]}{hint}")
        sys.exit(1)
