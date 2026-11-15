"""Async database engine, session factory, and ``get_db`` dependency.

PostgreSQL is the only supported backend because RLS enforcement requires
Postgres. SQLite is allowed only in tests (RLS is a no-op there; the test
conftest overrides the engine to aiosqlite).
"""

from __future__ import annotations

from collections.abc import AsyncGenerator, Sequence
from typing import Any, TypeVar

from sqlalchemy import event, func, select, text
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.orm import Session
from sqlalchemy.sql import ColumnElement, Select

from app.core.config import settings
from app.core.logging import get_logger
from app.core.schemas import PaginationMeta
from app.core.tenant import TENANT_CONTEXT_VAR

logger = get_logger("rubbish.db")


@event.listens_for(Session, "after_begin")
def _reissue_tenant_guc(session: Session, transaction: Any, connection: Any) -> None:
    """Re-issue ``SET LOCAL app.current_tenant_id`` after every BEGIN.

    ``SET LOCAL`` resets at ``COMMIT``, so a second transaction in the same
    request would lose the GUC and RLS would fail-closed. ``after_begin``
    also fires on auto-begin, so the next execute after a commit re-arms it.
    """
    tenant_id = TENANT_CONTEXT_VAR.get()
    if tenant_id is None or settings.database_url.startswith("sqlite"):
        return
    # set_config() accepts a bound parameter, so we avoid interpolating
    # tenant_id into the SQL string (no SQL-injection surface, asyncpg-safe).
    connection.execute(
        text("SELECT set_config('app.current_tenant_id', :tid, true)"),
        {"tid": str(tenant_id)},
    )


def _apply_sqlite_pragmas(dbapi_conn: Any, _record: Any) -> None:
    """Make SQLite usable under concurrent async requests.

    Default SQLite journaling (DELETE mode) takes a whole-database write
    lock and fails immediately with "database is locked" when a second
    connection wants to write. Under E2E, where the SPA fires several
    requests per page, that surfaced as sporadic unrelated test failures.

    * ``journal_mode=WAL`` — readers no longer block the writer
    * ``busy_timeout=5000`` — a blocked writer waits up to 5s instead of
      erroring out instantly
    * ``synchronous=NORMAL`` — safe with WAL, much faster than FULL
    * ``foreign_keys=ON`` — SQLite disables FK enforcement by default, so
      without this the test DB has weaker constraints than production PG
    """
    cursor = dbapi_conn.cursor()
    try:
        cursor.execute("PRAGMA journal_mode=WAL")
        cursor.execute("PRAGMA busy_timeout=5000")
        cursor.execute("PRAGMA synchronous=NORMAL")
        cursor.execute("PRAGMA foreign_keys=ON")
    finally:
        cursor.close()


def _build_engine() -> AsyncEngine:
    """Create the async engine with pool settings appropriate for the backend.

    SQLite (tests) does not support pool_size/max_overflow; PostgreSQL gets
    a bounded pool with pre-ping and recycling to avoid stale connections.
    """
    url = settings.database_url
    kwargs: dict[str, Any] = {"echo": settings.debug}

    if url.startswith("sqlite"):
        sqlite_engine = create_async_engine(url, **kwargs)
        # sync_engine：PRAGMA 要在 DBAPI 层的每条新连接上执行一次
        event.listen(sqlite_engine.sync_engine, "connect", _apply_sqlite_pragmas)
        return sqlite_engine

    kwargs.update(
        pool_size=settings.db_pool_size,
        max_overflow=settings.db_max_overflow,
        pool_recycle=settings.db_pool_recycle or -1,  # -1 = never recycle
        pool_pre_ping=settings.db_pool_pre_ping,
        pool_timeout=settings.db_pool_timeout,
    )
    return create_async_engine(url, **kwargs)


engine: AsyncEngine = _build_engine()
async_session_factory: async_sessionmaker[AsyncSession] = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,
)


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    """Yield a session whose tenant GUC is set by the ``after_begin`` event.

    The actual ``SET LOCAL app.current_tenant_id`` is issued by the
    ``_reissue_tenant_guc`` event listener registered above, which fires
    on every transaction begin (including auto-begin after a commit).
    """
    async with async_session_factory() as session:
        yield session


async def check_db_connection() -> None:
    """Run ``SELECT 1`` to verify the database is reachable. Raises on failure."""
    async with async_session_factory() as session:
        await session.execute(text("SELECT 1"))


async def dispose_engine() -> None:
    """Dispose of all pooled connections (call on shutdown)."""
    await engine.dispose()
    logger.info("database_engine_disposed")


# 3.11 兼容：PEP 695 的 `async def paginate[T](...)` 语法要求 3.12+，
# 部署沙箱是 3.11，这里用等价 TypeVar 写法（3.12+ 行为完全一致）。
# UP047 建议改回 PEP 695 语法，为兼容 3.11 有意 noqa。
_PaginateT = TypeVar("_PaginateT")


async def paginate(  # noqa: UP047 - 3.11 兼容，见上注释
    db: AsyncSession,
    stmt: Select[tuple[_PaginateT]],
    *,
    page: int,
    page_size: int,
    order_by: Sequence[ColumnElement[Any]],
) -> tuple[list[_PaginateT], PaginationMeta]:
    """Run a paginated query; return (rows, PaginationMeta).

    Caller builds the base ``select(SomeModel).where(...)`` (no ORDER BY,
    no LIMIT/OFFSET) and passes the deterministic tiebreaker columns via
    ``order_by``. Returns the rows as scalars and a fully populated
    ``PaginationMeta`` (with ``total_pages`` ceiling-divided).

    Module list endpoints use this to keep pagination math + count query
    in one place; the response-model conversion stays at the call site.
    """
    total: int = (await db.execute(select(func.count()).select_from(stmt.subquery()))).scalar_one()
    rows = (
        (await db.execute(stmt.order_by(*order_by).offset((page - 1) * page_size).limit(page_size)))
        .scalars()
        .all()
    )
    return list(rows), PaginationMeta(
        total=total,
        page=page,
        page_size=page_size,
        total_pages=(total + page_size - 1) // page_size,
    )
