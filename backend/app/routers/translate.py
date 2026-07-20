import json

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from .. import llm, models, prompts
from ..database import get_db
from ..schemas import FeedbackRequest, TranslateRequest

router = APIRouter(prefix="/api", tags=["translate"])


@router.post("/translate")
async def translate(req: TranslateRequest, db: Session = Depends(get_db)):
    prompt = prompts.build(req)
    try:
        parsed, meta = await llm.complete(prompt)
    except llm.LLMError as exc:
        raise HTTPException(status_code=502, detail=str(exc))

    if req.compare:
        output_text = json.dumps(parsed.get("variants", []))
        tone = "compare"
    else:
        output_text = parsed.get("translation", "")
        tone = "decode" if req.mode == "reverse" else req.tone

    row = models.Translation(
        mode=req.mode,
        tone=tone,
        context=req.context,
        modifiers=json.dumps(req.modifiers),
        input_text=req.text,
        output_text=output_text,
        changes=json.dumps(parsed.get("changes", [])),
        scores_before=json.dumps(parsed.get("scores_before", {})),
        scores_after=json.dumps(parsed.get("scores_after", {})),
        input_tokens=meta["input_tokens"],
        output_tokens=meta["output_tokens"],
        cost_usd=meta["cost_usd"],
        latency_ms=meta["latency_ms"],
    )
    db.add(row)
    db.commit()
    db.refresh(row)

    return {**parsed, "meta": meta, "id": row.id}


@router.post("/feedback")
def feedback(req: FeedbackRequest, db: Session = Depends(get_db)):
    row = db.get(models.Translation, req.translation_id)
    if not row:
        raise HTTPException(status_code=404, detail="Translation not found")
    row.feedback = req.rating
    db.commit()
    return {"ok": True}
