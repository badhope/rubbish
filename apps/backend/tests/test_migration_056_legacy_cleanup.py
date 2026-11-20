"""056 — explicit cleanup of all legacy backup / retired score tables."""

from __future__ import annotations

import importlib.util
from pathlib import Path
from types import ModuleType

from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.pool import StaticPool

_MIGRATION_PATH = (
    Path(__file__).resolve().parents[1]
    / "alembic"
    / "versions"
    / "056_drop_legacy_backup_tables.py"
)


def _load_migration() -> ModuleType:
    spec = importlib.util.spec_from_file_location("migration_056", _MIGRATION_PATH)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_056_drops_all_legacy_and_keeps_business_tables() -> None:
    module = _load_migration()
    engine = create_engine(
        "sqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False}
    )
    with engine.begin() as conn:
        for name in module._LEGACY_DROP_NAMES:
            conn.execute(text(f'CREATE TABLE "{name}" (id INTEGER PRIMARY KEY)'))
        conn.execute(text("CREATE TABLE resources (id INTEGER PRIMARY KEY)"))
        conn.execute(text("CREATE TABLE submissions (id INTEGER PRIMARY KEY)"))
    with engine.begin() as conn:
        ctx = MigrationContext.configure(conn)
        with Operations.context(ctx):
            module.upgrade()
    with engine.connect() as conn:
        remaining = set(inspect(conn).get_table_names())
    assert not remaining.intersection(module._LEGACY_DROP_NAMES)
    assert {"resources", "submissions"}.issubset(remaining)
    engine.dispose()
