"""1.19.56 infrastructure: leader election, leases, malware scan, digest."""

from __future__ import annotations

import subprocess
from datetime import UTC, datetime
from uuid import uuid4

import pytest

from app.core import antivirus
from app.core.config import settings
from app.core.leader_election import PgLeaderElector
from app.core.rate_limit_store import MemoryRateLimiterStore
from app.domain import workflow_scheduler
from app.domain.catalog.models import Resource
from app.domain.notifications import services as notifications
from app.domain.notifications.models import (
    PublicationDigestDelivery,
    PublicationDigestItem,
)
from app.domain.release.digest import run_publication_digest
from app.models import Tenant, User


@pytest.mark.asyncio
async def test_leader_elector_single_process_and_release() -> None:
    elector = PgLeaderElector("test", (1, 2))
    assert await elector.acquire() is True
    assert elector.is_leader is True
    assert await elector.heartbeat() is True
    await elector.release()
    assert elector.is_leader is False


@pytest.mark.asyncio
async def test_memory_lease_limit_and_release() -> None:
    store = MemoryRateLimiterStore()
    first = await store.acquire_lease(bucket_key="convert", limit=2, ttl_seconds=30)
    second = await store.acquire_lease(bucket_key="convert", limit=2, ttl_seconds=30)
    assert first and second
    assert await store.acquire_lease(bucket_key="convert", limit=2, ttl_seconds=30) is None
    await store.release_lease(bucket_key="convert", token=first)
    third = await store.acquire_lease(bucket_key="convert", limit=2, ttl_seconds=30)
    assert third is not None


def test_clamav_output_is_parsed(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "virus_scan_enabled", True)

    def infected(data: bytes) -> subprocess.CompletedProcess[bytes]:
        return subprocess.CompletedProcess(
            args=["clamdscan"], returncode=1, stdout=b"stream: Eicar-Test-Signature FOUND\n"
        )

    monkeypatch.setattr(antivirus, "_run_scanner", infected)
    result = antivirus.scan_bytes_sync(b"not-really", "paper.pdf")
    assert result.status == "infected"
    assert result.signature == "Eicar-Test-Signature"

    def clean(data: bytes) -> subprocess.CompletedProcess[bytes]:
        return subprocess.CompletedProcess(args=["clamdscan"], returncode=0, stdout=b"stream: OK\n")

    monkeypatch.setattr(antivirus, "_run_scanner", clean)
    result = antivirus.scan_bytes_sync(b"clean", "paper.pdf")
    assert result.status == "clean"


@pytest.mark.asyncio
async def test_antivirus_health_probes_daemon(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "virus_scan_enabled", True)
    monkeypatch.setattr(
        antivirus.subprocess,
        "run",
        lambda *args, **kwargs: subprocess.CompletedProcess(
            args=args, returncode=0, stdout="PONG\n"
        ),
    )
    health = await antivirus.antivirus_health()
    assert health["status"] == "ok"
    assert "PONG" in str(health["detail"])


@pytest.mark.asyncio
async def test_publication_digest_is_idempotent(
    db_session, monkeypatch: pytest.MonkeyPatch
) -> None:
    tenant = Tenant(slug=f"t-{uuid4().hex[:8]}", name="Test")
    db_session.add(tenant)
    await db_session.flush()
    user = User(
        tenant_id=tenant.id,
        email=f"reader-{uuid4().hex[:8]}@example.com",
        username=f"reader-{uuid4().hex[:8]}",
        hashed_password="x",
        is_email_verified=True,
        notification_prefs={"email_release": True},
    )
    db_session.add(user)
    resource = Resource(
        tenant_id=tenant.id,
        type="paper",
        title="A new work",
        authors=["Author"],
        year=2026,
        discipline="testing",
        tags=[],
        abstract="abs",
        preview="preview",
    )
    db_session.add(resource)
    await db_session.flush()
    db_session.add(
        PublicationDigestItem(tenant_id=tenant.id, user_id=user.id, resource_id=resource.id)
    )
    await db_session.flush()

    async def fake_record(*args, **kwargs) -> str:
        return "sent"

    monkeypatch.setattr(notifications, "record_email_digest", fake_record)
    monkeypatch.setattr(settings, "publication_digest_enabled", True)
    monkeypatch.setattr(settings, "publication_digest_local_hour", 0)

    stats = await run_publication_digest(
        db_session, tenant_id=tenant.id, now=datetime.now(UTC), force=True
    )
    assert stats["sent"] == 1
    assert stats["items"] == 1

    delivery = (
        await db_session.execute(
            PublicationDigestDelivery.__table__.select().where(
                PublicationDigestDelivery.user_id == user.id
            )
        )
    ).first()
    assert delivery is not None
    item = (
        await db_session.execute(
            PublicationDigestItem.__table__.select().where(PublicationDigestItem.user_id == user.id)
        )
    ).first()
    assert item is not None
    assert item.delivered_at is not None

    # A second run on the same local date must not enqueue another email.
    stats2 = await run_publication_digest(
        db_session, tenant_id=tenant.id, now=datetime.now(UTC), force=True
    )
    assert stats2["sent"] == 0


@pytest.mark.asyncio
async def test_workflow_job_commits_its_session(monkeypatch: pytest.MonkeyPatch) -> None:
    """A job that only flushes must still be durable when it returns."""
    state = {"commit": 0, "rollback": 0}

    class FakeSession:
        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb) -> bool:
            return False

        async def commit(self) -> None:
            state["commit"] += 1

        async def rollback(self) -> None:
            state["rollback"] += 1

    async def runner(db) -> dict[str, int]:
        return {"scanned": 1}

    monkeypatch.setattr(workflow_scheduler, "async_session_factory", lambda: FakeSession())
    result = await workflow_scheduler._run_job("virus_scan", uuid4(), runner)
    assert result == {"scanned": 1}
    assert state == {"commit": 1, "rollback": 0}
