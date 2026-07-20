import json
from collections import Counter

from fastapi import APIRouter, Depends
from sqlalchemy import func
from sqlalchemy.orm import Session

from .. import models
from ..database import get_db

router = APIRouter(prefix="/api/analytics", tags=["analytics"])


@router.get("/summary")
def summary(db: Session = Depends(get_db)):
    T = models.Translation

    total = db.query(func.count(T.id)).scalar() or 0
    totals = db.query(
        func.coalesce(func.sum(T.input_tokens), 0),
        func.coalesce(func.sum(T.output_tokens), 0),
        func.coalesce(func.sum(T.cost_usd), 0.0),
        func.coalesce(func.avg(T.latency_ms), 0.0),
    ).one()

    tone_rows = db.query(T.tone, func.count(T.id)).group_by(T.tone).all()
    ctx_rows = (
        db.query(T.context, func.count(T.id))
        .filter(T.mode == "forward")
        .group_by(T.context)
        .all()
    )

    # Average professionalism lift and top rewritten phrases,
    # computed over the most recent 500 forward translations.
    recent = (
        db.query(T.scores_before, T.scores_after, T.changes)
        .filter(T.mode == "forward", T.tone != "compare")
        .order_by(T.id.desc())
        .limit(500)
        .all()
    )
    lifts, phrases = [], Counter()
    for before_s, after_s, changes_s in recent:
        try:
            before, after = json.loads(before_s or "{}"), json.loads(after_s or "{}")
            if "professionalism" in before and "professionalism" in after:
                lifts.append(float(after["professionalism"]) - float(before["professionalism"]))
            for c in json.loads(changes_s or "[]"):
                key = str(c.get("from", "")).lower().strip()
                if key:
                    phrases[key] += 1
        except (ValueError, TypeError):
            continue

    fb_up = db.query(func.count(T.id)).filter(T.feedback == 1).scalar() or 0
    fb_down = db.query(func.count(T.id)).filter(T.feedback == -1).scalar() or 0

    return {
        "total_requests": total,
        "total_tokens": int(totals[0]) + int(totals[1]),
        "total_input_tokens": int(totals[0]),
        "total_output_tokens": int(totals[1]),
        "total_cost_usd": round(float(totals[2]), 6),
        "avg_cost_per_request_usd": round(float(totals[2]) / total, 6) if total else 0.0,
        "avg_latency_ms": round(float(totals[3]), 1),
        "avg_professionalism_lift": round(sum(lifts) / len(lifts), 1) if lifts else None,
        "tone_distribution": {tone: n for tone, n in tone_rows},
        "context_distribution": {ctx: n for ctx, n in ctx_rows},
        "top_rewritten_phrases": phrases.most_common(10),
        "feedback": {"up": fb_up, "down": fb_down},
    }


@router.get("/recent")
def recent(limit: int = 20, db: Session = Depends(get_db)):
    T = models.Translation
    rows = db.query(T).order_by(T.id.desc()).limit(min(limit, 100)).all()
    return [
        {
            "id": r.id,
            "created_at": r.created_at.isoformat() if r.created_at else None,
            "mode": r.mode,
            "tone": r.tone,
            "context": r.context,
            "input_text": r.input_text,
            "output_text": r.output_text,
            "cost_usd": r.cost_usd,
            "latency_ms": r.latency_ms,
            "feedback": r.feedback,
        }
        for r in rows
    ]
