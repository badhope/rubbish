"""Reviewer annual conflict-of-interest declarations.

P1-8：每位审稿人每年声明一次冲突对象（作者姓名、邮箱、机构、项目等），
并新增机构级匹配：审稿人资料中的单位与投稿作者单位重合时直接 409 拦截。
声明项命中作者姓名/邮箱/单位，或机构重合，都会给出可解释的 matched_terms。

没有声明不阻止分派，编辑侧会显示“未声明”。这样既不会让存量审稿流程
因为一次迁移集体停摆，也不会假装平台已经知道所有人的利益关系。
"""

from __future__ import annotations

import re
from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import require_reviewer, require_tenant_id
from app.core.db import get_db
from app.core.time import utcnow
from app.domain.review.models import ReviewerConflictDeclaration
from app.domain.submission.models import Submission
from app.models import AuditLog, User

router = APIRouter(prefix="/conflicts", tags=["review-coi"])

MAX_CONFLICTS = 30
MAX_CONFLICT_LENGTH = 120


class CoiDeclarationBody(BaseModel):
    conflicts: list[str] = Field(default_factory=list, max_length=MAX_CONFLICTS)
    notes: str | None = Field(default=None, max_length=2000)


class CoiDeclarationResponse(BaseModel):
    year: int
    declared: bool
    conflicts: list[str] = Field(default_factory=list)
    notes: str | None = None
    declared_at: datetime | None = None
    updated_at: datetime | None = None


def current_coi_year() -> int:
    return datetime.now(UTC).year


def _norm(value: str) -> str:
    """Normalize names/emails for substring matching.

    Keeping only letters/digits/CJK makes ``Alice  Author``, ``alice.author``
    and ``Alice-Author`` comparable without pretending to be a fuzzy matcher.
    """

    return re.sub(r"[\s\W_]+", "", str(value).casefold())


def normalize_conflicts(values: list[str]) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for raw in values:
        text = " ".join(str(raw).split()).strip(" ,;，；")
        if not text:
            continue
        if len(text) > MAX_CONFLICT_LENGTH:
            raise HTTPException(
                status_code=422,
                detail=f"冲突对象最多 {MAX_CONFLICT_LENGTH} 字：{text[:20]}…",
            )
        key = text.casefold()
        if key in seen:
            continue
        seen.add(key)
        out.append(text)
    if len(out) > MAX_CONFLICTS:
        raise HTTPException(status_code=422, detail=f"最多声明 {MAX_CONFLICTS} 个冲突对象")
    return out


def declaration_matches(
    declaration: ReviewerConflictDeclaration, submission: Submission
) -> list[str]:
    """Return declared terms that match author names / corresponding email.

    Only terms with at least 2 normalized characters participate; a one-letter
    surname would otherwise match almost every Chinese author and turn the
    guard into a false-positive machine.
    """

    haystacks = [
        *(submission.authors or []),
        *(getattr(submission, "author_affiliations", None) or []),
        submission.corresponding_author_email or "",
    ]
    haystacks = [_norm(item) for item in haystacks if item]
    matches: list[str] = []
    for term in declaration.conflicts or []:
        needle = _norm(term)
        if len(needle) < 2:
            continue
        if any(needle in hay for hay in haystacks):
            matches.append(term)
    return matches


def institution_matches(reviewer: User, submission: Submission) -> list[str]:
    """Return reviewer affiliation/department values that overlap author units.

    This is a deliberately narrow guard: only the reviewer's institution
    (falling back to department when institution is blank) is compared, only
    values at least four characters long participate, and only equality or
    containment counts.  A university name therefore blocks a same-school
    reviewer, while a generic department alone does not match every CS paper.
    """

    # 只把“单位”作为主匹配项；院系单独出现（如“计算机系”）过于宽泛，
    # 仅在审稿人没有填写单位时作为兜底，避免把同院系所有投稿都误判为冲突。
    reviewer_terms = [text for text in (reviewer.affiliation,) if text and len(_norm(text)) >= 4]
    if not reviewer_terms and reviewer.department and len(_norm(reviewer.department)) >= 4:
        reviewer_terms = [reviewer.department]
    author_terms = [
        text
        for text in (getattr(submission, "author_affiliations", None) or [])
        if text and len(_norm(text)) >= 4
    ]
    matches: list[str] = []
    for reviewer_text in reviewer_terms:
        needle = _norm(reviewer_text)
        for author_text in author_terms:
            hay = _norm(author_text)
            if needle and hay and (needle in hay or hay in needle):
                matched = f"{reviewer_text} ↔ {author_text}"
                if matched not in matches:
                    matches.append(matched)
                break
    return matches


