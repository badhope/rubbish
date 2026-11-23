"""SQLAlchemy models for the catalog module.

All tables are tenant-scoped with RLS:

- ``resources`` — core bibliographic record (title, authors, year, venue,
  discipline, tags, abstract, DOI, journal metadata). No view/download
  counters: the promised tracking endpoints were never built, so the
  half-finished ``resource_stats`` table was dropped in migration 021.

The optional ``Author`` table for ORCID/affiliation enrichment is
reserved for a future phase; the primary author storage is the JSON
``authors`` column on ``resources``.

All catalog models inherit from the core ``Base`` so cross-module FKs
(e.g. ``resources.tenant_id → tenants.id``) resolve without metadata
gymnastics. This matches ARCHITECTURE.md "All modules share the
tenant's PostgreSQL database".
"""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import (
    JSON,
    BigInteger,
    Boolean,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.time import utcnow
from app.models import Base, JSONBVariant, TenantScopedMixin


class Resource(Base, TenantScopedMixin):
    """A catalog record (paper / book / dataset / tutorial / ...).

    The ``slug`` is an optional stable URL identifier. When absent, the
    frontend uses the integer id. ``authors`` is the primary author
    storage (JSON list[str]); structured author entities with ORCID etc.
    are a future concern (reserved ``Author`` table).
    """

    __tablename__ = "resources"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    # Optional stable URL slug. Unique per tenant; null allowed for records
    # imported without a slug (frontend falls back to int id).
    slug: Mapped[str | None] = mapped_column(String(100), nullable=True)
    type: Mapped[str] = mapped_column(String(50), nullable=False, index=True)
    title: Mapped[str] = mapped_column(Text, nullable=False)
    # Primary author storage. JSON list[str], e.g. ["Alice Author", "Bob"].
    authors: Mapped[list[str]] = mapped_column(JSONBVariant, nullable=False)
    year: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    venue: Mapped[str | None] = mapped_column(Text, nullable=True, index=True)
    discipline: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    subdiscipline: Mapped[str | None] = mapped_column(String(100), nullable=True, index=True)
    tags: Mapped[list[str]] = mapped_column(JSONBVariant, nullable=False)
    abstract: Mapped[str] = mapped_column(Text, nullable=False)
    preview: Mapped[str] = mapped_column(Text, nullable=False)
    # 编辑推荐层（1.19.16）：不覆盖正式题录，只给阅读端一个更短、更有钩子的入口。
    # short_title 用于卡片/详情首行；title 仍是引用、导出和 SEO 的正式标题。
    short_title: Mapped[str | None] = mapped_column(String(120), nullable=True)
    # 编辑推荐语：回答“为什么现在读这篇”，不是摘要的复述。
    editor_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    # 文末讨论引子：把“去社区聊”变成一句具体可回答的话。
    discussion_prompt: Mapped[str | None] = mapped_column(Text, nullable=True)
    # 首页编辑推荐排序（1 起，越小越靠前）；为空表示不进推荐池。
    featured_rank: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
    # 阅读路径分组：start / research / weird；用于首页“三条阅读路线”。
    reading_path: Mapped[str | None] = mapped_column(String(20), nullable=True)
    download_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    external_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    # 同一 DOI 不得落到两个资源上（可空；Postgres 唯一索引允许多个 NULL）。
    doi: Mapped[str | None] = mapped_column(String(200), nullable=True, index=True, unique=True)

    # Optional per-author enrichment (e.g. ORCID iDs). Stored as a
    # JSON list parallel to ``authors``: each entry has at least a
    # ``name`` field, optionally ``orcid``, ``affiliation``,
    # ``email``. The ``authors`` column stays the source of truth for
    # display; this column enriches it for academic citation needs.
    # Format:
    #   [{"name": "Alice Author", "orcid": "0000-0002-1825-0097", ...}]
    authors_meta: Mapped[list[dict[str, str]] | None] = mapped_column(JSON, nullable=True)
    # Journal metadata (Phase 1)
    volume: Mapped[str | None] = mapped_column(String(50), nullable=True)
    issue: Mapped[str | None] = mapped_column(String(50), nullable=True)
    # 合集一等对象（2026-11-19）：Issue 是真实记录，Resource.issue_id 是归属。
    # volume/issue 字符串保留为兼容快照，公开筛选与旧 API 仍可读；新写入以
    # issue_id 为准，并在同步层回写字符串，避免两套数据漂移。
    issue_id: Mapped[int | None] = mapped_column(
        Integer,
        ForeignKey("issues.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    pages: Mapped[str | None] = mapped_column(String(50), nullable=True)
    issn: Mapped[str | None] = mapped_column(String(20), nullable=True)
    isbn: Mapped[str | None] = mapped_column(String(20), nullable=True)
    publisher: Mapped[str | None] = mapped_column(String(500), nullable=True)
    short_container_title: Mapped[str | None] = mapped_column(String(200), nullable=True)
    keywords: Mapped[list[str] | None] = mapped_column(JSONBVariant, nullable=True)
    # 本站是中文内容库：默认 zh 而不是 en。作品的语言在目录条目上维护，
    # 因为 submission 模型没有 language 列（物化时沿用这里的中文默认值）。
    language: Mapped[str] = mapped_column(String(10), nullable=False, default="zh")
    publication_status: Mapped[str] = mapped_column(String(20), nullable=False, default="published")
    # 定时发布：published 但 publish_at 在未来 = 已排期、尚未对公众可见。
    # 编辑部把整期排在月初，到点自动上线（判定见 catalog/visibility.py）。
    # 单列索引不需要：公开面过滤永远是 (tenant_id, publish_at) 组合，
    # 复合索引已覆盖；多余的 index=True 会让 alembic metadata 与迁移漂移。
    publish_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    journal_issue: Mapped[Issue | None] = relationship(back_populates="resources")

    # 下载计数：公开 /api/catalog/{id}/file 每次命中 +1，用于 R 指数
    # （见 app/modules/catalog/engagement.py）。只做原子自增，不做行锁。
    download_count: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, server_default="0"
    )
    # 荒诞指数：编辑部对单篇内容离谱程度的评定（0–10，一位小数）。
    # 与 R 指数（读者注意力）相互独立；可空——正经论文可以不评定。
    absurdity_index: Mapped[Decimal | None] = mapped_column(Numeric(4, 1), nullable=True)
    # 赛道：历史字段，已下线（见 core/tracks.py）。serious / absurd 双赛道
    # 已由每篇论文的荒诞指数（absurdity_index）取代，为兼容历史数据保留
    # 本列，新写入恒为 serious。复合索引见迁移 013
    # （(tenant_id, track, publication_status)），单列 index=True 会让公开面
    # 列表多一次回表。
    track: Mapped[str] = mapped_column(
        String(16), nullable=False, default="serious", server_default="serious"
    )
    # --- 质量评分（quality 模块 RQS v2.0，冻结口径） ---
    # 0–100；grade = A+/A/B/C/D；breakdown 存各维度得分明细（可复现）。
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    quality_score: Mapped[Decimal | None] = mapped_column(Numeric(5, 1), nullable=True)
    quality_grade: Mapped[str | None] = mapped_column(String(4), nullable=True)
    quality_breakdown: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    # 封面：主题图本地化的相对路径（/assets/covers/xxx.jpg）。
    # 为空时前端回退到生成的纸面卡（CoverArt），不会出现破图。
    cover_image: Mapped[str | None] = mapped_column(String(500), nullable=True)
    # 内容类别（v1.11）：编辑部评定的一等公民属性——academic（学术研究）/
    # fun（娱乐向）/ rant（吐槽向）。这是「类别」而不是「等级」：内容不分
    # 等级，层级只与创作者经验挂钩；同类别内容才能互相比对（排行/推荐
    # 均按本字段分域）。发布时必填（无值由发布流程按荒诞指数折算回填）。
    content_category: Mapped[str | None] = mapped_column(String(20), nullable=True)
    # 内容赛道派生值（P0）：paper|essay。academic→paper，fun/rant→essay。
    # DB 可空时由响应层按 content_category 回退计算；R 因子/篇均指标只统计 paper。
    content_track: Mapped[str | None] = mapped_column(String(8), nullable=True)
    # 娱乐轨文体细分（v1.16）：joke/fiction/review/guide/essay/poetry/rant。
    # 只对 essay 有值；论文轨恒为 NULL。用于娱乐区导航与筛选，不参与学术评分。
    content_genre: Mapped[str | None] = mapped_column(String(32), nullable=True, index=True)
    # 特别篇（篇幅特许）：正常作品不得超过轨道篇幅上限；只有显式特批的
    # 长稿才置 true，并在阅读端打「特别篇」标签。理由/操作人/时间留痕。
    is_special_issue: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False, server_default="false", index=True
    )
    special_issue_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    special_issue_by: Mapped[int | None] = mapped_column(Integer, nullable=True)
    special_issue_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    # 中图分类号（P0）：clc_code 如 TP3、clc_label 如「计算技术、计算机技术」。
    clc_code: Mapped[str | None] = mapped_column(String(20), nullable=True, index=True)
    clc_label: Mapped[str | None] = mapped_column(String(80), nullable=True)
    # 作者归属（P0）：发布时写 submissions.submitted_by；认领批准时写认领人。
    # 已绑定（IS NOT NULL）的文章不可再被他人认领（POST claim 返回 403）。
    owner_id: Mapped[int | None] = mapped_column(
        Integer,
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    # 归类键：封面主题、专题聚合使用（如 universe / lab / ocean / society）。
    cover_theme: Mapped[str | None] = mapped_column(String(50), nullable=True)
    # Nature 式分区：this-week / news-focus / books-arts / opinion / work /
    # research / amendments / collections。仅对外展示分组，不改轨道判定。
    article_section: Mapped[str | None] = mapped_column(String(40), nullable=True, index=True)
    # 合集内分部分（Editorial / Features / Articles / Reviews / Corrections…）。
    issue_part: Mapped[str | None] = mapped_column(String(40), nullable=True, index=True)
    # 学术声明与许可（P3-1）：不再只埋在 PDF/正文里，逐篇结构化存字段。
    # 作者贡献用 CRediT 文本；基金写资助方与编号；COI/数据可用性保留原文。
    # license 是单篇许可，避免前台把全站默认许可硬编码到每一篇。
    license: Mapped[str | None] = mapped_column(String(100), nullable=True)
    author_contributions: Mapped[str | None] = mapped_column(Text, nullable=True)
    funding: Mapped[str | None] = mapped_column(Text, nullable=True)
    coi_statement: Mapped[str | None] = mapped_column(Text, nullable=True)
    data_availability: Mapped[str | None] = mapped_column(Text, nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utcnow,
        onupdate=utcnow,
        nullable=False,
    )

    # __table_args__ 放在类体末尾：其中的 created_at.desc() 需要引用
    # 上面已定义的 created_at 列对象（类体自上而下求值）。
    #
    # ↓ 以下 4 个索引与 020_performance_indexes 迁移一一对应。
    # 该迁移用 raw DDL 建索引，DB 里有而 ORM metadata 没有，alembic
    # check 会判 "Detected removed index"（CI migrations job 因此挂）。
    # 在模型侧声明同名同形的索引让 metadata 与迁移后 schema 一致。
    __table_args__ = (
        UniqueConstraint("tenant_id", "slug", name="uq_resources_tenant_slug"),
        Index(
            "ix_resources_tenant_created",
            "tenant_id",
            created_at.desc(),
        ),
        Index(
            "ix_resources_tenant_type_created",
            "tenant_id",
            "type",
            created_at.desc(),
        ),
        # GIN trigram（pg_trgm）索引：PG 专属，SQLite 下 create_all 忽略
        # using/ops 参数，仅退化为普通索引（无害）。
        Index("ix_resources_tenant_publish_at", "tenant_id", "publish_at"),
        Index(
            "ix_resources_title_trgm",
            "title",
            postgresql_using="gin",
            postgresql_ops={"title": "gin_trgm_ops"},
        ),
        Index(
            "ix_resources_abstract_trgm",
            "abstract",
            postgresql_using="gin",
            postgresql_ops={"abstract": "gin_trgm_ops"},
        ),
    )


class Discipline(Base, TenantScopedMixin):
    """学科本体表。供分类一致性校验和统计聚合使用。

    A controlled vocabulary of academic disciplines. Resources
    reference these by string name (we keep the historical column
    shape rather than introducing a hard FK, so legacy data
    ingested before this table existed still loads cleanly). New
    resources are validated against the table on create/update
    by ``app.domain.catalog.onto``.

    Each discipline may have zero or more ``Subdiscipline`` rows.
    """

    __tablename__ = "disciplines"
    __table_args__ = (UniqueConstraint("tenant_id", "slug", name="uq_disciplines_tenant_slug"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    # URL slug (lower-case, hyphenated). Unique per tenant.
    slug: Mapped[str] = mapped_column(String(100), nullable=False)
    # Display name (e.g. "Computer Science").
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    # Short description for the directory UI.
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, nullable=False
    )

    subdisciplines: Mapped[list[Subdiscipline]] = relationship(
        back_populates="discipline", cascade="all, delete-orphan"
    )


class Subdiscipline(Base, TenantScopedMixin):
    """学科下的子领域。Resource.subdiscipline 是字符串，但需校验
    该字符串存在于此表中（按学科过滤）。"""

    __tablename__ = "subdisciplines"
    __table_args__ = (
        UniqueConstraint("discipline_id", "slug", name="uq_subdisciplines_discipline_slug"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    discipline_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("disciplines.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    slug: Mapped[str] = mapped_column(String(100), nullable=False)
    name: Mapped[str] = mapped_column(String(200), nullable=False)

    discipline: Mapped[Discipline] = relationship(back_populates="subdisciplines")


class AuthorClaim(Base, TenantScopedMixin):
    """作者认领申请：站内用户认领一篇"无人认领"的存量文章。

    背景：本刊早期文章由编辑部批量导入（authors 是纯字符串数组，
    与站内账号无关）。作者想在站内名下挂上自己的文章，需要走认领
    流程：用户对资源发起认领 → 编辑部批准后自动创建一条关联作品记录
    （``submissions.submitted_by`` = 认领人），从此"我的文章"、
    通过数统计、刊前预览等一切基于 Submission 链路的功能都能生效。

    状态机：``pending`` → ``approved`` | ``rejected``（终态）。
    同一 (tenant, resource, user) 只允许一条申请（唯一约束）；
    同一资源同一时刻只允许一条 pending（由服务层校验）。
    """

    __tablename__ = "author_claims"
    __table_args__ = (
        UniqueConstraint("tenant_id", "resource_id", "user_id", name="uq_author_claims_once"),
        Index("ix_author_claims_status_created", "status", "created_at"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    resource_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("resources.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    user_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    # 认领说明（申请人填写，如"我是本文作者"）。
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="pending")
    # P1：申请人认领的作者位（1-based，对应 authors_detail 顺序）。
    author_position: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # 认领证据类型：email / orcid / manuscript_id；evidence_value 为证据值。
    evidence_type: Mapped[str | None] = mapped_column(String(16), nullable=True)
    evidence_value: Mapped[str | None] = mapped_column(String(255), nullable=True)
    # 编辑部决定说明（批准/拒绝理由，通知里带给申请人）。
    decision_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    decided_by: Mapped[int | None] = mapped_column(
        Integer,
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, nullable=False
    )
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class ResourcePublicEvent(Base, TenantScopedMixin):
    """公开的内容变更记录：更正 / 撤回 / 署名变更 / 版本说明。

    与内部 ``AuditLog`` 分开：审计日志回答“谁在后台改了什么”，本表回答
    “读者需要知道这篇稿子发生过什么”。事件只追加，不覆盖历史；撤回不
    删除文章，而是保留原文并在页面顶部给出可点开的记录。
    """

    __tablename__ = "resource_public_events"
    __table_args__ = (
        Index("ix_resource_public_events_resource", "resource_id", "created_at"),
        Index("ix_resource_public_events_tenant_type", "tenant_id", "event_type"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    resource_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("resources.id", ondelete="CASCADE"), nullable=False
    )
    # correction / retraction / author_change / expression_of_concern / version
    event_type: Mapped[str] = mapped_column(String(30), nullable=False)
    title: Mapped[str] = mapped_column(String(300), nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    # 生效时间可早于录入时间（补记历史更正），公开页按此排序。
    effective_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_by: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, nullable=False
    )


__all__ = ["AuthorClaim", "Discipline", "Resource", "ResourcePublicEvent", "Subdiscipline"]


class Appeal(Base, TenantScopedMixin):
    """作者申诉：撤回作品、重审分数、重审分区。

    与站内反馈分开存：申诉需要状态流转（pending → accepted/rejected）、
    处置说明和操作人，不能只留一条审计日志。
    """

    __tablename__ = "appeals"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    resource_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("resources.id", ondelete="CASCADE"), nullable=False, index=True
    )
    user_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    submission_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("submissions.id", ondelete="SET NULL"), nullable=True
    )
    kind: Mapped[str] = mapped_column(String(20), nullable=False)
    reason: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(
        String(20), nullable=False, default="pending", server_default="pending"
    )
    editor_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    decided_by: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, nullable=False
    )
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class PageView(Base, TenantScopedMixin):
    """匿名页面访问事件（第一方统计，不依赖第三方 SDK）。

    只记 path / referrer / 时间，不写 IP、不写 UA、不关联 user_id；
    用于回答“哪些文章与入口真的有人来”，不能反查个人。
    """

    __tablename__ = "page_views"
    __table_args__ = (
        Index("ix_page_views_tenant_created", "tenant_id", "created_at"),
        Index("ix_page_views_path", "path"),
    )

    id: Mapped[int] = mapped_column(
        BigInteger().with_variant(Integer, "sqlite"), primary_key=True, autoincrement=True
    )
    path: Mapped[str] = mapped_column(String(300), nullable=False)
    referrer: Mapped[str | None] = mapped_column(String(500), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, nullable=False
    )


class Volume(Base, TenantScopedMixin):
    """A journal volume (e.g. Vol. 1). First-class since 2026-11-19.

    ``number`` is the human label used in URLs and citations; it is not an
    integer because legacy volumes can be "1A" or "S1". Uniqueness is per tenant.
    """

    __tablename__ = "volumes"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    number: Mapped[str] = mapped_column(String(50), nullable=False)
    title: Mapped[str | None] = mapped_column(String(200), nullable=True)
    year: Mapped[int | None] = mapped_column(Integer, nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    cover_image: Mapped[str | None] = mapped_column(String(500), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False
    )

    issues: Mapped[list[Issue]] = relationship(
        back_populates="volume", cascade="all, delete-orphan", order_by="Issue.number"
    )

    __table_args__ = (UniqueConstraint("tenant_id", "number", name="uq_volumes_tenant_number"),)


class Issue(Base, TenantScopedMixin):
    """A journal issue, the publishable unit.

    Status:
    - ``draft``: being assembled, invisible to readers
    - ``scheduled``: approved, has a future ``publish_at``
    - ``live``: visible to readers (subject to ``publish_at``)
    - ``archived``: kept for history, no longer promoted
    """

    __tablename__ = "issues"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    volume_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("volumes.id", ondelete="CASCADE"), nullable=False, index=True
    )
    number: Mapped[str] = mapped_column(String(50), nullable=False)
    title: Mapped[str | None] = mapped_column(String(200), nullable=True)
    intro: Mapped[str | None] = mapped_column(Text, nullable=True)
    cover_image: Mapped[str | None] = mapped_column(String(500), nullable=True)
    status: Mapped[str] = mapped_column(
        String(20), nullable=False, default="draft", server_default="draft"
    )
    publish_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow, nullable=False
    )

    volume: Mapped[Volume] = relationship(back_populates="issues")
    resources: Mapped[list[Resource]] = relationship(back_populates="journal_issue")

    __table_args__ = (
        UniqueConstraint("tenant_id", "volume_id", "number", name="uq_issues_tenant_volume_number"),
        Index("ix_issues_tenant_status", "tenant_id", "status"),
    )
