"""053 — FORCE RLS on coin tables + non-negative balance guard (P1 #12, #11).

#12: 036 created coin_rules / coin_policy / coin_shop_items / coin_purchases
with ``ENABLE ROW LEVEL SECURITY`` + a tenant_isolation policy, but never
``FORCE``. Without FORCE, the table owner (and any BYPASSRLS role) skips the
policy — so a misconfigured runtime role or a owner-connected session could
read/write across tenants. The application already filters every coin query
by tenant_id and db.py re-issues the GUC per transaction, so FORCE is safe
for legitimate same-tenant traffic and closes the owner-bypass hole.

#11: add a DB-level backstop against negative wallet balances. The runtime
now debits atomically with a ``coin_balance >= price`` guard (shop.purchase),
but a CHECK constraint makes negative balances impossible regardless of
future code paths. ``NOT VALID`` enforces it on new writes immediately while
not blocking the migration on legacy rows; operators VALIDATE it later after
reconciling any historical negative balance against the point_events ledger.

PostgreSQL-only: SQLite (tests) has no RLS, and cannot ADD a CHECK via ALTER.

Revision ID: 053_coin_force_rls
Revises: 052_submission_triage_repair
Create Date: 2026-11-16
"""

from __future__ import annotations

from alembic import op

revision = "053_coin_force_rls"
down_revision = "052_submission_triage_repair"
branch_labels = None
depends_on = None

_COIN_TABLES = ("coin_rules", "coin_policy", "coin_shop_items", "coin_purchases")


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        return
    for table in _COIN_TABLES:
        op.execute(f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY")
    # 幂等：约束已存在时跳过（重跑/部分环境手工加过）。NOT VALID 不校验存量行。
    op.execute(
        """
        DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM pg_constraint WHERE conname = 'chk_users_coin_balance_nonneg'
          ) THEN
            ALTER TABLE users
              ADD CONSTRAINT chk_users_coin_balance_nonneg
              CHECK (coin_balance >= 0) NOT VALID;
          END IF;
        END $$;
        """
    )


def downgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        return
    op.execute("ALTER TABLE users DROP CONSTRAINT IF EXISTS chk_users_coin_balance_nonneg")
    for table in _COIN_TABLES:
        op.execute(f"ALTER TABLE {table} NO FORCE ROW LEVEL SECURITY")