async def reviewer_institution_matches(
    db: AsyncSession, *, tenant_id: Any, reviewer_id: int, submission: Submission
) -> list[str]:
    reviewer = (
        await db.execute(select(User).where(User.id == reviewer_id, User.tenant_id == tenant_id))
    ).scalar_one_or_none()
    if reviewer is None:
        return []
    return institution_matches(reviewer, submission)


async def declarations_for_reviewers(
    db: AsyncSession, *, tenant_id: Any, reviewer_ids: list[int], year: int
) -> dict[int, ReviewerConflictDeclaration]:
    if not reviewer_ids:
        return {}
    rows = (
        (
            await db.execute(
                select(ReviewerConflictDeclaration).where(
                    ReviewerConflictDeclaration.tenant_id == tenant_id,
                    ReviewerConflictDeclaration.user_id.in_(reviewer_ids),
                    ReviewerConflictDeclaration.year == year,
                )
            )
        )
        .scalars()
        .all()
    )
    return {row.user_id: row for row in rows}


async def latest_declaration(
    db: AsyncSession, *, tenant_id: Any, user_id: int, year: int | None = None
) -> ReviewerConflictDeclaration | None:
    stmt = select(ReviewerConflictDeclaration).where(
        ReviewerConflictDeclaration.tenant_id == tenant_id,
        ReviewerConflictDeclaration.user_id == user_id,
    )
    if year is not None:
        stmt = stmt.where(ReviewerConflictDeclaration.year == year)
    return (
        (await db.execute(stmt.order_by(desc(ReviewerConflictDeclaration.year)))).scalars().first()
    )


async def ensure_no_declared_conflict(
    db: AsyncSession, *, tenant_id: Any, reviewer_id: int, submission: Submission
) -> None:
    declaration = await latest_declaration(db, tenant_id=tenant_id, user_id=reviewer_id)
    declared_matches = declaration_matches(declaration, submission) if declaration else []
    institution_matches_list = await reviewer_institution_matches(
        db, tenant_id=tenant_id, reviewer_id=reviewer_id, submission=submission
    )
    matches = [*declared_matches, *institution_matches_list]
    if not matches:
        return
    code = "reviewer_declared_conflict" if declared_matches else "reviewer_institution_conflict"
    raise HTTPException(
        status_code=status.HTTP_409_CONFLICT,
        detail={
            "code": code,
            "message": (
                f"审稿人与作者存在可核验的利益冲突：{', '.join(matches)}。"
                "请更换审稿人；如属误判，请先在审稿人资料中修正单位。"
            ),
            "matched_terms": matches,
            "year": declaration.year if declaration else None,
        },
    )


def _to_response(
    declaration: ReviewerConflictDeclaration | None, year: int
) -> CoiDeclarationResponse:
    if declaration is None:
        return CoiDeclarationResponse(year=year, declared=False)
    return CoiDeclarationResponse(
        year=declaration.year,
        declared=True,
        conflicts=list(declaration.conflicts or []),
        notes=declaration.notes,
        declared_at=declaration.declared_at,
        updated_at=declaration.updated_at,
    )


@router.get("/me", response_model=CoiDeclarationResponse)
async def get_my_coi(
    current_user: User = Depends(require_reviewer),
    db: AsyncSession = Depends(get_db),
) -> CoiDeclarationResponse:
    tenant_id = require_tenant_id()
    year = current_coi_year()
    declaration = await latest_declaration(
        db, tenant_id=tenant_id, user_id=current_user.id, year=year
    )
    return _to_response(declaration, year)


@router.put("/me", response_model=CoiDeclarationResponse)
async def save_my_coi(
    body: CoiDeclarationBody,
    current_user: User = Depends(require_reviewer),
    db: AsyncSession = Depends(get_db),
) -> CoiDeclarationResponse:
    tenant_id = require_tenant_id()
    year = current_coi_year()
    conflicts = normalize_conflicts(body.conflicts)
    notes = (body.notes or "").strip() or None
    declaration = await latest_declaration(
        db, tenant_id=tenant_id, user_id=current_user.id, year=year
    )
    now = utcnow()
    if declaration is None:
        declaration = ReviewerConflictDeclaration(
            tenant_id=tenant_id,
            user_id=current_user.id,
            year=year,
            conflicts=conflicts,
            notes=notes,
            declared_at=now,
            updated_at=now,
        )
        db.add(declaration)
    else:
        declaration.conflicts = conflicts
        declaration.notes = notes
        declaration.updated_at = now
    db.add(
        AuditLog(
            tenant_id=tenant_id,
            actor_user_id=current_user.id,
            action="reviewer.coi_declaration",
            target_type="user",
            target_id=str(current_user.id),
            payload={"year": year, "conflicts": conflicts},
        )
    )
    await db.commit()
    await db.refresh(declaration)
    return _to_response(declaration, year)
