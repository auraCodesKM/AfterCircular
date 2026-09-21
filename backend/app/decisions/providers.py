"""Judgment providers: one state + typed questions → typed answers with probabilities.

The question objects are the TypeSafe SDK types (Noul / Choice / Score) — they are the contract for every provider,
so a task can be re-routed from Jev to a Foundry emulation or a fixture without touching business logic.

- TypeSafeJudgmentProvider: Jev via `typesafe_sdk` (POST /v1/systemone). Calibrated probabilities.
- FoundryJudgmentProvider: asks a chat model to answer the same questions as JSON. Self-reported probabilities are
  NOT calibrated; exists for the evaluation harness and as a fallback, labelled `calibrated=False`.
- StubJudgmentProvider: fixture answers from evals/scenarios; labelled everywhere. No AI.
"""

import hashlib
import json
import logging
import time
from abc import ABC, abstractmethod
from typing import Any

from typesafe_sdk import AsyncTypeSafeClient, Choice, Noul, RetryPolicy, Score, TypeSafeAPIError, TypeSafeError

from app.config import settings
from app.schemas.decisions import Answer, JudgeName, Judgment

log = logging.getLogger(__name__)
Question = Noul | Choice | Score


class JudgmentError(RuntimeError):
    pass


def state_digest(state: Any) -> str:
    return hashlib.sha256(json.dumps(state, sort_keys=True, default=str).encode()).hexdigest()


def question_json(q: Question) -> dict[str, Any]:
    return q.model_dump(exclude_none=True) if hasattr(q, "model_dump") else dict(q)  # type: ignore[arg-type]


class JudgmentProvider(ABC):
    name: JudgeName
    calibrated: bool

    @abstractmethod
    async def ask(self, task: str, state: Any, questions: dict[str, Question], *, model: str | None = None,
                  context: dict[str, Any] | None = None) -> Judgment: ...

    async def aclose(self) -> None:
        return None


class TypeSafeJudgmentProvider(JudgmentProvider):
    name = "typesafe"
    calibrated = True

    def __init__(self) -> None:
        s = settings()
        if not s.typesafe_api_key:
            raise JudgmentError("TYPESAFE_API_KEY is not set")
        self.model = s.typesafe_model
        self.client = AsyncTypeSafeClient(api_key=s.typesafe_api_key, model=self.model, timeout=60.0,
                                          retry=RetryPolicy(max_retries=3))

    async def ask(self, task, state, questions, *, model=None, context=None) -> Judgment:
        t0 = time.perf_counter()
        try:
            res = await self.client.system_one(state, questions, model=model or self.model)
        except TypeSafeAPIError as e:
            raise JudgmentError(f"TypeSafe {task} failed (HTTP {e.status}): {str(e)[:160]}") from e
        except TypeSafeError as e:
            raise JudgmentError(f"TypeSafe {task} failed ({type(e).__name__}): {str(e)[:160]}") from e
        answers: dict[str, Answer] = {}
        for qid, a in res.answers.items():
            if a.type == "noul":
                answers[qid] = Answer(type="noul", noul=float(a.noul))
            elif a.type == "choice":
                answers[qid] = Answer(type="choice", choice=a.choice, probabilities={k: float(v) for k, v in a.probabilities.items()}, confidence=float(a.confidence))
            else:
                answers[qid] = Answer(type="score", score=float(a.score), probabilities={str(k): float(v) for k, v in a.probabilities.items()}, confidence=float(a.confidence))
        return Judgment(provider="typesafe", model=res.model, calibrated=True, answers=answers, input_tokens=res.usage.input_tokens,
                        output_tokens=res.usage.output_tokens, latency_ms=int((time.perf_counter() - t0) * 1000))

    async def aclose(self) -> None:
        await self.client.aclose()


