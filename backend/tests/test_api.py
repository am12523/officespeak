import os

os.environ["DATABASE_URL"] = "sqlite:///./test_officespeak.db"

import pytest
from fastapi.testclient import TestClient

from app import llm
from app.database import Base, engine
from app.main import app

FAKE_RESULT = {
    "translation": "I won't be able to complete this today; I can deliver it tomorrow afternoon.",
    "changes": [{"from": "no way", "to": "won't be able to", "reason": "Less abrupt."}],
    "scores_before": {"buzzword_density": 5, "readability": 90, "professionalism": 30},
    "scores_after": {"buzzword_density": 10, "readability": 85, "professionalism": 92},
}
FAKE_META = {"input_tokens": 300, "output_tokens": 120, "cost_usd": 0.0027, "latency_ms": 850}


@pytest.fixture(autouse=True)
def setup_db(monkeypatch):
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)

    async def fake_complete(prompt):
        return FAKE_RESULT, FAKE_META

    monkeypatch.setattr(llm, "complete", fake_complete)
    yield


client = TestClient(app)


def test_health():
    assert client.get("/health").json()["status"] == "ok"


def test_translate_persists_and_returns_meta():
    r = client.post(
        "/api/translate",
        json={"text": "no way I can finish this today", "mode": "forward", "tone": "professional", "context": "slack"},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["translation"] == FAKE_RESULT["translation"]
    assert body["meta"]["cost_usd"] == FAKE_META["cost_usd"]
    assert isinstance(body["id"], int)


def test_validation_rejects_empty_text():
    assert client.post("/api/translate", json={"text": ""}).status_code == 422


def test_feedback_roundtrip():
    tid = client.post("/api/translate", json={"text": "hey"}).json()["id"]
    assert client.post("/api/feedback", json={"translation_id": tid, "rating": 1}).json()["ok"]
    assert client.post("/api/feedback", json={"translation_id": 99999, "rating": 1}).status_code == 404


def test_analytics_summary_aggregates():
    for _ in range(3):
        client.post("/api/translate", json={"text": "hey", "tone": "executive", "context": "email"})
    s = client.get("/api/analytics/summary").json()
    assert s["total_requests"] == 3
    assert s["total_tokens"] == 3 * (300 + 120)
    assert s["tone_distribution"]["executive"] == 3
    assert s["context_distribution"]["email"] == 3
    assert s["avg_professionalism_lift"] == 62.0
    assert s["top_rewritten_phrases"][0][0] == "no way"


def test_analytics_recent():
    client.post("/api/translate", json={"text": "hello"})
    rows = client.get("/api/analytics/recent?limit=5").json()
    assert len(rows) == 1
    assert rows[0]["input_text"] == "hello"
