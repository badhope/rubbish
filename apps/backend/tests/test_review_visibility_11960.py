"""1.19.60 评审可见性与统计口径回归。

覆盖本次深潜审计发现的六类缺口：
1. 作者时间线在单盲模式下也不能出现审稿人用户名；
2. 作者报告接口不能下发评分/评分理由（评审表单承诺只给 comments_to_author）；
3. 即使审稿人主动署名，作者在刊出前也拿不到显示名；
4. 公开评审必须保留退回/重投前的历史轮次，并且同一审稿人跨轮匿名序号稳定；
5. 退回/重投后 cancelled 的旧报告不能把列表统计算成“可裁决”，新轮未交报告也不能回退用旧轮；
6. 共同作者同名在服务端被识别，历史遗留的同名指派也不能在接邀请或交报告时继续。
"""

from __future__ import annotations

from datetime import UTC, datetime

from conftest import register_reviewer
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.domain.catalog.models import Resource, ResourcePublicEvent
from app.domain.review.models import ReviewAssignment, ReviewReport
from app.domain.submission.models import Submission
from app.interfaces.http.review.coi import name_matches_author
from app.models import Tenant, User


def _scores() -> dict[str, object]:
    return {
        "rubric_version": "5.1",
        "track": "academic",
        "dimensions": {
            "method": {
                "score": 88,
                "reason": "评分理由：方法可复现",
                "evidence": "证据：§3 表 1",
                "suggestion": "只给编辑的补充建议：补做一组对照。",
            }
        },
        "score": 88,
        "grade": "A",
    }


async def _tenant(db: AsyncSession) -> Tenant:
    return (await db.execute(select(Tenant).where(Tenant.slug == "default"))).scalar_one()


def _resource(tenant: Tenant, *, title: str) -> Resource:
    return Resource(
        tenant_id=tenant.id,
        type="paper",
        title=title,
        authors=["测试作者"],
        year=2026,
        discipline="计算机科学",
        tags=[],
        abstract="摘要",
        preview="预览",
        publication_status="published",
        content_category="academic",
        content_track="paper",
    )


def _submission(
    tenant: Tenant,
    *,
    submitted_by: int,
    resource_id: int | None = None,
    status: str = "under_review",
    title: str = "评审可见性测试",
    author_response: str | None = None,
) -> Submission:
    return Submission(
        tenant_id=tenant.id,
        submitted_by=submitted_by,
        resource_id=resource_id,
        title=title,
        type="paper",
        authors=["测试作者"],
        year=2026,
        discipline="计算机科学",
        tags=[],
        keywords=[],
        jel_codes=[],
        abstract="摘要",
        preview="预览",
        status=status,
        author_response=author_response,
        author_response_at=datetime.now(UTC) if author_response else None,
    )


def _assignment(
    tenant: Tenant,
    *,
    submission_id: int,
    reviewer_id: int,
    reviewer_assigned_by: int,
    status: str = "completed",
    round_no: int = 1,
) -> ReviewAssignment:
    return ReviewAssignment(
        tenant_id=tenant.id,
        submission_id=submission_id,
        reviewer_id=reviewer_id,
        assigned_by=reviewer_assigned_by,
        status=status,
        round=round_no,
        slot=1,
        completed_at=datetime.now(UTC) if status in ("completed", "cancelled") else None,
    )


def _report(
    tenant: Tenant,
    *,
    assignment_id: int,
    comments: str,
    anonymous: bool = True,
) -> ReviewReport:
    return ReviewReport(
        tenant_id=tenant.id,
        assignment_id=assignment_id,
        recommendation="accept",
        scores=_scores(),
        comments_to_editor="编辑机密",
        comments_to_author=comments,
        is_anonymous=anonymous,
        submitted_at=datetime.now(UTC),
    )


