from typing import List, Optional
from pydantic import BaseModel, ConfigDict, Field


class TranslateRequest(BaseModel):
    text: str = Field(min_length=1, max_length=4000)
    mode: str = Field(default="forward", pattern="^(forward|reverse)$")
    tone: str = "professional"
    context: str = "chat"
    modifiers: List[str] = []
    compare: bool = False
    # Refinement loop: revise a previous output per a user instruction.
    previous: Optional[str] = Field(default=None, max_length=4000)
    instruction: Optional[str] = Field(default=None, max_length=300)


class FeedbackRequest(BaseModel):
    translation_id: int
    rating: int = Field(ge=-1, le=1)


class Meta(BaseModel):
    input_tokens: int
    output_tokens: int
    cost_usd: float
    latency_ms: int


class Change(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    from_: Optional[str] = Field(default=None, alias="from")
    to: Optional[str] = None
    reason: Optional[str] = None
