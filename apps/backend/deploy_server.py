"""单端口部署入口：后端 API + 前端静态托管，一个进程一个端口。

用途：把整个应用（FastAPI + 已构建的 vite dist/）部署到 Render/Railway/
Fly/任一 PaaS 或 VPS——只需一条命令 ``python deploy_server.py``。

环境变量约定（所有变量若外部已设置则**不覆盖**，生产平台注入的
PG 连接串 / 密钥直接生效；缺失时用安全的开发兜底值）：

- ``RUBBISH_DATABASE_URL``  生产注入 PostgreSQL；缺省用本地 SQLite（demo）。
- ``RUBBISH_ENVIRONMENT``   生产应设 ``production``；缺省 ``development``。
- ``RUBBISH_STATIC_DIR``    前端构建产物目录；缺省 ``../frontend/dist``。
- ``PORT``                     PaaS 常注入的监听端口；缺省 8000。
- 其余（SECRET_KEY / FERNET_KEY / ADMIN_PASSWORD / ALLOWED_HOSTS / CORS_ORIGINS）
  生产必须显式提供；development 模式下缺失时自动生成强随机值（每次重启
  会变，session 失效——生产请务必显式配置，见 DEPLOY.md）。

Usage:
    uv run python deploy_server.py              # 本地 demo（SQLite + dist）
    PORT=8080 uv run python deploy_server.py    # 自定义端口
"""

from __future__ import annotations

import asyncio
import os
import secrets
from pathlib import Path

# --- 在导入 app 之前确定所有配置 ---

BACKEND_DIR = Path(__file__).resolve().parent
_db_url = os.environ.setdefault("RUBBISH_DATABASE_URL", "")
if not _db_url:
    os.environ["RUBBISH_DATABASE_URL"] = f"sqlite+aiosqlite:///{BACKEND_DIR / 'deploy_demo.db'}"
    _USING_SQLITE = True
else:
    _USING_SQLITE = _db_url.startswith("sqlite")

os.environ.setdefault("RUBBISH_ENVIRONMENT", "development")
if not os.environ.get("RUBBISH_SECRET_KEY"):
    os.environ["RUBBISH_SECRET_KEY"] = secrets.token_hex(32)
if not os.environ.get("RUBBISH_FERNET_KEY"):
    try:
        from cryptography.fernet import Fernet

        os.environ["RUBBISH_FERNET_KEY"] = Fernet.generate_key().decode()
    except ImportError:  # pragma: no cover
        pass
os.environ.setdefault("RUBBISH_ADMIN_EMAIL", "admin@example.com")
os.environ.setdefault("RUBBISH_ADMIN_USERNAME", "admin")
if not os.environ.get("RUBBISH_ADMIN_PASSWORD"):
    _admin_pw = secrets.token_urlsafe(12)
    os.environ["RUBBISH_ADMIN_PASSWORD"] = _admin_pw
    print(f"[deploy] 生成临时管理员密码: {_admin_pw}（重启会变，生产请显式设置）")
os.environ.setdefault("RUBBISH_ALLOWED_HOSTS", "*")
os.environ.setdefault("RUBBISH_CORS_ORIGINS", "*")
os.environ.setdefault("RUBBISH_RATE_LIMIT_PER_MINUTE", "600")
os.environ.setdefault("RUBBISH_EMAIL_BACKEND", "console")
os.environ.setdefault("RUBBISH_STORAGE_BACKEND", "local")
os.environ.setdefault("RUBBISH_STORAGE_PATH", str(BACKEND_DIR / "storage"))
os.environ.setdefault("RUBBISH_LOG_LEVEL", "WARNING")
os.environ.setdefault("RUBBISH_JSON_LOGS", "false")

_static = os.environ.setdefault(
    "RUBBISH_STATIC_DIR",
    # 优先同目录 static/（容器/沙箱发布布局），回退 monorepo 的 frontend/dist。
    str(BACKEND_DIR / "static")
    if (BACKEND_DIR / "static" / "index.html").is_file()
    else str(BACKEND_DIR.parent / "frontend" / "dist"),
)

PORT = int(os.environ.get("PORT", "8000"))


async def _prepare_sqlite_db() -> None:
    """SQLite 且库文件不存在时，按 ORM metadata 建全部表。

    PostgreSQL 部署不做这里的事——请用 ``alembic upgrade head``
    （迁移含 RLS 策略，create_all 不会生成 RLS）。
    """
    if not _USING_SQLITE:
        return
    db_file = os.environ["RUBBISH_DATABASE_URL"].split("///")[-1]
    # 启动脚本的一次性轻量检查（非热路径），阻塞版 os.path 足够；
    # ASYNC240 针对 async 函数内的同步 IO，这里 noqa 是有意为之。
    if os.path.exists(db_file):  # noqa: ASYNC240
        return
    from sqlalchemy.ext.asyncio import create_async_engine

    from app.core.modules import load_all
    from app.models import Base

    load_all()  # 模块模型 import 后才注册进 Base.metadata
    engine = create_async_engine(
        os.environ["RUBBISH_DATABASE_URL"],
        connect_args={"check_same_thread": False},
    )
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    await engine.dispose()
    print("[deploy] SQLite 数据库已初始化")


def main() -> None:
    asyncio.run(_prepare_sqlite_db())
    import uvicorn

    print(f"[deploy] http://localhost:{PORT}  (static: {_static})")
    uvicorn.run(
        "app.main:app",
        host="0.0.0.0",
        port=PORT,
        log_level="warning",
        access_log=False,
    )


if __name__ == "__main__":
    main()
