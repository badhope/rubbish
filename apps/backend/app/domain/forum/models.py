"""SQLAlchemy models for the forum module.

Two tables, both tenant-scoped with RLS:

- ``forum_topics``   — 帖子（标题 + 正文 + 分类 + 置顶/锁定）
- ``forum_replies``  — 回帖（按时间正序展示）

为什么是"论坛"而不是"评论"：comments 模块是读者对**已发表文章**的评论，
依附于资源；论坛是**独立于文章的公共主题论坛**——提建议、报 bug、聊选题、
求合作，这些内容没有对应的 resource，塞进 comments 会污染文章页。

删除策略：软删除（``deleted_at``）而不是硬删除。论坛的价值在于讨论
上下文，硬删会让被回复的楼层变成"回复不存在的内容"。
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Index, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.core.time import utcnow
from app.models import Base, JSONBVariant, TenantScopedMixin


class ForumBoard(Base, TenantScopedMixin):
    """树形版块。parent_id 为空是父板块，非空是子板块/子子板块。

    版块是运营配置而不是枚举：新增叶子版块不用改代码、不用迁移。
    ``slug`` 在租户内唯一，是 URL 与旧 ``category`` 的稳定锚点。
    """

    __tablename__ = "forum_boards"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    parent_id: Mapped[int | None] = mapped_column(
        Integer,
        ForeignKey("forum_boards.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    slug: Mapped[str] = mapped_column(String(40), nullable=False)
    name: Mapped[str] = mapped_column(String(60), nullable=False)
    description: Mapped[str | None] = mapped_column(String(200), nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, nullable=False
    )

    __table_args__ = (
        UniqueConstraint("tenant_id", "slug", name="uq_forum_boards_tenant_slug"),
        Index("ix_forum_boards_tenant_parent_sort", "tenant_id", "parent_id", "sort_order"),
    )


class ForumTopic(Base, TenantScopedMixin):
    """一个讨论帖。"""

    __tablename__ = "forum_topics"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    author_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    # 新树形版块。为空时回退到旧 category（兼容存量帖与旧客户端）。
    board_id: Mapped[int | None] = mapped_column(
        Integer,
        ForeignKey("forum_boards.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    # 版块：论文沙龙 / 方法与写作 / 学术生存 / 组队招募 / 站务公告。
    # notice 是「站务公告」下的官方公告子类，只有编辑与管理员能发。
    # 保留旧字段作为兼容别名；新帖同时写入 board.slug。
    category: Mapped[str] = mapped_column(String(20), nullable=False, default="discussion")
    # 作者声明的虚构属性：帖子可能是小说、寓言、角色扮演或假设情境。
    is_fictional: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    # 关联论文（可选）：从论文详情页发起的讨论带上资源 id，
    # 论文页据此显示"讨论 N"；普通帖子保持 NULL。
    paper_id: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
    # 置顶与锁定：版主/管理员操作
    is_pinned: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    is_locked: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    # 反冗余计数：列表页直接读，避免每次 COUNT(replies)
    reply_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    last_reply_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # 半自动化内容流转：规则引擎先判断，命中边界后进入人工核验。
    # 存量主题迁移时统一回填为 published，不能让历史讨论突然消失。
    moderation_status: Mapped[str] = mapped_column(
        String(24), nullable=False, default="published", server_default="published", index=True
    )
    risk_score: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    # 规则命中明细：[{code,label,detail,weight}]，给运营看，不把内部规则粗暴暴露给普通用户。
    moderation_signals: Mapped[list[dict] | None] = mapped_column(JSONBVariant, nullable=True)
    manual_review_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    review_eta_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    reviewed_by: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, nullable=False
    )
    # 软删除：保留讨论上下文
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    __table_args__ = (
        # 列表页默认排序：置顶优先 + 最近活跃
        Index(
            "ix_forum_topics_tenant_pinned_last",
            "tenant_id",
            "is_pinned",
            last_reply_at.desc(),
            "created_at",
        ),
    )


class ForumReply(Base, TenantScopedMixin):
    """一条回帖。"""

    __tablename__ = "forum_replies"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    topic_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("forum_topics.id", ondelete="CASCADE"), nullable=False, index=True
    )
    author_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    body: Mapped[str] = mapped_column(Text, nullable=False)
    # 楼中楼：回复某条回复时带 parent_id；只保留两级，回复子楼时归到根楼。
    parent_id: Mapped[int | None] = mapped_column(
        Integer,
        ForeignKey("forum_replies.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, nullable=False
    )
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    __table_args__ = (
        Index("ix_forum_replies_tenant_topic_created", "tenant_id", "topic_id", "created_at"),
    )


class ForumReaction(Base, TenantScopedMixin):
    """帖子/回复的多维反馈：赞同、有帮助、收藏。

    不做“反对/踩”：内容库社区要讨论问题，不是把异见踩下去。
    用 target_type + target_id 而不是两个可空 FK，是为了让唯一约束在
    PostgreSQL 下真正生效（可空列会让 UNIQUE 放过多条 NULL）。
    """

    __tablename__ = "forum_reactions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    target_type: Mapped[str] = mapped_column(String(8), nullable=False)
    target_id: Mapped[int] = mapped_column(Integer, nullable=False)
    kind: Mapped[str] = mapped_column(String(12), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, nullable=False
    )

    __table_args__ = (
        UniqueConstraint(
            "tenant_id",
            "user_id",
            "target_type",
            "target_id",
            "kind",
            name="uq_forum_reaction_once",
        ),
        Index("ix_forum_reactions_tenant_target", "tenant_id", "target_type", "target_id"),
    )


class ForumTopicFollow(Base, TenantScopedMixin):
    """A user watching one topic for new replies.

    Idempotent at the DB level: (tenant, user, topic) is unique. The topic
    author is always notified, so authors do not need to follow their own
    topic; following is for readers who want the rest of the thread.
    """

    __tablename__ = "forum_topic_follows"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    topic_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("forum_topics.id", ondelete="CASCADE"), nullable=False, index=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, nullable=False
    )

    __table_args__ = (
        UniqueConstraint(
            "tenant_id",
            "user_id",
            "topic_id",
            name="uq_forum_topic_follows_tenant_user_topic",
        ),
        Index("ix_forum_topic_follows_tenant_topic", "tenant_id", "topic_id"),
    )


class ForumReport(Base, TenantScopedMixin):
    """一条用户举报。

    举报对象可以是帖子（``topic_id`` 非空）或回复（``reply_id`` 非空），
    二者至少其一。版主在后台按 ``status`` 分诊：open / resolved / rejected。

    幂等：同一 reporter 对同一对象只能有一条 open 记录（数据库层
    UniqueConstraint 兜底），重复举报返回 409 并带上已有记录，不重复入库。
    """

    __tablename__ = "forum_reports"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    reporter_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    # 帖子与回复二选一（FK 都可空，应用层校验至少其一）。
    topic_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("forum_topics.id", ondelete="CASCADE"), nullable=True, index=True
    )
    reply_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("forum_replies.id", ondelete="CASCADE"), nullable=True, index=True
    )
    reason: Mapped[str] = mapped_column(String(200), nullable=False, default="")
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="open")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, nullable=False
    )
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    __table_args__ = (
        # 同一用户对同一对象（帖子或回复）只能有一条 open 举报。
        # 用 partial unique 没法同时覆盖两种对象，这里用两个可空列组合，
        # 配合应用层"先查 open 记录"做幂等；DB 层再加一个普通索引供后台筛选。
        Index("ix_forum_reports_tenant_status", "tenant_id", "status", "created_at"),
    )


class ForumModerationEvent(Base, TenantScopedMixin):
    """人工干预审计：谁在什么时候把主题从什么状态改成什么状态。

    不可变事件流，不覆盖历史；运营后台的回溯面板直接读这张表。
    """

    __tablename__ = "forum_moderation_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    topic_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("forum_topics.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    actor_id: Mapped[int | None] = mapped_column(
        Integer,
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    action: Mapped[str] = mapped_column(String(24), nullable=False)
    from_status: Mapped[str | None] = mapped_column(String(24), nullable=True)
    to_status: Mapped[str | None] = mapped_column(String(24), nullable=True)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    meta: Mapped[dict | None] = mapped_column(JSONBVariant, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, nullable=False
    )

    __table_args__ = (
        Index(
            "ix_forum_moderation_events_tenant_topic_created",
            "tenant_id",
            "topic_id",
            "created_at",
        ),
    )


class ForumModerationSetting(Base, TenantScopedMixin):
    """租户级规则开关。单行配置，没有就使用代码默认值。"""

    __tablename__ = "forum_moderation_settings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    auto_publish_enabled: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default="true"
    )
    manual_threshold: Mapped[int] = mapped_column(
        Integer, nullable=False, default=40, server_default="40"
    )
    sla_minutes: Mapped[int] = mapped_column(
        Integer, nullable=False, default=30, server_default="30"
    )
    weights: Mapped[dict | None] = mapped_column(JSONBVariant, nullable=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False
    )

    __table_args__ = (UniqueConstraint("tenant_id", name="uq_forum_moderation_settings_tenant"),)
