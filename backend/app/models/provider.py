"""LLM provider abstraction. The rest of the app calls `provider().structured(...)` and never sees a model name."""

import asyncio
import contextvars
import json
import logging
import time
from abc import ABC, abstractmethod
from collections.abc import Awaitable, Callable
from typing import Any, TypeVar

from pydantic import BaseModel, ValidationError

from app.config import settings

log = logging.getLogger(__name__)
T = TypeVar("T", bound=BaseModel)

TASK_MODELS = {"extraction": "extraction_model", "impact": "impact_model", "memo": "memo_model"}

# USD per 1M tokens: (input, cached input, output). Public list-price snapshot (Azure OpenAI, global standard, Sept 2026
# as known to this code) — an *estimate* for telemetry only. Override with MODEL_PRICING_JSON={"<deployment>":[in,cached,out]}.
DEFAULT_PRICING: dict[str, tuple[float, float, float]] = {
    "gpt-4o-mini": (0.15, 0.075, 0.60), "gpt-4o": (2.50, 1.25, 10.00),
    "gpt-4.1-nano": (0.10, 0.025, 0.40), "gpt-4.1-mini": (0.40, 0.10, 1.60), "gpt-4.1": (2.00, 0.50, 8.00),
    "gpt-5-nano": (0.05, 0.005, 0.40), "gpt-5-mini": (0.25, 0.025, 2.00), "gpt-5": (1.25, 0.125, 10.00),
    "text-embedding-3-small": (0.02, 0.02, 0.0), "text-embedding-3-large": (0.13, 0.13, 0.0),
}


def pricing_for(model: str) -> tuple[float, float, float] | None:
    """(input, cached input, output) USD per 1M tokens for a deployment, or None when the price is unknown."""
    table = dict(DEFAULT_PRICING)
    if settings().model_pricing_json:
        try:
            table.update({k: tuple(v) for k, v in json.loads(settings().model_pricing_json).items()})  # type: ignore[misc]
        except (ValueError, TypeError):
            log.warning("MODEL_PRICING_JSON is not valid JSON; using defaults")
    key = next((k for k in sorted(table, key=len, reverse=True) if model.lower().startswith(k)), None)
    return table[key] if key else None


def estimate_cost(model: str, input_tokens: int | None, output_tokens: int | None, cached_tokens: int | None = None) -> float | None:
    """Estimated USD for one call from the list-price table; None (never a guess) when the model has no price or no usage."""
    price = pricing_for(model)
    if price is None or input_tokens is None:
        return None
    p_in, p_cached, p_out = price
    cached = cached_tokens or 0
    return round(((input_tokens - cached) * p_in + cached * p_cached + (output_tokens or 0) * p_out) / 1_000_000, 6)


def pricing_status(model: str, cost: float | None) -> str:
    """'estimate' = list-price snapshot (DEFAULT_PRICING / MODEL_PRICING_JSON); 'unknown' = no price → cost is null."""
    return "estimate" if cost is not None or pricing_for(model) else "unknown"


class ProviderError(RuntimeError):
    pass


class StructuredOutputError(ProviderError):
    pass


class BudgetExceeded(ProviderError):
    """A scan budget (calls or estimated cost) is spent. Stops generative work instead of spending more credits.
    `reason` is one of BUDGET_EXCEEDED:calls | BUDGET_EXCEEDED:scan_cost | BUDGET_EXCEEDED:daily_cost."""

    def __init__(self, reason: str, detail: str):
        super().__init__(f"{reason} — {detail}")
        self.reason = reason


