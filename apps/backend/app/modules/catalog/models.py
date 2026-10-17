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

from sqlalchemy import (
    JSON,
    DateTime,
    ForeignKey,
    Index,
    Integer,
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
    pages: Mapped[str | None] = mapped_column(String(50), nullable=True)
    issn: Mapped[str | None] = mapped_column(String(20), nullable=True)
    isbn: Mapped[str | None] = mapped_column(String(20), nullable=True)
    publisher: Mapped[str | None] = mapped_column(String(500), nullable=True)
    short_container_title: Mapped[str | None] = mapped_column(String(200), nullable=True)
    keywords: Mapped[list[str] | None] = mapped_column(JSONBVariant, nullable=True)
    language: Mapped[str] = mapped_column(String(10), nullable=False, default="en")
    publication_status: Mapped[str] = mapped_column(String(20), nullable=False, default="published")

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
    by ``app.modules.catalog.onto``.

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


__all__ = ["Discipline", "Resource", "Subdiscipline"]
