"""1.19.59 公开评审：一人成稿、署名可选、意见与作者回复公开。

直接落库构造已刊资源与一份互评报告，避免测试被投稿表单/文件上传链路
牵扯；核心验证：
1. 单份 accept 报告即可通过 final decision（不再要求 2 名）；
2. 公开端点只给作者可见评论与推荐，不给 editor-only 评论和评分；
3. 默认匿名；审稿人明确署名后才出现显示名；
4. 作者回复随文章公开。
"""

from __future__ import annotations

from datetime import UTC, datetime

from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession


def _scores() -> dict[str, object]:
    return {
        "rubric_version": "5.1",
        "track": "academic",
        "dimensions": {
            key: {"score": 88, "reason": "逐条核对", "evidence": "正文 §3 表 1"}
            for key in ("question", "argument", "method", "evidence", "integrity")
        },
        "score": 88,
        "grade": "A",
    }


async def test_single_review_is_enough_and_public_reviews_are_opt_in(
    client: AsyncClient,
    db_session: AsyncSession,
    admin_user: dict,
    test_user: dict,
) -> None:
    from app.core.security import hash_password
    from app.domain.catalog.models import Resource
    from app.domain.review.models import ReviewAssignment, ReviewReport
    from app.domain.submission.models import Submission
    from app.models import Tenant, User

    tenant = (await db_session.execute(select(Tenant).where(Tenant.slug == "default"))).scalar_one()
    reviewer = User(
        tenant_id=tenant.id,
        email="named-reviewer@example.com",
        username="named_reviewer",
        display_name="署名审稿人",
        hashed_password=hash_password("password123"),
        is_active=True,
    )
    db_session.add(reviewer)
    await db_session.flush()

    resource = Resource(
        tenant_id=tenant.id,
        type="paper",
        title="公开评审测试文章",
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
    db_session.add(resource)
    await db_session.flush()

    submission = Submission(
        tenant_id=tenant.id,
        submitted_by=int(test_user["user_id"]),
        resource_id=resource.id,
        title=resource.title,
        type="paper",
        authors=["测试作者"],
        year=2026,
        discipline="计算机科学",
        tags=[],
        abstract="摘要",
        preview="预览",
        status="under_review",
    )
    db_session.add(submission)
    await db_session.flush()

    assignment = ReviewAssignment(
        tenant_id=tenant.id,
        submission_id=submission.id,
        reviewer_id=reviewer.id,
        assigned_by=int(admin_user["user_id"]),
        status="completed",
        round=1,
        slot=1,
        completed_at=datetime.now(UTC),
    )
    db_session.add(assignment)
    await db_session.flush()
    report = ReviewReport(
        tenant_id=tenant.id,
        assignment_id=assignment.id,
        recommendation="accept",
        scores=_scores(),
        comments_to_editor="编辑机密：这句绝不能出现在公开接口。",
        comments_to_author="公开意见：结论成立，建议补充一段限制条件。",
        is_anonymous=True,
    )
    db_session.add(report)
    await db_session.commit()

    author_headers = {"Authorization": f"Bearer {test_user['token']}"}
    response = await client.put(
        f"/api/submissions/{submission.id}/response",
        json={"response": "作者回复：已在 §5 补充限制条件。"},
        headers=author_headers,
    )
    assert response.status_code == 200, response.text

    headers = {"Authorization": f"Bearer {admin_user['token']}"}
    decision = await client.patch(
        f"/api/submissions/{submission.id}/decision",
        json={"decision": "accept", "editor_note": "单人互评通过。"},
        headers=headers,
    )
    assert decision.status_code == 200, decision.text
    body = decision.json()
    assert body["status"] == "accepted"
    published_id = body["resource_id"] or resource.id

    public = await client.get(f"/api/catalog/{published_id}/reviews")
    assert public.status_code == 200, public.text
    payload = public.json()
    assert payload["reports"][0]["reviewer_label"] == "匿名审稿人 1"
    assert payload["reports"][0]["reviewer_anonymous"] is True
    assert payload["reports"][0]["comments_to_author"].startswith("公开意见")
    assert "编辑机密" not in public.text
    assert payload["author_response"].startswith("作者回复")

    report.is_anonymous = False
    await db_session.commit()
    named = await client.get(f"/api/catalog/{published_id}/reviews")
    assert named.status_code == 200, named.text
    assert named.json()["reports"][0]["reviewer_label"] == "署名审稿人"
    assert named.json()["reports"][0]["reviewer_anonymous"] is False


async def test_public_reviews_404_for_unpublished_resource(
    client: AsyncClient, db_session: AsyncSession, admin_user: dict
) -> None:
    from app.domain.catalog.models import Resource
    from app.models import Tenant

    tenant = (await db_session.execute(select(Tenant).where(Tenant.slug == "default"))).scalar_one()
    resource = Resource(
        tenant_id=tenant.id,
        type="paper",
        title="草稿",
        authors=["作者"],
        year=2026,
        discipline="计算机科学",
        tags=[],
        abstract="摘要",
        preview="预览",
        publication_status="draft",
        content_category="academic",
        content_track="paper",
    )
    db_session.add(resource)
    await db_session.commit()

    response = await client.get(f"/api/catalog/{resource.id}/reviews")
    assert response.status_code == 404