class CallBudget:
    """Per-scan circuit breaker: call count + *estimated* cost (application limits, not Azure billing). Set via `budget_var`.
    Cost is checked before a call from what has already been spent — the call that crosses the line completes and is
    recorded; the next one is refused. Unknown pricing adds 0 and is counted separately so the gap is visible."""

    def __init__(self, limit: int, cost_limit: float = 0.0, daily_limit: float = 0.0, daily_spent_before: float = 0.0):
        self.limit, self.used = limit, 0
        self.cost_limit, self.spent = cost_limit, 0.0
        self.daily_limit, self.daily_spent_before = daily_limit, daily_spent_before
        self.unknown_pricing_calls = 0

    @property
    def daily_spent(self) -> float:
        return self.daily_spent_before + self.spent

    def take(self, task: str) -> None:
        if self.used >= self.limit:
            raise BudgetExceeded("BUDGET_EXCEEDED:calls", f"model-call budget of {self.limit} per scan reached before task={task}")
        if self.cost_limit and self.spent >= self.cost_limit:
            raise BudgetExceeded("BUDGET_EXCEEDED:scan_cost", f"estimated scan spend ${self.spent:.4f} reached the ${self.cost_limit:.2f} scan limit before task={task}")
        if self.daily_limit and self.daily_spent >= self.daily_limit:
            raise BudgetExceeded("BUDGET_EXCEEDED:daily_cost", f"estimated spend today ${self.daily_spent:.4f} reached the ${self.daily_limit:.2f} daily limit before task={task}")
        self.used += 1

    def add(self, cost: float | None) -> None:
        if cost is None:
            self.unknown_pricing_calls += 1
        else:
            self.spent += cost


budget_var: contextvars.ContextVar[CallBudget | None] = contextvars.ContextVar("llm_budget", default=None)


