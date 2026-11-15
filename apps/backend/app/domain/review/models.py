"""SQLAlchemy models for the peer-review module.

Tables:

- ``review_assignments`` — editor→reviewer task assignment. One submission
  can have multiple assignments (multiple reviewers). Each assignment has
  its own status lifecycle: ``pending`` (invited) → ``accepted`` / ``declined``
  → ``completed`` (reviewer submitted) → ``cancelled`` (editor withdrew).
- ``review_reports`` — the actual review report submitted by a reviewer:
  overall recommendation + per-criterion scores + comments to editor +
  comments to author. One report per assignment (1:1).

Tenant-scoped with RLS, mirroring the catalog/submission strategy.
Single-blind by default: reviewer identity visible to editors but not
to authors. (Double-blind is a future tenant setting; for now we keep
the data model identity-bearing to keep the MVP simple.)
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import (
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.time import utcnow
from app.models import Base, JSONBVariant, TenantScopedMixin


class ReviewAssignment(Base, TenantScopedMixin):
    """Editor→reviewer task assignment for a submission.

    Lifecycle: ``pending`` (invited) → ``accepted``|``declined`` →
    ``completed`` (reviewer submitted the report) → ``cancelled``.
    """

    __tablename__ = "review_assignments"
    __table_args__ = (
        # 同一稿件、同一审稿人、同一轮只能有一条邀请；重投后可邀请同一
        # 审稿人进入新一轮，不能被旧的 (submission, reviewer) 约束拦住。
        UniqueConstraint(
            "submission_id",
            "reviewer_id",
            "round",
            name="uq_review_assignment_submission_reviewer_round",
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    submission_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("submissions.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    reviewer_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    assigned_by: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )

    # pending=已邀请待回应, accepted=审稿人接受, declined=审稿人拒绝,
    # completed=审稿人已提交报告, cancelled=编辑撤销邀请
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="pending", index=True)
    due_date: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    invited_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, nullable=False
    )
    responded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # 催办记录（0.8.0）：最近一次自动催办时间与累计次数。用于幂等
    # （同一窗口内不重复催）与编辑侧可见的"已催 N 次"。
    last_reminded_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    reminder_count: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, server_default="0"
    )

    # P1：轮次（默认 1）、slot（1/2/3，审稿人槽位）、是否裁决人。
    round: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1")
    slot: Mapped[int] = mapped_column(Integer, nullable=False, default=1, server_default="1")
    is_adjudicator: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="false"
    )
    # 外审专家（主编指定，可标注外省/外单位）；不改变账号体系，
    # 只记录这次邀请的性质，供矩阵与审计识别。
    is_external: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="false"
    )
    external_affiliation: Mapped[str | None] = mapped_column(String(120), nullable=True)

    submission = relationship("Submission", backref="review_assignments")
    reviewer = relationship("User", foreign_keys="ReviewAssignment.reviewer_id")
    assigner = relationship("User", foreign_keys="ReviewAssignment.assigned_by")
    report: Mapped[list[ReviewReport]] = relationship(
        back_populates="assignment", cascade="all, delete-orphan"
    )


class ReviewerConflictDeclaration(Base, TenantScopedMixin):
    """审稿人年度利益冲突声明。

    只记录审稿人主动申报的冲突对象（作者姓名、邮箱、机构、项目等）。
    分派时用作者姓名/通讯邮箱做可解释匹配；机构字段目前不在投稿表里，
    不做“凭猜测拦截”。没有声明不阻止分派，但编辑侧会显示“未声明”；
    有声明且命中则硬拦截，并写入审计。
    """

    __tablename__ = "reviewer_conflict_declarations"
    __table_args__ = (
        UniqueConstraint(
            "tenant_id",
            "user_id",
            "year",
            name="uq_reviewer_conflict_tenant_user_year",
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    year: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    # 每行一个冲突对象；去重、去空白后存 JSON 数组。
    conflicts: Mapped[list[str]] = mapped_column(JSONBVariant, nullable=False, default=list)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    declared_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False
    )

    user = relationship("User", foreign_keys=[user_id])


class ReviewReport(Base, TenantScopedMixin):
    """Review report submitted by a reviewer (one per assignment).

    ``recommendation``: accept / minor_revision / major_revision / reject.
    ``scores``: structured JSON of per-criterion scores (e.g. originality,
    methodology, clarity, significance, each on 1-5 scale).
    ``comments_to_editor``: confidential comments visible to editor only.
    ``comments_to_author``: comments visible to author (single-blind:
    author sees these but not reviewer identity).
    """

    __tablename__ = "review_reports"
    __table_args__ = (UniqueConstraint("assignment_id", name="uq_review_report_assignment"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    assignment_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("review_assignments.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    recommendation: Mapped[str] = mapped_column(String(32), nullable=False)
    scores: Mapped[dict[str, Any]] = mapped_column(JSONBVariant, nullable=False, default=dict)
    comments_to_editor: Mapped[str | None] = mapped_column(Text, nullable=True)
    comments_to_author: Mapped[str | None] = mapped_column(Text, nullable=True)
    # 审稿报告附件（主要是带批注的 PDF/Word/图片）。存元数据数组而不是
    # 单列：一个审稿人可能同时交“批注版 PDF + 补充数据表”。
    attachments: Mapped[list[dict[str, Any]]] = mapped_column(
        JSONBVariant, nullable=False, default=list
    )
    submitted_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, nullable=False
    )

    assignment = relationship("ReviewAssignment", back_populates="report")


class ReviewCalibrationSample(Base, TenantScopedMixin):
    """季度盲评校准样本（P1-10）。

    编辑每季度从“至少两位审稿人完成报告”的稿件中抽取最多 5 篇，
    保存当时的匿名分数快照：只留 A/B/C 标签，不留审稿人姓名/ID，
    用于季度校准会上对照同稿分歧。样本是快照，不随审稿人后续改稿
    或报告更新而变化；重新抽取会命中 (year, quarter, submission_id)
    唯一约束，保持同一季度样本集稳定。
    """

    __tablename__ = "review_calibration_samples"
    __table_args__ = (
        UniqueConstraint(
            "tenant_id",
            "year",
            "quarter",
            "submission_id",
            name="uq_review_calibration_sample_period_submission",
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    year: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    quarter: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    submission_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("submissions.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    title: Mapped[str] = mapped_column(Text, nullable=False)
    abstract: Mapped[str] = mapped_column(Text, nullable=False)
    discipline: Mapped[str] = mapped_column(String(100), nullable=False, default="")
    # [{"label":"A","score":82.5,"recommendation":"minor_revision"}, ...]
    reviewer_scores: Mapped[list[dict[str, Any]]] = mapped_column(
        JSONBVariant, nullable=False, default=list
    )
    consensus_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    score_spread: Mapped[float | None] = mapped_column(Float, nullable=True)
    review_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_by: Mapped[int | None] = mapped_column(
        Integer,
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, nullable=False
    )


class ReviewDraft(Base, TenantScopedMixin):
    """审稿报告的未提交草稿（每个 assignment 至多一份）。

    ``payload`` 原样保存前端 ``ReviewFormValue``：推荐结论、赛道、七维
    打分与作者/编辑意见。草稿不是正式报告，不参与审稿矩阵/录用闸门；
    审稿人提交报告时删除本行，避免旧草稿继续被加载。
    """

    __tablename__ = "review_drafts"
    __table_args__ = (UniqueConstraint("assignment_id", name="uq_review_draft_assignment"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    assignment_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("review_assignments.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    reviewer_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    payload: Mapped[dict[str, Any]] = mapped_column(JSONBVariant, nullable=False, default=dict)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False
    )


__all__ = [
    "ReviewAssignment",
    "ReviewCalibrationSample",
    "ReviewDraft",
    "ReviewReport",
    "ReviewerConflictDeclaration",
]
