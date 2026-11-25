"""Region access + overseas read-only tests."""

from __future__ import annotations

from httpx import AsyncClient

from app.core.config import settings


async def test_restricted_region_blocks_anonymous_but_overseas_can_read(
    client: AsyncClient, monkeypatch
) -> None:
    monkeypatch.setattr(settings, "region_access_enabled", True)
    monkeypatch.setattr(settings, "trusted_proxies_count", 1)
    monkeypatch.setattr(settings, "auth_wall_enabled", True)

    restricted = await client.get(
        "/api/catalog", headers={"x-forwarded-for": "1.0.1.1"}
    )
    assert restricted.status_code == 403
    assert restricted.json()["detail"] == "region_restricted"

    overseas = await client.get(
        "/api/catalog", headers={"x-forwarded-for": "8.8.8.8"}
    )
    assert overseas.status_code == 200

    forum = await client.get(
        "/api/forum/topics", headers={"x-forwarded-for": "8.8.8.8"}
    )
    assert forum.status_code == 200

    # 公开评审是已刊文章的一部分，海外匿名必须能读到；不存在的资源应
    # 停在业务 404，而不是地区 403/登录墙 401。
    review_overseas = await client.get(
        "/api/catalog/999999/reviews", headers={"x-forwarded-for": "8.8.8.8"}
    )
    assert review_overseas.status_code == 404, review_overseas.text[:160]
    review_restricted = await client.get(
        "/api/catalog/999999/reviews", headers={"x-forwarded-for": "1.0.1.1"}
    )
    assert review_restricted.status_code == 403

    # Reads are open; publishing is still a write and must be authenticated.
    write = await client.post(
        "/api/forum/topics",
        headers={"x-forwarded-for": "8.8.8.8"},
        json={"board_id": 1, "title": "guest should not post", "body": "nope"},
    )
    assert write.status_code == 401


async def test_region_cookie_is_set_on_html_response(client: AsyncClient, monkeypatch) -> None:
    monkeypatch.setattr(settings, "region_access_enabled", True)
    monkeypatch.setattr(settings, "trusted_proxies_count", 1)

    response = await client.get("/", headers={"x-forwarded-for": "8.8.8.8"})
    assert response.cookies.get("rubbish_region") == "overseas"

    response = await client.get("/", headers={"x-forwarded-for": "1.0.1.1"})
    assert response.cookies.get("rubbish_region") == "restricted"


async def test_public_image_capability_urls_bypass_region_and_auth_walls(
    client: AsyncClient, monkeypatch
) -> None:
    """<img> 不会带 Authorization；大陆匿名也必须拿到图片而不是 403/401。

    不存在的随机文件名应返回 404（说明已经穿过地区闸门和登录墙），
    绝不能返回 region_restricted 或未认证。
    """
    monkeypatch.setattr(settings, "region_access_enabled", True)
    monkeypatch.setattr(settings, "trusted_proxies_count", 1)
    monkeypatch.setattr(settings, "auth_wall_enabled", True)

    for path in (
        "/api/forum/images/deadbeefdeadbeef.jpg",
        "/api/media/images/deadbeefdeadbeef.webp",
    ):
        response = await client.get(path, headers={"x-forwarded-for": "1.0.1.1"})
        assert response.status_code == 404, (path, response.status_code, response.text[:120])

    # 文章配图路由先做路径参数校验；422 也说明已经穿过两道墙，绝不能是
    # 401/403 或 region_restricted。
    article_image = await client.get(
        "/api/catalog/1/img/deadbeefdeadbeef.png",
        headers={"x-forwarded-for": "1.0.1.1"},
    )
    assert article_image.status_code in {404, 422}
    assert article_image.status_code not in {401, 403}


async def test_signed_submission_download_bypasses_region_and_auth_walls(
    client: AsyncClient, monkeypatch
) -> None:
    """微信/手机直接打开签名链接时不会带 Bearer，票据端点必须能穿过两道墙。

    不存在的投稿应返回 404；返回 region_restricted 或 authentication_required
    都说明请求在到达票据校验前就被拦住了。
    """
    monkeypatch.setattr(settings, "region_access_enabled", True)
    monkeypatch.setattr(settings, "trusted_proxies_count", 1)
    monkeypatch.setattr(settings, "auth_wall_enabled", True)

    path = "/api/submissions/999999/files/999999.pdf"
    blocked = await client.get(path, headers={"x-forwarded-for": "1.0.1.1"})
    assert blocked.status_code == 403
    assert blocked.json()["detail"] == "region_restricted"

    signed = await client.get(
        f"{path}?inline=true&ticket=bogus",
        headers={"x-forwarded-for": "1.0.1.1"},
    )
    assert signed.status_code == 404, signed.text[:160]