class FoundryJudgmentProvider(JudgmentProvider):
    """Emulates System One questions with a generative model. Probabilities are the model's own estimates."""

    name = "foundry"
    calibrated = False
    SYSTEM = ("You answer typed questions about a JSON state. For each question id return exactly the requested shape. "
              "noul → {\"noul\": p} with p = probability the answer is yes in [0,1]. "
              "choice → {\"choice\": option, \"probabilities\": {option: p}} summing to 1 over the given options. "
              "score → {\"score\": weighted level index, \"probabilities\": {level_index: p}}. "
              "Respond with one JSON object keyed by question id. No prose.")

    def __init__(self) -> None:
        from app.models.provider import FoundryProvider

        self.llm = FoundryProvider()

    async def ask(self, task, state, questions, *, model=None, context=None) -> Judgment:
        from app.models.provider import ProviderError, _extract_json

        payload = {"state": state, "questions": {k: question_json(q) for k, q in questions.items()}}
        try:
            res = await self.llm.generate("impact", self.SYSTEM, json.dumps(payload, default=str), model=model, json_mode=True)
            raw = _extract_json(res.text)
        except (ProviderError, ValueError) as e:
            raise JudgmentError(f"Foundry judgment {task} failed: {str(e)[:160]}") from e
        answers: dict[str, Answer] = {}
        for qid, q in questions.items():
            a = raw.get(qid) or {}
            qt = question_json(q)["type"]
            try:
                if qt == "noul":
                    answers[qid] = Answer(type="noul", noul=min(1.0, max(0.0, float(a.get("noul", 0.5)))))
                elif qt == "choice":
                    probs = {k: float(a.get("probabilities", {}).get(k, 0.0)) for k in question_json(q)["criteria"]}
                    total = sum(probs.values()) or 1.0
                    probs = {k: v / total for k, v in probs.items()}
                    choice = max(probs, key=lambda k: probs[k])
                    answers[qid] = Answer(type="choice", choice=choice, probabilities=probs, confidence=_choice_confidence(list(probs.values())))
                else:
                    levels = question_json(q)["criteria"]
                    probs = {str(i): float(a.get("probabilities", {}).get(str(i), 0.0)) for i in range(len(levels))}
                    total = sum(probs.values()) or 1.0
                    probs = {k: v / total for k, v in probs.items()}
                    score = sum(int(k) * v for k, v in probs.items())
                    answers[qid] = Answer(type="score", score=score, probabilities=probs, confidence=_choice_confidence(list(probs.values())))
            except (TypeError, ValueError):
                raise JudgmentError(f"Foundry judgment {task}: malformed answer for {qid}") from None
        return Judgment(provider="foundry", model=res.model, calibrated=False, answers=answers, input_tokens=res.input_tokens,
                        output_tokens=res.output_tokens, latency_ms=res.latency_ms)


def _choice_confidence(probs: list[float]) -> float:
    """Same shape as the docs' demo statistic: (n·max − 1)/(n − 1); 1 = all mass on one option, 0 = uniform."""
    n = len(probs)
    if n < 2:
        return 1.0
    return max(0.0, min(1.0, (n * max(probs) - 1) / (n - 1)))


class StubJudgmentProvider(JudgmentProvider):
    """Fixture answers keyed by task + question id in evals/scenarios[*].fixtures.judgments; unknown ids get a
    neutral answer that routes to escalation, never to a confident decision."""

    name = "stub"
    calibrated = False

    async def ask(self, task, state, questions, *, model=None, context=None) -> Judgment:
        from evals.dataset import load_scenarios

        doc_id = (context or {}).get("document_id")
        fixtures: dict[str, Any] = {}
        for sc in load_scenarios():
            if sc.get("document", {}).get("document_id") == doc_id:
                fixtures = dict(sc.get("fixtures", {}).get("judgments", {}).get(task, {}))
        # per-chunk fixtures (rerank / alignment): fixtures.judgments.<task>.by_chunk["POL-001#4.1"] = {...}
        chunk = state.get("policy_chunk") if isinstance(state, dict) else None
        if chunk and "by_chunk" in fixtures:
            import re as _re

            m = _re.match(r"^(\d+(?:\.\d+)*)", str(chunk.get("section", "")))
            key = f"{chunk.get('doc_id')}#{m.group(1) if m else chunk.get('section')}"
            fixtures = {**{k: v for k, v in fixtures.items() if k != "by_chunk"}, **fixtures["by_chunk"].get(key, {})}
        answers: dict[str, Answer] = {}
        for qid, q in questions.items():
            qt = question_json(q)["type"]
            fx = fixtures.get(qid) or fixtures.get(qid.rsplit(":", 1)[-1]) or {}
            if qt == "noul":
                answers[qid] = Answer(type="noul", noul=float(fx.get("noul", 0.5)))
            elif qt == "choice":
                opts = list(question_json(q)["criteria"])
                choice = fx.get("choice", opts[0])
                probs = fx.get("probabilities") or {o: (1.0 if o == choice else 0.0) for o in opts}
                answers[qid] = Answer(type="choice", choice=choice, probabilities=probs, confidence=float(fx.get("confidence", _choice_confidence(list(probs.values())) if fx else 0.0)))
            else:
                n = len(question_json(q)["criteria"])
                score = float(fx.get("score", (n - 1) / 2))
                answers[qid] = Answer(type="score", score=score, probabilities=fx.get("probabilities") or {str(i): 1.0 / n for i in range(n)}, confidence=float(fx.get("confidence", 0.0)))
        return Judgment(provider="stub", model="stub-fixture", calibrated=False, answers=answers, latency_ms=0)


_providers: dict[str, JudgmentProvider] = {}


def judge_for(task: str) -> JudgmentProvider:
    """Task → provider, from DECISION_ROUTES (e.g. 'applicability=typesafe,rerank=typesafe,alignment=typesafe')."""
    s = settings()
    name = s.decision_routes.get(task, s.default_judge)
    if name == "typesafe" and not s.typesafe_api_key:
        log.warning("task %s routed to typesafe but TYPESAFE_API_KEY is empty; using stub", task)
        name = "stub"
    if name == "foundry" and not s.foundry_configured:
        log.warning("task %s routed to foundry but Foundry is not configured; using stub", task)
        name = "stub"
    if name not in _providers:
        factory: dict[str, type[JudgmentProvider]] = {"typesafe": TypeSafeJudgmentProvider, "foundry": FoundryJudgmentProvider, "stub": StubJudgmentProvider}
        _providers[name] = factory[name]()
    return _providers[name]
