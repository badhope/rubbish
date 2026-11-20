"""RLS enforcement 回归（审计 M6）：跨租户读/写/插入必须被 PG 策略挡住。

单测走 SQLite（RLS no-op），策略"存在性"由 test_rls_coverage 保证，但
"生效性"此前无任何断言。本文件只在 PG lane 运行：CI migrations job 在
``alembic upgrade head`` 后跑 ``pytest -m pg``；本地把 RUBBISH_DATABASE_URL
指向 PG 测试库即可复跑，SQLite 环境自动 skip。

不复用 conftest 的 SQLite engine/client fixtures：自带 engine 直接 ORM
播种，GUC 由 app.core.db 的全局 after_begin 监听器按 TENANT_CONTEXT_VAR 注入。
"""

from __future__ import annotations

import uuid
from collections.abc import AsyncGenerator

import pytest
from sqlalchemy import delete, select, update
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.config import settings
from app.core.tenant import TENANT_CONTEXT_VAR
from app.domain.submission.models import Submission
from app.models import Tenant, User

pytestmark = [
    pytest.mark.pg,
    pytest.mark.skipif(
        settings.database_url.startswith("sqlite"),
        reason="RLS enforcement requires PostgreSQL",
    ),
]


@pytest.fixture
async def pg_factory() -> AsyncGenerator[async_sessionmaker[AsyncSession], None]:
    """以非 superuser 探针角色连接：superuser 绕过 RLS（FORCE 也无效），
    而 CI/dev 默认连的是 docker superuser。探针角色临时创建、用完删除。"""
    from sqlalchemy import text
    from sqlalchemy.engine import make_url

    url = make_url(settings.database_url)
    probe = f"rls_probe_{uuid.uuid4().hex[:8]}"
    admin_engine = create_async_engine(settings.database_url)
    async with admin_engine.begin() as conn:
        await conn.execute(
            text(f"CREATE ROLE {probe} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD 'probe'")
        )
        await conn.execute(text(f"GRANT CONNECT ON DATABASE {url.database} TO {probe}"))
        await conn.execute(text(f"GRANT USAGE ON SCHEMA public TO {probe}"))
        await conn.execute(
            text(f"GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO {probe}")
        )
        await conn.execute(
            text(f"GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO {probe}")
        )
    await admin_engine.dispose()

    probe_url = url.set(username=probe, password="probe")
    engine = create_async_engine(probe_url)
    try:
        yield async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    finally:
        await engine.dispose()
        cleanup_engine = create_async_engine(settings.database_url)
        async with cleanup_engine.begin() as conn:
            await conn.execute(text(f"DROP OWNED BY {probe}"))
            await conn.execute(text(f"DROP ROLE {probe}"))
        await cleanup_engine.dispose()


def _submission(tenant_id: uuid.UUID, user_id: int, title: str) -> Submission:
    return Submission(
        tenant_id=tenant_id,
        submitted_by=user_id,
        title=title,
        type="paper",
        authors=["rls probe"],
        year=2026,
        discipline="computer science",
        tags=[],
        abstract="rls enforcement probe",
        preview="rls enforcement probe",
    )


async def test_cross_tenant_reads_and_writes_are_blocked(
    pg_factory: async_sessionmaker[AsyncSession],
) -> None:
    suffix = uuid.uuid4().hex[:10]
    async with pg_factory() as s:
        ta = Tenant(slug=f"rlsa{suffix}", name="RLS A")
        tb = Tenant(slug=f"rlsb{suffix}", name="RLS B")
        s.add_all([ta, tb])
        await s.commit()
        ta_id, tb_id = ta.id, tb.id

    ids: dict[str, int] = {}
    for key, tid in (("a", ta_id), ("b", tb_id)):
        async with pg_factory() as s:
            TENANT_CONTEXT_VAR.set(tid)
            user = User(
                tenant_id=tid,
                email=f"rls{key}{suffix}@example.test",
                username=f"rls{key}{suffix}",
                hashed_password="x",
            )
            s.add(user)
            await s.flush()
            sub = _submission(tid, user.id, f"RLS {key}")
            s.add(sub)
            await s.commit()
            ids[key] = sub.id

    try:
        async with pg_factory() as s:
            TENANT_CONTEXT_VAR.set(ta_id)
            rows = (await s.execute(select(Submission))).scalars().all()
            assert all(r.tenant_id == ta_id for r in rows)
            assert ids["a"] in {r.id for r in rows}
            assert ids["b"] not in {r.id for r in rows}

            crossed = await s.execute(
                update(Submission).where(Submission.id == ids["b"]).values(title="hacked")
            )
            assert crossed.rowcount == 0
            removed = await s.execute(delete(Submission).where(Submission.id == ids["b"]))
            assert removed.rowcount == 0

        async with pg_factory() as s:
            TENANT_CONTEXT_VAR.set(ta_id)
            s.add(_submission(tb_id, 1, "cross-tenant insert"))
            with pytest.raises(DBAPIError):
                await s.flush()
            await s.rollback()

        async with pg_factory() as s:
            TENANT_CONTEXT_VAR.set(None)
            assert (await s.execute(select(Submission))).scalars().all() == []
    finally:
        for tid in (ta_id, tb_id):
            async with pg_factory() as s:
                TENANT_CONTEXT_VAR.set(tid)
                await s.execute(delete(Submission).where(Submission.tenant_id == tid))
                await s.execute(delete(User).where(User.tenant_id == tid))
                await s.commit()
        async with pg_factory() as s:
            await s.execute(delete(Tenant).where(Tenant.id.in_([ta_id, tb_id])))
            await s.commit()
        TENANT_CONTEXT_VAR.set(None)
