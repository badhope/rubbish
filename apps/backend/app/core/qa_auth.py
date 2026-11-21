"""QA-only machine identity for isolated visual inspection.

This module is inert unless ``RUBBISH_QA_AUTOLOGIN_USER`` is set. It is
intended for a loopback-only staging clone; production imports it but never
installs the override because the two QA settings are empty there.
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


def install_qa_auth(app: FastAPI) -> None:
    """Install a token-gated QA identity. Refuses unsafe configurations."""
    if not settings.qa_autologin_user:
        return
    if settings.environment != "staging":
        raise RuntimeError("QA auto-login is only allowed when RUBBISH_ENVIRONMENT=staging")
    token = settings.qa_autologin_token
    if len(token) < 32:
        raise RuntimeError("RUBBISH_QA_AUTOLOGIN_TOKEN must be at least 32 characters")

    expected = f"Bearer {token}"

    async def _load_user(db: AsyncSession) -> User:
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

    async def qa_current_user(
        request: Request, db: AsyncSession = Depends(get_db)
    ) -> User:
        if request.headers.get("authorization", "") != expected:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="QA token required",
            )
        return await _load_user(db)

    async def qa_optional_user(
        request: Request, db: AsyncSession = Depends(get_db)
    ) -> User | None:
        if request.headers.get("authorization", "") != expected:
            return None
        return await _load_user(db)

    app.dependency_overrides[get_current_user] = qa_current_user
    app.dependency_overrides[get_current_user_optional] = qa_optional_user
