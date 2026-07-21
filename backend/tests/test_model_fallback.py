import pytest

from app import config, llm

RETIRED = llm.LLMError(
    'Gemini API returned 404: {"error": {"code": 404, "message": "This model models/x is no longer available to new users."}}'
)
OK = ({"translation": "hi"}, {"input_tokens": 1, "output_tokens": 1, "cost_usd": 0.0, "latency_ms": 5, "model": "?"})


@pytest.mark.asyncio
async def test_falls_back_when_primary_model_is_retired(monkeypatch):
    calls = []

    async def fake_once(model, prompt):
        calls.append(model)
        if model == config.GEMINI_MODEL:
            raise RETIRED
        return OK

    monkeypatch.setattr(llm, "_gemini_once", fake_once)
    monkeypatch.setattr(config, "GEMINI_API_KEY", "dummy")
    parsed, meta = await llm._gemini("prompt")
    assert parsed["translation"] == "hi"
    assert calls[0] == config.GEMINI_MODEL and len(calls) == 2  # fell through exactly once


@pytest.mark.asyncio
async def test_non_retirement_errors_surface_immediately(monkeypatch):
    async def fake_once(model, prompt):
        raise llm.LLMError("Gemini API returned 429: rate limit exceeded")

    monkeypatch.setattr(llm, "_gemini_once", fake_once)
    monkeypatch.setattr(config, "GEMINI_API_KEY", "dummy")
    with pytest.raises(llm.LLMError, match="429"):
        await llm._gemini("prompt")


@pytest.mark.asyncio
async def test_all_retired_gives_actionable_error(monkeypatch):
    async def fake_once(model, prompt):
        raise RETIRED

    monkeypatch.setattr(llm, "_gemini_once", fake_once)
    monkeypatch.setattr(config, "GEMINI_API_KEY", "dummy")
    with pytest.raises(llm.LLMError, match="Set GEMINI_MODEL"):
        await llm._gemini("prompt")
