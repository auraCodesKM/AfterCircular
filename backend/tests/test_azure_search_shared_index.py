"""Azure AI Search on ONE shared index: naming, tenant isolation, metadata upload, dates, dimensions, readiness.
No network: SearchClient / SearchIndexClient are replaced with in-memory fakes."""

import json
from datetime import date
from pathlib import Path
from typing import Any

import pytest
from azure.core.exceptions import ResourceNotFoundError

from app.config import settings
from app.retrieval import azure_search as az
from app.services.policies import chunk_markdown, edm_datetime, enrich_chunks

ROOT = Path(__file__).resolve().parents[2]


class FakeResults(list):
    def __init__(self, rows: list[dict[str, Any]], count: int | None = None):
        super().__init__(rows)
        self._count = count

    def get_count(self) -> int | None:
        return self._count


class FakeSearchClient:
    def __init__(self, *a: Any, **k: Any):
        self.index_name = a[1] if len(a) > 1 else k.get("index_name")
        self.docs: dict[str, dict[str, Any]] = {}
        self.calls: list[dict[str, Any]] = []

    def merge_or_upload_documents(self, docs: list[dict[str, Any]]) -> None:
        for d in docs:
            self.docs[d["id"]] = {**self.docs.get(d["id"], {}), **d}

    def merge_documents(self, docs: list[dict[str, Any]]) -> None:
        for d in docs:
            self.docs[d["id"]].update(d)

    def search(self, search_text: str = "*", **kw: Any) -> FakeResults:
        self.calls.append({"search_text": search_text, **kw})
        flt = kw.get("filter") or ""
        rows = [d for d in self.docs.values() if _matches(d, flt)]
        rows = [{**r, "@search.score": 1.0} for r in rows]
        if kw.get("top") == 0:
            return FakeResults([], count=len(rows))
        return FakeResults(rows[: kw.get("top") or len(rows)])


def _matches(d: dict[str, Any], flt: str) -> bool:
    # supports "tenant_id eq 'x'" and "tenant_id eq 'x' and status eq 'active'"
    for part in flt.split(" and "):
        part = part.strip()
        if not part:
            continue
        field, _, val = part.partition(" eq ")
        if str(d.get(field.strip())) != val.strip().strip("'"):
            return False
    return True


class FakeIndexClient:
    def __init__(self, *a: Any, **k: Any):
        self.created: list[Any] = []
        self.existing: Any | None = None

    def get_index(self, name: str) -> Any:
        if self.existing is None:
            raise ResourceNotFoundError("no index")
        return self.existing

    def create_index(self, index: Any) -> None:
        self.created.append(index)
        self.existing = index


@pytest.fixture
def retriever(monkeypatch):
    monkeypatch.setattr(settings(), "azure_search_endpoint", "https://srch-test.search.windows.net")
    monkeypatch.setattr(settings(), "azure_search_api_key", "not-a-real-key")
    monkeypatch.setattr(settings(), "azure_search_index", "policies-dev")
    monkeypatch.setattr(settings(), "embedding_dimensions", 1536)
    monkeypatch.setattr(az, "SearchClient", FakeSearchClient)
    monkeypatch.setattr(az, "SearchIndexClient", FakeIndexClient)
    return az.AzureSearchRetriever()


def _chunks(tenant_sha: str = "abc1234") -> list[dict[str, Any]]:
    body = "## 4. Limits\n\n### 4.1 Client-level limits\n\nClient-level position limits for index derivatives are fixed caps reviewed annually.\n"
    chunks = chunk_markdown("POL-001", "Position Limits Policy", "policies/POL-001.md", "2.3", body)
    docs = [{"doc_id": "POL-001", "category": "policy", "effective_date": "2025-04-01", "topics": ["position-limits", "index-derivatives"]}]
    manifest = {"company": {"regulator": "SEBI", "country": "IN"}}
    enrich_chunks(chunks, docs, manifest, tenant_sha)
    for c in chunks:
        c["embedding"] = [0.01] * 1536
    return chunks


def test_index_name_is_the_environment_index_not_the_tenant(retriever):
    assert retriever.index_name == "policies-dev"
    assert retriever.client.index_name == "policies-dev"
    assert not hasattr(az, "index_name")  # the per-tenant naming helper is gone


def test_code_schema_matches_committed_portal_json():
    committed = json.loads((ROOT / "docs" / "azure" / "policies-dev.index.json").read_text(encoding="utf-8"))
    assert az.index_definition("policies-dev", 1536).as_dict() == committed


def test_dimensions_come_from_settings(monkeypatch, retriever):
    assert retriever.dims == 1536
    monkeypatch.setattr(settings(), "embedding_dimensions", 3072)
    assert az.AzureSearchRetriever().dims == 3072
    assert az.index_definition("x", 3072).as_dict()["fields"][-1]["dimensions"] == 3072