class LLMResult(BaseModel):
    task: str
    model: str
    provider: str
    text: str
    latency_ms: int
    input_tokens: int | None = None
    output_tokens: int | None = None
    cached_tokens: int | None = None
    attempts: int = 1
    estimated_cost_usd: float | None = None
    pricing_status: str = "unknown"  # "estimate" (list-price table) | "unknown" (no price → cost null, never invented)
    context_format: str | None = None  # "toon" | "json" — how repeated structured context was serialized in the prompt
    structured_mode: str | None = None  # "json_schema" (strict) | "json_object" (schema-in-prompt) | "fixture"


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

    async def generate_structured(self, task: str, system: str, user: str, schema: type[T], *, model: str | None = None,
                                  context: dict[str, Any] | None = None) -> tuple[T, LLMResult] | None:
        """Native strict structured output (JSON Schema at the API boundary). None → provider has no native mode."""
        return None

    async def structured(self, task: str, system: str, user: str, schema: type[T], *, model: str | None = None,
                         context: dict[str, Any] | None = None) -> tuple[T, LLMResult]:
        """Typed call validated against `schema`. Native strict JSON-Schema output when available; otherwise JSON mode
        with the schema in the prompt and ONE repair attempt carrying the validation errors; then fail safely."""
        budget = budget_var.get()
        if budget is not None:
            budget.take(task)
        ctx = dict(context or {})
        native = await self.generate_structured(task, system, user, schema, model=model, context=ctx)
        if native is not None:
            obj, res = native
            res.context_format = ctx.get("context_format")
            if budget is not None:
                budget.add(res.estimated_cost_usd)
            return obj, res
        schema_text = json.dumps(schema.model_json_schema(), indent=None)
        sys_prompt = f"{system}\n\nRespond with a single JSON object that validates against this JSON Schema. No prose.\n{schema_text}"
        last_err = ""
        for attempt in (1, 2):
            prompt = user if attempt == 1 else f"{user}\n\nYour previous answer failed validation:\n{last_err}\nReturn corrected JSON only."
            if attempt == 2 and budget is not None:
                budget.take(f"{task}:repair")  # the repair attempt is a second call; it draws from the same budget
            res = await self.generate(task, sys_prompt, prompt, model=model, json_mode=True, context=ctx)
            res.attempts, res.context_format = attempt, ctx.get("context_format")
            res.structured_mode = res.structured_mode or "json_object"
            if budget is not None:
                budget.add(res.estimated_cost_usd)
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
    """Microsoft Foundry / Azure OpenAI through the GA v1 API (`<endpoint>/openai/v1/`, no api-version):
    Responses API with strict JSON-Schema structured outputs, prompt-cache telemetry, bounded retries, a concurrency cap.
    Models are deployment names from configuration. Auth: API key locally, DefaultAzureCredential (Entra ID) otherwise."""

    name = "foundry"

    def __init__(self) -> None:
        from openai import AsyncOpenAI

        s = settings()
        if not s.foundry_endpoint:
            raise ProviderError("FOUNDRY_ENDPOINT is not set")
        base = s.foundry_endpoint.rstrip("/") + "/openai/v1/"
        self._credential = None if s.foundry_api_key else EntraCredential()
        self.client = AsyncOpenAI(base_url=base, api_key=s.foundry_api_key or self._credential.provider(), timeout=90, max_retries=s.max_retries)  # type: ignore[union-attr]
        self.api = s.foundry_api
        self._sem = asyncio.Semaphore(max(1, s.max_concurrent_calls))
        self._strict_ok: dict[str, bool] = {}  # schema name → whether the API accepted the strict schema

    @staticmethod
    def _sampling(model: str) -> dict[str, Any]:
        """`temperature` is rejected by reasoning-family deployments (gpt-5*, o1/o3/o4*); everything else gets 0 for determinism."""
        m = model.lower()
        if m.startswith(("gpt-5", "o1", "o3", "o4")):
            return {}
        return {"temperature": 0}

    @staticmethod
    def _usage(usage: Any) -> tuple[int | None, int | None, int | None]:
        if usage is None:
            return None, None, None
        inp = getattr(usage, "input_tokens", None) or getattr(usage, "prompt_tokens", None)
        out = getattr(usage, "output_tokens", None) or getattr(usage, "completion_tokens", None)
        details = getattr(usage, "input_tokens_details", None) or getattr(usage, "prompt_tokens_details", None)
        cached = getattr(details, "cached_tokens", None) if details is not None else None
        return inp, out, cached

    def _result(self, task: str, m: str, text: str, t0: float, usage: Any, mode: str | None) -> LLMResult:
        inp, out, cached = self._usage(usage)
        cost = estimate_cost(m, inp, out, cached)
        return LLMResult(task=task, model=m, provider=self.name, text=text, latency_ms=int((time.perf_counter() - t0) * 1000),
                         input_tokens=inp, output_tokens=out, cached_tokens=cached, estimated_cost_usd=cost, pricing_status=pricing_status(m, cost),
                         structured_mode=mode)

    async def generate_structured(self, task, system, user, schema, *, model=None, context=None):
        m = self.model_for(task, model)
        if self._strict_ok.get(schema.__name__) is False:
            return None  # this schema was rejected by the API once: use JSON mode with the schema in the prompt
        t0 = time.perf_counter()
        try:
            async with self._sem:
                if self.api == "responses":
                    # stable instructions first (prompt-cache prefix), dynamic content in the input
                    resp = await self.client.responses.parse(model=m, instructions=system, input=user, text_format=schema, **self._sampling(m))
                    parsed, usage, text = resp.output_parsed, resp.usage, resp.output_text  # type: ignore[assignment]
                else:
                    cc = await self.client.chat.completions.parse(
                        model=m, response_format=schema, **self._sampling(m),
                        messages=[{"role": "system", "content": system}, {"role": "user", "content": user}])
                    parsed, usage, text = cc.choices[0].message.parsed, cc.usage, cc.choices[0].message.content or ""  # type: ignore[assignment]
        except Exception as e:  # noqa: BLE001
            msg = str(e)
            if _schema_rejected(e):
                log.warning("Foundry rejected strict schema %s (%s); falling back to JSON mode for this schema", schema.__name__, msg[:160])
                self._strict_ok[schema.__name__] = False
                return None
            raise ProviderError(f"Foundry call failed ({type(e).__name__}): {msg[:200]}") from e
        self._strict_ok[schema.__name__] = True
        if parsed is None:  # refusal or empty output: one bounded repair through the JSON-mode path
            log.warning("Foundry returned no parsed output for %s; falling back to JSON mode once", task)
            return None
        return parsed, self._result(task, m, text, t0, usage, "json_schema")

    async def generate(self, task, system, user, *, model=None, json_mode=False, context=None) -> LLMResult:
        m = self.model_for(task, model)
        t0 = time.perf_counter()
        try:
            async with self._sem:
                if self.api == "responses":
                    kw: dict[str, Any] = {"model": m, "instructions": system, "input": user, **self._sampling(m)}
                    if json_mode:
                        kw["text"] = {"format": {"type": "json_object"}}
                    r = await self.client.responses.create(**kw)
                    return self._result(task, m, r.output_text, t0, r.usage, "json_object" if json_mode else None)
                kwargs: dict[str, Any] = {"model": m, **self._sampling(m),
                                          "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}]}
                if json_mode:
                    kwargs["response_format"] = {"type": "json_object"}
                resp = await self.client.chat.completions.create(**kwargs)
                return self._result(task, m, resp.choices[0].message.content or "", t0, resp.usage, "json_object" if json_mode else None)
        except ProviderError:
            raise
        except Exception as e:  # noqa: BLE001
            raise ProviderError(f"Foundry call failed ({type(e).__name__}): {str(e)[:200]}") from e

    async def aclose(self) -> None:
        await self.client.close()
        if self._credential is not None:
            await self._credential.aclose()

    async def embed(self, texts):
        try:
            async with self._sem:
                resp = await self.client.embeddings.create(model=settings().embedding_model, input=texts)
        except Exception as e:  # noqa: BLE001
            log.warning("embedding failed (%s); keyword-only retrieval", e)
            return None
        return [d.embedding for d in resp.data]


class EntraCredential:
    """Entra ID token source for `AsyncOpenAI`. The async client *awaits* its `api_key` callable, so this must be the
    `azure.identity.aio` provider (returns a coroutine); the sync `azure.identity.get_bearer_token_provider` returns a plain
    str and fails with "object str can't be used in 'await' expression". DefaultAzureCredential (aio) picks up `az login`
    locally and the managed identity in Azure; scope is the Cognitive Services resource. `aclose()` releases its HTTP session."""

    SCOPE = "https://cognitiveservices.azure.com/.default"

    def __init__(self) -> None:
        from azure.identity.aio import DefaultAzureCredential

        self.credential = DefaultAzureCredential()

    def provider(self) -> Callable[[], Awaitable[str]]:
        from azure.identity.aio import get_bearer_token_provider

        return get_bearer_token_provider(self.credential, self.SCOPE)

    async def aclose(self) -> None:
        await self.credential.close()


def entra_token_provider() -> Callable[[], Awaitable[str]]:
    return EntraCredential().provider()


def _schema_rejected(e: Exception) -> bool:
    """400 from the API about the JSON Schema itself (unsupported keyword etc.) — not a transport/auth failure."""
    status = getattr(e, "status_code", None)
    msg = str(e).lower()
    return status == 400 and ("schema" in msg or "json_schema" in msg or "response_format" in msg or "text.format" in msg)


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
        return LLMResult(task=task, model="stub-fixture", provider=self.name, text=self._fixture(task, context), latency_ms=0, structured_mode="fixture")

    async def embed(self, texts):
        return None


_provider: LLMProvider | None = None


def provider() -> LLMProvider:
    global _provider
    if _provider is None:
        s = settings()
        if s.foundry_configured:
            _provider = FoundryProvider()
        elif s.ai_provider == "foundry" and s.environment != "dev":
            raise ProviderError(f"AI_PROVIDER=foundry but FOUNDRY_ENDPOINT is empty in {s.environment}; refusing to fall back to fixtures")
        else:
            _provider = StubProvider()
            log.warning("AI provider is the STUB — no model calls will be made; outputs come from evals/scenarios fixtures (dev only)")
    return _provider
