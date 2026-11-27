"""启动播种：栏目说明帖只建一次，既有部署不会被重复写入。"""

from __future__ import annotations

import pytest
from conftest import test_async_session_factory as _test_session_factory
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

import app.core.bootstrap as bootstrap
from app.core.bootstrap import run_bootstrap
from app.core.config import settings
from app.core.tenant import TENANT_CONTEXT_VAR
from app.domain.forum.defaults import ADMISSIONS_GUIDE_TITLE
from app.domain.forum.models import ForumBoard, ForumTopic
from app.models import Tenant


@pytest.mark.asyncio
async def test_bootstrap_seeds_admissions_guide_once(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    """首次启动补说明帖；第二次启动按标题去重，不产生副本。"""
    monkeypatch.setattr(
        type(settings),
        "is_test",
        property(lambda self: False),
    )
    # conftest 在替换 engine 之前就导入了 app.main，bootstrap 模块拿到的是
    # 生产 factory。这里显式换成测试库，才能验证播种本身。
    monkeypatch.setattr(bootstrap, "async_session_factory", _test_session_factory)
    await run_bootstrap()

    tenant = (
        await db_session.execute(
            select(Tenant).where(Tenant.slug == settings.bootstrap_tenant_slug)
        )
    ).scalar_one()
    board = (
        await db_session.execute(
            select(ForumBoard).where(
                ForumBoard.tenant_id == tenant.id,
                ForumBoard.slug == "admissions",
            )
        )
    ).scalar_one()
    topic = (
        await db_session.execute(
            select(ForumTopic).where(
                ForumTopic.tenant_id == tenant.id,
                ForumTopic.title == ADMISSIONS_GUIDE_TITLE,
            )
        )
    ).scalar_one()
    assert topic.board_id == board.id
    assert topic.category == "admissions"
    assert topic.is_pinned is True
    assert topic.moderation_status == "published"
    assert topic.published_at is not None

    await run_bootstrap()
    count = (
        await db_session.execute(
            select(func.count())
            .select_from(ForumTopic)
            .where(
                ForumTopic.tenant_id == tenant.id,
                ForumTopic.title == ADMISSIONS_GUIDE_TITLE,
            )
        )
    ).scalar_one()
    assert count == 1
    TENANT_CONTEXT_VAR.set(None)
