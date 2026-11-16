"""052 — repair triage_status backfill swallowed by FORCE RLS (P1 #10).

043  added ``submissions.triage_status`` and backfilled it with two bare
``UPDATE submissions ...`` statements. ``submissions`` has FORCE ROW LEVEL
SECURITY, and the migration session has no ``app.current_tenant_id`` GUC,
so RLS silently filtered both UPDATEs to **zero rows**. Production result:
278 already-accepted manuscripts stayed ``triage_status='pending'`` and
kept re-appearing in the desk triage queue.

This migration re-runs the backfill the way 045 does it: per tenant, with
``set_config('app.current_tenant_id', :tid, true)`` issued inside the
migration transaction so the RLS policy lets the UPDATE through.

Idempotent + non-destructive:
  * Only rows still ``triage_status='pending'`` are touched, so re-running
    is a no-op and any later *manual* triage decision (rework / materials /
    passed / rejected) is preserved.
  * ``triaged_at`` / ``triaged_by`` are left untouched — this repairs the
    status flag only, it does not fabricate an audit trail.

043 is kept as-is for history; this is the corrective follow-up.

Revision ID: 052_submission_triage_repair
Revises: 051_resource_public_events
Create Date: 2026-11-16
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "052_submission_triage_repair"
down_revision = "051_resource_public_events"
branch_labels = None
depends_on = None

# 已送外审及之后的状态 → passed；已拒稿 → rejected。与 043 的口径一致。
_PASSED_STATUSES = (
    "under_review",
    "major_revision",
    "minor_revision",
    "resubmitted",
    "accepted",
    "approved",
)


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        # submissions 启用 FORCE RLS：必须按租户设置事务级 GUC，否则 UPDATE
        # 被策略静默过滤成 0 行（这正是 043 回填失败的根因）。
        tenant_ids = [
            str(row[0]) for row in bind.execute(sa.text("SELECT id FROM tenants")).fetchall()
        ]
        for tenant_id in tenant_ids:
            bind.execute(
                sa.text("SELECT set_config('app.current_tenant_id', :tid, true)"),
                {"tid": tenant_id},
            )
            bind.execute(
                sa.text(
                    """
                    UPDATE submissions
                    SET triage_status = 'passed'
                    WHERE tenant_id = :tid
                      AND triage_status = 'pending'
                      AND status IN :statuses
                    """
                ).bindparams(sa.bindparam("statuses", expanding=True)),
                {"tid": tenant_id, "statuses": list(_PASSED_STATUSES)},
            )
            bind.execute(
                sa.text(
                    """
                    UPDATE submissions
                    SET triage_status = 'rejected'
                    WHERE tenant_id = :tid
                      AND triage_status = 'pending'
                      AND status = 'rejected'
                    """
                ),
                {"tid": tenant_id},
            )
    else:
        # SQLite（测试）无 RLS / GUC，直接按状态回填；pending 谓词保证幂等。
        op.execute(
            """
            UPDATE submissions
            SET triage_status = 'passed'
            WHERE triage_status = 'pending'
              AND status IN (
                'under_review', 'major_revision', 'minor_revision',
                'resubmitted', 'accepted', 'approved'
              )
            """
        )
        op.execute(
            """
            UPDATE submissions
            SET triage_status = 'rejected'
            WHERE triage_status = 'pending' AND status = 'rejected'
            """
        )


def downgrade() -> None:
    # 数据修复不可逆：无法区分"本次回填的 passed/rejected"与"编辑人工做出的
    # 同值决定"。回滚会覆盖人工 triage，故 downgrade 刻意 no-op。
    pass
