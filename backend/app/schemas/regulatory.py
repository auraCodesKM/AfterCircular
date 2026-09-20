import hashlib
from datetime import date, datetime, timezone
from typing import Literal

from pydantic import BaseModel, Field

SourceMode = Literal["LIVE", "DEMO_SNAPSHOT"]


class RegulatoryDocument(BaseModel):
    """Normalized regulatory publication — the only shape the pipeline accepts (§7)."""

    source: str = Field(examples=["SEBI"])
    jurisdiction: str = Field(examples=["IN"])
    document_id: str = Field(description="Stable id within the source, e.g. the SEBI entry id")
    circular_number: str | None = None
    title: str
    published_date: date | None = None
    effective_date: date | None = None
    url: str
    document_type: str = "circular"
    content_hash: str = ""
    content: str
    source_mode: SourceMode = "LIVE"
    fetched_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

    def with_hash(self) -> "RegulatoryDocument":
        return self.model_copy(update={"content_hash": content_hash(self.content)})


def content_hash(text: str) -> str:
    # Whitespace-normalized so a re-download with different line endings is not a "new version".
    normalized = " ".join(text.split())
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()


class FetchResult(BaseModel):
    mode: SourceMode
    documents: list[RegulatoryDocument]
    warnings: list[str] = []
