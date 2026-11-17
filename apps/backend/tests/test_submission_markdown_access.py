"""在线正文读/写门禁分离：读取不限稿件状态，写入保留可编辑门禁。

审稿期（under_review）作者仍要能在 Studio 看自己的稿子与修改建议；
此前 GET 与 PUT 共用「可编辑状态」门禁，导致审稿期整页报错。
"""

from __future__ import annotations

from conftest import auth_headers, register_reviewer
from httpx import AsyncClient

_PAYLOAD = {
    "title": "Markdown Access Gate Test",
    "type": "paper",
    "authors": ["Alice Author"],
    "year": 2026,
    "discipline": "computer science",
    "abstract": "An abstract for the markdown access gate test.",
    "keywords": ["gate"],
}

_BODY = "# 正文\n\n审稿期也要能读到自己这份稿子。\n"


async def _under_review_submission(client: AsyncClient, author: dict, admin: dict) -> int:
    created = await client.post("/api/submissions", json=_PAYLOAD, headers=auth_headers(author))
    created.raise_for_status()
    sid = int(created.json()["id"])
    saved = await client.put(
        f"/api/submissions/{sid}/markdown", json={"content": _BODY}, headers=auth_headers(author)
    )
    assert saved.status_code == 200, saved.text
    reviewer = await register_reviewer(client, admin, f"mdgate_{sid}", f"mdgate{sid}@example.com")
    assigned = await client.post(
        f"/api/submissions/{sid}/assignments",
        json={"reviewer_id": reviewer["user_id"]},
        headers=auth_headers(admin),
    )
    assert assigned.status_code == 201, assigned.text
    detail = await client.get(f"/api/submissions/{sid}", headers=auth_headers(author))
    assert detail.json()["status"] == "under_review"
    return sid


async def test_author_reads_but_cannot_write_during_review(
    client: AsyncClient, test_user: dict, admin_user: dict
) -> None:
    sid = await _under_review_submission(client, test_user, admin_user)
    read = await client.get(f"/api/submissions/{sid}/markdown", headers=auth_headers(test_user))
    assert read.status_code == 200, read.text
    assert read.json()["content"] == _BODY
    write = await client.put(
        f"/api/submissions/{sid}/markdown",
        json={"content": "# 偷改\n"},
        headers=auth_headers(test_user),
    )
    assert write.status_code == 400
    assert "Cannot edit submission body" in write.json()["detail"]


async def test_stranger_cannot_read_markdown(
    client: AsyncClient, test_user: dict, admin_user: dict
) -> None:
    sid = await _under_review_submission(client, test_user, admin_user)
    stranger = await register_reviewer(client, admin_user, "mdgate_stranger", "stranger@example.com")
    read = await client.get(f"/api/submissions/{sid}/markdown", headers=auth_headers(stranger))
    assert read.status_code == 403


async def test_staff_reads_and_writes_in_any_status(
    client: AsyncClient, test_user: dict, admin_user: dict
) -> None:
    sid = await _under_review_submission(client, test_user, admin_user)
    read = await client.get(f"/api/submissions/{sid}/markdown", headers=auth_headers(admin_user))
    assert read.status_code == 200
    write = await client.put(
        f"/api/submissions/{sid}/markdown",
        json={"content": "# 编辑部改稿\n"},
        headers=auth_headers(admin_user),
    )
    assert write.status_code == 200, write.text
