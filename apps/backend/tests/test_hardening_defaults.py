"""生产环境安全开关默认治理（审计 M4）。

csrf/captcha 在生产未显式配置时默认开（SPA 已回显 X-CSRF-Token、注册页
已支持自建 captcha）；显式 env 优先；dev/test 保持关。
"""

from __future__ import annotations

import pytest
from app.core.config import Settings

_FERNET = "88Q2Rl3-2UqzRfG_3tyKUPUDp9CP81YuJp2dLSkQa_0="


def _settings(**overrides: object) -> Settings:
    base: dict[str, object] = {
        "_env_file": None,
        "secret_key": "x" * 40,
        "admin_password": "strong-password-123",
        "fernet_key": _FERNET,
    }
    base.update(overrides)
    return Settings(**base)  # type: ignore[arg-type]


def test_production_enables_csrf_and_captcha_when_unset(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # conftest 导出了 captcha=false 环境变量（视为显式配置），先移除。
    monkeypatch.delenv("RUBBISH_CAPTCHA_REQUIRED_FOR_REGISTRATION", raising=False)
    monkeypatch.delenv("RUBBISH_CSRF_ENABLED", raising=False)
    s = _settings(
        environment="production",
        allowed_hosts="journal.example.com",
        cors_origins="https://journal.example.com",
    )
    assert s.csrf_enabled is True
    assert s.captcha_required_for_registration is True
    # 2FA 强制仍默认关（避免锁死未 rollout 的管理员），靠启动告警提醒。
    assert s.require_2fa_for_admin is False


def test_production_explicit_off_wins() -> None:
    s = _settings(
        environment="production",
        allowed_hosts="journal.example.com",
        cors_origins="https://journal.example.com",
        csrf_enabled=False,
        captcha_required_for_registration=False,
    )
    assert s.csrf_enabled is False
    assert s.captcha_required_for_registration is False


@pytest.mark.parametrize("env", ["development", "test"])
def test_non_production_stays_off(env: str) -> None:
    s = _settings(environment=env)
    assert s.csrf_enabled is False
    assert s.captcha_required_for_registration is False