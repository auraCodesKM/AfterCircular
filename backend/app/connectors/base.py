from abc import ABC, abstractmethod

from app.schemas.regulatory import FetchResult


class RegulatorySource(ABC):
    """One regulator = one connector. The pipeline only ever sees FetchResult (normalized documents)."""

    name: str
    jurisdiction: str

    @abstractmethod
    async def fetch_documents(self, limit: int) -> FetchResult: ...
