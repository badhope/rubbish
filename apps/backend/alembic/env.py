"""Alembic migration environment.

Async-aware. ``target_metadata`` is the shared core ``Base.metadata`` —
modules inherit from the core Base (see ARCHITECTURE.md "All modules
share the tenant's PostgreSQL database"), so importing a module adds
its tables to the same metadata. ``load_all()`` runs before migrations
to ensure every enabled module's tables are registered.

For RLS: migrations use a dedicated ``admin_role`` with ``BYPASSRLS``;
the application's runtime role never sees ``BYPASSRLS``. This separation
prevents the "dev uses superuser, prod silently skips RLS" footgun.
"""

from __future__ import annotations

import asyncio
import logging
from logging.config import fileConfig

from sqlalchemy import pool
from sqlalchemy.engine import Connection
from sqlalchemy.ext.asyncio import async_engine_from_config

from alembic import context
from app.core.config import settings
from app.models import Base

config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# Importing enabled modules registers their tables with Base.metadata.
logger = logging.getLogger("alembic.env")

try:
    from app.core.modules import load_all

    load_all()
except Exception as exc:
    # Never silently swallow this: if a module fails to import, metadata
    # degrades to core-only tables and `alembic check` can pass vacuously,
    # hiding missing migrations. Log loudly so CI/local logs surface it.
    logger.warning(
        "load_all() failed to register module tables — metadata degraded to "
        "core-only; alembic comparisons may pass vacuously. Cause: %r",
        exc,
    )

target_metadata = Base.metadata

# Override sqlalchemy.url from application settings.
config.set_main_option("sqlalchemy.url", settings.database_url)


def run_migrations_offline() -> None:
    """Run migrations in 'offline' mode — emits SQL to stdout."""
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        compare_type=True,
    )
    with context.begin_transaction():
        context.run_migrations()


def do_run_migrations(connection: Connection) -> None:
    context.configure(
        connection=connection,
        target_metadata=target_metadata,
        compare_type=True,
    )
    with context.begin_transaction():
        context.run_migrations()


async def run_async_migrations() -> None:
    """Create an async engine and run migrations online."""
    connectable = async_engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    async with connectable.connect() as connection:
        await connection.run_sync(do_run_migrations)
    await connectable.dispose()


def run_migrations_online() -> None:
    asyncio.run(run_async_migrations())


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
