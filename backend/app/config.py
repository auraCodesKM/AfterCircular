from functools import lru_cache
from typing import Literal

from pydantic import AliasChoices, Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    backend_api_key: str = "change-me"
    database_path: str = "data/aftercircular.db"
    # WAL needs shared memory on the same filesystem; a network share (Azure Files/SMB, a macOS bind mount) does not
    # provide it and SQLite then fails with "disk I/O error". Use DELETE (rollback journal) on mounted shares.
    sqlite_journal_mode: Literal["WAL", "DELETE", "TRUNCATE"] = "WAL"
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
    # Ask: Jev makes the judgments; the generative deployment renders them into grounded sentences (strict schema, ids validated).
    # false → answers are composed from the judgments alone (no narrative model call).
    ask_narrative: bool = True
    ask_web_search: bool = True  # Foundry Web Search tool, restricted to sebi.gov.in; discovery only — never compliance evidence

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
    # Comma-separated SEBI entry ids to scan (each must exist in regulatory_sources/sebi). Empty = newest listing rows.
    # Every selected circular is still fetched live from www.sebi.gov.in on each scan; the registry only names them.
    sebi_selected_entry_ids: str = ""

    @property
    def sebi_selected_ids(self) -> list[str]:
        return [x.strip() for x in self.sebi_selected_entry_ids.split(",") if x.strip()]
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
    def is_production(self) -> bool:
        return self.environment == "production"

    def production_guard(self) -> list[str]:
        """Configuration that must hold before this process may serve production traffic. Returns the problems, so the
        caller can fail fast with all of them at once instead of discovering them one request at a time."""
        problems: list[str] = []
        if not self.is_production:
            return problems
        if not self.foundry_configured:
            problems.append("AI_PROVIDER/FOUNDRY_ENDPOINT: production must use Microsoft Foundry, never the stub fixture provider")
        if not self.search_configured:
            problems.append("AZURE_SEARCH_ENDPOINT: production must retrieve policy evidence from Azure AI Search, never the local index")
        if self.default_judge != "foundry" and not self.typesafe_api_key:
            problems.append("TYPESAFE_API_KEY: Jev is the configured judge but has no key; production must not silently fall back to the stub judge")
        if self.default_judge == "stub" or "stub" in self.decision_routes.values():
            problems.append("DEFAULT_JUDGE/DECISION_ROUTES: the stub judge is for tests only")
        if self.sebi_mode != "live":
            problems.append(f"SEBI_MODE={self.sebi_mode}: production must read the official source; a snapshot must never stand in for a live failure")
        if self.backend_api_key in ("", "change-me"):
            problems.append("BACKEND_API_KEY: set a real shared secret for the frontend → API call")
        if not self.cors_origin_list or "*" in self.cors_origin_list:
            problems.append("CORS_ORIGINS: set the exact frontend origin(s); '*' is not allowed for an authenticated API")
        if self.database_path.startswith("data/") or self.database_path.startswith("./data/"):
            problems.append("DATABASE_PATH: point at a mounted durable volume (e.g. /data/aftercircular.db); container-local storage is lost on every revision")
        return problems

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def settings() -> Settings:
    return Settings()
