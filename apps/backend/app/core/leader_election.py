"""PostgreSQL advisory-lock leader election for in-process schedulers.

The schedulers used to assume exactly one application process.  Running a
second uvicorn worker (or a staging copy against the same database) silently
doubled every sweep: two digests, two retry passes, two release attempts.
The row-level locks made the writes safe, but not the work itself.

This module holds one dedicated database connection for the lifetime of a
leadership term.  PostgreSQL advisory locks are connection-scoped: if the
process dies, the connection dies, and the lock is released automatically.
No heartbeat row, no stale lease, no cleanup job.

Follower behaviour is deliberate: the asyncio task still exists and retries
every ``ELECTION_RETRY_SECONDS``.  A follower that exits would never take
over after the leader dies; a task that stays alive can.
"""

from __future__ import annotations

import asyncio
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncConnection

from app.core.db import engine
from app.core.logging import get_logger
from app.core.time import utcnow

logger = get_logger("rubbish.leader_election")

ELECTION_RETRY_SECONDS = 30

# Two int32 keys form one advisory-lock identity. Different schedulers must
# use different pairs. Values are project-specific and intentionally not
# shared with any other pg_advisory_lock user in this codebase.
_RELEASE_LOCK = (0x5255, 0x0001)
_WORKFLOW_LOCK = (0x5255, 0x0002)


class PgLeaderElector:
    """Try to become the one process allowed to run a scheduler."""

    def __init__(self, name: str, lock_keys: tuple[int, int]) -> None:
        self.name = name
        self._keys = lock_keys
        self._conn: AsyncConnection | None = None
        self._local_leader = False
        self._acquired_at: Any | None = None
        self._attempts = 0
        self._last_error: str | None = None

    @property
    def is_leader(self) -> bool:
        return self._conn is not None or self._local_leader

    def state(self) -> dict[str, Any]:
        return {
            "leader": self.is_leader,
            "leader_since": self._acquired_at,
            "election_attempts": self._attempts,
            "election_error": self._last_error,
        }

    async def acquire(self) -> bool:
        """Return True when this process holds (or just won) the lock."""
        if self._conn is not None:
            return True
        self._attempts += 1
        if engine.dialect.name != "postgresql":
            # SQLite tests are single-process. Treat the local process as
            # leader so manual scheduler tests keep working without a PG
            # instance, but never claim this in production health output.
            self._local_leader = True
            self._acquired_at = utcnow()
            return True
        conn: AsyncConnection | None = None
        try:
            conn = await engine.connect()
            won = bool(
                await conn.scalar(
                    text("SELECT pg_try_advisory_lock(:k1, :k2)"),
                    {"k1": self._keys[0], "k2": self._keys[1]},
                )
            )
            if not won:
                await conn.close()
                self._last_error = None
                return False
            self._conn = conn
            self._acquired_at = utcnow()
            self._last_error = None
            logger.info("scheduler_leader_acquired", scheduler=self.name)
            return True
        except Exception as exc:
            if conn is not None:
                try:
                    await conn.close()
                except Exception:
                    pass
            self._last_error = str(exc)[:300]
            logger.warning(
                "scheduler_leader_election_failed",
                scheduler=self.name,
                exc_info=True,
            )
            return False

    async def heartbeat(self) -> bool:
        """Verify the dedicated connection is still usable.

        A network blip or database restart closes the connection and drops
        the advisory lock.  Returning False lets the caller stop doing work
        immediately; the loop will start a new election.
        """
        if self._local_leader:
            return True
        if self._conn is None:
            return False
        try:
            await self._conn.scalar(text("SELECT 1"))
            return True
        except Exception:
            logger.warning("scheduler_leader_connection_lost", scheduler=self.name)
            await self.release(unlock=False)
            return False

    async def release(self, *, unlock: bool = True) -> None:
        if self._local_leader:
            self._local_leader = False
            self._acquired_at = None
            return
        if self._conn is None:
            self._acquired_at = None
            return
        conn = self._conn
        self._conn = None
        self._acquired_at = None
        if unlock:
            try:
                await conn.execute(
                    text("SELECT pg_advisory_unlock(:k1, :k2)"),
                    {"k1": self._keys[0], "k2": self._keys[1]},
                )
            except Exception:
                # Closing the connection below also releases the lock.
                logger.debug("scheduler_leader_unlock_failed", scheduler=self.name)
        try:
            await conn.close()
        except Exception:
            logger.debug("scheduler_leader_close_failed", scheduler=self.name)
        logger.info("scheduler_leader_released", scheduler=self.name)


release_elector = PgLeaderElector("release", _RELEASE_LOCK)
workflow_elector = PgLeaderElector("workflow", _WORKFLOW_LOCK)


async def sleep_election_retry() -> None:
    await asyncio.sleep(ELECTION_RETRY_SECONDS)


__all__ = [
    "ELECTION_RETRY_SECONDS",
    "PgLeaderElector",
    "release_elector",
    "sleep_election_retry",
    "workflow_elector",
]
