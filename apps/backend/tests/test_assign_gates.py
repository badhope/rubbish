"""指派闸门回归：状态前置、同名利益冲突服务端拦截、重复指派 409。

审计 M1/M2/M3：批量指派曾缺状态闸门与同名 COI 拦截，且并发/批内重复
撞唯一约束时裸抛 IntegrityError（500）。
"""

from __future__ import annotations

from conftest import auth_headers, register_reviewer
from httpx import AsyncClient

_PAYLOAD = {
    "title": "Assign Gate Test",
    "type": "paper",
    "authors": ["gateauthor"],
    "year": 2026,
    "discipline": "computer science",
    "abstract": "An abstract for the assign gate test.",
    "keywords": ["gate"],
}


async def _pending_submission(client: AsyncClient, author: dict) -> int:
    created = await client.post("/api/submissions", json=_PAYLOAD, headers=auth_headers(author))
    created.raise_for_status()
    return int(created.json()["id"])


async def test_assign_rejected_in_decided_status(
    client: AsyncClient, test_user: dict, admin_user: dict
) -> None:
    sid = await _pending_submission(client, test_user)
    reviewer = await register_reviewer(client, admin_user, f"agate_{sid}", f"agate{sid}@example.com")
    decided = await client.patch(
        f"/api/submissions/{sid}/decision",
        json={"decision": "reject", "editor_note": "desk reject for gate test"},
        headers=auth_headers(admin_user),
    )
    assert decided.status_code == 200, decided.text

    batch = await client.post(
        f"/api/review/submissions/{sid}/assign",
        json={"reviewer_ids": [reviewer["user_id"]], "due_days": 14},
        headers=auth_headers(admin_user),
    )
    assert batch.status_code == 400
    assert "Cannot assign reviewer in status" in batch.json()["detail"]

    single = await client.post(
        f"/api/submissions/{sid}/assignments",
        json={"reviewer_id": reviewer["user_id"]},
        headers=auth_headers(admin_user),
    )
    assert single.status_code == 400


async def test_name_match_conflict_blocked_server_side(
    client: AsyncClient, test_user: dict, admin_user: dict
) -> None:
    sid = await _pending_submission(client, test_user)
    # 用户名与署名作者同名（忽略大小写）：前端禁选，后端也必须拦。
    reviewer = await register_reviewer(
        client, admin_user, "GateAuthor", f"namecoi{sid}@example.com"
    )
    batch = await client.post(
        f"/api/review/submissions/{sid}/assign",
        json={"reviewer_ids": [reviewer["user_id"]], "due_days": 14},
        headers=auth_headers(admin_user),
    )
    assert batch.status_code == 409, batch.text
    assert batch.json()["detail"]["code"] == "reviewer_name_conflict"

    single = await client.post(
        f"/api/submissions/{sid}/assignments",
        json={"reviewer_id": reviewer["user_id"]},
        headers=auth_headers(admin_user),
    )
    assert single.status_code == 409
    assert single.json()["detail"]["code"] == "reviewer_name_conflict"

    hint = await client.post(
        "/api/editor/workbench/conflicts",
        json={"submission_id": sid, "reviewer_ids": [reviewer["user_id"]]},
        headers=auth_headers(admin_user),
    )
    assert hint.status_code == 200
    row = hint.json()["candidates"][0]
    assert row["name_matches_author"] is True
    assert row["default_selected"] is False


async def test_batch_duplicate_reviewer_ids_deduped(
    client: AsyncClient, test_user: dict, admin_user: dict
) -> None:
    sid = await _pending_submission(client, test_user)
    reviewer = await register_reviewer(client, admin_user, "adup", f"adup{sid}@example.com")
    resp = await client.post(
        f"/api/review/submissions/{sid}/assign",
        json={"reviewer_ids": [reviewer["user_id"], reviewer["user_id"]], "due_days": 14},
        headers=auth_headers(admin_user),
    )
    assert resp.status_code == 201, resp.text
    assert resp.json()["assigned"] == 1