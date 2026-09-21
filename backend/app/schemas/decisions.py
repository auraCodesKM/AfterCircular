"""Typed decision records: what a judgment model saw, what it answered, and what code did with it (prompt §9, §19)."""

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field

Primitive = Literal["noul", "choice", "score"]
JudgeName = Literal["typesafe", "foundry", "stub"]
Stage = Literal["triage", "extraction_check", "applicability", "rerank", "alignment", "verification", "escalation", "cross_check"]


class Answer(BaseModel):
    """One typed answer, normalized across providers. Mirrors the TypeSafe answer shapes."""

    type: Primitive
    noul: float | None = Field(default=None, description="P(yes) for a noul")
    choice: str | None = None
    score: float | None = None
    probabilities: dict[str, float] | None = None
    confidence: float | None = Field(default=None, description="Choice/Score only; derived from the distribution")


class Judgment(BaseModel):
    """The result of one request to a judgment provider (one state, many questions)."""

    provider: JudgeName
    model: str
    calibrated: bool = Field(description="True only for System One models trained for calibrated probabilities")
    answers: dict[str, Answer]
    input_tokens: int | None = None
    output_tokens: int | None = None
    latency_ms: int


class DecisionRecord(BaseModel):
    """Persisted per stage. `state_digest` + `evidence_ids` let a reviewer reconstruct exactly what was judged
    without storing the full state twice; `routing` is what deterministic code concluded from the answers."""

    id: str
    analysis_id: str
    tenant_id: str
    stage: Stage
    provider: JudgeName | Literal["code"]
    model: str
    calibrated: bool | None = None
    question_ids: list[str] = []
    state_digest: str = Field(default="", description="sha256 of the JSON state sent to the model")
    evidence_ids: list[str] = Field(default_factory=list, description="chunk ids / obligation indexes / circular sections judged")
    answers: dict[str, Answer] = {}
    routing: dict[str, Any] = Field(default_factory=dict, description="outcome, thresholds applied, escalated, reason")
    latency_ms: int = 0
    input_tokens: int | None = None
    output_tokens: int | None = None
    created_at: datetime
