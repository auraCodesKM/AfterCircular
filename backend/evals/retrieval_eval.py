"""Azure AI Search reality check — real hybrid queries against `policies-dev` for both tenants.

    uv run python -m evals.retrieval_eval

1. retrieval quality: for each demo scenario, does the expected policy appear in the top-k (hybrid BM25 + vector + RRF)?
2. tenant isolation: every hit carries the queried tenant's id, including for queries written to attract the *other* tenant's corpus;
3. embedding reality: a stored chunk's vector is 1536-d and its `chunk_hash` equals the hash of the current text, and the
   index commit equals the repository HEAD recorded at indexing time.
Writes evals/results/retrieval_eval.{json,md}. Nothing is tuned here; results are recorded as they come.
"""

from __future__ import annotations

import asyncio
import json
from datetime import UTC, datetime
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[1] / ".env")

from app.config import settings  # noqa: E402
from app.models.provider import provider  # noqa: E402
from app.retrieval.azure_search import AzureSearchRetriever, tenant_filter  # noqa: E402
from app.services.policies import chunk_hash  # noqa: E402
from app.services.state import store  # noqa: E402

ACME = "acme-securities-pvt-ltd-181441765"
NIMBUS = "nimbus-asset-management-181441765"
CASES = [
    (ACME, "client unpaid securities pledge payment period trading days", "POL-001"),
    (ACME, "cyber incident reporting to SEBI portal within hours", "POL-002"),
    (ACME, "position limits exposure derivatives risk", "POL-003"),
    (ACME, "standing instructions demat account depository participant", "POL-005"),
    (NIMBUS, "intraday borrowing by a scheme to meet redemptions", "POL-001"),
    (NIMBUS, "distributor NISM certification specialized investment fund", "POL-002"),
    (NIMBUS, "cyber incident reporting", "POL-003"),
    (NIMBUS, "SWP STP standing instructions demat units", "POL-004"),
]
# written to attract the other tenant's corpus: the filter must still hold
LEAK = [(ACME, "distributor NISM certification specialized investment fund scheme"), (NIMBUS, "client unpaid securities pledge trading member")]


