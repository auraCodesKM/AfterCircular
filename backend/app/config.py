from functools import lru_cache
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    backend_api_key: str = "change-me"
    database_path: str = "data/aftercircular.db"
    cors_origins: str = "http://localhost:3000"

    ai_provider: Literal["foundry", "stub"] = "foundry"
    foundry_endpoint: str = ""
    foundry_api_key: str = ""
    foundry_api_version: str = "2024-10-21"
    extraction_model: str = "gpt-4o-mini"
    impact_model: str = "gpt-4o"
    memo_model: str = "gpt-4o-mini"
    embedding_model: str = "text-embedding-3-small"
    eval_models: str = ""

    azure_search_endpoint: str = ""
    azure_search_api_key: str = ""

    sebi_mode: Literal["live", "snapshot"] = "live"
    sebi_max_documents: int = 5
    sebi_timeout_seconds: float = 20

    github_token: str = ""

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
