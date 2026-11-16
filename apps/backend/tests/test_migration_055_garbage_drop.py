"""P1 #16 — 迁移 055 垃圾备份表清理（SQLite 口径）。

生产累积了 ~19 张手工备份/草稿表（``*_bak_*`` / ``*_backup_YYYYMMDD`` /
``p0_fix`` …）。仓库今天只能验证一个垃圾名 ``users_backup_20261107``，其余
生产独有名单由 ops/drop-garbage-tables.sh 运行时清点归档后删除。本迁移只删
可验证名，且**明确保留**两个 20261112 回滚点。这里用 importlib 加载 055 +
真实 SQLite MigrationContext 执行 upgrade()，验证：

  * 垃圾表被删除；
  * 两个回滚点表被保留（即使误入删除名单也跳过）；
  * 无关业务表不受影响；
  * fresh 库（无垃圾表）upgrade 是 no-op；
  * 重跑幂等。
"""

from __future__ import annotations

import importlib.util
from pathlib import Path
from types import ModuleType

from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.pool import StaticPool

_MIGRATION_PATH = (
    Path(__file__).resolve().parents[1] / "alembic" / "versions" / "055_drop_garbage_tables.py"
)


def _load_migration() -> ModuleType:
    spec = importlib.util.spec_from_file_location("migration_055", _MIGRATION_PATH)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _engine():
    return create_engine(
        "sqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False}
    )


def _tables(conn) -> set[str]:
    return set(inspect(conn).get_table_names())


def _seed(conn) -> None:
    for name in (
        "users_backup_20261107",
        "resources_authors_meta_backup_20261112",
        "resources_keywords_backup_20261112",
        "users",
    ):
        conn.execute(text(f"CREATE TABLE {name} (id INTEGER PRIMARY KEY)"))


def _upgrade(conn, module: ModuleType) -> None:
    ctx = MigrationContext.configure(conn)
    with Operations.context(ctx):
        module.upgrade()


def test_055_drops_garbage_preserves_rollback_points() -> None:
    module = _load_migration()
    engine = _engine()
    with engine.begin() as conn:
        _seed(conn)
    with engine.begin() as conn:
        _upgrade(conn, module)
    with engine.connect() as conn:
        remaining = _tables(conn)
    assert "users_backup_20261107" not in remaining
    assert "resources_authors_meta_backup_20261112" in remaining
    assert "resources_keywords_backup_20261112" in remaining
    assert "users" in remaining
    engine.dispose()


def test_055_is_idempotent_on_rerun() -> None:
    module = _load_migration()
    engine = _engine()
    with engine.begin() as conn:
        _seed(conn)
    for _ in range(2):
        with engine.begin() as conn:
            _upgrade(conn, module)
    with engine.connect() as conn:
        remaining = _tables(conn)
    assert "users_backup_20261107" not in remaining
    assert "resources_authors_meta_backup_20261112" in remaining
    engine.dispose()


def test_055_on_fresh_db_is_noop() -> None:
    """fresh 库没有任何垃圾表：DROP IF EXISTS 不得报错、不得删业务表。"""
    module = _load_migration()
    engine = _engine()
    with engine.begin() as conn:
        conn.execute(text("CREATE TABLE users (id INTEGER PRIMARY KEY)"))
    with engine.begin() as conn:
        _upgrade(conn, module)
    with engine.connect() as conn:
        assert _tables(conn) == {"users"}
    engine.dispose()


def test_055_preserved_names_are_never_in_drop_list() -> None:
    """守卫：回滚点表名绝不能出现在删除名单里（防止未来误加）。"""
    module = _load_migration()
    drop = set(module._GARBAGE_DROP)
    preserved = set(module._PRESERVED_ROLLBACK_POINTS)
    assert drop.isdisjoint(preserved)
