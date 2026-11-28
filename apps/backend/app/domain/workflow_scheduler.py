"""In-process scheduler for review reminders and email outbox retries.

Why this exists: the reminder functions were written but never wired to a
clock, and the release scheduler was also never started. That made scheduled
releases and overdue reminders look implemented while silently never firing.
This loop is deliberately small: one process-wide task, no worker dependency,
and safe to disable with ``RUBBISH_SCHEDULER_ENABLED=false``.

Each job gets its own session. A broken job (for example a malformed row in
one tenant) is rolled back and logged without poisoning the next job; the old
shared-session version could leave the transaction aborted and silently skip
the remaining sweeps.
"""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from contextlib import suppress
from functools import partial
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.db import async_session_factory
from app.core.leader_election import ELECTION_RETRY_SECONDS, workflow_elector
from app.core.logging import get_logger
from app.core.tenant import TENANT_CONTEXT_VAR
from app.core.time import utcnow
from app.domain.forum.reminders import run_moderation_sla_reminders
from app.domain.notifications.email_outbox import retry_due_emails
from app.domain.release.digest import run_publication_digest
from app.domain.submission.review_reminders import run_overdue_reminders, run_rework_reminders
from app.domain.submission.security import run_file_scan_backfill
from app.domain.submission.triage_reminders import run_triage_reminders
from app.models import Tenant

logger = get_logger("rubbish.workflow_scheduler")

# 15 分钟：足够及时处理修回到期与邮件退避，又不会给数据库造成持续压力。
TICK_SECONDS = 15 * 60

_state: dict[str, Any] = {
    "started_at": None,
    "last_run_at": None,
    "last_success_at": None,
    "last_error": None,
    "last_stats": None,
    "runs": 0,
    "running": False,
}


def workflow_scheduler_state() -> dict[str, Any]:
    """Read-only snapshot for the admin health page and tests."""
    election = workflow_elector.state()
    return {
        **_state,
        **election,
        "tick_seconds": TICK_SECONDS,
        "task_alive": _task is not None and not _task.done(),
    }


async def _run_job(
    name: str, tenant_id: Any, runner: Callable[[AsyncSession], Awaitable[dict[str, int]]]
) -> dict[str, int]:
    """Run one tenant-scoped job in its own session, rollback on failure."""
    async with async_session_factory() as job_db:
        try:
            result = await runner(job_db)
            # Jobs such as publication_digest and the scan backfill only
            # flush their rows; without this commit the session closes and
            # PostgreSQL rolls every scan result and digest marker back.
            await job_db.commit()
            return result
        except Exception:
            await job_db.rollback()
            logger.warning("workflow_job_failed", job=name, tenant_id=str(tenant_id), exc_info=True)
            raise


async def run_workflow_once() -> dict[str, int]:
    """One sweep across all tenants. Public for tests and manual runs."""
    started = utcnow()
    _state["running"] = True
    _state["last_run_at"] = started
    errors: list[str] = []
    async with async_session_factory() as db:
        tenant_ids = list((await db.execute(select(Tenant.id))).scalars().all())
    totals = {
        "triage": 0,
        "review": 0,
        "rework": 0,
        "moderation_sla": 0,
        "email_retry": 0,
        "publication_digest": 0,
        "virus_scan": 0,
    }
    for tenant_id in tenant_ids:
        token = TENANT_CONTEXT_VAR.set(tenant_id)
        try:
            specs = [
                (
                    "triage",
                    "triage",
                    partial(run_triage_reminders, tenant_id=tenant_id),
                    "reminded",
                ),
                (
                    "review",
                    "review",
                    partial(run_overdue_reminders, tenant_id=tenant_id),
                    "reminded",
                ),
                ("rework", "rework", partial(run_rework_reminders, tenant_id=tenant_id), None),
                (
                    "moderation_sla",
                    "moderation_sla",
                    partial(run_moderation_sla_reminders, tenant_id=tenant_id),
                    "reminded",
                ),
                (
                    "email_retry",
                    "email_retry",
                    partial(retry_due_emails, tenant_id=tenant_id),
                    "sent",
                ),
                (
                    "publication_digest",
                    "publication_digest",
                    partial(run_publication_digest, tenant_id=tenant_id),
                    None,
                ),
                (
                    "virus_scan",
                    "virus_scan",
                    partial(run_file_scan_backfill, tenant_id=tenant_id),
                    "scanned",
                ),
            ]
            for name, key, runner, field in specs:
                try:
                    result = await _run_job(name, tenant_id, runner)
                    if name == "rework":
                        totals[key] += int(result.get("due_soon", 0)) + int(
                            result.get("overdue", 0)
                        )
                    elif name == "publication_digest":
                        totals[key] += int(result.get("sent", 0)) + int(result.get("queued", 0))
                    elif field is not None:
                        totals[key] += int(result.get(field, 0))
                except Exception:
                    errors.append(f"{name}@{tenant_id}")
        finally:
            TENANT_CONTEXT_VAR.reset(token)
    _state["last_stats"] = dict(totals)
    _state["last_error"] = ", ".join(errors) if errors else None
    _state["last_success_at"] = utcnow()
    _state["runs"] = int(_state["runs"] or 0) + 1
    _state["running"] = False
    return totals


_task: asyncio.Task[None] | None = None


async def _loop() -> None:
    await asyncio.sleep(settings.scheduler_startup_delay_seconds)
    while True:
        if not await workflow_elector.acquire():
            await asyncio.sleep(ELECTION_RETRY_SECONDS)
            continue
        try:
            while await workflow_elector.heartbeat():
                try:
                    stats = await run_workflow_once()
                    logger.info("workflow_scheduler_done", **stats)
                except asyncio.CancelledError:
                    raise
                except Exception as exc:
                    _state["last_error"] = str(exc)[:500]
                    _state["running"] = False
                    logger.warning("workflow_scheduler_failed", exc_info=True)
                await asyncio.sleep(TICK_SECONDS)
        finally:
            await workflow_elector.release()
            _state["running"] = False


def start_workflow_scheduler() -> None:
    global _task
    if settings.is_test or not settings.scheduler_enabled:
        return
    if _task is not None and not _task.done():
        return
    _state["started_at"] = utcnow()
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
    await workflow_elector.release()
    logger.info("workflow_scheduler_stopped")


__all__ = [
    "TICK_SECONDS",
    "run_workflow_once",
    "start_workflow_scheduler",
    "stop_workflow_scheduler",
    "workflow_scheduler_state",
]
