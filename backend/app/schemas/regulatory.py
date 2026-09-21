import hashlib
from datetime import date, datetime, timezone
from typing import Literal

from pydantic import BaseModel, Field

SourceMode = Literal["LIVE", "DEMO_SNAPSHOT"]
# what actually happened at the source on this fetch (mode says where documents come from; status says how it went)
FetchStatus = Literal["LIVE_SUCCESS", "LIVE_PARTIAL", "LIVE_FAILED", "DEMO_SNAPSHOT", "DEMO_SNAPSHOT_FALLBACK"]


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
    synthetic: bool = False  # True only for the fictional demo snapshot; a LIVE document is never synthetic
    document_url: str | None = None  # the PDF actually downloaded (provenance); `url` is the circular page
    document_bytes: int | None = None
    fetched_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

    def with_hash(self) -> "RegulatoryDocument":
        return self.model_copy(update={"content_hash": content_hash(self.content)})


def content_hash(text: str) -> str:
    # Whitespace-normalized so a re-download with different line endings is not a "new version".
    normalized = " ".join(text.split())
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()


class FetchResult(BaseModel):
    mode: SourceMode
    status: FetchStatus
    documents: list[RegulatoryDocument]
    warnings: list[str] = []
    error: str | None = None  # concise reason when status is LIVE_FAILED / DEMO_SNAPSHOT_FALLBACK
    fallback: bool = False
    listing_url: str | None = None
    discovered: int = 0  # rows seen on the listing (before `limit`)
