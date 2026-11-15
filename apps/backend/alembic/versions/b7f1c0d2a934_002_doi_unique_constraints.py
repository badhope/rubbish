"""002 — DOI 唯一约束（安全修复 P0-3）

``resources.doi`` 与 ``doi_registrations.doi`` 此前只建了普通索引，
多租户部署下租户 A 的 resource #7 与租户 B 的 #7 会铸出**同一个 DOI**
（默认后缀取自全局自增 id）。DOI 是学术永久标识，撞号不可撤销，
会直接污染引用与 DataCite 账目，因此在数据库层补上唯一约束兜底。

注意：两列都可空（Postgres 唯一索引允许多个 NULL），不影响未注册 DOI 的资源。

Revision ID: b7f1c0d2a934
Revises: 3392b958c074
Create Date: 2026-10-18
"""

from __future__ import annotations

from alembic import op

revision = "b7f1c0d2a934"
down_revision = "3392b958c074"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # SQLAlchemy 的 ``unique=True`` 在列上生成的是**唯一索引**而不是唯一约束，
    # 所以这里必须"删掉 001 建的普通索引 → 重建同名唯一索引"，才能与模型一致
    # （否则 CI 的 ``alembic check`` 会一直报 remove_index/add_index 漂移）。
    op.drop_index("ix_resources_doi", table_name="resources")
    op.create_index("ix_resources_doi", "resources", ["doi"], unique=True)
    op.drop_index("ix_doi_registrations_doi", table_name="doi_registrations")
    op.create_index("ix_doi_registrations_doi", "doi_registrations", ["doi"], unique=True)


def downgrade() -> None:
    op.drop_index("ix_doi_registrations_doi", table_name="doi_registrations")
    op.create_index("ix_doi_registrations_doi", "doi_registrations", ["doi"], unique=False)
    op.drop_index("ix_resources_doi", table_name="resources")
    op.create_index("ix_resources_doi", "resources", ["doi"], unique=False)