async def test_upload_carries_tenant_and_metadata_with_edm_date(retriever):
    await retriever.index("acme-1", _chunks())
    docs = list(retriever.client.docs.values())
    assert len(docs) == 1
    d = docs[0]
    assert d["tenant_id"] == "acme-1" and d["doc_id"] == "POL-001" and d["status"] == "active"
    assert d["effective_date"] == "2025-04-01T00:00:00Z"
    assert d["topics"] == ["position-limits", "index-derivatives"] and d["regulator"] == "SEBI" and d["jurisdiction"] == "IN"
    assert d["commit_sha"] == "abc1234" and len(d["chunk_hash"]) == 24 and d["category"] == "policy"
    assert len(d["vector"]) == 1536
    assert set(d) == {"id", "vector", *az.METADATA}
    assert d["id"] != "POL-001#4.1" and all(ch.isalnum() or ch in "_-=" for ch in d["id"])


async def test_existing_index_is_validated_not_recreated(retriever):
    retriever.idx.existing = az.index_definition("policies-dev", 1536)
    await retriever.index("acme-1", _chunks())
    assert retriever.idx.created == []


async def test_missing_index_is_created_with_the_full_schema(retriever):
    await retriever.index("acme-1", _chunks())
    assert [i.name for i in retriever.idx.created] == ["policies-dev"]
    assert {f.name for f in retriever.idx.created[0].fields} == {"id", "vector", *az.METADATA}


async def test_existing_index_with_wrong_dimensions_is_refused(retriever):
    retriever.idx.existing = az.index_definition("policies-dev", 3072)
    with pytest.raises(RuntimeError, match="3072"):
        await retriever.index("acme-1", _chunks())


async def test_queries_and_readiness_are_tenant_scoped(retriever):
    await retriever.index("acme-1", _chunks())
    await retriever.index("nimbus-2", _chunks("def5678"))
    assert await retriever.is_ready("acme-1") and await retriever.is_ready("nimbus-2")
    assert not await retriever.is_ready("someone-else")  # shared index is never mistaken for "ready" for a new tenant
    hits = await retriever.search("acme-1", "position limits", [0.01] * 1536, k=5)
    assert [h.doc_id for h in hits] == ["POL-001"]
    last = retriever.client.calls[-1]
    assert last["filter"] == "tenant_id eq 'acme-1' and status eq 'active'"
    assert last["vector_queries"] and last["search_text"] == "position limits"  # hybrid: BM25 + vector in one request → RRF
    assert retriever.client.calls[0]["filter"].startswith("tenant_id eq 'acme-1'")  # readiness filtered too


async def test_removed_chunks_are_retired_and_hidden(retriever):
    await retriever.index("acme-1", _chunks())
    await retriever.index("acme-1", [])  # repository no longer has the chunk
    d = next(iter(retriever.client.docs.values()))
    assert d["status"] == "retired"
    assert not await retriever.is_ready("acme-1")
    assert await retriever.search("acme-1", "position limits", None) == []


def test_edm_datetime_conversion():
    assert edm_datetime("2025-04-01") == "2025-04-01T00:00:00Z"
    assert edm_datetime(date(2025, 4, 1)) == "2025-04-01T00:00:00Z"
    assert edm_datetime("2025-04-01T09:30:00+05:30") == "2025-04-01T09:30:00+05:30"
    assert edm_datetime(None) is None and edm_datetime("") is None
    with pytest.raises(ValueError):
        edm_datetime("April 1, 2025")


def test_tenant_filter_escapes_quotes():
    assert az.tenant_filter("o'brien") == "tenant_id eq 'o''brien' and status eq 'active'"
    assert az.tenant_filter("t", status=None) == "tenant_id eq 't'"


async def test_ensure_indexed_embeds_only_changed_chunks(db, tenant, retriever, monkeypatch):
    """SQLite policy_chunks is the embedding cache: a second index build with the same text makes zero embedding calls."""
    from app.services.policies import ensure_indexed
    from tests.test_pipeline_e2e import FakeGH

    calls: list[int] = []

    async def embed(texts):
        calls.append(len(texts))
        return [[0.02] * 1536 for _ in texts]

    _, reindexed = await ensure_indexed(db, FakeGH(None), tenant, retriever, embed)
    assert reindexed and calls == [len(db.policy_chunks(tenant.tenant_id))] and calls[0] > 0
    db.conn.execute("UPDATE policy_index_meta SET commit_sha='moved'")  # pretend the branch moved but the text did not
    db.conn.commit()
    _, reindexed = await ensure_indexed(db, FakeGH(None), tenant, retriever, embed)
    assert reindexed and len(calls) == 1  # no new embedding call
    uploaded = next(iter(retriever.client.docs.values()))
    assert uploaded["tenant_id"] == tenant.tenant_id and len(uploaded["vector"]) == 1536 and uploaded["chunk_hash"]
