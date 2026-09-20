from app.retrieval.local import LocalRetriever, bm25_scores, tokens
from app.services.policies import chunk_markdown, parse_front_matter

DOC = """---
doc_id: POL-001
title: Position Limits Policy
version: "2.3"
---
# POL-001

## 1. Purpose
This policy sets limits for derivatives positions held by clients.

### 4.1 Client-level limits — index derivatives
Client-level position limits for index derivatives are fixed caps reviewed annually.

## 9. Review
Annual review.
"""


def test_front_matter_and_chunking():
    meta, body = parse_front_matter(DOC)
    assert meta["doc_id"] == "POL-001" and meta["version"] == "2.3"
    chunks = chunk_markdown("POL-001", "Position Limits Policy", "policies/POL-001.md", "2.3", body)
    ids = [c["chunk_id"] for c in chunks]
    assert "POL-001#4.1" in ids and "POL-001#1" in ids
    assert all(c["text"].startswith("POL-001 — Position Limits Policy §") for c in chunks)


async def test_local_hybrid_retrieval_ranks_relevant_chunk_first(db):
    meta, body = parse_front_matter(DOC)
    chunks = chunk_markdown("POL-001", "Position Limits Policy", "p", "2.3", body)
    chunks.append({"chunk_id": "PRIV-001#3", "doc_id": "PRIV-001", "title": "Privacy", "path": "p2", "version": "1", "section": "3", "text": "Client data retention period is seven years."})
    db.replace_policy_chunks("t", "repo", "sha", chunks)
    res = await LocalRetriever(db).search("t", "client-level position limits for index derivatives", None, k=2)
    assert res[0].chunk_id == "POL-001#4.1"
    assert bm25_scores("limits", [tokens("limits limits"), tokens("nothing")])[1] == 0
