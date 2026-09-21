from typing import Literal

from pydantic import BaseModel, Field

Applicability = Literal["YES", "NO", "UNCERTAIN"]
Severity = Literal["administrative", "operational", "prohibitive"]
Alignment = Literal["ALIGNED", "CONFLICT"]


class PolicyChunk(BaseModel):
    chunk_id: str
    doc_id: str
    title: str
    path: str
    version: str | None = None
    section: str
    text: str
    score: float = 0.0


class RegulatoryEvidence(BaseModel):
    section: str = Field(min_length=1)
    text: str = Field(min_length=1)


class PolicyEvidence(BaseModel):
    doc_id: str = Field(min_length=1, examples=["POL-001"])
    section: str = Field(min_length=1, examples=["4.1"])
    text: str = Field(min_length=1, description="Verbatim excerpt from the policy chunk")


class ImpactAnalysis(BaseModel):
    applicability: Applicability
    alignment: Alignment | None = Field(default=None, description="Required when applicability is YES")
    affected_policies: list[str] = Field(default_factory=list)
    reason: str = Field(min_length=1)
    regulatory_evidence: list[RegulatoryEvidence] = Field(default_factory=list)
    policy_evidence: list[PolicyEvidence] = Field(default_factory=list)
    effective_date: str | None = None
    recommended_action: str | None = None
    confidence: float = Field(ge=0, le=1, description="Model-reported; a routing signal, never proof of correctness")
    severity: Severity | None = None


class Memo(BaseModel):
    regulatory_change: str
    current_policy: str
    identified_gap: str
    proposed_amendment: str
    effective_date: str
    recommended_action: str
    evidence: list[str]
    disclaimer: str = "AI-generated draft — human review required"


GateOutcome = Literal["ARCHIVED", "ALIGNED", "CONFLICT", "NEEDS_INVESTIGATION"]
