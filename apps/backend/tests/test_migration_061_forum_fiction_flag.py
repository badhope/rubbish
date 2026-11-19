"""迁移 061：给帖子加虚构标记（SQLite 口径）。"""

from __future__ import annotations

import importlib.util
from pathlib import Path
from types import ModuleType

from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import create_engine, text
from sqlalchemy.pool import StaticPool

_MIGRATION_PATH = (
    Path(__file__).resolve().parents[1] / "alembic" / "versions" / "061_forum_fiction_flag.py"
)


def _load() -> ModuleType:
    spec = importlib.util.spec_from_file_location("migration_061", _MIGRATION_PATH)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_061_adds_fiction_flag() -> None:
    module = _load()
    engine = create_engine("sqlite://", poolclass=StaticPool)
    with engine.begin() as conn:
        conn.execute(text("CREATE TABLE forum_topics (id INTEGER PRIMARY KEY)"))
    with engine.begin() as conn:
        ctx = MigrationContext.configure(conn)
        with Operations.context(ctx):
            module.upgrade()
    with engine.connect() as conn:
        columns = [row[1] for row in conn.execute(text("PRAGMA table_info(forum_topics)")).all()]
    assert "is_fictional" in columns
    engine.dispose()