async def test_author_timeline_and_reports_do_not_leak_reviewer_identity_or_scores(
    client: AsyncClient,
    db_session: AsyncSession,
    admin_user: dict,
    test_user: dict,
) -> None:
    tenant = await _tenant(db_session)
    reviewer = User(
        tenant_id=tenant.id,
        email="secret-reviewer@example.com",
        username="secret_reviewer",
        display_name="实名审稿人",
        hashed_password="x",
        is_active=True,
    )
    db_session.add(reviewer)
    await db_session.flush()

    submission = _submission(
        tenant,
        submitted_by=int(test_user["user_id"]),
        title="作者不应看到审稿人身份",
    )
    db_session.add(submission)
    await db_session.flush()

    assignment = _assignment(
        tenant,
        submission_id=submission.id,
        reviewer_id=reviewer.id,
        reviewer_assigned_by=int(admin_user["user_id"]),
    )
    db_session.add(assignment)
    await db_session.flush()
    db_session.add(
        _report(
            tenant,
            assignment_id=assignment.id,
            comments="给作者：请补限制条件。",
            # 即使审稿人主动署名，作者在刊出前也不能看到姓名；
            # 姓名只由公开评审端点在本刊出后下发。
            anonymous=False,
        )
    )
    await db_session.commit()

    author_headers = {"Authorization": f"Bearer {test_user['token']}"}
    timeline = await client.get(
        f"/api/submissions/{submission.id}/timeline", headers=author_headers
    )
    assert timeline.status_code == 200, timeline.text
    assert "secret_reviewer" not in timeline.text
    assert "实名审稿人" not in timeline.text
    assert "互评成员1" in timeline.text

    reports = await client.get(f"/api/submissions/{submission.id}/reports", headers=author_headers)
    assert reports.status_code == 200, reports.text
    payload = reports.json()[0]
    assert payload["comments_to_author"] == "给作者：请补限制条件。"
    assert payload["scores"] == {}
    assert payload["is_anonymous"] is False
    assert payload["reviewer_display_name"] is None
    assert "secret_reviewer" not in reports.text
    assert "实名审稿人" not in reports.text
    assert "评分理由" not in reports.text
    assert "补充建议" not in reports.text

    editor_headers = {"Authorization": f"Bearer {admin_user['token']}"}
    editor_reports = await client.get(
        f"/api/submissions/{submission.id}/reports", headers=editor_headers
    )
    assert editor_reports.status_code == 200, editor_reports.text
    assert editor_reports.json()[0]["scores"]["score"] == 88
    assert "secret_reviewer" in editor_reports.text


async def test_public_reviews_keep_history_and_stable_labels_per_reviewer(
    client: AsyncClient,
    db_session: AsyncSession,
    admin_user: dict,
    test_user: dict,
) -> None:
    tenant = await _tenant(db_session)
    resource = _resource(tenant, title="跨轮公开评审")
    db_session.add(resource)
    await db_session.flush()
    submission = _submission(
        tenant,
        submitted_by=int(test_user["user_id"]),
        resource_id=resource.id,
        status="accepted",
        author_response="作者回复：已补两轮意见。",
    )
    db_session.add(submission)
    await db_session.flush()

    reviewer = User(
        tenant_id=tenant.id,
        email="round-reviewer@example.com",
        username="round_reviewer",
        hashed_password="x",
        is_active=True,
    )
    db_session.add(reviewer)
    await db_session.flush()

    old = _assignment(
        tenant,
        submission_id=submission.id,
        reviewer_id=reviewer.id,
        reviewer_assigned_by=int(admin_user["user_id"]),
        status="cancelled",
        round_no=1,
    )
    current = _assignment(
        tenant,
        submission_id=submission.id,
        reviewer_id=reviewer.id,
        reviewer_assigned_by=int(admin_user["user_id"]),
        status="completed",
        round_no=2,
    )
    db_session.add_all([old, current])
    await db_session.flush()
    db_session.add_all(
        [
            _report(tenant, assignment_id=old.id, comments="第一轮：补样本量。"),
            _report(tenant, assignment_id=current.id, comments="第二轮：可以公开。"),
        ]
    )
    await db_session.commit()

    response = await client.get(f"/api/catalog/{resource.id}/reviews")
    assert response.status_code == 200, response.text
    payload = response.json()
    assert [item["round"] for item in payload["reports"]] == [1, 2]
    assert [item["reviewer_label"] for item in payload["reports"]] == [
        "匿名审稿人 1",
        "匿名审稿人 1",
    ]
    assert payload["author_response"] == "作者回复：已补两轮意见。"


async def test_named_reviewer_does_not_consume_anonymous_number(
    client: AsyncClient,
    db_session: AsyncSession,
    admin_user: dict,
    test_user: dict,
) -> None:
    """署名审稿人不应占掉匿名序号，否则读者会看到没有 1 号的匿名审稿人 2。"""
    tenant = await _tenant(db_session)
    resource = _resource(tenant, title="署名与匿名并存")
    db_session.add(resource)
    await db_session.flush()
    submission = _submission(
        tenant,
        submitted_by=int(test_user["user_id"]),
        resource_id=resource.id,
        status="accepted",
    )
    db_session.add(submission)
    await db_session.flush()

    named = User(
        tenant_id=tenant.id,
        email="public-named@example.com",
        username="public_named",
        display_name="公开姓名",
        hashed_password="x",
        is_active=True,
    )
    anonymous = User(
        tenant_id=tenant.id,
        email="public-anon@example.com",
        username="public_anon",
        hashed_password="x",
        is_active=True,
    )
    db_session.add_all([named, anonymous])
    await db_session.flush()

    named_assignment = _assignment(
        tenant,
        submission_id=submission.id,
        reviewer_id=named.id,
        reviewer_assigned_by=int(admin_user["user_id"]),
    )
    anonymous_assignment = _assignment(
        tenant,
        submission_id=submission.id,
        reviewer_id=anonymous.id,
        reviewer_assigned_by=int(admin_user["user_id"]),
    )
    db_session.add_all([named_assignment, anonymous_assignment])
    await db_session.flush()
    db_session.add_all(
        [
            _report(
                tenant,
                assignment_id=named_assignment.id,
                comments="署名意见。",
                anonymous=False,
            ),
            _report(
                tenant,
                assignment_id=anonymous_assignment.id,
                comments="匿名意见。",
                anonymous=True,
            ),
        ]
    )
    await db_session.commit()

    response = await client.get(f"/api/catalog/{resource.id}/reviews")
    assert response.status_code == 200, response.text
    labels = [item["reviewer_label"] for item in response.json()["reports"]]
    assert labels == ["公开姓名", "匿名审稿人 1"]