async def main() -> None:
    s = settings()
    ret = AzureSearchRetriever()
    llm = provider()
    db = store()
    out: dict = {"at": datetime.now(UTC).isoformat(), "service": s.azure_search_endpoint, "index": s.azure_search_index, "embedding_model": s.embedding_model,
                 "dimensions": s.embedding_dimensions, "method": "hybrid: BM25 + vector (HNSW cosine) fused by RRF; semantic ranker not configured", "quality": [], "isolation": [], "embedding": {}}
    for tenant, q, expected in CASES:
        vec = await llm.embed([q])
        hits = await ret.search(tenant, q, vec[0] if vec else None, k=5)
        out["quality"].append({"tenant": tenant, "query": q, "expected": expected, "hit": expected in [h.doc_id for h in hits],
                               "rank": next((i + 1 for i, h in enumerate(hits) if h.doc_id == expected), None), "vector": bool(vec),
                               "top": [{"doc_id": h.doc_id, "section": h.section, "path": h.path, "score": round(h.score, 5), "commit": h.commit_sha} for h in hits]})
    for tenant, q in LEAK:
        vec = await llm.embed([q])
        rows = await asyncio.to_thread(lambda: list(ret.client.search(search_text=q, filter=tenant_filter(tenant), top=10, select=["id", "tenant_id", "doc_id"])))
        out["isolation"].append({"tenant": tenant, "query": q, "results": len(rows), "foreign_rows": [r["id"] for r in rows if r["tenant_id"] != tenant], "doc_ids": sorted({r["doc_id"] for r in rows})})
    # embedding reality: the vector field is not retrievable (by design), so re-embed the chunk's *current* text and run a pure
    # vector query — the stored vector must be the nearest neighbour of its own text. Also re-hash the text against chunk_hash.
    def _pick() -> dict:
        r = next(iter(ret.client.search(search_text="*", filter=tenant_filter(ACME), top=1, select=["id", "doc_id", "section", "text", "chunk_hash", "commit_sha"])))
        return dict(r)
    try:
        r = await asyncio.to_thread(_pick)
        vecs = await llm.embed([r["text"]])
        if not vecs:
            raise RuntimeError("embedding returned nothing")
        qv: list[float] = vecs[0]
        from azure.search.documents.models import VectorizedQuery
        rows = await asyncio.to_thread(lambda: list(ret.client.search(search_text=None, vector_queries=[VectorizedQuery(vector=qv, k_nearest_neighbors=3, fields="vector")],
                                                                      filter=tenant_filter(ACME), top=3, select=["id"])))
        emb = {"id": r["id"], "doc_id": r["doc_id"], "section": r["section"], "stored_chunk_hash": r["chunk_hash"], "recomputed_chunk_hash": chunk_hash(r["text"]), "commit": r["commit_sha"],
               "query_vector_dims": len(qv), "nearest_by_vector": [(x["id"], round(x["@search.score"], 5)) for x in rows],
               "self_is_nearest": bool(rows) and rows[0]["id"] == r["id"]}
        meta = db.policy_index_meta(ACME) or {}
        emb["index_meta_commit"] = meta.get("commit_sha")
        emb["hash_matches"] = emb["stored_chunk_hash"] == emb["recomputed_chunk_hash"]
        emb["commit_matches_index_meta"] = emb["commit"] == meta.get("commit_sha")
    except Exception as e:  # noqa: BLE001
        emb = {"error": f"{type(e).__name__}: {str(e)[:200]}"}
    out["embedding"] = emb
    def _count(t: str) -> int:
        return int(ret.client.search(search_text="*", filter=tenant_filter(t, status=None), top=0, include_total_count=True).get_count() or 0)

    counts = {t: await asyncio.to_thread(_count, t) for t in (ACME, NIMBUS)}
    out["document_counts"] = counts
    if hasattr(llm, "aclose"):
        await llm.aclose()
    d = Path(__file__).parent / "results"
    d.mkdir(exist_ok=True)
    (d / "retrieval_eval.json").write_text(json.dumps(out, indent=2))
    lines = [f"# Azure AI Search retrieval evaluation — {out['at']}", "", f"Service `{out['service']}` · index `{out['index']}` · {out['method']} · embeddings {out['embedding_model']} ({out['dimensions']}-d)", "",
             f"Documents in index: " + ", ".join(f"{k.split('-1')[0]}={v}" for k, v in counts.items()), "", "## Retrieval quality", "", "| tenant | query | expected | hit | rank | top-3 |", "|---|---|---|:--:|---:|---|"]
    for c in out["quality"]:
        lines.append(f"| {c['tenant'].split('-1')[0]} | {c['query']} | {c['expected']} | {'✓' if c['hit'] else '✗'} | {c['rank'] or '-'} | " + "; ".join(f"{h['doc_id']} §{h['section']} ({h['score']})" for h in c["top"][:3]) + " |")
    lines += ["", f"Expected policy in top-5: **{sum(c['hit'] for c in out['quality'])}/{len(out['quality'])}**", "", "## Tenant isolation", "", "| tenant filter | cross-tenant bait query | results | foreign rows | doc ids |", "|---|---|---:|---:|---|"]
    for c in out["isolation"]:
        lines.append(f"| {c['tenant'].split('-1')[0]} | {c['query']} | {c['results']} | **{len(c['foreign_rows'])}** | {', '.join(c['doc_ids'])} |")
    lines += ["", "## Embedding / index reality", "", "```json", json.dumps(emb, indent=2), "```"]
    (d / "retrieval_eval.md").write_text("\n".join(lines) + "\n")
    print("\n".join(lines))


if __name__ == "__main__":
    asyncio.run(main())
