"""Azure AI Search: ONE index per environment (`AZURE_SEARCH_INDEX`, e.g. policies-dev), tenants isolated by the
filterable `tenant_id` field. Schema = docs/azure/policies-dev.index.json (the code carries the same definition and only
creates the index when it does not exist; it never rewrites an existing index).

Hybrid = BM25 keyword (`title`, `text`) + HNSW vector (`vector`, cosine) in one request, fused server-side with Reciprocal
Rank Fusion. Every tenant-scoped call carries `tenant_id eq '<tenant>' and status eq 'active'`. Optional semantic
reranking (L2) when AZURE_SEARCH_SEMANTIC_CONFIG names a configuration — billed per query, so opt-in and measured.
Auth: API key when AZURE_SEARCH_API_KEY is set, else DefaultAzureCredential (Search Index Data Contributor on the service,
plus Search Service Contributor only if the index must be created by the app)."""

import asyncio
import hashlib
import logging
import re
from typing import Any

from azure.core.credentials import AzureKeyCredential
from azure.core.exceptions import ResourceNotFoundError
from azure.search.documents import SearchClient
from azure.search.documents.indexes import SearchIndexClient
from azure.search.documents.indexes.models import (
    HnswAlgorithmConfiguration,
    HnswParameters,
    SearchableField,
    SearchField,
    SearchIndex,
    SimpleField,
    VectorSearch,
    VectorSearchProfile,
)
from azure.search.documents.models import VectorizedQuery, VectorQuery

from app.config import settings
from app.retrieval.base import Retriever
from app.schemas.impact import PolicyChunk

log = logging.getLogger(__name__)

SELECT = ["id", "doc_id", "title", "path", "version", "section", "text", "commit_sha", "chunk_hash"]
# every field the index carries besides the key and the vector; upload sends exactly these (docs/azure/policies-dev.index.json)
METADATA = ["tenant_id", "doc_id", "title", "category", "path", "version", "effective_date", "status", "section", "regulator",
            "jurisdiction", "topics", "commit_sha", "chunk_hash", "text"]


def document_key(tenant_id: str, chunk_id: str) -> str:
    """Azure keys allow letters, digits, `_ - =`. Readable prefix + hash suffix so sanitizing can never merge two chunks."""
    raw = f"{tenant_id}|{chunk_id}"
    return re.sub(r"[^A-Za-z0-9_\-=]", "_", raw)[:96] + "-" + hashlib.sha1(raw.encode("utf-8")).hexdigest()[:10]


def tenant_filter(tenant_id: str, status: str | None = "active") -> str:
    tid = tenant_id.replace("'", "''")
    return f"tenant_id eq '{tid}'" + (f" and status eq '{status}'" if status else "")


def index_definition(name: str, dims: int) -> SearchIndex:
    """The policies-<env> schema — identical to docs/azure/policies-dev.index.json (which was serialized from this)."""
    S, D = "Edm.String", "Edm.DateTimeOffset"
    fields = [
        SimpleField(name="id", type=S, key=True, filterable=True),
        SimpleField(name="tenant_id", type=S, filterable=True, facetable=True),
        SimpleField(name="doc_id", type=S, filterable=True, facetable=True),
        SearchableField(name="title", type=S, analyzer_name="en.microsoft"),
        SimpleField(name="category", type=S, filterable=True, facetable=True),
        SimpleField(name="path", type=S),
        SimpleField(name="version", type=S, filterable=True),
        SimpleField(name="effective_date", type=D, filterable=True, sortable=True),
        SimpleField(name="status", type=S, filterable=True, facetable=True),
        SimpleField(name="section", type=S),
        SimpleField(name="regulator", type=S, filterable=True, facetable=True),
        SimpleField(name="jurisdiction", type=S, filterable=True, facetable=True),
        SimpleField(name="topics", type="Collection(Edm.String)", filterable=True, facetable=True),
        SimpleField(name="commit_sha", type=S, filterable=True),
        SimpleField(name="chunk_hash", type=S, filterable=True),
        SearchableField(name="text", type=S, analyzer_name="en.microsoft"),
        SearchField(name="vector", type="Collection(Edm.Single)", searchable=True, stored=True, vector_search_dimensions=dims, vector_search_profile_name="hnsw"),
    ]
    vs = VectorSearch(
        algorithms=[HnswAlgorithmConfiguration(name="hnsw-algo", parameters=HnswParameters(m=4, ef_construction=400, ef_search=500, metric="cosine"))],
        profiles=[VectorSearchProfile(name="hnsw", algorithm_configuration_name="hnsw-algo")],
    )
    return SearchIndex(name=name, fields=fields, vector_search=vs)