async def test_public_reviews_are_bound_to_one_submission_and_hidden_after_retraction(
    client: AsyncClient,
    db_session: AsyncSession,
    admin_user: dict,
    test_user: dict,
) -> None:
    tenant = await _tenant(db_session)
    resource = _resource(tenant, title="多投稿绑定")
    db_session.add(resource)
    await db_session.flush()

    second_author = User(
        tenant_id=tenant.id,
        email="second-author@example.com",
        username="second_author",
        hashed_password="x",
        is_active=True,
    )
    reviewer = User(
        tenant_id=tenant.id,
        email="bind-reviewer@example.com",
        username="bind_reviewer",
        hashed_password="x",
        is_active=True,
    )
    db_session.add_all([second_author, reviewer])
    await db_session.flush()

    first = _submission(
        tenant,
        submitted_by=int(test_user["user_id"]),
        resource_id=resource.id,
        status="accepted",
        title="第一条投稿",
        author_response="A 的回复：不应公开。",
    )
    second = _submission(
        tenant,
        submitted_by=second_author.id,
        resource_id=resource.id,
        status="accepted",
        title="第二条投稿",
        author_response="B 的回复：应公开。",
    )
    db_session.add_all([first, second])
    await db_session.flush()

    assignment_a = _assignment(
        tenant,
        submission_id=first.id,
        reviewer_id=reviewer.id,
        reviewer_assigned_by=int(admin_user["user_id"]),
    )
    assignment_b = _assignment(
        tenant,
        submission_id=second.id,
        reviewer_id=reviewer.id,
        reviewer_assigned_by=int(admin_user["user_id"]),
        round_no=2,
    )
    db_session.add_all([assignment_a, assignment_b])
    await db_session.flush()
    db_session.add_all(
        [
            _report(tenant, assignment_id=assignment_a.id, comments="A 的意见：不应公开。"),
            _report(tenant, assignment_id=assignment_b.id, comments="B 的意见：应公开。"),
        ]
    )
    await db_session.commit()

    response = await client.get(f"/api/catalog/{resource.id}/reviews")
    assert response.status_code == 200, response.text
    payload = response.json()
    assert [item["comments_to_author"] for item in payload["reports"]] == ["B 的意见：应公开。"]
    assert payload["author_response"] == "B 的回复：应公开。"

    db_session.add(
        ResourcePublicEvent(
            tenant_id=tenant.id,
            resource_id=resource.id,
            event_type="retraction",
            title="撤回声明",
            body="作者申请撤回。",
        )
    )
    await db_session.commit()
    retracted = await client.get(f"/api/catalog/{resource.id}/reviews")
    assert retracted.status_code == 404


async def test_cancelled_report_does_not_make_submission_decidable(
    client: AsyncClient,
    db_session: AsyncSession,
    admin_user: dict,
    test_user: dict,
) -> None:
    tenant = await _tenant(db_session)
    submission = _submission(
        tenant,
        submitted_by=int(test_user["user_id"]),
        title="取消报告不能算完成",
    )
    db_session.add(submission)
    await db_session.flush()

    reviewer = User(
        tenant_id=tenant.id,
        email="cancelled-reviewer@example.com",
        username="cancelled_reviewer",
        hashed_password="x",
        is_active=True,
    )
    db_session.add(reviewer)
    await db_session.flush()
    assignment = _assignment(
        tenant,
        submission_id=submission.id,
        reviewer_id=reviewer.id,
        reviewer_assigned_by=int(admin_user["user_id"]),
        status="cancelled",
    )
    db_session.add(assignment)
    await db_session.flush()
    db_session.add(_report(tenant, assignment_id=assignment.id, comments="这一轮已取消。"))
    await db_session.commit()

    response = await client.get(
        "/api/submissions",
        params={"status": "under_review"},
        headers={"Authorization": f"Bearer {admin_user['token']}"},
    )
    assert response.status_code == 200, response.text
    row = next(item for item in response.json()["data"] if item["id"] == submission.id)
    assert row["reports_completed"] == 0
    assert row["accept_recommendations"] == 0
    assert row["can_decide"] is False


