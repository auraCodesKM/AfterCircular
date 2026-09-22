"""Architecture proof panel — GET /api/system. Every value is read from configuration *and* from what actually ran
(llm_calls, decisions, scans, the Azure AI Search index). Configuration alone never shows as "connected"; a service is
"connected" only when a successful call is on record."""

from __future__ import annotations

import asyncio
from typing import Any

from fastapi import APIRouter, Depends

from app.api.deps import db, tenant
from app.config import settings
from app.schemas.actions import TenantContext
from app.services.state import StateStore, now

router = APIRouter()


def _row(s: StateStore, sql: str, args: tuple[Any, ...] = ()) -> dict[str, Any]:
    r = s.conn.execute(sql, args).fetchone()
    return dict(r) if r else {}


@router.get("/system")
async def system(t: TenantContext = Depends(tenant), s: StateStore = Depends(db)) -> dict[str, Any]:
    cfg = settings()
    day = now().replace(hour=0, minute=0, second=0, microsecond=0).isoformat()
    f = _row(s, "SELECT COUNT(*) AS n, MAX(created_at) AS last_at, SUM(CASE WHEN ok=0 THEN 1 ELSE 0 END) AS errors FROM llm_calls WHERE provider='foundry' AND task IN ('extraction','impact','memo','ask','ask_web')")
    f_today = _row(s, "SELECT COUNT(*) AS n, SUM(estimated_cost_usd) AS cost FROM llm_calls WHERE provider='foundry' AND created_at >= ?", (day,))
    f_last = _row(s, "SELECT model, response_id, task, created_at, structured_mode FROM llm_calls WHERE provider='foundry' AND ok=1 ORDER BY created_at DESC LIMIT 1")
    j = _row(s, "SELECT COUNT(*) AS n, MAX(created_at) AS last_at, MAX(model) AS model FROM decisions WHERE provider='typesafe'")
    j_today = _row(s, "SELECT COUNT(*) AS n FROM decisions WHERE provider='typesafe' AND created_at >= ?", (day,))
    scan = s.latest_scan(t.tenant_id)
    live_scan = _row(s, "SELECT finished_at, source_status, new_documents FROM scans WHERE tenant_id=? AND source_mode='LIVE' AND status='COMPLETED' ORDER BY finished_at DESC LIMIT 1", (t.tenant_id,))
    live_docs = _row(s, "SELECT COUNT(*) AS n, MAX(fetched_at) AS last_fetch FROM processed_documents WHERE tenant_id=? AND source_mode='LIVE'", (t.tenant_id,))
    meta = s.policy_index_meta(t.tenant_id) or {}
    retr = _row(s, "SELECT COUNT(*) AS n FROM analyses WHERE tenant_id=? AND json_extract(metrics,'$.retrieval.backend')='azure-ai-search'", (t.tenant_id,))
    search: dict[str, Any] = {"configured": cfg.search_configured, "service": cfg.azure_search_endpoint or None, "index": cfg.azure_search_index if cfg.search_configured else None,
                              "retrieval": "hybrid: BM25 + vector (HNSW cosine), RRF", "semantic_ranker": bool(cfg.azure_search_semantic_config),
                              "tenant_filter": "tenant_id eq '<tenant>' and status eq 'active'", "indexed_commit": meta.get("commit_sha"), "indexed_at": meta.get("indexed_at"),
                              "chunks_recorded": meta.get("chunk_count"), "analyses_retrieved": retr.get("n", 0), "documents_in_index": None}
    if cfg.search_configured:
        try:
            from app.retrieval.azure_search import AzureSearchRetriever, tenant_filter

            ret = AzureSearchRetriever()
            search["documents_in_index"] = await asyncio.to_thread(lambda: ret.client.search(search_text="*", filter=tenant_filter(t.tenant_id, status=None), top=0, include_total_count=True).get_count())
            search["connected"] = True
        except Exception as e:  # noqa: BLE001
            search["connected"] = False
            search["error"] = f"{type(e).__name__}: {str(e)[:120]}"
    emb = _row(s, "SELECT COUNT(*) AS n FROM analyses WHERE tenant_id=? AND json_extract(metrics,'$.retrieval.vector')=1", (t.tenant_id,))
    return {
        "at": now().isoformat(),
        "foundry": {"configured": cfg.foundry_configured, "connected": bool(f.get("n")) and bool(f_last), "endpoint_host": cfg.foundry_endpoint.split("//")[-1].split("/")[0] if cfg.foundry_endpoint else None,
                    "resource": "aif-aftercircular-dev", "project": "proj-aftercircular-dev", "api": cfg.foundry_api, "auth": "api-key" if cfg.foundry_api_key else "entra-id",
                    "deployments": {"extraction": cfg.extraction_model, "impact": cfg.impact_model, "memo": cfg.memo_model}, "requests_total": f.get("n", 0), "errors_total": f.get("errors") or 0,
                    "requests_today": f_today.get("n", 0), "estimated_cost_today_usd": round(f_today.get("cost") or 0.0, 6), "last_request_at": f.get("last_at"), "last_response_id": f_last.get("response_id"),
                    "last_task": f_last.get("task"), "last_structured_mode": f_last.get("structured_mode")},
        "embeddings": {"model": cfg.embedding_model, "dimensions": cfg.embedding_dimensions, "connected": bool(emb.get("n")) or bool(meta.get("chunk_count")), "analyses_with_vector_query": emb.get("n", 0)},
        "search": search,
        "jev": {"configured": bool(cfg.typesafe_api_key), "connected": bool(j.get("n")), "model": j.get("model"), "role": "reasoning support", "decisions_total": j.get("n", 0), "decisions_today": j_today.get("n", 0), "last_at": j.get("last_at")},
        "sebi": {"mode": cfg.sebi_mode, "live": cfg.sebi_mode == "live", "last_live_scan_at": live_scan.get("finished_at"), "last_live_status": live_scan.get("source_status"), "live_documents": live_docs.get("n", 0),
                 "last_fetch_at": live_docs.get("last_fetch"), "curated_entry_ids": cfg.sebi_selected_ids, "latest_scan_status": scan.status if scan else None},
        "github": {"repo": t.github_repo, "issues_created": _row(s, "SELECT COUNT(*) AS n FROM reviews WHERE tenant_id=? AND ticket_id IS NOT NULL", (t.tenant_id,)).get("n", 0),
                   "awaiting_review": _row(s, "SELECT COUNT(*) AS n FROM reviews WHERE tenant_id=? AND status='AWAITING_REVIEW'", (t.tenant_id,)).get("n", 0)},
    }