class AzureSearchRetriever(Retriever):
    name = "azure-ai-search"

    def __init__(self, dims: int | None = None):
        s = settings()
        self.cred: Any
        if s.azure_search_api_key:
            self.cred = AzureKeyCredential(s.azure_search_api_key)
        else:
            from azure.identity import DefaultAzureCredential

            self.cred = DefaultAzureCredential()
        self.endpoint = s.azure_search_endpoint
        self.index_name = s.azure_search_index
        self.semantic = s.azure_search_semantic_config or None
        self.dims = dims or s.embedding_dimensions
        self.idx = SearchIndexClient(self.endpoint, self.cred)
        self.client = SearchClient(self.endpoint, self.index_name, self.cred)
        self._verified = False

    # ---- schema ----------------------------------------------------------------------------------------------------
    def _ensure_index(self) -> None:
        """Existing index: validate the fields the app relies on and leave it alone. Missing: create the full schema."""
        if self._verified:
            return
        try:
            existing = self.idx.get_index(self.index_name)
        except ResourceNotFoundError:
            log.info("creating Azure AI Search index %s (%d dims)", self.index_name, self.dims)
            self.idx.create_index(index_definition(self.index_name, self.dims))
            self._verified = True
            return
        have = {f.name: f for f in existing.fields}
        missing = [f for f in ["id", "tenant_id", "status", "vector", *SELECT] if f not in have]
        if missing:
            raise RuntimeError(f"Azure AI Search index {self.index_name} lacks fields {missing}; see docs/azure/policies-dev.index.json")
        dims = getattr(have["vector"], "vector_search_dimensions", None)
        if dims and dims != self.dims:
            raise RuntimeError(f"index {self.index_name} vector has {dims} dimensions; EMBEDDING_DIMENSIONS={self.dims}")
        self._verified = True

    # ---- ingestion --------------------------------------------------------------------------------------------------
    async def index(self, tenant_id: str, chunks: list[dict[str, Any]]) -> None:
        def _do() -> None:
            self._ensure_index()
            docs = []
            for c in chunks:
                d: dict[str, Any] = {"id": document_key(tenant_id, c["chunk_id"]), "tenant_id": tenant_id}
                for f in METADATA[1:]:
                    d[f] = c.get(f) if f != "topics" else list(c.get("topics") or [])
                d["status"] = c.get("status") or "active"
                if c.get("embedding") is not None:
                    d["vector"] = c["embedding"]
                docs.append(d)
            if docs:
                for i in range(0, len(docs), 500):  # batch limit is 1000; stay well under
                    self.client.merge_or_upload_documents(docs[i : i + 500])
            # chunks that vanished from the repository stay for audit, marked retired and filtered out of retrieval
            keep = {d["id"] for d in docs}
            stale = [r["id"] for r in self.client.search(search_text="*", filter=tenant_filter(tenant_id), select=["id"], top=1000) if r["id"] not in keep]
            if stale:
                self.client.merge_documents([{"id": i, "status": "retired"} for i in stale])
                log.info("retired %d stale chunks for tenant %s", len(stale), tenant_id)
        await asyncio.to_thread(_do)

    async def is_ready(self, tenant_id: str) -> bool:
        def _do() -> bool:
            try:
                res = self.client.search(search_text="*", filter=tenant_filter(tenant_id), top=0, include_total_count=True)
                return (res.get_count() or 0) > 0
            except ResourceNotFoundError:
                return False
        return await asyncio.to_thread(_do)

    # ---- retrieval --------------------------------------------------------------------------------------------------
    async def search(self, tenant_id: str, query: str, vector: list[float] | None, k: int = 6) -> list[PolicyChunk]:
        def _do() -> list[PolicyChunk]:
            vq: list[VectorQuery] | None = [VectorizedQuery(vector=vector, k_nearest_neighbors=k, fields="vector")] if vector else None
            extra: dict[str, Any] = {"query_type": "semantic", "semantic_configuration_name": self.semantic} if self.semantic else {}
            res = self.client.search(search_text=query, vector_queries=vq, filter=tenant_filter(tenant_id), top=k, select=SELECT, **extra)
            return [PolicyChunk(chunk_id=r["id"], doc_id=r["doc_id"], title=r["title"], path=r["path"], version=r.get("version") or None,
                                section=r["section"], text=r["text"], score=float(r["@search.score"]), commit_sha=r.get("commit_sha"), chunk_hash=r.get("chunk_hash")) for r in res]
        return await asyncio.to_thread(_do)


def retriever(db) -> Retriever:
    from app.retrieval.local import LocalRetriever

    s = settings()
    if s.search_configured:
        try:
            return AzureSearchRetriever()
        except Exception as e:  # noqa: BLE001
            if s.is_production:
                # configured but unreachable in production: fail the scan visibly rather than answer from a different corpus
                raise
            log.warning("Azure AI Search unavailable (%s); using local hybrid retriever", e)
    return LocalRetriever(db)
