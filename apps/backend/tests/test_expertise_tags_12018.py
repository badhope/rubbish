"""1.20.18 互评能力标签聚合：旧数据里的分隔串不能被当成一个标签。"""

from __future__ import annotations

import pytest
from conftest import register_reviewer
from httpx import AsyncClient
from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import User


@pytest.mark.asyncio
async def test_public_expertise_splits_legacy_tag_strings(
    client: AsyncClient,
    admin_user: dict,
    db_session: AsyncSession,
) -> None:
    reviewer = await register_reviewer(
        client,
        admin_user,
        "reviewer_legacy_tags",
        "reviewer_legacy_tags@example.com",
    )

    await db_session.execute(
        update(User)
        .where(User.id == reviewer["user_id"])
        .values(reviewer_tags=["生态学、环境科学", "生态学"])
    )
    await db_session.commit()

    response = await client.get("/api/review/public-expertise")
    assert response.status_code == 200, response.text
    counts = {item["tag"]: item["count"] for item in response.json()["top_tags"]}
    assert counts["生态学"] == 2
    assert counts["环境科学"] == 1
