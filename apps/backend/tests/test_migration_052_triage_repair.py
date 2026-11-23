"""P1 #10 — 迁移 052 triage 回填修复（SQLite 口径）。

043 的裸 UPDATE 被 submissions 的 FORCE RLS 静默过滤成 0 行，导致已通过稿
triage_status 卡在 pending。052 按租户设 GUC 重跑回填。这里用 importlib 加载
052 + 真实 SQLite MigrationContext 执行 upgrade()，验证：

  * accepted/under_review + pending → passed
  * rejected + pending → rejected
  * 仍 pending 的基础检查稿（status=pending）保持 pending
  * 人工 triage 决定（rework / 已 passed）不被覆盖
  * 重跑幂等

PostgreSQL 的 FORCE RLS + 按租户 GUC 路径由 test_rls_isolation.py 同款 PG 环境
单独验证（SQLite 无 RLS，这里只锁回填逻辑与幂等/保护谓词）。
"""

from __future__ import annotations

import importlib.util
from pathlib import Path
from types import ModuleType

from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import create_engine, text
from sqlalchemy.pool import StaticPool

_MIGRATION_PATH = (
    Path(__file__).resolve().parents[1] / "alembic" / "versions" / "052_submission_triage_repair.py"
)


def _load_migration() -> ModuleType:
    spec = importlib.util.spec_from_file_location("migration_052", _MIGRATION_PATH)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _engine():
    return create_engine(
        "sqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False}
    )


def _seed(conn) -> None:
    conn.execute(
        text(
            "CREATE TABLE submissions "
            "(id INTEGER PRIMARY KEY, tenant_id TEXT, status TEXT, triage_status TEXT)"
        )
    )
    rows = [
        (1, "accepted", "pending"),  # → passed
        (2, "rejected", "pending"),  # → rejected
        (3, "under_review", "pending"),  # → passed
        (4, "pending", "pending"),  # 保持 pending（仍在基础检查队列）
        (5, "accepted", "rework"),  # 人工 rework 不被覆盖
        (6, "accepted", "passed"),  # 已 passed，幂等
        (7, "major_revision", "pending"),  # → passed
    ]
    for rid, status, triage in rows:
        conn.execute(
            text(
                "INSERT INTO submissions (id, tenant_id, status, triage_status) "
                "VALUES (:id, 't', :status, :triage)"
            ),
            {"id": rid, "status": status, "triage": triage},
        )


def _statuses(conn) -> dict[int, str]:
    return {
        row[0]: row[1]
        for row in conn.execute(text("SELECT id, triage_status FROM submissions")).fetchall()
    }


def test_052_repairs_pending_and_preserves_manual_triage() -> None:
    module = _load_migration()
    engine = _engine()
    with engine.begin() as conn:
        _seed(conn)
    with engine.begin() as conn:
        ctx = MigrationContext.configure(conn)
        with Operations.context(ctx):
            module.upgrade()
    with engine.connect() as conn:
        result = _statuses(conn)
    assert result == {
        1: "passed",
        2: "rejected",
        3: "passed",
        4: "pending",
        5: "rework",
        6: "passed",
        7: "passed",
    }
    engine.dispose()


def test_052_is_idempotent_on_rerun() -> None:
    module = _load_migration()
    engine = _engine()
    with engine.begin() as conn:
        _seed(conn)
    for _ in range(2):
        with engine.begin() as conn:
            ctx = MigrationContext.configure(conn)
            with Operations.context(ctx):
                module.upgrade()
    with engine.connect() as conn:
        result = _statuses(conn)
    assert result[1] == "passed"
    assert result[2] == "rejected"
    assert result[4] == "pending"
    assert result[5] == "rework"
    engine.dispose()


def test_052_downgrade_is_noop() -> None:
    """数据修复不可逆：downgrade 不得改动任何行（避免覆盖人工决定）。"""
    module = _load_migration()
    engine = _engine()
    with engine.begin() as conn:
        _seed(conn)
    with engine.begin() as conn:
        ctx = MigrationContext.configure(conn)
        with Operations.context(ctx):
            module.upgrade()
    with engine.connect() as conn:
        before = _statuses(conn)
    with engine.begin() as conn:
        ctx = MigrationContext.configure(conn)
        with Operations.context(ctx):
            module.downgrade()
    with engine.connect() as conn:
        after = _statuses(conn)
    assert before == after
    engine.dispose()
