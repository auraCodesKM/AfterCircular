from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field

# One explicit state per circular drives the dashboard (PRD §17, prompt §28).
DocumentStatus = Literal[
    "DISCOVERED",
    "EXTRACTING",
    "RETRIEVING",
    "ANALYZING",
    "ARCHIVED",  # NO applicability, or YES + ALIGNED
    "NEEDS_INVESTIGATION",  # UNCERTAIN, or CONFLICT without evidence
    "DRAFTING",
    "AWAITING_REVIEW",
    "APPROVED",
    "REJECTED",
    "COMPLETED",  # ticket created
    "FAILED",
]

ScanStatus = Literal["RUNNING", "COMPLETED", "FAILED"]
ErrorKind = Literal["repository", "source", "ai", "backend"]
ReviewStatus = Literal["AWAITING_REVIEW", "APPROVED", "REJECTED"]
ReviewDecision = Literal["approve", "reject"]

AuditEventType = Literal[
    "SCAN_STARTED",
    "SCAN_COMPLETED",
    "SCAN_FAILED",
    "DOCUMENT_DETECTED",
    "DOCUMENT_SKIPPED",
    "DOCUMENT_VERSION_DETECTED",
    "OBLIGATIONS_EXTRACTED",
    "POLICIES_INDEXED",
    "POLICIES_RETRIEVED",
    "IMPACT_ANALYZED",
    "ARCHIVED",
    "CONFLICT_DETECTED",
    "NEEDS_INVESTIGATION",
    "MEMO_GENERATED",
    "REVIEW_REQUESTED",
    "APPROVED",
    "REJECTED",
    "TICKET_CREATED",
    "PIPELINE_FAILED",
    "BUDGET_EXCEEDED",
]


class TenantContext(BaseModel):
    tenant_id: str
    company_name: str
    github_repo: str
    default_branch: str = "main"
    actor: str = "system"
    github_token: str | None = Field(default=None, exclude=True, repr=False)


class ScanStep(BaseModel):
    key: str
    label: str
    status: Literal["pending", "running", "done", "skipped", "failed"] = "pending"
    detail: str | None = None
    at: datetime | None = None


class ScanRequest(BaseModel):
    force: bool = Field(default=False, description="Re-process documents already seen (dev/demo only)")


class ScanRecord(BaseModel):
    id: str
    tenant_id: str
    status: ScanStatus
    source_mode: str | None = None  # LIVE | DEMO_SNAPSHOT — where documents came from
    source_status: str | None = None  # LIVE_SUCCESS | LIVE_NO_NEW_DOCUMENTS | LIVE_PARTIAL | LIVE_FAILED | DEMO_SNAPSHOT | DEMO_SNAPSHOT_FALLBACK
    source_error: str | None = None
    started_at: datetime
    finished_at: datetime | None = None
    steps: list[ScanStep]
    new_documents: int = 0
    skipped_documents: int = 0
    deferred_documents: int = 0  # new documents left for the next scan by MAX_DOCUMENTS_PER_SCAN
    llm_calls: int = 0
    estimated_cost_usd: float = 0.0  # sum of list-price estimates for this scan's generative calls (0 when pricing unknown)
    document_ids: list[str] = []
    error: str | None = Field(default=None, description="Human-readable")
    error_kind: ErrorKind | None = None
    error_detail: str | None = Field(default=None, description="Technical detail for a collapsible; never secrets")
    ai_provider: str = ""
    retrieval_backend: str = ""


class ProcessedDocument(BaseModel):
    id: str
    tenant_id: str
    source: str
    jurisdiction: str
    document_id: str
    circular_number: str | None
    title: str
    published_date: str | None
    effective_date: str | None
    url: str
    content_hash: str
    document_version: int = 1
    previous_hash: str | None = None
    processed_at: datetime
    status: DocumentStatus
    impact: str | None = None
    analysis_id: str | None = None
    ticket_id: str | None = None
    ticket_url: str | None = None
    source_mode: str = "LIVE"
    synthetic: bool = False  # provenance: True only for the fictional demo snapshot
    document_url: str | None = None  # the PDF that was downloaded (LIVE) — proof of source
    fetched_at: datetime | None = None
    error: str | None = None


class AnalysisRecord(BaseModel):
    id: str
    tenant_id: str
    document_pk: str
    scan_id: str | None
    extraction: dict[str, Any]
    retrieved_chunks: list[dict[str, Any]]
    impact: dict[str, Any] | None
    gate_outcome: str | None
    memo: dict[str, Any] | None
    ai_provider: str
    models: dict[str, str]
    metrics: dict[str, Any]
    decision_path: list[str] = Field(default_factory=list, description="e.g. ['typesafe:applicability','typesafe:rerank','typesafe:alignment','typesafe:verification']")
    escalation_reason: str | None = None
    created_at: datetime


class ReviewRecord(BaseModel):
    id: str
    tenant_id: str
    document_pk: str
    analysis_id: str
    status: ReviewStatus
    requested_at: datetime
    decided_at: datetime | None = None
    decided_by: str | None = None
    note: str | None = None
    ticket_id: str | None = None
    ticket_url: str | None = None


class ReviewDecisionRequest(BaseModel):
    note: str | None = None


class AuditEvent(BaseModel):
    id: str
    tenant_id: str
    timestamp: datetime
    actor: str
    actor_type: Literal["agent", "human", "system"]
    event_type: AuditEventType
    document_pk: str | None = None
    analysis_id: str | None = None
    scan_id: str | None = None
    metadata: dict[str, Any] = {}


class Investigation(BaseModel):
    """One question asked of the workspace agent and the structured answer code assembled for it."""

    id: str
    tenant_id: str
    question: str
    intent: str
    summary: str
    document_pk: str | None = None
    analysis_id: str | None = None
    policy_id: str | None = None
    answer: dict[str, Any] = Field(default_factory=dict, description="structured sections the UI renders")
    judge: dict[str, Any] = Field(default_factory=dict, description="provider/model/confidence behind the intent routing")
    actor: str
    created_at: datetime


class TicketPayload(BaseModel):
    title: str
    body: str
    labels: list[str]
