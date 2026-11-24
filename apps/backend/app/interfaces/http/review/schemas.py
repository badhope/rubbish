"""Pydantic schemas for the peer-review module.

- ``AssignmentCreate``: editor→reviewer invite body.
- ``AssignmentResponse``: list/detail response.
- ``ReviewSubmit``: reviewer submits a report.
- ``ReviewReportResponse``: report payload.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

from app.core.schemas import MessageResponse, PaginationMeta

AssignmentStatus = Literal["pending", "accepted", "declined", "completed", "cancelled"]
Recommendation = Literal["accept", "minor_revision", "major_revision", "reject"]


class AssignmentCreate(BaseModel):
    """Body for POST /submissions/{id}/assignments — editor invites reviewer."""

    reviewer_id: int = Field(ge=1)
    due_date: datetime | None = None


class AssignmentResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    submission_id: int
    reviewer_id: int
    assigned_by: int | None = None
    status: AssignmentStatus
    due_date: datetime | None = None
    invited_at: datetime
    responded_at: datetime | None = None
    completed_at: datetime | None = None
    # 列表展开互评成员用户名（避免 N+1 前端要再查 user）
    reviewer_username: str | None = None
    submission_title: str | None = None
    # 催办状态（编辑可见「已催 N 次」；互评成员可见最近提醒时间）
    last_reminded_at: datetime | None = None
    reminder_count: int = 0
    # 已完成任务：关联报告 id 与附件，供互评成员自查/补传批注件
    report_id: int | None = None
    attachments: list[dict[str, Any]] = Field(default_factory=list)
    round: int = 1
    slot: int = 1
    is_adjudicator: bool = False
    is_external: bool = False
    external_affiliation: str | None = None


class AssignmentListResponse(BaseModel):
    data: list[AssignmentResponse]
    meta: PaginationMeta


class ReviewSubmit(BaseModel):
    """Body for POST /review/assignments/{id}/submit — reviewer submits report."""

    recommendation: Recommendation
    # scores 是自由结构 JSON：e.g. {"originality": 4, "methodology": 5, ...}
    # 不强制 schema 让不同内容库可以自定义评分维度
    scores: dict[str, Any] = Field(default_factory=dict)
    comments_to_editor: str | None = Field(default=None, max_length=20000)
    comments_to_author: str | None = Field(default=None, max_length=20000)
    # 互评端「特别篇」特许标记：普通作品不得超篇幅上限；勾选即视为
    # 互评成员建议/确认特许，落库到资源并显示显式标签。理由单独留痕。
    special_issue: bool = False
    special_issue_reason: str | None = Field(default=None, max_length=500)


class ReviewReportResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    assignment_id: int
    recommendation: Recommendation
    scores: dict[str, Any]
    comments_to_editor: str | None = None
    # 单盲模式：作者只看作者评论 + 推荐，看不到互评成员身份 + editor-only 评论
    comments_to_author: str | None = None
    # 互评成员身份：仅编辑可见（单盲对作者隐藏，接口按调用者裁剪）。
    reviewer_id: int | None = None
    reviewer_username: str | None = None
    # 互评附件元数据：filename / path / content_type / size。
    attachments: list[dict[str, Any]] = Field(default_factory=list)
    # 第几轮互评。退回/重投后旧报告仍保留，编辑按轮次分组查看。
    round: int = 1
    # 归档报告对应的 assignment 状态（completed/cancelled）。
    assignment_status: str = "completed"
    submitted_at: datetime


__all__ = [
    "AssignmentCreate",
    "AssignmentListResponse",
    "AssignmentResponse",
    "AssignmentStatus",
    "MessageResponse",
    "PaginationMeta",
    "Recommendation",
    "ReviewDraftIn",
    "ReviewDraftResponse",
    "ReviewReportResponse",
    "ReviewSubmit",
]


class ReviewDraftIn(BaseModel):
    """互评意见草稿正文；payload 是前端 ReviewFormValue 的 JSON。"""

    payload: dict[str, Any] = Field(default_factory=dict)


class ReviewDraftResponse(BaseModel):
    payload: dict[str, Any] | None = None
    updated_at: datetime | None = None


class ExpertiseDiscipline(BaseModel):
    """匿名话题覆盖：仅 slug/名称/人数，不含任何身份信息。"""

    slug: str
    name: str
    reviewer_count: int = 0


class ExpertiseTag(BaseModel):
    tag: str
    count: int


class PublicExpertiseResponse(BaseModel):
    """GET /review/public-expertise — 作者可见的互评团队匿名画像。"""

    total_reviewers: int = 0
    disciplines: list[ExpertiseDiscipline] = Field(default_factory=list)
    top_tags: list[ExpertiseTag] = Field(default_factory=list)
