"""审稿人受控学科标签（迁移 057）+ 公开匿名专长画像。

覆盖：
  - PATCH /users/me reviewer_disciplines：slug 归一/去重、格式校验、
    词表存在性校验（租户配置词表后严格，未配置宽松放行）
  - 候选匹配：自选学科命中稿件学科加分且理由可解释
  - GET /review/public-expertise：公开可访问、只有聚合计数、
    不泄露任何审稿人身份信息
"""

from __future__ import annotations

from conftest import auth_headers
from httpx import AsyncClient


async def _assign(client: AsyncClient, admin: dict, user_id: int, role: str) -> None:
    r = await client.post(
        f"/api/admin/users/{user_id}/roles", json={"role": role}, headers=auth_headers(admin)
    )
    assert r.status_code == 201, r.text


async def _create_discipline(
    client: AsyncClient, admin: dict, slug: str, name: str
) -> None:
    r = await client.post(
        "/api/catalog/disciplines",
        json={"slug": slug, "name": name, "subdisciplines": []},
        headers=auth_headers(admin),
    )
    assert r.status_code == 201, r.text


async def test_patch_disciplines_lenient_without_vocab(
    client: AsyncClient, test_user: dict
) -> None:
    r = await client.patch(
        "/api/users/me",
        json={"reviewer_disciplines": ["Computer-Science", "computer-science", "history"]},
        headers=auth_headers(test_user),
    )
    assert r.status_code == 200, r.text
    assert r.json()["reviewer_disciplines"] == ["computer-science", "history"]


async def test_patch_disciplines_rejects_bad_slug(client: AsyncClient, test_user: dict) -> None:
    r = await client.patch(
        "/api/users/me",
        json={"reviewer_disciplines": ["Computer Science!"]},
        headers=auth_headers(test_user),
    )
    assert r.status_code == 422


async def test_patch_disciplines_strict_with_vocab(
    client: AsyncClient, admin_user: dict, test_user: dict
) -> None:
    await _create_discipline(client, admin_user, "computer-science", "Computer Science")
    r = await client.patch(
        "/api/users/me",
        json={"reviewer_disciplines": ["no-such-field"]},
        headers=auth_headers(test_user),
    )
    assert r.status_code == 422
    assert "no-such-field" in r.text

    r = await client.patch(
        "/api/users/me",
        json={"reviewer_disciplines": ["computer-science"]},
        headers=auth_headers(test_user),
    )
    assert r.status_code == 200, r.text
    assert r.json()["reviewer_disciplines"] == ["computer-science"]

    # 空数组 = 清除
    r = await client.patch(
        "/api/users/me",
        json={"reviewer_disciplines": []},
        headers=auth_headers(test_user),
    )
    assert r.status_code == 200
    assert r.json()["reviewer_disciplines"] == []


async def test_candidate_declared_discipline_boost(
    client: AsyncClient, admin_user: dict, test_user: dict
) -> None:
    await _create_discipline(client, admin_user, "computer-science", "Computer Science")
    await _assign(client, admin_user, int(test_user["user_id"]), "reviewer")
    r = await client.patch(
        "/api/users/me",
        json={"reviewer_disciplines": ["computer-science"]},
        headers=auth_headers(test_user),
    )
    assert r.status_code == 200, r.text

    r = await client.post(
        "/api/submissions",
        json={
            "title": "Discipline Matching Test",
            "type": "paper",
            "authors": ["Discipline Author"],
            "year": 2026,
            "discipline": "Computer Science",
            "keywords": [],
            "abstract": "用于验证自选学科参与候选评分。",
        },
        headers=auth_headers(test_user),
    )
    assert r.status_code == 201, r.text
    sid = r.json()["id"]

    r = await client.get(
        f"/api/submissions/reviewer-candidates?submission_id={sid}",
        headers=auth_headers(admin_user),
    )
    assert r.status_code == 200, r.text
    candidate = next(c for c in r.json()["data"] if c["username"] == "testuser")
    assert candidate["reviewer_disciplines"] == ["computer-science"]
    assert candidate["score"] >= 35
    assert any("自选学科命中" in reason for reason in candidate["match_reasons"])


async def test_public_expertise_anonymous_aggregates(
    client: AsyncClient, admin_user: dict, test_user: dict
) -> None:
    warmup = await client.get("/api/health")
    assert warmup.status_code == 200
    await _create_discipline(client, admin_user, "computer-science", "Computer Science")
    await _create_discipline(client, admin_user, "history", "History")
    await _assign(client, admin_user, int(test_user["user_id"]), "reviewer")
    r = await client.patch(
        "/api/users/me",
        json={
            "reviewer_disciplines": ["computer-science"],
            "reviewer_tags": ["multi-agent", "ethics"],
        },
        headers=auth_headers(test_user),
    )
    assert r.status_code == 200, r.text

    # 无需登录
    r = await client.get("/api/review/public-expertise")
    assert r.status_code == 200, r.text
    body = r.json()
    assert set(body) == {"total_reviewers", "disciplines", "top_tags"}
    assert body["total_reviewers"] == 1
    by_slug = {d["slug"]: d for d in body["disciplines"]}
    assert by_slug["computer-science"]["reviewer_count"] == 1
    assert by_slug["history"]["reviewer_count"] == 0
    assert {t["tag"] for t in body["top_tags"]} == {"multi-agent", "ethics"}
    # 不泄露身份：响应全文不含用户名/邮箱/id 字段
    assert "testuser" not in r.text
    assert test_user.get("email", "test@example.com") not in r.text
    for item in body["disciplines"]:
        assert set(item) == {"slug", "name", "reviewer_count"}
    for item in body["top_tags"]:
        assert set(item) == {"tag", "count"}
