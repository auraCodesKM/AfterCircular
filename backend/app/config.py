from functools import lru_cache
from typing import Literal

from pydantic import AliasChoices, Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    backend_api_key: str = "change-me"
    database_path: str = "data/aftercircular.db"
    cors_origins: str = "http://localhost:3000"

    ai_provider: Literal["foundry", "stub"] = "foundry"
    # Microsoft Foundry / Azure OpenAI resource endpoint, e.g. https://<resource>.openai.azure.com or
    # https://<resource>.services.ai.azure.com. Inference goes through the GA v1 API at <endpoint>/openai/v1/.
    foundry_endpoint: str = ""
    foundry_api_key: str = ""  # local dev only; empty → DefaultAzureCredential (az login / managed identity)
    # Foundry *project* endpoint (…/api/projects/<name>) — recorded for tracing/evals, not used for inference.
    foundry_project_endpoint: str = ""
    # "responses" (v1 Responses API, strict structured outputs) | "chat" (chat.completions on the same v1 API)
    foundry_api: Literal["responses", "chat"] = "responses"
    # deployment names — must match the real Foundry deployments; never hardcoded elsewhere
    extraction_model: str = "gpt-4o-mini"
    impact_model: str = "gpt-4o"
    memo_model: str = "gpt-4o-mini"
    embedding_model: str = "text-embedding-3-small"
    eval_models: str = ""
    # USD per 1M tokens as "input,cached_input,output" per deployment, JSON. Used only for *estimated* cost telemetry.
    model_pricing_json: str = ""

    # ---- cost guardrails (AFTERCIRCULAR_* names per the cost policy; development defaults) ----
    max_documents_per_scan: int = Field(default=1, validation_alias=AliasChoices("AFTERCIRCULAR_MAX_DOCUMENTS_PER_SCAN", "MAX_DOCUMENTS_PER_SCAN"))
    max_llm_calls_per_scan: int = Field(default=10, validation_alias=AliasChoices("AFTERCIRCULAR_MAX_LLM_CALLS_PER_SCAN", "MAX_LLM_CALLS_PER_SCAN"))
    max_retries: int = Field(default=2, validation_alias=AliasChoices("AFTERCIRCULAR_MAX_RETRIES", "MAX_RETRIES"))
    max_concurrent_calls: int = Field(default=2, validation_alias=AliasChoices("AFTERCIRCULAR_MAX_CONCURRENT_CALLS", "MAX_CONCURRENT_CALLS"))
    enable_live_scan: bool = Field(default=True, validation_alias=AliasChoices("AFTERCIRCULAR_ENABLE_LIVE_SCAN", "ENABLE_LIVE_SCAN"))
    enable_scheduled_scan: bool = Field(default=False, validation_alias=AliasChoices("AFTERCIRCULAR_ENABLE_SCHEDULED_SCAN", "ENABLE_SCHEDULED_SCAN"))
    # Application circuit breakers on *estimated* spend (list-price estimates, not Azure billing). 0 disables a limit.
    max_estimated_cost_per_scan_usd: float = Field(default=0.50, validation_alias=AliasChoices("AFTERCIRCULAR_MAX_ESTIMATED_COST_PER_SCAN_USD", "MAX_ESTIMATED_COST_PER_SCAN_USD"))
    max_estimated_cost_per_day_usd: float = Field(default=5.00, validation_alias=AliasChoices("AFTERCIRCULAR_MAX_ESTIMATED_COST_PER_DAY_USD", "MAX_ESTIMATED_COST_PER_DAY_USD"))

    # ---- context budgets (deterministic filtering → dedupe → ranking → TOON → truncate last) ----
    max_obligations_in_context: int = 12
    max_policy_chunks: int = 8
    max_evidence_items: int = 8
    max_evidence_tokens: int = 3000
    max_context_tokens: int = 12000
    # TOON for repeated structured context (obligations, chunks, evidence) in Foundry prompts. JSON stays at API boundaries.
    toon_context: bool = True

    # Application Insights (azure-monitor-opentelemetry). Empty → no exporter, local logging only.
    applicationinsights_connection_string: str = ""
    environment: Literal["dev", "demo", "production"] = "dev"

    # TypeSafe System One (Jev) — typed judgments. TYPE_SAFE_API_KEY accepted as an alias.
    typesafe_api_key: str = Field(default="", validation_alias=AliasChoices("TYPESAFE_API_KEY", "TYPE_SAFE_API_KEY"))
    typesafe_model: str = "jev-latest"
    # task → judge ("typesafe" | "foundry" | "stub"); tasks: extraction_check, applicability, rerank, alignment, verification
    decision_routes_raw: str = Field(default="", validation_alias="DECISION_ROUTES")
    default_judge: Literal["typesafe", "foundry", "stub"] = "typesafe"

    azure_search_endpoint: str = ""
    azure_search_api_key: str = ""  # empty → DefaultAzureCredential (Search Index Data Contributor/Reader roles)
    # ONE index per environment; tenants are isolated by the filterable `tenant_id` field (docs/azure/policies-dev.index.json)
    azure_search_index: str = "policies-dev"
    embedding_dimensions: int = 1536  # must match the deployed embedding model and the index's vector field
    azure_search_semantic_config: str = ""  # name of a semantic configuration to add L2 reranking; empty → RRF hybrid only

    # live = official sebi.gov.in, no fallback (LIVE_FAILED on error) · demo_snapshot = fictional fixtures ·
    # live_with_snapshot_fallback = dev only, falls back and says so. "snapshot" is accepted as an alias of demo_snapshot.
    sebi_mode: Literal["live", "demo_snapshot", "snapshot", "live_with_snapshot_fallback"] = "live"
    sebi_max_documents: int = 5
    sebi_timeout_seconds: float = 20

    github_token: str = ""

    @property
    def decision_routes(self) -> dict[str, str]:
        out: dict[str, str] = {}
        for part in self.decision_routes_raw.split(","):
            if "=" in part:
                k, v = part.split("=", 1)
                out[k.strip()] = v.strip()
        return out

    @property
    def foundry_configured(self) -> bool:
        return self.ai_provider == "foundry" and bool(self.foundry_endpoint)

    @property
    def search_configured(self) -> bool:
        return bool(self.azure_search_endpoint)

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def settings() -> Settings:
    return Settings()
