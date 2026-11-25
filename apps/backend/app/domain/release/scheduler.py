"""Tiny in-process scheduler for due release manifests.

The main scheduler interval is six hours because review reminders are
expensive; a scheduled issue cannot wait six hours.  This loop is separate,
runs every 30 seconds, and only touches manifests that are already due.

Failure policy: never publish a changed issue silently.  If the content hash
no longer matches, or the gate is blocked, the manifest is superseded and an
audit row records why.  The editor then re-checks and re-approves.
"""

from __future__ import annotations

import asyncio
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.db import async_session_factory
from app.core.leader_election import ELECTION_RETRY_SECONDS, release_elector
from app.core.logging import get_logger
from app.core.tenant import TENANT_CONTEXT_VAR
from app.core.time import utcnow
from app.domain.catalog.models import Resource
from app.domain.follows.fanout import notify_publication
from app.domain.release.alerts import alert_release_failure
from app.domain.release.gate import check_issue
from app.domain.release.models import ReleaseManifest
from app.models import AuditLog, Tenant

logger = get_logger("rubbish.release_scheduler")

TICK_SECONDS = 30
STARTUP_DELAY_SECONDS = 10
_task: asyncio.Task[None] | None = None

_state: dict[str, Any] = {
    "started_at": None,
    "last_run_at": None,
    "last_success_at": None,
    "last_error": None,
    "last_stats": None,
    "runs": 0,
    "running": False,
}


def release_scheduler_state() -> dict[str, Any]:
    """Read-only snapshot for the admin health page and tests."""
    election = release_elector.state()
    return {
        **_state,
        **election,
        "tick_seconds": TICK_SECONDS,
        "task_alive": _task is not None and not _task.done(),
    }


async def _due_manifests(session: AsyncSession, tenant_id: Any) -> list[ReleaseManifest]:
    stmt = (
        select(ReleaseManifest)
        .where(
            ReleaseManifest.tenant_id == tenant_id,
            ReleaseManifest.status == "scheduled",
            ReleaseManifest.scheduled_for.is_not(None),
            ReleaseManifest.scheduled_for <= utcnow(),
        )
        .order_by(ReleaseManifest.scheduled_for.asc())
    )
    # 多实例或“手动发布”同时命中同一 manifest 时，只让一个执行者拿到行锁；
    # 另一个实例跳过该行，避免同一期重复发布、重复 fan-out 通知。
    if session.get_bind().dialect.name == "postgresql":
        stmt = stmt.with_for_update(skip_locked=True)
    return list((await session.execute(stmt)).scalars().all())


