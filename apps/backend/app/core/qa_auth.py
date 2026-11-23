"""QA-only machine identity layered over the normal JWT auth.

This module is inert unless ``RUBBISH_QA_AUTOLOGIN_USER`` is set. It is
intended for a loopback-only staging clone; production imports it but never
installs the override because the two QA settings are empty there (no-op,
same switch semantics as before).

Resolution order per request (static token wins only on an exact header
match, so it cannot hijack a real JWT session):

1. ``Authorization: Bearer <QA static token>`` → bind the QA autologin user.
2. Otherwise, a well-formed access JWT → resolve through the normal JWT
   dependency, so real registered accounts keep their own identity and roles
   (reader / creator / moderator flows stay exercisable on QA).
3. No usable credential → required dependency 401; optional dependency
   returns ``None`` (anonymous), same as the plain JWT variants.
"""

from __future__ import annotations

from fastapi import Depends, FastAPI, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from structlog.contextvars import bind_contextvars

from app.api.deps import get_current_user, get_current_user_optional
from app.core.config import settings
from app.core.db import get_db
from app.core.tenant import TENANT_CONTEXT_VAR
from app.models import User

_BEARER_PREFIX = "Bearer "


def _bearer_token(request: Request) -> str | None:
    """Extract the raw bearer token from the Authorization header, if any."""
    header = request.headers.get("authorization", "")
    if header.startswith(_BEARER_PREFIX):
        token = header[len(_BEARER_PREFIX) :].strip()
        return token or None
    return None


def install_qa_auth(app: FastAPI) -> None:
    """Install the QA identity override on top of the normal JWT dependencies.

    Refuses unsafe configurations: staging-only, QA token >= 32 chars.
    """
    if not settings.qa_autologin_user:
        return
    if settings.environment != "staging":
        raise RuntimeError("QA auto-login is only allowed when RUBBISH_ENVIRONMENT=staging")
    token = settings.qa_autologin_token
    if len(token) < 32:
        raise RuntimeError("RUBBISH_QA_AUTOLOGIN_TOKEN must be at least 32 characters")

    expected_header = f"{_BEARER_PREFIX}{token}"

    async def _load_qa_user(db: AsyncSession) -> User:
        tenant_id = TENANT_CONTEXT_VAR.get()
        stmt = select(User).where(User.username == settings.qa_autologin_user)
        if tenant_id is not None:
            stmt = stmt.where(User.tenant_id == tenant_id)
        user = (await db.execute(stmt)).scalar_one_or_none()
        if user is None or not user.is_active:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="QA identity is unavailable",
            )
        bind_contextvars(user_id=str(user.id), is_admin=bool(user.is_admin))
        return user

    async def qa_current_user(request: Request, db: AsyncSession = Depends(get_db)) -> User:
        # 1) Exact static-token match → QA machine identity.
        if request.headers.get("authorization", "") == expected_header:
            return await _load_qa_user(db)
        # 2) Otherwise fall back to the normal JWT dependency (real accounts).
        bearer = _bearer_token(request)
        if bearer is None:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Not authenticated",
            )
        return await get_current_user(token=bearer, db=db)

    async def qa_optional_user(request: Request, db: AsyncSession = Depends(get_db)) -> User | None:
        # 1) Exact static-token match → QA machine identity.
        if request.headers.get("authorization", "") == expected_header:
            return await _load_qa_user(db)
        # 2) Otherwise fall back to the optional JWT dependency (None if anonymous).
        bearer = _bearer_token(request)
        return await get_current_user_optional(token=bearer, db=db)

    app.dependency_overrides[get_current_user] = qa_current_user
    app.dependency_overrides[get_current_user_optional] = qa_optional_user
