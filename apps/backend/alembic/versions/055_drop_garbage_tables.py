"""055 — drop verified garbage backup tables (P1 #16).

The production database accumulated ~19 ad-hoc backup / scratch tables
(``*_bak_*``, ``*_backup_YYYYMMDD``, ``p0_fix``, ``content_fix_20261107`` …)
from manual hotfix sessions. They bloat backups, confuse schema inspection,
and risk being mistaken for live tables.

Only ONE garbage name is verifiable from the repository today:
``users_backup_20261107`` (migrations-sql/20261107_role_axis.sql:13 — a full
``CREATE TABLE ... AS SELECT * FROM users`` snapshot taken before the role-axis
convergence). The other ~18 names exist only on production and cannot be
hardcoded from the repo/git history. This migration therefore drops just the
verifiable name; the FULL production inventory is enumerated, archived
(per-table ``pg_dump -t``) and dropped by ops/drop-garbage-tables.sh, which
finalizes the list at runtime. See docs/p1-audit-garbage-tables.md.

DELIBERATELY PRESERVED (rollback points, NOT garbage):
  * resources_authors_meta_backup_20261112
  * resources_keywords_backup_20261112
These are the documented rollback anchors for the authors_meta / keywords
normalization (TECH-DEBT-CLOSURE). They are excluded from both this migration
and the ops script.

SAFETY: this migration is delivered, NOT applied. Before applying it on any
real database, archive ``users_backup_20261107`` with ``pg_dump -t`` (the ops
script does this automatically). DROP is irreversible; downgrade is a no-op
and restoration relies on that pre-drop archive. ``DROP TABLE IF EXISTS`` is
safe on PostgreSQL and SQLite and a no-op on a fresh database.

Revision ID: 055_drop_garbage_tables
Revises: 054_missing_table_rls
Create Date: 2026-11-16
"""

from __future__ import annotations

from alembic import op

revision = "055_drop_garbage_tables"
down_revision = "054_missing_table_rls"
branch_labels = None
depends_on = None

# 仓库可验证的垃圾表（其余生产独有名单由 ops/drop-garbage-tables.sh 运行时清点）。
# 命名刻意不以 _TABLES 结尾：test_rls_coverage 把 ``for x in *_TABLES`` 一律
# 当作 RLS-enable 循环，DROP 列表若叫 *_TABLES 会被误判为"启用了 RLS 的 phantom"。
_GARBAGE_DROP = ("users_backup_20261107",)

# 明确保留的回滚点——绝不进入删除名单（迁移与 ops 脚本共用此口径）。
_PRESERVED_ROLLBACK_POINTS = (
    "resources_authors_meta_backup_20261112",
    "resources_keywords_backup_20261112",
)


def upgrade() -> None:
    for table in _GARBAGE_DROP:
        if table in _PRESERVED_ROLLBACK_POINTS:
            continue
        op.execute(f"DROP TABLE IF EXISTS {table}")


def downgrade() -> None:
    # 删表不可逆：恢复依赖 drop 前的 pg_dump -t 归档（见 ops 脚本与文档）。
    pass
