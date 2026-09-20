from typing import Literal

from pydantic import BaseModel, Field

AffectedArea = Literal[
    "position_limits",
    "margins",
    "penalties",
    "risk_management",
    "reporting",
    "record_keeping",
    "kyc_aml",
    "client_onboarding",
    "settlement",
    "incident_reporting",
    "data_protection",
    "code_of_conduct",
    "governance",
    "other",
]


class Evidence(BaseModel):
    text: str = Field(min_length=1, description="Verbatim excerpt from the circular")
    section: str = Field(min_length=1, description="Paragraph / clause reference, e.g. '2.1' or 'Annexure J'")


class Obligation(BaseModel):
    requirement: str = Field(min_length=1)
    affected_area: AffectedArea
    deadline: str | None = Field(default=None, description="Date or relative deadline stated in the circular, else null")
    evidence: Evidence


class ExtractionResult(BaseModel):
    regulator: str
    circular_number: str | None = None
    published_date: str | None = None
    effective_date: str | None = Field(default=None, description="ISO date or the verbatim effective-date phrase")
    applies_to: list[str] = Field(description="Regulated entity types the circular addresses, e.g. 'stock brokers'")
    summary: str = Field(min_length=1, description="One paragraph, plain language")
    obligations: list[Obligation]
