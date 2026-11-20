"""迁移 060：把旧论文栏目重建成荒诞科研社区版块树（SQLite 口径）。"""

from __future__ import annotations

import importlib.util
from pathlib import Path
from types import ModuleType

from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import create_engine, text
from sqlalchemy.pool import StaticPool

_MIGRATION_PATH = (
    Path(__file__).resolve().parents[1] / "alembic" / "versions" / "060_community_boards.py"
)


def _load_migration() -> ModuleType:
    spec = importlib.util.spec_from_file_location("migration_060", _MIGRATION_PATH)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _engine():
    return create_engine(
        "sqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False}
    )


def _seed(conn) -> None:
    conn.execute(text("CREATE TABLE tenants (id TEXT PRIMARY KEY, tenant_type TEXT)"))
    conn.execute(
        text(
            """
            CREATE TABLE forum_boards (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                tenant_id TEXT NOT NULL,
                parent_id INTEGER,
                slug TEXT NOT NULL,
                name TEXT NOT NULL,
                description TEXT,
                sort_order INTEGER NOT NULL DEFAULT 0,
                is_active INTEGER NOT NULL DEFAULT 1,
                created_at DATETIME NOT NULL
            )
            """
        )
    )
    conn.execute(
        text(
            """
            CREATE TABLE forum_topics (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                tenant_id TEXT NOT NULL,
                category TEXT NOT NULL,
                board_id INTEGER
            )
            """
        )
    )
    conn.execute(text("INSERT INTO tenants (id, tenant_type) VALUES ('t1', 'journal')"))
    conn.execute(
        text(
            """
            INSERT INTO forum_boards
                (tenant_id, parent_id, slug, name, sort_order, is_active, created_at)
            VALUES
                ('t1', NULL, 'academic', '学术交流', 0, 1, CURRENT_TIMESTAMP),
                ('t1', 1, 'paper', '论文沙龙', 0, 1, CURRENT_TIMESTAMP),
                ('t1', 1, 'method', '方法与写作', 1, 1, CURRENT_TIMESTAMP),
                ('t1', 1, 'life', '学术生存', 2, 1, CURRENT_TIMESTAMP),
                ('t1', 1, 'collab', '组队招募', 3, 1, CURRENT_TIMESTAMP),
                ('t1', NULL, 'site', '站务', 1, 1, CURRENT_TIMESTAMP)
            """
        )
    )
    for category in ("paper", "method", "life", "collab", "meta", "notice", "suggestion"):
        conn.execute(
            text("INSERT INTO forum_topics (tenant_id, category) VALUES ('t1', :c)"),
            {"c": category},
        )


def _upgrade(conn, module: ModuleType) -> None:
    ctx = MigrationContext.configure(conn)
    with Operations.context(ctx):
        module.upgrade()


def test_060_rebuilds_board_tree_and_moves_topics() -> None:
    module = _load_migration()
    engine = _engine()
    with engine.begin() as conn:
        _seed(conn)
    with engine.begin() as conn:
        _upgrade(conn, module)
    with engine.connect() as conn:
        boards = conn.execute(
            text("SELECT slug, parent_id FROM forum_boards ORDER BY sort_order")
        ).all()
        topics = conn.execute(text("SELECT category, board_id FROM forum_topics ORDER BY id")).all()
        discussion_id = conn.execute(
            text("SELECT id FROM forum_boards WHERE slug = 'discussion'")
        ).scalar_one()
        survival_id = conn.execute(
            text("SELECT id FROM forum_boards WHERE slug = 'survival'")
        ).scalar_one()
        collab_id = conn.execute(
            text("SELECT id FROM forum_boards WHERE slug = 'collab'")
        ).scalar_one()
        announcement_id = conn.execute(
            text("SELECT id FROM forum_boards WHERE slug = 'announcements'")
        ).scalar_one()
        feedback_id = conn.execute(
            text("SELECT id FROM forum_boards WHERE slug = 'feedback'")
        ).scalar_one()
        tenant_type = conn.execute(
            text("SELECT tenant_type FROM tenants WHERE id = 't1'")
        ).scalar_one()

    assert len(boards) == 12
    assert tenant_type == "community"
    assert [b.slug for b in boards][:6] == [
        "research",
        "planning",
        "lab-notes",
        "field-notes",
        "failures",
        "discussion",
    ]
    assert [t.category for t in topics] == [
        "discussion",
        "discussion",
        "survival",
        "collab",
        "announcements",
        "announcements",
        "feedback",
    ]
    assert [t.board_id for t in topics] == [
        discussion_id,
        discussion_id,
        survival_id,
        collab_id,
        announcement_id,
        announcement_id,
        feedback_id,
    ]
    engine.dispose()
