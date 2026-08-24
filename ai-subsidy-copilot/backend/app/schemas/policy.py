from datetime import date

from pydantic import BaseModel, Field


class PolicyCitation(BaseModel):
    document: str
    section: str
    article: str | None = None
    version: str | None = None


class PolicySearchResult(BaseModel):
    id: str | None = None
    content: str
    score: float = Field(ge=0, le=1)
    citation: PolicyCitation
    effective_from: date | None = None
    effective_to: date | None = None
    topic: str | None = None


class PolicyAnswer(BaseModel):
    answer: str
    citations: list[PolicyCitation] = Field(default_factory=list)
    established: bool
    ai_used: bool = False
    notice: str | None = None


class PolicyQuery(BaseModel):
    query: str = Field(min_length=2, max_length=1000)
    top_k: int = Field(default=4, ge=1, le=10)
