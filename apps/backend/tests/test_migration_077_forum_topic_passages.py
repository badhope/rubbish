"""迁移 077：主题帖的页边引文列（SQLite 口径）。"""

from __future__ import annotations

import importlib.util
from pathlib import Path
from types import ModuleType

from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import create_engine, text
from sqlalchemy.pool import StaticPool

_MIGRATION_PATH = (
    Path(__file__).resolve().parents[1] / "alembic" / "versions" / "077_forum_topic_passages.py"
)


def _load() -> ModuleType:
    spec = importlib.util.spec_from_file_location("migration_077", _MIGRATION_PATH)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _columns(conn) -> list[str]:
    return [row[1] for row in conn.execute(text("PRAGMA table_info(forum_topics)")).all()]


def test_077_adds_and_removes_passage_columns() -> None:
    module = _load()
    assert module.revision == "077_forum_topic_passages"
    assert module.down_revision == "076_forum_moderation_tuning"
    engine = create_engine("sqlite://", poolclass=StaticPool)
    with engine.begin() as conn:
        conn.execute(text("CREATE TABLE forum_topics (id INTEGER PRIMARY KEY, title TEXT)"))
        conn.execute(text("INSERT INTO forum_topics (id, title) VALUES (1, 'kept')"))
    with engine.begin() as conn:
        with Operations.context(MigrationContext.configure(conn)):
            module.upgrade()
    with engine.connect() as conn:
        assert {"passage_quote", "passage_prefix", "passage_suffix"} <= set(_columns(conn))
        # Existing topics simply have no passage.
        row = conn.execute(text("SELECT title, passage_quote FROM forum_topics")).one()
        assert tuple(row) == ("kept", None)
    with engine.begin() as conn:
        with Operations.context(MigrationContext.configure(conn)):
            module.downgrade()
    with engine.connect() as conn:
        assert "passage_quote" not in _columns(conn)
    engine.dispose()
