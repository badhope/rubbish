"""1.19.61 互评矩阵与免审口径回归。

矩阵端点过去只按“当前轮报告”汇总推荐，没有过滤 cancelled；退回/重投后
旧报告仍在时，矩阵可能显示可裁决，但 /decision 会 409。矩阵也缺少投稿
存在性校验，免审作品更没有 can_decide 口径。这个文件锁住这三件事。
"""

from __future__ import annotations

from datetime import UTC, datetime

from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession
from test_review_visibility_11960 import _submission, _tenant

from app.domain.review.models import ReviewAssignment, ReviewReport
from app.models import User


async def test_matrix_ignores_cancelled_report_and_honors_waiver(
    client: AsyncClient,
    db_session: AsyncSession,
    admin_user: dict,
    test_user: dict,
) -> None:
    tenant = await _tenant(db_session)
    submission = _submission(
        tenant,
        submitted_by=int(test_user["user_id"]),
        title="矩阵 cancelled 报告与免审",
    )
    db_session.add(submission)
    await db_session.flush()

    reviewer = User(
        tenant_id=tenant.id,
        email="matrix-reviewer@example.com",
        username="matrix_reviewer",
        hashed_password="x",
        is_active=True,
    )
    db_session.add(reviewer)
    await db_session.flush()
    assignment = ReviewAssignment(
        tenant_id=tenant.id,
        submission_id=submission.id,
        reviewer_id=reviewer.id,
        assigned_by=int(admin_user["user_id"]),
        status="cancelled",
        round=1,
        slot=1,
        completed_at=datetime.now(UTC),
        is_adjudicator=True,
    )
    db_session.add(assignment)
    await db_session.flush()
    db_session.add(
        ReviewReport(
            tenant_id=tenant.id,
            assignment_id=assignment.id,
            recommendation="accept",
            scores={"score": 88},
            comments_to_author="这份报告属于已取消的轮次。",
            submitted_at=datetime.now(UTC),
        )
    )
    await db_session.commit()

    headers = {"Authorization": f"Bearer {admin_user['token']}"}
    matrix = await client.get(
        f"/api/review/submissions/{submission.id}/matrix", headers=headers
    )
    assert matrix.status_code == 200, matrix.text
    payload = matrix.json()
    assert payload["reports_completed"] == 0
    assert payload["accept_count"] == 0
    assert payload["can_decide"] is False
    assert payload["review_waived"] is False
    assert payload["adjudicator_assigned"] is False

    list_response = await client.get(
        "/api/submissions",
        params={"status": "under_review"},
        headers=headers,
    )
    assert list_response.status_code == 200, list_response.text
    row = next(item for item in list_response.json()["data"] if item["id"] == submission.id)
    assert row["can_decide"] is False
    assert row["review_waived"] is False
    assert row["adjudicator_assigned"] is False

    adjudicator = User(
        tenant_id=tenant.id,
        email="matrix-adjudicator@example.com",
        username="matrix_adjudicator",
        hashed_password="x",
        is_active=True,
    )
    db_session.add(adjudicator)
    await db_session.flush()
    db_session.add(
        ReviewAssignment(
            tenant_id=tenant.id,
            submission_id=submission.id,
            reviewer_id=adjudicator.id,
            assigned_by=int(admin_user["user_id"]),
            status="pending",
            round=1,
            slot=2,
            is_adjudicator=True,
        )
    )
    await db_session.commit()

    matrix_with_adjudicator = await client.get(
        f"/api/review/submissions/{submission.id}/matrix", headers=headers
    )
    assert matrix_with_adjudicator.status_code == 200, matrix_with_adjudicator.text
    assert matrix_with_adjudicator.json()["adjudicator_assigned"] is True
    assert matrix_with_adjudicator.json()["adjudicator_accepted"] is False

    list_with_adjudicator = await client.get(
        "/api/submissions",
        params={"status": "under_review"},
        headers=headers,
    )
    assert list_with_adjudicator.status_code == 200, list_with_adjudicator.text
    row = next(
        item for item in list_with_adjudicator.json()["data"] if item["id"] == submission.id
    )
    assert row["adjudicator_assigned"] is True
    assert row["adjudicator_accepted"] is False

    submission.review_waived_at = datetime.now(UTC)
    await db_session.commit()
    waived_matrix = await client.get(
        f"/api/review/submissions/{submission.id}/matrix", headers=headers
    )
    assert waived_matrix.status_code == 200, waived_matrix.text
    assert waived_matrix.json()["can_decide"] is True
    assert waived_matrix.json()["review_waived"] is True
    assert waived_matrix.json()["need_adjudication"] is False

    list_waived = await client.get(
        "/api/submissions",
        params={"status": "under_review"},
        headers=headers,
    )
    assert list_waived.status_code == 200, list_waived.text
    row = next(item for item in list_waived.json()["data"] if item["id"] == submission.id)
    assert row["can_decide"] is True
    assert row["review_waived"] is True


async def test_matrix_404_for_unknown_submission(
    client: AsyncClient, admin_user: dict
) -> None:
    response = await client.get(
        "/api/review/submissions/99999999/matrix",
        headers={"Authorization": f"Bearer {admin_user['token']}"},
    )
    assert response.status_code == 404, response.text
