from datetime import datetime, timezone

from sqlalchemy import Column, Integer, String, Text, Float, DateTime

from .database import Base


class Translation(Base):
    """One row per LLM request — the source of truth for the analytics dashboard."""

    __tablename__ = "translations"

    id = Column(Integer, primary_key=True, index=True)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc), index=True)

    mode = Column(String(16), index=True)          # forward | reverse
    tone = Column(String(32), index=True)          # voice id, "compare", or "decode"
    context = Column(String(32), index=True)       # slack | email | teams | review | client
    modifiers = Column(Text, default="[]")         # JSON list of modifier ids

    input_text = Column(Text)
    output_text = Column(Text)
    changes = Column(Text, default="[]")           # JSON list of {from, to, reason}
    scores_before = Column(Text, default="{}")     # JSON
    scores_after = Column(Text, default="{}")      # JSON

    input_tokens = Column(Integer, default=0)
    output_tokens = Column(Integer, default=0)
    cost_usd = Column(Float, default=0.0)
    latency_ms = Column(Integer, default=0)

    feedback = Column(Integer, nullable=True)      # 1 = thumbs up, -1 = thumbs down
