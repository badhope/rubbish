"""QA 鉴权覆盖层回归：静态令牌优先，合法 JWT 回退，无凭证 401；空配置 no-op。"""

from __future__ import annotations

import pytest
from conftest import auth_headers, register_user
from httpx import AsyncClient

from app.api.deps import get_current_user, get_current_user_optional
from app.core.config import settings
from app.core.qa_auth import install_qa_auth
from app.main import app

QA_USERNAME = "qa_bot_identity"
QA_TOKEN = "x" * 40


@pytest.fixture
def qa_override(client: AsyncClient, monkeypatch: pytest.MonkeyPatch):
    """装上 QA 覆盖层；用例结束后清掉 override，避免污染其它测试。"""
    monkeypatch.setattr(settings, "environment", "staging")
    monkeypatch.setattr(settings, "qa_autologin_user", QA_USERNAME)
    monkeypatch.setattr(settings, "qa_autologin_token", QA_TOKEN)
    install_qa_auth(app)
    yield
    app.dependency_overrides.pop(get_current_user, None)
    app.dependency_overrides.pop(get_current_user_optional, None)


async def test_static_token_resolves_to_qa_identity(client: AsyncClient, qa_override: None) -> None:
    """带 QA 静态令牌 → 绑定 QA 机器身份。"""
    await register_user(client, email="qabot@example.com", username=QA_USERNAME)
    resp = await client.get("/api/auth/me", headers={"Authorization": f"Bearer {QA_TOKEN}"})
    assert resp.status_code == 200
    assert resp.json()["username"] == QA_USERNAME


async def test_valid_jwt_falls_back_to_jwt_identity(
    client: AsyncClient, qa_override: None, test_user: dict
) -> None:
    """不带静态令牌、带真实 JWT → 走正常 JWT 身份，不被覆盖成 QA 账号。"""
    # 静态分支对应的 QA 账号也存在，证明身份选择取决于令牌而非账号是否存在。
    await register_user(client, email="qabot2@example.com", username=QA_USERNAME)
    resp = await client.get("/api/auth/me", headers=auth_headers(test_user))
    assert resp.status_code == 200
    assert resp.json()["username"] == test_user["username"]


async def test_no_credential_is_401(client: AsyncClient, qa_override: None) -> None:
    """既无静态令牌也无 JWT → 受保护接口 401（与普通 JWT 口径一致）。"""
    resp = await client.get("/api/auth/me")
    assert resp.status_code == 401


async def test_empty_settings_is_noop(client: AsyncClient, monkeypatch: pytest.MonkeyPatch) -> None:
    """QA 配置为空时 install 直接返回，不写入任何依赖覆盖，行为等同未装模块。"""
    monkeypatch.setattr(settings, "qa_autologin_user", "")
    install_qa_auth(app)
    assert get_current_user not in app.dependency_overrides
    assert get_current_user_optional not in app.dependency_overrides
