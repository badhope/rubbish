"""迁移 076：论坛审核排序权重与灰度规则列的 PostgreSQL 离线 SQL。"""

from __future__ import annotations

import importlib.util
import io
from pathlib import Path
from types import ModuleType

from alembic.migration import MigrationContext
from alembic.operations import Operations

_MIGRATION_PATH = (
    Path(__file__).resolve().parents[1]
    / "alembic"
    / "versions"
    / "076_forum_moderation_tuning.py"
)


def _load() -> ModuleType:
    spec = importlib.util.spec_from_file_location("migration_076", _MIGRATION_PATH)
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


def test_076_upgrade_adds_weight_and_gray_rule_columns() -> None:
    sql = _offline_sql("upgrade")
    assert "ADD COLUMN priority_risk_weight INTEGER" in sql
    assert "DEFAULT '10'" in sql
    assert "NOT NULL" in sql
    assert "ADD COLUMN priority_age_weight INTEGER" in sql
    assert "DEFAULT '1'" in sql
    assert "ADD COLUMN gray_rules JSONB" in sql


def test_076_downgrade_drops_the_columns() -> None:
    sql = _offline_sql("downgrade")
    assert "DROP COLUMN gray_rules" in sql
    assert "DROP COLUMN priority_age_weight" in sql
    assert "DROP COLUMN priority_risk_weight" in sql


def test_076_revision_chain_follows_075() -> None:
    module = _load()
    assert module.revision == "076_forum_moderation_tuning"
    assert module.down_revision == "075_user_subject_disciplines"
