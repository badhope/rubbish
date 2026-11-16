"""Edge paths of the submission file endpoints: size limit, Range, redirects."""

from __future__ import annotations

import pytest
from conftest import auth_headers, register_reviewer, register_user
from httpx import AsyncClient

_PDF = b"%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF"


async def _create_submission(client: AsyncClient, token: str) -> int:
    r = await client.post(
        "/api/submissions",
        json={
            "title": "Files Edge Cases",
            "type": "paper",
            "authors": ["边界作者"],
            "year": 2026,
            "discipline": "计算机科学",
            "abstract": "用于验证文件端点边界行为。",
        },
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 201
    return r.json()["id"]


async def _upload(
    client: AsyncClient,
    token: str,
    sid: int,
    content: bytes = _PDF,
    name: str = "paper.pdf",
    mime: str = "application/pdf",
):
    return await client.post(
        f"/api/submissions/{sid}/files",
        files={"file": (name, content, mime)},
        headers={"Authorization": f"Bearer {token}"},
    )


@pytest.mark.asyncio
async def test_upload_rejects_oversize_file(
    client: AsyncClient, test_user: dict, monkeypatch: pytest.MonkeyPatch
) -> None:
    from app.interfaces.http.submission import routes_files

    monkeypatch.setattr(routes_files, "_MAX_UPLOAD_BYTES", 256)
    sid = await _create_submission(client, test_user["token"])
    r = await _upload(client, test_user["token"], sid, content=b"x" * 1024)
    assert r.status_code == 413


@pytest.mark.asyncio
async def test_upload_truncates_overlong_extension(client: AsyncClient, test_user: dict) -> None:
    sid = await _create_submission(client, test_user["token"])
    r = await _upload(
        client,
        test_user["token"],
        sid,
        name=f"paper.{'a' * 30}",
        mime="text/plain",
        content=b"plain text body",
    )
    assert r.status_code == 200
    file_path = r.json().get("file_path") or ""
    # 新语义：不合规扩展名（超长）整体丢弃而不是截断——存储 key 里
    # 不应出现半个控制字符序列，截断可能留下它。
    assert "." not in file_path.rsplit("/", 1)[1]


@pytest.mark.asyncio
async def test_download_returns_206_for_valid_range(client: AsyncClient, test_user: dict) -> None:
    sid = await _create_submission(client, test_user["token"])
    up = await _upload(client, test_user["token"], sid)
    assert up.status_code == 200

    r = await client.get(
        f"/api/submissions/{sid}/files",
        headers={**auth_headers(test_user), "Range": "bytes=0-3"},
    )
    assert r.status_code == 206
    assert r.headers["Content-Range"].startswith("bytes 0-3/")
    assert r.headers["Accept-Ranges"] == "bytes"
    assert len(r.content) == 4


@pytest.mark.asyncio
async def test_download_open_ended_range(client: AsyncClient, test_user: dict) -> None:
    sid = await _create_submission(client, test_user["token"])
    await _upload(client, test_user["token"], sid)

    r = await client.get(
        f"/api/submissions/{sid}/files",
        headers={**auth_headers(test_user), "Range": "bytes=2-"},
    )
    assert r.status_code == 206
    assert r.headers["Content-Range"].startswith("bytes 2-")


@pytest.mark.asyncio
async def test_download_invalid_range_falls_back_to_200(
    client: AsyncClient, test_user: dict
) -> None:
    sid = await _create_submission(client, test_user["token"])
    await _upload(client, test_user["token"], sid)

    r = await client.get(
        f"/api/submissions/{sid}/files",
        headers={**auth_headers(test_user), "Range": "bytes=99999-"},
    )
    assert r.status_code == 200
    assert len(r.content) == len(_PDF)


@pytest.mark.asyncio
async def test_download_presigned_redirect(
    client: AsyncClient, test_user: dict, monkeypatch: pytest.MonkeyPatch
) -> None:
    from app.core.storage import get_storage

    sid = await _create_submission(client, test_user["token"])
    await _upload(client, test_user["token"], sid)

    monkeypatch.setattr(
        get_storage(), "presigned_url", lambda path: f"https://s3.example.com/{path}"
    )
    r = await client.get(f"/api/submissions/{sid}/files", headers=auth_headers(test_user))
    assert r.status_code == 302
    assert r.headers["location"].startswith("https://s3.example.com/")


@pytest.mark.asyncio
async def test_download_missing_storage_file_404(
    client: AsyncClient, test_user: dict, monkeypatch: pytest.MonkeyPatch
) -> None:
    from app.core.storage import get_storage

    sid = await _create_submission(client, test_user["token"])
    await _upload(client, test_user["token"], sid)

    async def missing(path: str) -> bytes:
        raise FileNotFoundError(path)

    monkeypatch.setattr(get_storage(), "load", missing)
    r = await client.get(f"/api/submissions/{sid}/files", headers=auth_headers(test_user))
    assert r.status_code == 404


async def test_upload_accepts_markdown_latex_and_data_files(
    client: AsyncClient, test_user: dict
) -> None:
    """扩展名命中即放行：浏览器对 .md/.tex/.csv 报的 content-type 不可靠。"""
    sid = await _create_submission(client, test_user["token"])
    cases = [
        ("notes.md", "text/markdown", b"# heading\n"),
        ("paper.tex", "application/octet-stream", b"\\documentclass{article}"),
        ("table.csv", "", b"a,b\n1,2\n"),
        ("figure.png", "image/png", b"\x89PNG\r\n\x1a\n" + b"0" * 64),
        ("bundle.zip", "application/x-zip-compressed", b"PK\x03\x04fake"),
    ]
    for name, mime, content in cases:
        r = await _upload(client, test_user["token"], sid, content=content, name=name, mime=mime)
        assert r.status_code == 200, f"{name}: {r.text[:200]}"


async def test_upload_rejects_unknown_extension(client: AsyncClient, test_user: dict) -> None:
    sid = await _create_submission(client, test_user["token"])
    r = await _upload(
        client,
        test_user["token"],
        sid,
        content=b"MZ\x90\x00",
        name="setup.exe",
        mime="application/x-msdownload",
    )
    assert r.status_code == 400
    assert "Unsupported file type" in r.json()["detail"]
    # 错误信息必须列出可接受扩展名，便于作者自救
    assert ".pdf" in r.json()["detail"]


async def test_capabilities_exposes_upload_limits(client: AsyncClient) -> None:
    body = (await client.get("/api/capabilities")).json()
    assert body["upload_max_bytes"] == 50 * 1024 * 1024
    assert ".pdf" in body["upload_extensions"]
    assert ".ipynb" in body["upload_extensions"]


@pytest.mark.asyncio
async def test_download_ticket_allows_mobile_without_auth_header(
    client: AsyncClient, test_user: dict
) -> None:
    """移动端直链：票据换出的 URL 不带 Authorization 也能下载。"""
    sid = await _create_submission(client, test_user["token"])
    assert (await _upload(client, test_user["token"], sid)).status_code == 200

    ticket = await client.post(
        f"/api/submissions/{sid}/download-ticket?format=pdf",
        headers=auth_headers(test_user),
    )
    assert ticket.status_code == 200
    url = ticket.json()["url"]
    assert "ticket=" in url
    # 微信按扩展名识别文件，路径必须落在 .pdf 上。
    assert url.split("?", 1)[0].endswith(".pdf")

    # 模拟系统浏览器/下载器：只有 URL，没有 Bearer 头。
    downloaded = await client.get(url)
    assert downloaded.status_code == 200
    assert downloaded.headers["content-type"].startswith("application/pdf")
    assert downloaded.headers["content-disposition"].startswith("inline;")
    assert downloaded.content.startswith(b"%PDF")


@pytest.mark.asyncio
async def test_download_ticket_rejects_tampering(client: AsyncClient, test_user: dict) -> None:
    sid = await _create_submission(client, test_user["token"])
    assert (await _upload(client, test_user["token"], sid)).status_code == 200
    ticket = (
        await client.post(
            f"/api/submissions/{sid}/download-ticket?format=pdf",
            headers=auth_headers(test_user),
        )
    ).json()["url"]

    # 改掉票据末位，HMAC 校验必须失败。
    tampered = ticket[:-1] + ("A" if ticket[-1] != "A" else "B")
    r = await client.get(tampered)
    assert r.status_code == 401


@pytest.mark.asyncio
async def test_download_ticket_forbidden_for_outsider(client: AsyncClient, test_user: dict) -> None:
    sid = await _create_submission(client, test_user["token"])
    outsider = await register_user(
        client, email="ticket_outsider@example.com", username="ticket_outsider"
    )
    r = await client.post(
        f"/api/submissions/{sid}/download-ticket?format=pdf",
        headers=auth_headers(outsider),
    )
    # 租户隔离会先把外部用户挡成 404；两者都表示无权换票。
    assert r.status_code in (403, 404)


# ---------------------------------------------------------------------------
# P1 #5：票据绑租户 + 兑换时复核权限
# ---------------------------------------------------------------------------


async def _attach_markdown(db_session, submission_id: int, md_text: str) -> None:
    """给投稿挂一份在线 Markdown 稿（含作者身份），供匿名化生成路径使用。"""
    from sqlalchemy import select

    from app.core.storage import get_storage
    from app.domain.submission.models import Submission
    from app.models import Tenant

    tenant = (await db_session.execute(select(Tenant).where(Tenant.slug == "default"))).scalar_one()
    rel = f"{tenant.id}/{submission_id}/manuscript.md"
    await get_storage().save(rel, md_text.encode("utf-8"))
    entry = await db_session.get(Submission, submission_id)
    assert entry is not None
    entry.markdown_path = rel
    await db_session.commit()


async def _set_double_blind(client: AsyncClient, admin_user: dict) -> None:
    resp = await client.patch(
        "/api/admin/settings/review-mode",
        json={"review_mode": "double_blind"},
        headers=auth_headers(admin_user),
    )
    assert resp.status_code == 200, resp.text


def test_download_ticket_five_segment_round_trip() -> None:
    """5 段票据往返：错租户/错格式/错稿件都必须验签失败。"""
    from app.interfaces.http.submission.routes_files import (
        _make_download_ticket,
        _verify_download_ticket,
    )

    tid = "11111111-1111-1111-1111-111111111111"
    other = "22222222-2222-2222-2222-222222222222"
    ticket = _make_download_ticket(42, 7, "pdf", tid)
    assert _verify_download_ticket(ticket, 42, "pdf", tid) == 7
    assert _verify_download_ticket(ticket, 42, "pdf", other) is None
    assert _verify_download_ticket(ticket, 42, "docx", tid) is None
    assert _verify_download_ticket(ticket, 43, "pdf", tid) is None


def test_download_ticket_expired_returns_none(monkeypatch: pytest.MonkeyPatch) -> None:
    from app.interfaces.http.submission import routes_files

    tid = "11111111-1111-1111-1111-111111111111"
    ticket = routes_files._make_download_ticket(42, 7, "pdf", tid)
    real_time = routes_files.time.time
    monkeypatch.setattr(routes_files.time, "time", lambda: real_time() + 10000)
    assert routes_files._verify_download_ticket(ticket, 42, "pdf", tid) is None


@pytest.mark.asyncio
async def test_download_ticket_double_blind_author_original_reviewer_anonymized(
    client: AsyncClient, admin_user: dict, test_user: dict, db_session
) -> None:
    """双盲下作者持票拿原稿、审稿人持票拿匿名稿（修复持票特权倒错）。"""
    sid = await _create_submission(client, test_user["token"])
    await _attach_markdown(
        db_session,
        sid,
        "# 论文标题\n\n作者：Alice Identifiable（alice@identifiable.edu）\n\n正文学术内容。\n",
    )
    await _set_double_blind(client, admin_user)
    reviewer = await register_reviewer(
        client, admin_user, "ticketreviewer", "ticketreviewer@example.com"
    )
    assigned = await client.post(
        f"/api/submissions/{sid}/assignments",
        json={"reviewer_id": reviewer["user_id"]},
        headers=auth_headers(admin_user),
    )
    assert assigned.status_code == 201, assigned.text

    # 作者持票（无 Authorization 头）→ 原稿（文件名不含 anonymized）。
    author_url = (
        await client.post(
            f"/api/submissions/{sid}/download-ticket?format=docx",
            headers=auth_headers(test_user),
        )
    ).json()["url"]
    author_dl = await client.get(author_url)
    assert author_dl.status_code == 200, author_dl.text
    assert "anonymized" not in author_dl.headers["content-disposition"]
    assert "manuscript" in author_dl.headers["content-disposition"]

    # 审稿人持票（无 Authorization 头）→ 匿名稿。
    reviewer_url = (
        await client.post(
            f"/api/submissions/{sid}/download-ticket?format=docx",
            headers=auth_headers(reviewer),
        )
    ).json()["url"]
    reviewer_dl = await client.get(reviewer_url)
    assert reviewer_dl.status_code == 200, reviewer_dl.text
    assert "anonymized" in reviewer_dl.headers["content-disposition"]


@pytest.mark.asyncio
async def test_download_ticket_revoked_after_unassign_403(
    client: AsyncClient, admin_user: dict, test_user: dict
) -> None:
    """撤派后同一票据兑换 → 403：兑换时重新鉴权，票据不是长期授权。"""
    sid = await _create_submission(client, test_user["token"])
    assert (await _upload(client, test_user["token"], sid)).status_code == 200
    reviewer = await register_reviewer(
        client, admin_user, "revokereviewer", "revokereviewer@example.com"
    )
    assigned = await client.post(
        f"/api/submissions/{sid}/assignments",
        json={"reviewer_id": reviewer["user_id"]},
        headers=auth_headers(admin_user),
    )
    assert assigned.status_code == 201, assigned.text
    assignment_id = assigned.json()["id"]
    url = (
        await client.post(
            f"/api/submissions/{sid}/download-ticket?format=pdf",
            headers=auth_headers(reviewer),
        )
    ).json()["url"]
    # 撤派前可下载。
    assert (await client.get(url)).status_code == 200
    cancel = await client.delete(
        f"/api/submissions/{sid}/assignments/{assignment_id}",
        headers=auth_headers(admin_user),
    )
    assert cancel.status_code == 200, cancel.text
    # 撤派后重新鉴权失败 → 403。
    revoked = await client.get(url)
    assert revoked.status_code == 403, revoked.text


@pytest.mark.asyncio
async def test_download_ticket_cross_tenant_forgery_401(
    client: AsyncClient, test_user: dict
) -> None:
    """跨租户伪造：HMAC 合法但租户段不符 → 401。"""
    from app.interfaces.http.submission.routes_files import _make_download_ticket

    sid = await _create_submission(client, test_user["token"])
    assert (await _upload(client, test_user["token"], sid)).status_code == 200
    forged = _make_download_ticket(
        sid,
        int(test_user["user_id"]),
        "pdf",
        "99999999-9999-9999-9999-999999999999",
    )
    url = f"/api/submissions/{sid}/files/{sid}.pdf?inline=false&ticket={forged}"
    r = await client.get(url)
    assert r.status_code == 401, r.text