async def publish_due_manifests() -> dict[str, int]:
    """Publish every due, still-valid manifest.  Idempotent."""
    _state["running"] = True
    _state["last_run_at"] = utcnow()
    totals = {"due": 0, "published": 0, "failed": 0, "tenants": 0}
    async with async_session_factory() as tenant_session:
        tenant_ids = list((await tenant_session.execute(select(Tenant.id))).scalars().all())

    for tenant_id in tenant_ids:
        token = TENANT_CONTEXT_VAR.set(tenant_id)
        async with async_session_factory() as session:
            try:
                due = await _due_manifests(session, tenant_id)
                totals["tenants"] += 1
                totals["due"] += len(due)
                for manifest in due:
                    current = await check_issue(session, tenant_id, manifest.volume, manifest.issue)
                    if current["content_hash"] != manifest.content_hash:
                        manifest.status = "superseded"
                        manifest.payload = {
                            **manifest.payload,
                            "scheduler_failure": "content_changed",
                            "scheduler_failed_at": utcnow().isoformat(),
                        }
                        session.add(
                            AuditLog(
                                tenant_id=tenant_id,
                                actor_user_id=manifest.created_by,
                                action="release.scheduled_failed",
                                target_type="issue",
                                target_id=f"{manifest.volume}/{manifest.issue}",
                                payload={
                                    "manifest_id": manifest.id,
                                    "reason": "content_changed",
                                    "manifest_hash": manifest.content_hash,
                                    "current_hash": current["content_hash"],
                                },
                            )
                        )
                        await alert_release_failure(
                            session,
                            tenant_id=tenant_id,
                            manifest=manifest,
                            reason="content_changed",
                            detail={
                                "manifest_hash": manifest.content_hash,
                                "current_hash": current["content_hash"],
                            },
                        )
                        totals["failed"] += 1
                        continue
                    if current["status"] != "ready":
                        manifest.status = "superseded"
                        manifest.payload = {
                            **manifest.payload,
                            "scheduler_failure": "gate_blocked",
                            "scheduler_failed_at": utcnow().isoformat(),
                        }
                        session.add(
                            AuditLog(
                                tenant_id=tenant_id,
                                actor_user_id=manifest.created_by,
                                action="release.scheduled_failed",
                                target_type="issue",
                                target_id=f"{manifest.volume}/{manifest.issue}",
                                payload={
                                    "manifest_id": manifest.id,
                                    "reason": "gate_blocked",
                                    "errors": current["error_count"],
                                },
                            )
                        )
                        await alert_release_failure(
                            session,
                            tenant_id=tenant_id,
                            manifest=manifest,
                            reason="gate_blocked",
                            detail={"errors": current["error_count"]},
                        )
                        totals["failed"] += 1
                        continue
                    manifest.status = "published"
                    manifest.published_at = utcnow()
                    resources = list(
                        (
                            await session.execute(
                                select(Resource).where(
                                    Resource.tenant_id == tenant_id,
                                    Resource.volume == manifest.volume,
                                    Resource.issue == manifest.issue,
                                )
                            )
                        )
                        .scalars()
                        .all()
                    )
                    await notify_publication(
                        session,
                        tenant_id=tenant_id,
                        resources=resources,
                        notify_authors=True,
                        event_type="published",
                    )
                    session.add(
                        AuditLog(
                            tenant_id=tenant_id,
                            actor_user_id=manifest.created_by,
                            action="release.scheduled_publish",
                            target_type="issue",
                            target_id=f"{manifest.volume}/{manifest.issue}",
                            payload={
                                "manifest_id": manifest.id,
                                "scheduled_for": manifest.scheduled_for.isoformat()
                                if manifest.scheduled_for
                                else None,
                                "resources": manifest.resource_count,
                            },
                        )
                    )
                    totals["published"] += 1
                await session.commit()
            finally:
                TENANT_CONTEXT_VAR.reset(token)
    _state["last_stats"] = dict(totals)
    _state["last_success_at"] = utcnow()
    _state["runs"] = int(_state["runs"] or 0) + 1
    _state["last_error"] = None
    _state["running"] = False
    return totals


async def _loop() -> None:
    await asyncio.sleep(STARTUP_DELAY_SECONDS)
    while True:
        if not await release_elector.acquire():
            # Another process is the leader. Stay alive and poll; if that
            # process dies its connection drops the lock and we take over.
            await asyncio.sleep(ELECTION_RETRY_SECONDS)
            continue
        try:
            while await release_elector.heartbeat():
                try:
                    stats = await publish_due_manifests()
                    if stats["due"]:
                        logger.info("release_scheduler_done", **stats)
                except asyncio.CancelledError:
                    raise
                except Exception as exc:
                    _state["last_error"] = str(exc)[:500]
                    _state["running"] = False
                    logger.warning("release_scheduler_failed", exc_info=True)
                await asyncio.sleep(TICK_SECONDS)
        finally:
            await release_elector.release()
            _state["running"] = False


def start_release_scheduler() -> None:
    global _task
    if settings.is_test or not settings.scheduler_enabled:
        return
    if _task is not None and not _task.done():
        return
    _state["started_at"] = utcnow()
    _task = asyncio.create_task(_loop(), name="rubbish-release-scheduler")
    logger.info("release_scheduler_started", tick_seconds=TICK_SECONDS)


async def stop_release_scheduler() -> None:
    global _task
    if _task is None:
        return
    _task.cancel()
    try:
        await _task
    except asyncio.CancelledError:
        pass
    _task = None
    await release_elector.release()
    logger.info("release_scheduler_stopped")


__all__ = [
    "publish_due_manifests",
    "release_scheduler_state",
    "start_release_scheduler",
    "stop_release_scheduler",
]
