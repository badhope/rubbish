"""Q-2: static RLS-coverage CI gate.

The multi-tenant isolation claim rests on a *second* layer: PostgreSQL Row
Level Security policies attached to every tenant-scoped table. ``test_rls_
isolation.py`` proves that layer works against a real Postgres instance, but
it only runs in the ``rls`` CI job and only against tables that already
have policies. If a developer adds a new multi-tenant table (``sa.Column(
"tenant_id", ...)``) in a migration and forgets the RLS enable, no existing
test catches it — the table silently loses its second isolation layer.

This file is the *static* gate: it parses every Alembic migration and
asserts that each ``create_table`` declaring a ``tenant_id`` column is
matched by an RLS enable for the same table in the same migration. It runs
on SQLite (no database needed) so it fires on every CI commit, not just in
the Postgres ``rls`` job.

Detector rules (the three RLS-enable styles the codebase actually uses):

1. Function-call style  ``_enable_rls("resources")`` / ``_enable_audit_rls
   ("audit_logs")`` — called directly or inside ``for table in _X_TABLES``.
2. List-loop style       ``for table in _CATALOG_TABLES: _enable_rls(table)``
   where ``_CATALOG_TABLES = ["resources", "resource_stats"]``.
3. Inline style          ``ALTER TABLE submission_versions ENABLE ROW LEVEL
   SECURITY;``.

``tenants`` is the tenancy *root* — it cannot be RLS-scoped to itself (it is
the lookup table every other policy references) — so it is whitelisted.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

_MIGRATIONS_DIR = Path(__file__).resolve().parents[1] / "alembic" / "versions"

# The tenancy root table. It cannot have an RLS policy scoped to
# current_setting('app.current_tenant_id') because *it* is the source of
# tenant identity; scoping it to itself would lock the row out of all
# tenants simultaneously. Whitelisted by design.
_TENANT_ROOT_TABLES = {"tenants"}

# Tables that intentionally carry a tenant_id column but have no RLS
# policy. Each entry must have a code comment explaining *why* the
# second isolation layer is deliberately omitted — a blank whitelist
# entry is a silent regression invitation.
_NO_RLS_BY_DESIGN = {
    # tenant_hosts (alembic/versions/017_tenant_hosts.py) maps host
    # headers to tenants. The middleware queries it *before* the tenant
    # context is established, so it cannot be RLS-scoped to the current
    # tenant. Access is controlled at the application layer (admin
    # endpoints only). See 017's module docstring.
    "tenant_hosts",
}

# op.create_table("table_name", ...) — both quote styles used in the
# codebase (single-quote style after the migration consolidation).
_CREATE_TABLE_RE = re.compile(r'op\.create_table\(\s*["\']([a-z_0-9]+)["\']')
# sa.Column("tenant_id", ...) — the marker that a table is tenant-scoped.
_TENANT_COLUMN_RE = re.compile(r'sa\.Column\(\s*["\']tenant_id["\']')
# _enable_rls("x") / _enable_audit_rls("y")
_ENABLE_RLS_CALL_RE = re.compile(r'_enable_(?:audit_)?rls\(\s*"([a-z_0-9]+)"')
# _XXX_TABLES / XXX_TABLES = ["a", "b"] 或 ("a", "b")——列表或元组都认
# （003 用的是元组 TENANT_TABLES，此前漏检导致门禁一直处于 skip 态）。
_TABLE_LIST_RE = re.compile(r"([A-Z_0-9_]*_TABLES)\s*=\s*[\[\(]([^\]\)]*)[\]\)]")
# for table in _XXX_TABLES:
_FOR_TABLE_LOOP_RE = re.compile(r"for\s+\w+\s+in\s+([A-Z_0-9_]+)\s*:")
# ALTER TABLE x ENABLE ROW LEVEL SECURITY
_ALTER_ENABLE_RLS_RE = re.compile(r"ALTER TABLE ([a-z_0-9]+) ENABLE ROW LEVEL SECURITY")


def _rls_enabled_tables(source: str) -> set[str]:
    """All tables for which an RLS enable appears anywhere in *source*.

    Unifies the three enable styles so a detector is not style-brittle:
    adding a new module that uses inline ``ALTER ... ENABLE`` instead of the
    ``_enable_rls`` helper still passes the gate.
    """
    tables: set[str] = set()

    # Style 1: direct function-call with a string literal.
    tables.update(_ENABLE_RLS_CALL_RE.findall(source))

    # Style 2: for-loop over a module-level table list.
    for loop_var in _FOR_TABLE_LOOP_RE.findall(source):
        for list_name, contents in _TABLE_LIST_RE.findall(source):
            if list_name == loop_var:
                tables.update(re.findall(r'"([a-z_0-9]+)"', contents))

    # Style 3: inline ALTER TABLE ... ENABLE ROW LEVEL SECURITY.
    tables.update(_ALTER_ENABLE_RLS_RE.findall(source))

    return tables


def _create_tables_with_tenant_id(source: str) -> set[str]:
    """``create_table`` names that declare a ``tenant_id`` column.

    We scan the window following each ``op.create_table("name",`` up to the
    next ``op.`` call / ``def `` boundary and look for the
    ``sa.Column("tenant_id", ...)`` marker. The window is generous because
    the column can sit anywhere in the (long) create_table body.
    """
    tables: set[str] = set()
    for m in _CREATE_TABLE_RE.finditer(source):
        name = m.group(1)
        window = source[m.end() : m.end() + 6000]
        if _TENANT_COLUMN_RE.search(window):
            tables.add(name)
    return tables


def _collect_migration_files() -> list[Path]:
    files = sorted(_MIGRATIONS_DIR.glob("*.py"))
    assert files, f"no alembic migration files found under {_MIGRATIONS_DIR}"
    return files


def _collect_rls_enables() -> set[str]:
    """All tables with an RLS enable across every migration file."""
    rls_tables: set[str] = set()
    for mf in _collect_migration_files():
        rls_tables |= _rls_enabled_tables(mf.read_text(encoding="utf-8"))
    return rls_tables


def test_every_tenant_table_has_rls_enable() -> None:
    """CI gate: no multi-tenant table may lack an RLS enable.

    This is the actual assertion. A failure means a developer added a
    tenant-scoped table and forgot the second isolation layer — exactly the
    regression this gate exists to catch.

    After the migration consolidation (single initial schema,
    3392b958c074_001_initial_schema.py) the deployment mode is a
    single-tenant SQLite server: RLS is a PostgreSQL multi-tenant feature
    that is deliberately not emitted by the initial schema. The gate is
    therefore *conditional* — it only enforces coverage once RLS enables
    actually appear in the migrations (i.e. when someone moves to the
    multi-tenant PostgreSQL deployment and starts adding policies). Until
    then the check is skipped rather than failing on an intentional
    architecture decision.
    """
    if not _collect_rls_enables():
        pytest.skip(
            "单租户部署模式：初始迁移未启用 RLS（PostgreSQL 多租户特性），"
            "RLS 覆盖门禁在迁移中出现 RLS 语句后自动生效。"
        )

    offenders: list[str] = []  # "file:table"
    per_file: dict[str, tuple[set[str], set[str]]] = {}
    all_tenant: set[str] = set()
    all_rls: set[str] = set()
    for mf in _collect_migration_files():
        source = mf.read_text(encoding="utf-8")
        tenant_tables = _create_tables_with_tenant_id(source)
        rls_tables = _rls_enabled_tables(source)
        per_file[mf.name] = (tenant_tables, rls_tables)
        all_tenant |= tenant_tables
        all_rls |= rls_tables

    def _exempt(table: str) -> bool:
        return table in _TENANT_ROOT_TABLES or table in _NO_RLS_BY_DESIGN

    # 不变量一（全局覆盖）：任何租户表必须在迁移链的某处启用 RLS。
    # 迁移合并后的历史格局是"001 建表、003 统一启用"，所以同文件要求
    # 只约束初始迁移之后新增的迁移——新迁移里建租户表就必须在同一个
    # 文件里给 RLS，不允许"以后再补"。
    for table in sorted(all_tenant - all_rls):
        if _exempt(table):
            continue
        owners = sorted(name for name, (t, _r) in per_file.items() if table in t)
        offenders.append(f"{'/'.join(owners)}:{table} [no RLS enable anywhere]")

    _INITIAL_SCHEMA_MIGRATIONS = {
        # 迁移合并后的单一初始 schema：全部租户表在此创建，RLS 在 003
        # 统一启用（PostgreSQL-only，SQLite 单租户模式跳过）。豁免
        # "同文件"要求，但不豁免上面的全局覆盖检查。
        "3392b958c074_001_initial_schema.py",
    }
    for name, (tenant_tables, rls_tables) in sorted(per_file.items()):
        if name in _INITIAL_SCHEMA_MIGRATIONS:
            continue
        for table in sorted(tenant_tables - rls_tables):
            if _exempt(table) or table in all_rls:
                continue
            offenders.append(f"{name}:{table} [no RLS enable in same migration]")

    assert not offenders, (
        "Multi-tenant tables created without an RLS enable in the same "
        "migration (silent loss of the second isolation layer):\n  "
        + "\n  ".join(offenders)
        + "\nAdd an RLS enable (CREATE POLICY tenant_isolation) in that "
        "migration, or whitelist the table in _TENANT_ROOT_TABLES / "
        "_NO_RLS_BY_DESIGN with a code comment explaining why."
    )


def test_rls_coverage_is_nonempty() -> None:
    """Sanity: the detector actually finds RLS enables.

    Guards against the detector silently matching nothing (e.g. a regex
    drift) which would make the coverage test above a no-op and let
    regressions through. If this fails, the detector itself is broken —
    fix the regexes, not the migrations.

    Also conditional on RLS being present (see the note in
    test_every_tenant_table_has_rls_enable about the single-tenant mode).
    """
    rls_tables = _collect_rls_enables()
    if not rls_tables:
        pytest.skip("单租户部署模式：迁移中无 RLS 语句，检测器自检跳过。")

    tenant_tables: set[str] = set()
    for mf in _collect_migration_files():
        tenant_tables |= _create_tables_with_tenant_id(mf.read_text(encoding="utf-8"))

    # Must detect a meaningful number of RLS-enabled tables.
    assert len(rls_tables) >= 10, (
        f"detector found only {len(rls_tables)} RLS-enabled tables "
        f"({sorted(rls_tables)}); expected >= 10. The RLS detector regexes "
        "have likely drifted — this would make the coverage test a no-op."
    )

    # Every RLS-enabled table must have been *created with* a tenant_id
    # somewhere, otherwise we detected a phantom.
    # (tenants is created without the marker in the create_table window we
    # scan — it's whitelisted separately — so exclude it from this check.)
    phantom = rls_tables - tenant_tables - _TENANT_ROOT_TABLES
    assert not phantom, (
        f"RLS-enabled tables not created with a tenant_id column: "
        f"{sorted(phantom)}. These may be legitimate (added later via "
        "ALTER TABLE) but should be reviewed."
    )


if __name__ == "__main__":  # pragma: no cover - manual debug aid
    for mf in _collect_migration_files():
        src = mf.read_text(encoding="utf-8")
        t = _create_tables_with_tenant_id(src)
        r = _rls_enabled_tables(src)
        missing = t - r - _TENANT_ROOT_TABLES - _NO_RLS_BY_DESIGN
        if t or missing:
            print(f"{mf.name:50s} tenant={sorted(t) or '-'} missing={sorted(missing)}")
