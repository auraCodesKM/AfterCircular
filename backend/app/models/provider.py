"""LLM provider abstraction. The rest of the app calls `provider().structured(...)` and never sees a model name."""

import json
import logging
import time
from abc import ABC, abstractmethod
from typing import Any, TypeVar

from pydantic import BaseModel, ValidationError

from app.config import settings

log = logging.getLogger(__name__)
T = TypeVar("T", bound=BaseModel)

TASK_MODELS = {"extraction": "extraction_model", "impact": "impact_model", "memo": "memo_model"}


class ProviderError(RuntimeError):
    pass


class StructuredOutputError(ProviderError):
    pass


class LLMResult(BaseModel):
    task: str
    model: str
    provider: str
    text: str
    latency_ms: int
    input_tokens: int | None = None
    output_tokens: int | None = None
    attempts: int = 1


class LLMProvider(ABC):
    name: str

    def model_for(self, task: str, override: str | None = None) -> str:
        return override or getattr(settings(), TASK_MODELS[task])

    @abstractmethod
    async def generate(self, task: str, system: str, user: str, *, model: str | None = None,
                       json_mode: bool = False, context: dict[str, Any] | None = None) -> LLMResult: ...

    @abstractmethod
    async def embed(self, texts: list[str]) -> list[list[float]] | None:
        """None when the provider has no embedding model — retrieval degrades to keyword-only."""

    async def structured(self, task: str, system: str, user: str, schema: type[T], *, model: str | None = None,
                         context: dict[str, Any] | None = None) -> tuple[T, LLMResult]:
        """JSON-mode call validated against `schema`; one repair retry with the validation errors; then fail."""
        schema_text = json.dumps(schema.model_json_schema(), indent=None)
        sys_prompt = f"{system}\n\nRespond with a single JSON object that validates against this JSON Schema. No prose.\n{schema_text}"
        last_err = ""
        for attempt in (1, 2):
            prompt = user if attempt == 1 else f"{user}\n\nYour previous answer failed validation:\n{last_err}\nReturn corrected JSON only."
            res = await self.generate(task, sys_prompt, prompt, model=model, json_mode=True, context=context)
            res.attempts = attempt
            try:
                return schema.model_validate(_extract_json(res.text)), res
            except (ValidationError, ValueError) as e:
                last_err = str(e)[:1500]
                log.warning("structured output invalid for %s (attempt %d): %s", task, attempt, last_err[:200])
        raise StructuredOutputError(f"{task}: model output failed schema validation twice: {last_err[:300]}")


def _extract_json(text: str) -> Any:
    text = text.strip()
    if text.startswith("```"):
        text = text.strip("`")
        text = text[4:] if text.lower().startswith("json") else text
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        start, end = text.find("{"), text.rfind("}")
        if start == -1 or end == -1:
            raise ValueError("no JSON object in output")
        return json.loads(text[start : end + 1])


class FoundryProvider(LLMProvider):
    """Microsoft Foundry / Azure OpenAI via the OpenAI-compatible API. Models are deployment names."""

    name = "foundry"

    def __init__(self) -> None:
        from openai import AsyncAzureOpenAI

        s = settings()
        if not s.foundry_endpoint:
            raise ProviderError("FOUNDRY_ENDPOINT is not set")
        kwargs: dict[str, Any] = {"azure_endpoint": s.foundry_endpoint, "api_version": s.foundry_api_version, "timeout": 90, "max_retries": 2}
        if s.foundry_api_key:
            kwargs["api_key"] = s.foundry_api_key
        else:  # managed identity / az login
            from azure.identity import DefaultAzureCredential, get_bearer_token_provider

            kwargs["azure_ad_token_provider"] = get_bearer_token_provider(DefaultAzureCredential(), "https://cognitiveservices.azure.com/.default")
        self.client = AsyncAzureOpenAI(**kwargs)

    async def generate(self, task, system, user, *, model=None, json_mode=False, context=None) -> LLMResult:
        m = self.model_for(task, model)
        t0 = time.perf_counter()
        kwargs: dict[str, Any] = {"model": m, "temperature": 0,
                                  "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}]}
        if json_mode:
            kwargs["response_format"] = {"type": "json_object"}
        try:
            resp = await self.client.chat.completions.create(**kwargs)
        except Exception as e:  # noqa: BLE001
            raise ProviderError(f"Foundry call failed ({type(e).__name__}): {str(e)[:200]}") from e
        usage = resp.usage
        return LLMResult(task=task, model=m, provider=self.name, text=resp.choices[0].message.content or "",
                         latency_ms=int((time.perf_counter() - t0) * 1000),
                         input_tokens=usage.prompt_tokens if usage else None, output_tokens=usage.completion_tokens if usage else None)

    async def embed(self, texts):
        try:
            resp = await self.client.embeddings.create(model=settings().embedding_model, input=texts)
        except Exception as e:  # noqa: BLE001
            log.warning("embedding failed (%s); keyword-only retrieval", e)
            return None
        return [d.embedding for d in resp.data]


class StubProvider(LLMProvider):
    """No AI. Returns fixture outputs from evals/scenarios keyed by the document id in `context`.
    Exists so the pipeline, approval flow and UI can be exercised before Foundry is configured.
    Every record it produces is labelled provider='stub'."""

    name = "stub"

    def _fixture(self, task: str, context: dict[str, Any] | None) -> str:
        from evals.dataset import load_scenarios

        doc_id = (context or {}).get("document_id")
        for sc in load_scenarios():
            if sc.get("document", {}).get("document_id") == doc_id and task in sc.get("fixtures", {}):
                return json.dumps(sc["fixtures"][task])
        raise ProviderError(f"AI provider is 'stub' and no fixture exists for task={task} document={doc_id}. Configure FOUNDRY_ENDPOINT for real analysis.")

    async def generate(self, task, system, user, *, model=None, json_mode=False, context=None) -> LLMResult:
        return LLMResult(task=task, model="stub-fixture", provider=self.name, text=self._fixture(task, context), latency_ms=0)

    async def embed(self, texts):
        return None


_provider: LLMProvider | None = None


def provider() -> LLMProvider:
    global _provider
    if _provider is None:
        _provider = FoundryProvider() if settings().foundry_configured else StubProvider()
        if isinstance(_provider, StubProvider):
            log.warning("AI_PROVIDER=stub — no model calls will be made; outputs come from evals/scenarios fixtures")
    return _provider
