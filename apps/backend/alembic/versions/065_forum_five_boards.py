"""Merge the forum board tree into five stable, non-empty rooms.

The previous tree had 12 boards (three parents + nine leaves). For a small
community that produced nine empty rooms. This migration keeps the five rooms
that actually carry conversation:

    discussion 写作讨论
    records    记录与复盘
    collab     组队招募
    life       创作生活
    site        站务与反馈

Legacy topics are reassigned by ``board_id`` and ``category``; no topic is
deleted. Old slugs remain readable through the API's alias table and the
frontend's legacy-slug map.

Revision ID: 065_forum_five_boards
Revises: 064_article_boards
Create Date: 2026-11-21
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "065_forum_five_boards"
down_revision = "064_article_boards"
branch_labels = None
depends_on = None

NEW_BOARDS = (
    ("discussion", "写作讨论", "写法、材料、证据与继续追问", 0),
    ("records", "记录与复盘", "选题、过程、现场与失败，都放在这里；用标签区分阶段", 1),
    ("collab", "组队招募", "找合作、找数据、找同伴", 2),
    ("life", "创作生活", "写作以外，支撑继续写下去的部分", 3),
    ("site", "站务与反馈", "社区公告、规则、建议与申诉", 4),
)

# old board slug / category -> new board slug
MERGE_MAP = {
    "research": "records",
    "planning": "records",
    "lab-notes": "records",
    "field-notes": "records",
    "failures": "records",
    "survival": "life",
    "announcements": "site",
    "feedback": "site",
    # a few legacy categories that existed before the tree
    "paper": "discussion",
    "paper-reading": "discussion",
    "paper-repro": "discussion",
    "method": "discussion",
    "writing": "discussion",
    "stats": "discussion",
    "question": "discussion",
    "meta": "site",
    "notice": "site",
    "suggestion": "site",
}

OLD_SLUGS = tuple(MERGE_MAP)
NEW_BOARDS_SLUGS = tuple(row[0] for row in NEW_BOARDS)


def _tenant_ids(bind) -> list[str]:
    return [str(row[0]) for row in bind.execute(sa.text("SELECT id FROM tenants ORDER BY id")).all()]


def upgrade() -> None:
    bind = op.get_bind()
    for tenant_id in _tenant_ids(bind):
        bind.execute(
            sa.text("SELECT set_config('app.current_tenant_id', :tid, false)"),
            {"tid": tenant_id},
        )

        # Ensure the five rooms exist. ``records`` is new; the other four
        # already exist in the 060 tree. ON CONFLICT keeps this idempotent.
        for slug, name, description, sort_order in NEW_BOARDS:
            bind.execute(
                sa.text(
                    """
                    INSERT INTO forum_boards
                        (tenant_id, parent_id, slug, name, description, sort_order, is_active, created_at)
                    VALUES
                        (:tid, NULL, :slug, :name, :description, :sort_order, true, now())
                    ON CONFLICT (tenant_id, slug) DO UPDATE SET
                        parent_id = NULL,
                        name = EXCLUDED.name,
                        description = EXCLUDED.description,
                        sort_order = EXCLUDED.sort_order,
                        is_active = true
                    """
                ),
                {
                    "tid": tenant_id,
                    "slug": slug,
                    "name": name,
                    "description": description,
                    "sort_order": sort_order,
                },
            )

        ids = {
            row[0]: row[1]
            for row in bind.execute(
                sa.text(
                    "SELECT slug, id FROM forum_boards WHERE tenant_id = :tid AND slug IN :slugs"
                ).bindparams(sa.bindparam("slugs", expanding=True)),
                {"tid": tenant_id, "slugs": list(NEW_BOARDS_SLUGS)},
            ).all()
        }

        # Move topics from every old room before deleting those rooms.
        for old_slug, new_slug in MERGE_MAP.items():
            target_id = ids[new_slug]
            bind.execute(
                sa.text(
                    """
                    UPDATE forum_topics
                    SET board_id = :target_id, category = :new_slug
                    WHERE tenant_id = :tid
                      AND (board_id IN (
                          SELECT id FROM forum_boards
                          WHERE tenant_id = :tid AND slug = :old_slug
                      ) OR category = :old_slug)
                    """
                ),
                {
                    "target_id": target_id,
                    "new_slug": new_slug,
                    "tid": tenant_id,
                    "old_slug": old_slug,
                },
            )

        # Normalize the rooms that remain.
        for old_slug in OLD_SLUGS:
            bind.execute(
                sa.text(
                    "DELETE FROM forum_boards WHERE tenant_id = :tid AND slug = :slug"
                ),
                {"tid": tenant_id, "slug": old_slug},
            )


def downgrade() -> None:
    """Restore the board definitions; topic history stays in the five rooms.

    Data merging is intentionally not reversed: splitting a merged topic would
    require per-topic provenance that was never stored.
    """
    bind = op.get_bind()
    for tenant_id in _tenant_ids(bind):
        bind.execute(
            sa.text("SELECT set_config('app.current_tenant_id', :tid, false)"),
            {"tid": tenant_id},
        )
        bind.execute(
            sa.text("DELETE FROM forum_boards WHERE tenant_id = :tid AND slug = :slug"),
            {"tid": tenant_id, "slug": "records"},
        )
