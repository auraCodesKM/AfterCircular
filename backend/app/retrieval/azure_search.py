"""Azure AI Search: one index per tenant (PRD §6), HNSW vector field + BM25 keyword, hybrid query."""

import asyncio
import logging
import re
from typing import Any

from azure.core.credentials import AzureKeyCredential
from azure.core.exceptions import ResourceNotFoundError
from azure.search.documents import SearchClient
from azure.search.documents.indexes import SearchIndexClient
from azure.search.documents.indexes.models import (
    HnswAlgorithmConfiguration,
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


def index_name(tenant_id: str) -> str:
    return "policies-" + re.sub(r"[^a-z0-9-]", "-", tenant_id.lower())[:100]


class AzureSearchRetriever(Retriever):
    name = "azure-ai-search"

    def __init__(self, dims: int = 1536):
        s = settings()
        if not s.azure_search_api_key:
            raise RuntimeError("AZURE_SEARCH_API_KEY required (managed identity for Search: future scope)")
        self.cred = AzureKeyCredential(s.azure_search_api_key)
        self.endpoint = s.azure_search_endpoint
        self.dims = dims
        self.idx = SearchIndexClient(self.endpoint, self.cred)

    def _client(self, tenant_id: str) -> SearchClient:
        return SearchClient(self.endpoint, index_name(tenant_id), self.cred)

    def _ensure_index(self, tenant_id: str) -> None:
        fields = [
            SimpleField(name="id", type="Edm.String", key=True),
            SimpleField(name="doc_id", type="Edm.String", filterable=True),
            SimpleField(name="title", type="Edm.String"),
            SimpleField(name="path", type="Edm.String"),
            SimpleField(name="version", type="Edm.String"),
            SimpleField(name="section", type="Edm.String"),
            SearchableField(name="text", type="Edm.String", analyzer_name="en.microsoft"),
            SearchField(name="vector", type="Collection(Edm.Single)", searchable=True,
                        vector_search_dimensions=self.dims, vector_search_profile_name="hnsw"),
        ]
        vs = VectorSearch(algorithms=[HnswAlgorithmConfiguration(name="hnsw-algo")], profiles=[VectorSearchProfile(name="hnsw", algorithm_configuration_name="hnsw-algo")])
        self.idx.create_or_update_index(SearchIndex(name=index_name(tenant_id), fields=fields, vector_search=vs))

    async def index(self, tenant_id: str, chunks: list[dict[str, Any]]) -> None:
        def _do() -> None:
            self._ensure_index(tenant_id)
            client = self._client(tenant_id)
            docs = [{"id": re.sub(r"[^A-Za-z0-9_\-=]", "_", c["chunk_id"]), "doc_id": c["doc_id"], "title": c["title"], "path": c["path"],
                     "version": c.get("version") or "", "section": c["section"], "text": c["text"], "vector": c.get("embedding")} for c in chunks]
            for d in docs:
                if d["vector"] is None:
                    d.pop("vector")
            if docs:
                client.upload_documents(docs)
        await asyncio.to_thread(_do)

    async def is_ready(self, tenant_id: str) -> bool:
        def _do() -> bool:
            try:
                return self._client(tenant_id).get_document_count() > 0
            except ResourceNotFoundError:
                return False
        return await asyncio.to_thread(_do)

    async def search(self, tenant_id: str, query: str, vector: list[float] | None, k: int = 6) -> list[PolicyChunk]:
        def _do() -> list[PolicyChunk]:
            vq: list[VectorQuery] | None = [VectorizedQuery(vector=vector, k_nearest_neighbors=k, fields="vector")] if vector else None
            res = self._client(tenant_id).search(search_text=query, vector_queries=vq, top=k, select=["id", "doc_id", "title", "path", "version", "section", "text"])
            return [PolicyChunk(chunk_id=r["id"], doc_id=r["doc_id"], title=r["title"], path=r["path"], version=r.get("version") or None,
                                section=r["section"], text=r["text"], score=float(r["@search.score"])) for r in res]
        return await asyncio.to_thread(_do)


def retriever(db) -> Retriever:
    from app.retrieval.local import LocalRetriever

    if settings().search_configured:
        try:
            return AzureSearchRetriever()
        except Exception as e:  # noqa: BLE001
            log.warning("Azure AI Search unavailable (%s); using local hybrid retriever", e)
    return LocalRetriever(db)
