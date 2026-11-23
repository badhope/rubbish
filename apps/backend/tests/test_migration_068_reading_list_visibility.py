"""迁移 068：给合集加可见性字段（public/private，默认 private，SQLite 口径）。"""

from __future__ import annotations

import importlib.util
from pathlib import Path
from types import ModuleType

from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import create_engine, text
from sqlalchemy.pool import StaticPool

_MIGRATION_PATH = (
    Path(__file__).resolve().parents[1] / "alembic" / "versions" / "068_reading_list_visibility.py"
)


def _load() -> ModuleType:
    spec = importlib.util.spec_from_file_location("migration_068", _MIGRATION_PATH)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _columns(conn: object) -> list[str]:
    return [row[1] for row in conn.execute(text("PRAGMA table_info(reading_lists)")).all()]


def test_068_upgrade_adds_visibility_column_and_index() -> None:
    module = _load()
    engine = create_engine("sqlite://", poolclass=StaticPool)
    with engine.begin() as conn:
        conn.execute(text("CREATE TABLE reading_lists (id INTEGER PRIMARY KEY)"))
    with engine.begin() as conn:
        ctx = MigrationContext.configure(conn)
        with Operations.context(ctx):
            module.upgrade()
    with engine.connect() as conn:
        assert "visibility" in _columns(conn)
        indexes = [row[1] for row in conn.execute(text("PRAGMA index_list(reading_lists)")).all()]
        assert "ix_reading_lists_visibility" in indexes
    engine.dispose()


def test_068_downgrade_drops_column_and_index() -> None:
    module = _load()
    engine = create_engine("sqlite://", poolclass=StaticPool)
    with engine.begin() as conn:
        conn.execute(text("CREATE TABLE reading_lists (id INTEGER PRIMARY KEY)"))
    with engine.begin() as conn:
        ctx = MigrationContext.configure(conn)
        with Operations.context(ctx):
            module.upgrade()
            module.downgrade()
    with engine.connect() as conn:
        assert "visibility" not in _columns(conn)
        indexes = [row[1] for row in conn.execute(text("PRAGMA index_list(reading_lists)")).all()]
        assert "ix_reading_lists_visibility" not in indexes
    engine.dispose()
