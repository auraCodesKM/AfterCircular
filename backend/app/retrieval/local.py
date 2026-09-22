"""In-process hybrid retriever (BM25 + cosine, RRF-fused) over SQLite chunks. Used when Azure AI Search is not configured."""

import math
import re
from collections import Counter
from typing import Any

from app.retrieval.base import Retriever, rrf
from app.schemas.impact import PolicyChunk
from app.services.state import StateStore

_TOK = re.compile(r"[a-z0-9]+")


def tokens(s: str) -> list[str]:
    return _TOK.findall(s.lower())


def bm25_scores(query: str, docs: list[list[str]], k1: float = 1.5, b: float = 0.75) -> list[float]:
    n = len(docs)
    avgdl = sum(len(d) for d in docs) / n if n else 1
    df: Counter[str] = Counter()
    for d in docs:
        df.update(set(d))
    q = tokens(query)
    out = []
    for d in docs:
        tf = Counter(d)
        s = 0.0
        for t in q:
            if t not in tf:
                continue
            idf = math.log(1 + (n - df[t] + 0.5) / (df[t] + 0.5))
            s += idf * tf[t] * (k1 + 1) / (tf[t] + k1 * (1 - b + b * len(d) / avgdl))
        out.append(s)
    return out


def cosine(a: list[float], b: list[float]) -> float:
    dot = sum(x * y for x, y in zip(a, b))
    na, nb = math.sqrt(sum(x * x for x in a)), math.sqrt(sum(y * y for y in b))
    return dot / (na * nb) if na and nb else 0.0


class LocalRetriever(Retriever):
    name = "local-hybrid"

    def __init__(self, db: StateStore):
        self.db = db

    async def index(self, tenant_id: str, chunks: list[dict[str, Any]]) -> None:
        pass  # persisted by StateStore.replace_policy_chunks

    async def is_ready(self, tenant_id: str) -> bool:
        return bool(self.db.policy_chunks(tenant_id))

    async def search(self, tenant_id: str, query: str, vector: list[float] | None, k: int = 6) -> list[PolicyChunk]:
        chunks = self.db.policy_chunks(tenant_id)
        if not chunks:
            return []
        kw = bm25_scores(query, [tokens(c["text"]) for c in chunks])
        rankings = [[c["chunk_id"] for c, _ in sorted(zip(chunks, kw), key=lambda p: -p[1]) if _ > 0]]
        if vector is not None and any(c["embedding"] for c in chunks):
            vs = [(c["chunk_id"], cosine(vector, c["embedding"])) for c in chunks if c["embedding"]]
            rankings.append([cid for cid, _ in sorted(vs, key=lambda p: -p[1])])
        fused = rrf(rankings)
        by_id = {c["chunk_id"]: c for c in chunks}
        top = sorted(fused.items(), key=lambda p: -p[1])[:k]
        return [PolicyChunk(**{kk: by_id[cid][kk] for kk in ("chunk_id", "doc_id", "title", "path", "version", "section", "text")}, score=s,
                            commit_sha=by_id[cid].get("commit_sha"), chunk_hash=by_id[cid].get("chunk_hash")) for cid, s in top]
