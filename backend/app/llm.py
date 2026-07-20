"""LLM client layer with token/cost accounting.

Provider-agnostic: complete() dispatches on LLM_PROVIDER. Gemini is the
default because Google AI Studio keys have a real free tier; Anthropic is
kept as a drop-in alternative. Adding another provider (e.g. Grok, which is
OpenAI-compatible but paid) means adding one _provider() function.

Every provider returns (parsed_json, meta) where meta carries tokens, cost
and latency for persistence and the analytics dashboard.
"""
import json
import time

import httpx

from . import config


class LLMError(Exception):
    pass


def _repair_control_chars(s: str) -> str:
    """Escape literal newlines/tabs that models sometimes emit inside JSON strings."""
    out, in_str, esc = [], False, False
    for ch in s:
        if in_str:
            if esc:
                out.append(ch)
                esc = False
            elif ch == "\\":
                out.append(ch)
                esc = True
            elif ch == '"':
                in_str = False
                out.append(ch)
            elif ch == "\n":
                out.append("\\n")
            elif ch == "\r":
                out.append("\\r")
            elif ch == "\t":
                out.append("\\t")
            else:
                out.append(ch)
        else:
            if ch == '"':
                in_str = True
            out.append(ch)
    return "".join(out)


def _extract_json(text: str) -> dict:
    """Robust extraction: fence-strip, repair control chars inside strings,
    balanced-brace scan (string-aware), trailing-comma fallback."""
    import re as _re

    clean = text.replace("```json", "").replace("```", "").strip()
    start = clean.find("{")
    if start == -1:
        raise LLMError("Model response contained no JSON object")
    repaired = _repair_control_chars(clean[start:])

    depth, in_str, esc, end = 0, False, False, -1
    for i, ch in enumerate(repaired):
        if in_str:
            if esc:
                esc = False
            elif ch == "\\":
                esc = True
            elif ch == '"':
                in_str = False
        elif ch == '"':
            in_str = True
        elif ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                end = i
                break
    candidate = repaired[: end + 1] if end != -1 else repaired
    try:
        return json.loads(candidate)
    except json.JSONDecodeError:
        return json.loads(_re.sub(r",\s*([}\]])", r"\1", candidate))


def _meta(input_tokens: int, output_tokens: int, latency_ms: int) -> dict:
    cost = (
        input_tokens / 1_000_000 * config.PRICE_INPUT_PER_MTOK
        + output_tokens / 1_000_000 * config.PRICE_OUTPUT_PER_MTOK
    )
    return {
        "input_tokens": input_tokens,
        "output_tokens": output_tokens,
        "cost_usd": round(cost, 6),
        "latency_ms": latency_ms,
    }


def _is_model_retired(err: "LLMError") -> bool:
    msg = str(err)
    return "404" in msg and ("no longer available" in msg or "not found" in msg.lower())


async def _gemini_once(model: str, prompt: str) -> tuple[dict, dict]:
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
    started = time.monotonic()
    async with httpx.AsyncClient(timeout=60) as client:
        resp = await client.post(
            url,
            headers={"x-goog-api-key": config.GEMINI_API_KEY, "content-type": "application/json"},
            json={
                "contents": [{"parts": [{"text": prompt}]}],
                "generationConfig": {
                    "maxOutputTokens": config.MAX_TOKENS,
                    # Force pure-JSON output — no markdown fences to strip.
                    "responseMimeType": "application/json",
                    # NOTE: no thinkingConfig here. Gemini 3 removed thinking_budget
                    # (sending it returns 400); omitting it works across generations.
                },
            },
        )
    latency_ms = int((time.monotonic() - started) * 1000)

    if resp.status_code != 200:
        raise LLMError(f"Gemini API returned {resp.status_code}: {resp.text[:200]}")

    data = resp.json()
    try:
        parts = data["candidates"][0]["content"]["parts"]
    except (KeyError, IndexError) as exc:
        raise LLMError(f"Gemini returned no candidates: {str(data)[:200]}") from exc
    text = "\n".join(p.get("text", "") for p in parts)
    try:
        parsed = _extract_json(text)
    except json.JSONDecodeError as exc:
        raise LLMError(f"Model returned invalid JSON: {exc}") from exc

    usage = data.get("usageMetadata", {})
    meta = _meta(
        int(usage.get("promptTokenCount", 0)),
        int(usage.get("candidatesTokenCount", 0)) + int(usage.get("thoughtsTokenCount", 0)),
        latency_ms,
    )
    meta["model"] = model
    return parsed, meta


async def _gemini(prompt: str) -> tuple[dict, dict]:
    if not config.GEMINI_API_KEY:
        raise LLMError("GEMINI_API_KEY is not set (get a free key at https://aistudio.google.com/apikey)")

    candidates = [config.GEMINI_MODEL] + [
        m for m in config.GEMINI_FALLBACK_MODELS if m != config.GEMINI_MODEL
    ]
    last_err: LLMError | None = None
    for model in candidates:
        try:
            return await _gemini_once(model, prompt)
        except LLMError as err:
            # Only fall through on "model retired" 404s; real errors surface immediately.
            if _is_model_retired(err):
                last_err = err
                continue
            raise
    raise LLMError(
        f"All configured Gemini models appear retired ({', '.join(candidates)}). "
        f"Set GEMINI_MODEL to a current model. Last error: {last_err}"
    )


async def _anthropic(prompt: str) -> tuple[dict, dict]:
    if not config.ANTHROPIC_API_KEY:
        raise LLMError("ANTHROPIC_API_KEY is not set")

    started = time.monotonic()
    async with httpx.AsyncClient(timeout=60) as client:
        resp = await client.post(
            "https://api.anthropic.com/v1/messages",
            headers={
                "x-api-key": config.ANTHROPIC_API_KEY,
                "anthropic-version": config.ANTHROPIC_VERSION,
                "content-type": "application/json",
            },
            json={
                "model": config.ANTHROPIC_MODEL,
                "max_tokens": config.MAX_TOKENS,
                "messages": [{"role": "user", "content": prompt}],
            },
        )
    latency_ms = int((time.monotonic() - started) * 1000)

    if resp.status_code != 200:
        raise LLMError(f"Anthropic API returned {resp.status_code}: {resp.text[:200]}")

    data = resp.json()
    text = "\n".join(b.get("text", "") for b in data.get("content", []) if b.get("type") == "text")
    try:
        parsed = _extract_json(text)
    except json.JSONDecodeError as exc:
        raise LLMError(f"Model returned invalid JSON: {exc}") from exc

    usage = data.get("usage", {})
    return parsed, _meta(
        int(usage.get("input_tokens", 0)),
        int(usage.get("output_tokens", 0)),
        latency_ms,
    )


async def complete(prompt: str) -> tuple[dict, dict]:
    if config.LLM_PROVIDER == "anthropic":
        return await _anthropic(prompt)
    return await _gemini(prompt)
