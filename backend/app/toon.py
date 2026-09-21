"""TOON adapter — the one place that knows about Token-Oriented Object Notation.

Boundary rule (azureDecision.md §7):
    typed Python object ──► TOON     for repeated structured *context* handed to a model (obligations, chunks, evidence)
    typed Python object ──► JSON     at every API boundary that requires it (Foundry structured-output JSON Schema,
                                     Jev state dicts, Azure Search, GitHub, the database)

`format_context` is the only entry point the agents use. It returns the text plus which format was actually produced,
so telemetry can record TOON vs JSON per call. If the encoder fails, or the round-trip does not validate, it falls back
to compact JSON exactly once and records TOON_FALLBACK — never a retry loop.

Implementation: the official Python package `toon-format` (github.com/toon-format/toon-python, spec toonformat.dev).
Token counts use tiktoken's o200k_base (GPT-4o / GPT-4.1 / GPT-5 family); that is a local measurement, never a model call.
"""

from __future__ import annotations

import json
import logging
from functools import lru_cache
from typing import Any, Literal

from pydantic import BaseModel

log = logging.getLogger(__name__)

Format = Literal["toon", "json"]


class ContextBlock(BaseModel):
    text: str
    format: Format
    tokens: int
    json_tokens: int  # compact-JSON tokens of the same payload, for the measured comparison
    fallback: bool = False


def _plain(value: Any) -> Any:
    if isinstance(value, BaseModel):
        return value.model_dump(mode="json", exclude_none=True)
    if isinstance(value, list):
        return [_plain(v) for v in value]
    if isinstance(value, dict):
        return {k: _plain(v) for k, v in value.items()}
    return value


def compact_json(value: Any) -> str:
    return json.dumps(_plain(value), separators=(",", ":"), ensure_ascii=False)


def pretty_json(value: Any) -> str:
    return json.dumps(_plain(value), indent=2, ensure_ascii=False)


def to_toon(value: Any) -> str:
    from toon_format import encode

    return encode(_plain(value))


def from_toon(text: str) -> Any:
    from toon_format import decode

    return decode(text)


def validate_toon(text: str, schema: type[BaseModel] | None = None) -> Any:
    """Parse TOON and, when a schema is given, validate the typed object. Raises on any failure."""
    obj = from_toon(text)
    return schema.model_validate(obj) if schema else obj


@lru_cache(maxsize=1)
def _enc():
    import tiktoken

    return tiktoken.get_encoding("o200k_base")


def count_tokens(text: str) -> int:
    return len(_enc().encode(text))


def format_context(value: Any, *, prefer: Format = "toon") -> ContextBlock:
    """Encode a payload for a model prompt. TOON when preferred and round-trip-safe, else compact JSON."""
    plain = _plain(value)
    js = compact_json(plain)
    js_tokens = count_tokens(js)
    if prefer == "json":
        return ContextBlock(text=js, format="json", tokens=js_tokens, json_tokens=js_tokens)
    try:
        text = to_toon(plain)
        if from_toon(text) != plain:  # the spec round-trips; anything else means we would feed the model corrupted context
            raise ValueError("TOON round-trip mismatch")
        return ContextBlock(text=text, format="toon", tokens=count_tokens(text), json_tokens=js_tokens)
    except Exception as e:  # noqa: BLE001 — bounded fallback, recorded, never retried
        log.warning("TOON_FALLBACK: %s: %s", type(e).__name__, str(e)[:120])
        return ContextBlock(text=js, format="json", tokens=js_tokens, json_tokens=js_tokens, fallback=True)


def compare(value: Any) -> dict[str, int]:
    """Local token measurement of the three representations for one payload (benchmark + telemetry)."""
    plain = _plain(value)
    out = {"pretty_json": count_tokens(pretty_json(plain)), "compact_json": count_tokens(compact_json(plain))}
    try:
        out["toon"] = count_tokens(to_toon(plain))
    except Exception:  # noqa: BLE001
        out["toon"] = -1
    return out
