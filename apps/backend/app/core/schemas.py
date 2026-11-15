"""Shared Pydantic schemas and reusable field types.

Module-local schemas live in ``app/modules/<name>/schemas.py``; only
schemas referenced by more than one module belong here. Adding a schema
here is justified only after at least two modules need it (otherwise
the schema stays local — see ARCHITECTURE.md "minimal cross-module
surface").
"""

from __future__ import annotations

from typing import Annotated

from pydantic import AfterValidator, BaseModel


class PaginationMeta(BaseModel):
    """Page metadata for paginated list responses."""

    total: int
    page: int
    page_size: int
    total_pages: int


class MessageResponse(BaseModel):
    """Generic ``{"message": "..."}`` response body."""

    message: str


def _check_authors(v: list[str]) -> list[str]:
    """Per-element author string check.

    Pydantic's ``list[str]`` + ``Field(min_length=1, max_length=200)``
    already enforces "non-empty list, at most 200 entries". This validator
    adds the per-string constraint that each author is 1..200 chars.
    """
    for a in v:
        if not a or len(a) > 200:
            raise ValueError("each author must be 1..200 chars")
    return v


# Reusable author-list field type. Combines Pydantic's length constraints
# on the list with a per-element string check, so callers can declare
# ``authors: Authors = Field(min_length=1, max_length=200)`` without
# re-declaring the classmethod validator.
Authors = Annotated[list[str], AfterValidator(_check_authors)]


__all__ = ["Authors", "MessageResponse", "PaginationMeta"]
