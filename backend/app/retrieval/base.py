from abc import ABC, abstractmethod
from typing import Any

from app.schemas.impact import PolicyChunk


class Retriever(ABC):
    name: str

    @abstractmethod
    async def index(self, tenant_id: str, chunks: list[dict[str, Any]]) -> None: ...

    @abstractmethod
    async def is_ready(self, tenant_id: str) -> bool: ...

    @abstractmethod
    async def search(self, tenant_id: str, query: str, vector: list[float] | None, k: int = 6) -> list[PolicyChunk]: ...


def rrf(rankings: list[list[str]], k: int = 60) -> dict[str, float]:
    """Reciprocal-rank fusion of keyword + vector rankings (what Azure AI Search does for hybrid queries)."""
    scores: dict[str, float] = {}
    for ranking in rankings:
        for rank, cid in enumerate(ranking):
            scores[cid] = scores.get(cid, 0.0) + 1.0 / (k + rank + 1)
    return scores
