"""056 — drop all legacy backup / scratch tables (explicit cleanup).

Revision ID: 056_drop_legacy_backup_tables
Revises: 055_drop_garbage_tables
Create Date: 2026-11-16

The operator has explicitly authorized deleting historical backup tables and
using the latest live tables only; no rollback copies are to be retained.

The list below is the verified production inventory at the time of cleanup.
``DROP TABLE IF EXISTS`` keeps this migration safe on a fresh database and
on SQLite used by the test suite. The dropped tables are unreferenced by
ORM models and application code; ``review_scores`` is the retired v4 score
table (29 rows, old columns), superseded by the v5 rubric.
"""

from __future__ import annotations

from alembic import op

revision = "056_drop_legacy_backup_tables"
down_revision = "055_drop_garbage_tables"
branch_labels = None
depends_on = None

# Exact production inventory, including names that 055 deliberately preserved.
_LEGACY_DROP_NAMES = (
    "_bak_bigbad_submissions_20261113",
    "_bak_bigbad_topics_20261113",
    "_bak_bigbad_versions_20261113",
    "_bak_reclass_20261109",
    "_bak_reclass_b",
    "_bak_reclass_c",
    "_bak_submission_335",
    "content_fix_20261107",
    "forum_topics_backup_20261110",
    "forum_topics_backup_20261110b",
    "p0_fix_20261107",
    "resources_authors_meta_backup_20261112",
    "resources_keywords_backup_20261112",
    "resources_quality_backup_20261110",
    "resources_quality_backup_20261112_batch09",
    "resources_quality_backup_20261112_batch10",
    "resources_quality_backup_20261112_batch11",
    "resources_quality_backup_20261112_batch12",
    "resources_quality_backup_20261112_manual",
    "review_scores",
)


def upgrade() -> None:
    for table in _LEGACY_DROP_NAMES:
        op.execute(f'DROP TABLE IF EXISTS "{table}"')


def downgrade() -> None:
    # Intentionally irreversible: the operator chose to keep no backups.
    pass
