"""FoundryProvider builds an AsyncOpenAI client whose api_key source is awaitable (Entra) or a plain string (key).
Regression for: "object str can't be used in 'await' expression" from a sync token provider inside the async client."""

import inspect

import pytest

from app.config import settings
from app.models.provider import EntraCredential, FoundryProvider, entra_token_provider


def test_entra_token_provider_is_awaitable():
    provider = entra_token_provider()
    result = provider()
    assert inspect.isawaitable(result)
    result.close()  # never actually fetch a token in unit tests


class FakeEntra(EntraCredential):
    """Same interface, no credential chain, no network."""

    def __init__(self) -> None:
        self.closed = False

    def provider(self):
        async def token() -> str:
            return "token-from-entra"

        return token

    async def aclose(self) -> None:
        self.closed = True


async def test_async_client_can_refresh_api_key_from_entra_provider(monkeypatch):
    """The exact code path that failed: AsyncOpenAI._refresh_api_key awaits the callable."""
    monkeypatch.setattr(settings(), "foundry_endpoint", "https://example.invalid")
    monkeypatch.setattr(settings(), "foundry_api_key", "")

    monkeypatch.setattr("app.models.provider.EntraCredential", FakeEntra)
    p = FoundryProvider()
    assert str(p.client.base_url) == "https://example.invalid/openai/v1/"
    await p.client._refresh_api_key()
    assert p.client.api_key == "token-from-entra"
    await p.aclose()
    assert p._credential is not None and p._credential.closed  # type: ignore[attr-defined]


async def test_sync_token_provider_would_break_the_async_client():
    """Documents why the aio provider is mandatory: the async client rejects a sync callable."""
    from openai import AsyncOpenAI

    c = AsyncOpenAI(base_url="https://example.invalid/openai/v1/", api_key=lambda: "tok")
    with pytest.raises(TypeError, match="can't be used in 'await'"):
        await c._refresh_api_key()


def test_api_key_path_is_unchanged(monkeypatch):
    monkeypatch.setattr(settings(), "foundry_endpoint", "https://example.invalid")
    monkeypatch.setattr(settings(), "foundry_api_key", "local-dev-key")
    assert FoundryProvider().client.api_key == "local-dev-key"
