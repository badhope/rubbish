"""迁移 075：users.subject_disciplines 的 PostgreSQL 离线 SQL。"""

from __future__ import annotations

import importlib.util
import io
from pathlib import Path
from types import ModuleType

from alembic.migration import MigrationContext
from alembic.operations import Operations

_MIGRATION_PATH = (
    Path(__file__).resolve().parents[1] / "alembic" / "versions" / "075_user_subject_disciplines.py"
)


def _load() -> ModuleType:
    spec = importlib.util.spec_from_file_location("migration_075", _MIGRATION_PATH)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _offline_sql(action: str) -> str:
    module = _load()
    buffer = io.StringIO()
    context = MigrationContext.configure(
        dialect_name="postgresql",
        opts={"output_buffer": buffer, "as_sql": True},
    )
    with Operations.context(context):
        getattr(module, action)()
    return buffer.getvalue()


def test_075_upgrade_adds_not_null_jsonb_with_empty_default() -> None:
    sql = _offline_sql("upgrade")
    assert "ALTER TABLE users ADD COLUMN subject_disciplines JSONB" in sql
    assert "NOT NULL" in sql
    assert "'[]'::jsonb" in sql


def test_075_downgrade_drops_the_column() -> None:
    sql = _offline_sql("downgrade")
    assert "ALTER TABLE users DROP COLUMN subject_disciplines" in sql


def test_075_revision_chain_follows_074() -> None:
    module = _load()
    assert module.revision == "075_user_subject_disciplines"
    assert module.down_revision == "074_public_reviews"
