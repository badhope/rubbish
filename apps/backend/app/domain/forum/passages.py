"""Quoted passages for margin threads.

A reader can start a forum topic from a sentence they selected in a published
work. The topic stores the selection as the author's own words, so the server
must make sure those words are really in the work: a margin thread must never
put an invented sentence in an author's mouth.

The comparison is deliberately tolerant of rendering: the reader selected
text from rendered Markdown (no ``**``, link targets or line breaks), while
storage holds the Markdown source. Both sides are folded to letters and
digits only before the containment check, which ignores markup, spacing and
punctuation but still rejects any word the author did not write.
"""

from __future__ import annotations

import re
import uuid

from sqlalchemy import and_, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.storage import get_storage
from app.domain.submission.models import Submission

QUOTE_MAX = 600
CONTEXT_MAX = 64

_FOLD = re.compile(r"[\W_]+", re.UNICODE)
# The essay reader masks contact details before rendering (see the catalog
# manuscript endpoint); a quote taken from that page carries the placeholder.
_EMAIL = re.compile(r"[\w.+-]+@[\w-]+\.[\w.]+")
_PHONE = re.compile(r"\b1[3-9]\d{9}\b")
# Markdown that renders as something other than its source letters: images
# (no visible text), link and reference targets, autolinks and raw tags.
_IMAGE = re.compile(r"!\[[^\]]*\]\((?:[^()]|\([^)]*\))*\)")
_LINK = re.compile(r"\[([^\]]*)\]\((?:[^()]|\([^)]*\))*\)")
_REF_LINK = re.compile(r"\[([^\]]+)\]\[[^\]]*\]")
_REF_DEF = re.compile(r"^[ \t]*\[[^\]^]+\]:[ \t]*\S.*$", re.MULTILINE)
_AUTOLINK = re.compile(r"<(?:https?|mailto):[^>\s]+>")
_TAG = re.compile(r"</?[A-Za-z][^>]*>")


def visible_text(markdown: str) -> str:
    """Approximate the letters a reader sees once the Markdown is rendered."""
    text = _IMAGE.sub(" ", markdown or "")
    text = _LINK.sub(r"\1", text)
    text = _REF_LINK.sub(r"\1", text)
    text = _REF_DEF.sub(" ", text)
    text = _AUTOLINK.sub(" ", text)
    return _TAG.sub(" ", text)


def collapse(text: str) -> str:
    """Collapse runs of whitespace into single spaces and trim."""
    return " ".join((text or "").split())


def fold(text: str) -> str:
    """Letters and digits only, case-folded. CJK characters count as letters."""
    return _FOLD.sub("", text or "").casefold()


def clean_context(value: str | None, *, keep: str) -> str | None:
    """Trim a prefix (keep the tail) or suffix (keep the head) to CONTEXT_MAX."""
    text = collapse(value or "")
    if not text:
        return None
    return text[-CONTEXT_MAX:] if keep == "tail" else text[:CONTEXT_MAX]


def quote_in_text(quote: str, markdown: str) -> bool:
    needle = fold(quote)
    if len(needle) < 2:
        return False
    text = visible_text(markdown)
    if needle in fold(text):
        return True
    masked = _PHONE.sub("[手机号已隐藏]", _EMAIL.sub("[邮箱已隐藏]", text))
    return needle in fold(masked)


async def load_manuscript_markdown(
    db: AsyncSession, *, tenant_id: uuid.UUID, resource_id: int
) -> str | None:
    """Return the Markdown body that the reading page shows, if any.

    Mirrors the catalog manuscript endpoint: the first submission that carries
    either a Markdown body or an uploaded file decides. When that submission
    has no Markdown, there is no online text to quote from.
    """
    submission = (
        (
            await db.execute(
                select(Submission)
                .where(
                    Submission.resource_id == resource_id,
                    Submission.tenant_id == tenant_id,
                    or_(
                        and_(Submission.markdown_path.is_not(None), Submission.markdown_path != ""),
                        and_(Submission.file_path.is_not(None), Submission.file_path != ""),
                    ),
                )
                .order_by(Submission.id.asc())
                .limit(1)
            )
        )
        .scalars()
        .first()
    )
    if submission is None or not submission.markdown_path:
        return None
    try:
        data = await get_storage().load(submission.markdown_path)
    except FileNotFoundError:
        return None
    return data.decode("utf-8", errors="replace")


__all__ = [
    "CONTEXT_MAX",
    "QUOTE_MAX",
    "clean_context",
    "collapse",
    "fold",
    "load_manuscript_markdown",
    "quote_in_text",
    "visible_text",
]
