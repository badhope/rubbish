"""互评候选按自选领域服务端筛选的回归测试。

前端此前把候选列表限制在前 200 人，再在浏览器里按 reviewer_disciplines
过滤；候选池一大，排在后面的同方向成员就会消失。这里锁定「先筛选、后
截断」的顺序，避免以后把这段优化又改回客户端过滤。
"""

from __future__ import annotations

import pytest
from conftest import auth_headers, register_reviewer
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_reviewer_candidates_filter_discipline_before_limit(
    client: AsyncClient, admin_user: dict
) -> None:
    matching = await register_reviewer(
        client, admin_user, "reviewer_zzz", "reviewer_zzz@example.com"
    )
    await register_reviewer(client, admin_user, "reviewer_aaa", "reviewer_aaa@example.com")
    await register_reviewer(client, admin_user, "reviewer_bbb", "reviewer_bbb@example.com")

    patched = await client.patch(
        "/api/users/me",
        json={"reviewer_disciplines": ["computer-science"]},
        headers=auth_headers(matching),
    )
    assert patched.status_code == 200, patched.text

    response = await client.get(
        "/api/submissions/reviewer-candidates",
        params={"limit": 1, "discipline": "computer-science"},
        headers=auth_headers(admin_user),
    )
    assert response.status_code == 200, response.text
    rows = response.json()["data"]
    assert [row["username"] for row in rows] == ["reviewer_zzz"]