async def test_new_round_without_report_makes_list_not_decidable(
    client: AsyncClient,
    db_session: AsyncSession,
    admin_user: dict,
    test_user: dict,
) -> None:
    """第 2 轮已指派但还没报告时，列表不能退回用第 1 轮报告显示可裁决。"""
    tenant = await _tenant(db_session)
    submission = _submission(
        tenant,
        submitted_by=int(test_user["user_id"]),
        title="新一轮未完成",
    )
    db_session.add(submission)
    await db_session.flush()

    reviewers = [
        User(
            tenant_id=tenant.id,
            email=f"round-reviewer-{i}@example.com",
            username=f"round_reviewer_{i}",
            hashed_password="x",
            is_active=True,
        )
        for i in (1, 2)
    ]
    db_session.add_all(reviewers)
    await db_session.flush()

    first = _assignment(
        tenant,
        submission_id=submission.id,
        reviewer_id=reviewers[0].id,
        reviewer_assigned_by=int(admin_user["user_id"]),
        status="completed",
        round_no=1,
    )
    second = _assignment(
        tenant,
        submission_id=submission.id,
        reviewer_id=reviewers[1].id,
        reviewer_assigned_by=int(admin_user["user_id"]),
        status="pending",
        round_no=2,
    )
    db_session.add_all([first, second])
    await db_session.flush()
    db_session.add(_report(tenant, assignment_id=first.id, comments="第一轮通过。"))
    await db_session.commit()

    response = await client.get(
        "/api/submissions",
        params={"status": "under_review"},
        headers={"Authorization": f"Bearer {admin_user['token']}"},
    )
    assert response.status_code == 200, response.text
    row = next(item for item in response.json()["data"] if item["id"] == submission.id)
    assert row["reports_completed"] == 0
    assert row["accept_recommendations"] == 0
    assert row["can_decide"] is False


async def test_accept_and_submit_recheck_same_name(
    client: AsyncClient,
    db_session: AsyncSession,
    admin_user: dict,
    test_user: dict,
) -> None:
    """历史遗留的同名指派，也不能在接邀请或交报告时绕过。"""
    tenant = await _tenant(db_session)
    submission = _submission(
        tenant,
        submitted_by=int(test_user["user_id"]),
        title="同名审稿人不能接邀请",
    )
    db_session.add(submission)
    await db_session.flush()

    reviewer = await register_reviewer(
        client,
        admin_user,
        "same_name_reviewer",
        "same-name-reviewer@example.com",
    )
    reviewer_row = (
        await db_session.execute(select(User).where(User.id == int(reviewer["user_id"])))
    ).scalar_one()
    reviewer_row.display_name = "测试作者"
    await db_session.commit()

    assignment = _assignment(
        tenant,
        submission_id=submission.id,
        reviewer_id=reviewer_row.id,
        reviewer_assigned_by=int(admin_user["user_id"]),
        status="pending",
    )
    db_session.add(assignment)
    await db_session.commit()

    headers = {"Authorization": f"Bearer {reviewer['token']}"}
    accept = await client.post(f"/api/review/assignments/{assignment.id}/accept", headers=headers)
    assert accept.status_code == 409, accept.text

    assignment.status = "accepted"
    await db_session.commit()
    submit = await client.post(
        f"/api/review/assignments/{assignment.id}/submit",
        json={
            "recommendation": "accept",
            "scores": _scores(),
            "comments_to_author": "历史同名指派也不能提交。",
        },
        headers=headers,
    )
    assert submit.status_code == 409, submit.text


def test_name_matches_author_uses_display_and_real_name() -> None:
    class _Reviewer:
        username = "lm2026"
        display_name = "李明"
        real_name = "李明"

    reviewer = _Reviewer()
    submission = _submission(
        type("TenantStub", (), {"id": 1})(),  # type: ignore[arg-type]
        submitted_by=1,
        title="同名作者",
    )
    submission.authors = ["李明"]
    assert name_matches_author(reviewer, submission)  # type: ignore[arg-type]

    submission.authors = ["李 明"]  # 去掉空格后仍应命中
    assert name_matches_author(reviewer, submission)  # type: ignore[arg-type]

    submission.authors = ["李明明"]
    assert not name_matches_author(reviewer, submission)  # type: ignore[arg-type]
