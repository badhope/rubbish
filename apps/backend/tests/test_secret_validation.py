"""Tests for Settings validation — production secret enforcement.

These tests exercise the ``validate_secrets`` model validator without
needing a real .env file. We monkeypatch ``Settings.model_config`` to
control environment / secret values in isolation.
"""

from __future__ import annotations

import pytest

from app.core.config import Settings


def _make_settings(*, environment: str = "development", **overrides: object) -> Settings:
    """Build a Settings instance, bypassing env-file parsing."""
    cfg = Settings.model_config.copy()
    cfg["env_file"] = ""  # prevent real .env from leaking in
    obj = {"environment": environment}
    obj.update(overrides)
    return Settings.model_validate(obj)


class TestSecretValidation:
    """Non-test environments must reject weak or missing secrets."""

    def test_rejects_known_weak_secret_key(self) -> None:
        with pytest.raises(ValueError, match="known-weak value"):
            _make_settings(
                secret_key="change-me-in-production-use-openssl-rand-hex-32",
                admin_password="correct-horse-battery-staple",
                fernet_key="88Q2Rl3-2UqzRfG_3tyKUPUDp9CP81YuJp2dLSkQa_0=",
            )

    def test_rejects_short_secret_key(self) -> None:
        with pytest.raises(ValueError, match="at least 32"):
            _make_settings(
                secret_key="short",
                admin_password="correct-horse-battery-staple",
                fernet_key="88Q2Rl3-2UqzRfG_3tyKUPUDp9CP81YuJp2dLSkQa_0=",
            )

    def test_rejects_weak_admin_password(self) -> None:
        with pytest.raises(ValueError, match="weak value"):
            _make_settings(
                secret_key="a" * 32,
                admin_password="changeme",
                fernet_key="88Q2Rl3-2UqzRfG_3tyKUPUDp9CP81YuJp2dLSkQa_0=",
            )

    def test_rejects_short_admin_password(self) -> None:
        with pytest.raises(ValueError, match="at least 12"):
            _make_settings(
                secret_key="a" * 32,
                admin_password="short",
                fernet_key="88Q2Rl3-2UqzRfG_3tyKUPUDp9CP81YuJp2dLSkQa_0=",
            )

    def test_rejects_missing_fernet_key(self) -> None:
        with pytest.raises(ValueError, match="FERNET_KEY"):
            _make_settings(
                secret_key="a" * 32,
                admin_password="correct-horse-battery-staple",
                fernet_key="",
            )

    def test_rejects_invalid_fernet_key(self) -> None:
        with pytest.raises(ValueError, match="not a valid Fernet key"):
            _make_settings(
                secret_key="a" * 32,
                admin_password="correct-horse-battery-staple",
                fernet_key="not-a-real-fernet-key-xyz",
            )

    def test_rejects_weak_previous_secret_key(self) -> None:
        with pytest.raises(ValueError, match="PREVIOUS_SECRET_KEYS"):
            _make_settings(
                secret_key="a" * 32,
                admin_password="correct-horse-battery-staple",
                fernet_key="88Q2Rl3-2UqzRfG_3tyKUPUDp9CP81YuJp2dLSkQa_0=",
                previous_secret_keys="short",
            )

    def test_valid_settings_pass(self) -> None:
        """A strong config should pass validation without error."""
        s = _make_settings(
            secret_key="a" * 32,
            admin_password="correct-horse-battery-staple",
            fernet_key="88Q2Rl3-2UqzRfG_3tyKUPUDp9CP81YuJp2dLSkQa_0=",
        )
        assert s.secret_key == "a" * 32
        assert len(s.admin_password) >= 12


class TestProductionChecks:
    """Production-only strict checks."""

    def test_production_rejects_wildcard_allowed_hosts(self) -> None:
        with pytest.raises(ValueError, match="ALLOWED_HOSTS"):
            _make_settings(
                environment="production",
                secret_key="a" * 32,
                admin_password="correct-horse-battery-staple",
                fernet_key="88Q2Rl3-2UqzRfG_3tyKUPUDp9CP81YuJp2dLSkQa_0=",
                allowed_hosts="*",
            )

    def test_production_rejects_wildcard_cors(self) -> None:
        with pytest.raises(ValueError, match="CORS"):
            _make_settings(
                environment="production",
                secret_key="a" * 32,
                admin_password="correct-horse-battery-staple",
                fernet_key="88Q2Rl3-2UqzRfG_3tyKUPUDp9CP81YuJp2dLSkQa_0=",
                allowed_hosts="example.com",
                cors_origins="*",
            )


class TestParsers:
    """CSV-like list parsing from env vars."""

    def test_cors_origins_list(self) -> None:
        s = _make_settings(
            environment="test",
            cors_origins="http://a.com,http://b.com",
        )
        assert s.cors_origins_list == ["http://a.com", "http://b.com"]

    def test_allowed_hosts_list(self) -> None:
        s = _make_settings(
            environment="test",
            allowed_hosts="a.com,b.com",
        )
        assert s.allowed_hosts_list == ["a.com", "b.com"]

    def test_cookie_secure_in_production(self) -> None:
        s = _make_settings(
            environment="production",
            secret_key="a" * 32,
            admin_password="a_strong_password_12",
            fernet_key="88Q2Rl3-2UqzRfG_3tyKUPUDp9CP81YuJp2dLSkQa_0=",
            allowed_hosts="example.com",
        )
        assert s.cookie_secure is True

    def test_cookie_secure_off_in_dev(self) -> None:
        s = _make_settings(
            environment="development",
            secret_key="a" * 32,
            admin_password="correct-horse-battery-staple",
            fernet_key="88Q2Rl3-2UqzRfG_3tyKUPUDp9CP81YuJp2dLSkQa_0=",
        )
        assert s.cookie_secure is False
