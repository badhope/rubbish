"""In-process scheduler for review reminders and email outbox retries.

Why this exists: the reminder functions were written but never wired to a
clock, and the release scheduler was also never started. That made scheduled
releases and overdue reminders look implemented while silently never firing.
This loop is deliberately small: one process-wide task, no worker dependency,
and safe to disable with ``RUBBISH_SCHEDULER_ENABLED=false``.
"""

from __future__ import annotations

import asyncio
from contextlib import suppress

from sqlalchemy import select

from app.core.config import settings
from app.core.db import async_session_factory
from app.core.logging import get_logger
from app.core.tenant import TENANT_CONTEXT_VAR
from app.domain.notifications.email_outbox import retry_due_emails
from app.domain.submission.review_reminders import run_overdue_reminders, run_rework_reminders
from app.domain.submission.triage_reminders import run_triage_reminders
from app.models import Tenant

logger = get_logger("rubbish.workflow_scheduler")

# 15 分钟：足够及时处理修回到期与邮件退避，又不会给数据库造成持续压力。
TICK_SECONDS = 15 * 60


async def run_workflow_once() -> dict[str, int]:
    """One sweep across all tenants. Public for tests and manual runs."""
    async with async_session_factory() as db:
        tenant_ids = list((await db.execute(select(Tenant.id))).scalars().all())
    totals = {"triage": 0, "review": 0, "rework": 0, "email_retry": 0}
    for tenant_id in tenant_ids:
        token = TENANT_CONTEXT_VAR.set(tenant_id)
        try:
            async with async_session_factory() as db:
                try:
                    totals["triage"] += int(
                        (await run_triage_reminders(db, tenant_id=tenant_id)).get("reminded", 0)
                    )
                except Exception:
                    logger.warning("workflow_triage_failed", tenant_id=str(tenant_id), exc_info=True)
                try:
                    totals["review"] += int(
                        (await run_overdue_reminders(db, tenant_id=tenant_id)).get("reminded", 0)
                    )
                except Exception:
                    logger.warning("workflow_review_failed", tenant_id=str(tenant_id), exc_info=True)
                try:
                    stats = await run_rework_reminders(db, tenant_id=tenant_id)
                    totals["rework"] += int(stats.get("due_soon", 0)) + int(
                        stats.get("overdue", 0)
                    )
                except Exception:
                    logger.warning("workflow_rework_failed", tenant_id=str(tenant_id), exc_info=True)
                try:
                    totals["email_retry"] += int(
                        (await retry_due_emails(db, tenant_id=tenant_id)).get("sent", 0)
                    )
                except Exception:
                    logger.warning("workflow_email_retry_failed", tenant_id=str(tenant_id), exc_info=True)
        finally:
            TENANT_CONTEXT_VAR.reset(token)
    return totals


_task: asyncio.Task | None = None


async def _loop() -> None:
    await asyncio.sleep(settings.scheduler_startup_delay_seconds)
    while True:
        try:
            stats = await run_workflow_once()
            logger.info("workflow_scheduler_done", **stats)
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.warning("workflow_scheduler_failed", exc_info=True)
        await asyncio.sleep(TICK_SECONDS)


def start_workflow_scheduler() -> None:
    global _task
    if settings.is_test or not settings.scheduler_enabled or _task is not None:
        return
    _task = asyncio.create_task(_loop(), name="rubbish-workflow-scheduler")
    logger.info("workflow_scheduler_started", tick_seconds=TICK_SECONDS)


async def stop_workflow_scheduler() -> None:
    global _task
    if _task is None:
        return
    _task.cancel()
    with suppress(asyncio.CancelledError):
        await _task
    _task = None
    logger.info("workflow_scheduler_stopped")


__all__ = ["TICK_SECONDS", "run_workflow_once", "start_workflow_scheduler", "stop_workflow_scheduler"]
