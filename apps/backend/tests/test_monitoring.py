"""Tests for the optional Sentry monitoring bootstrap.

The contract we care about: monitoring is opt-in, and every failure mode
(no DSN / SDK not installed / bad DSN) degrades silently instead of
taking the application down.
"""

from __future__ import annotations

import builtins
from typing import Any

import pytest

from app.core import monitoring
from app.core.config import settings


def test_disabled_when_dsn_empty(monkeypatch: pytest.MonkeyPatch) -> None:
    """No DSN configured → returns False and never touches the SDK."""
    monkeypatch.setattr(settings, "sentry_dsn", "", raising=False)
    assert monitoring.init_monitoring() is False


def test_returns_false_when_sdk_missing(monkeypatch: pytest.MonkeyPatch) -> None:
    """DSN set but sentry_sdk not installed → warn + keep running."""
    monkeypatch.setattr(settings, "sentry_dsn", "https://key@example.org/1", raising=False)

    real_import = builtins.__import__

    def fake_import(name: str, *args: Any, **kwargs: Any) -> Any:
        if name == "sentry_sdk":
            raise ImportError("No module named 'sentry_sdk'")
        return real_import(name, *args, **kwargs)

    monkeypatch.setattr(builtins, "__import__", fake_import)
    assert monitoring.init_monitoring() is False


def test_init_failure_does_not_raise(monkeypatch: pytest.MonkeyPatch) -> None:
    """A broken SDK init must not propagate — monitoring is never critical."""
    monkeypatch.setattr(settings, "sentry_dsn", "https://key@example.org/1", raising=False)

    class BrokenSdk:
        @staticmethod
        def init(**_kwargs: Any) -> None:
            raise RuntimeError("bad dsn")

    real_import = builtins.__import__

    def fake_import(name: str, *args: Any, **kwargs: Any) -> Any:
        if name == "sentry_sdk":
            return BrokenSdk
        return real_import(name, *args, **kwargs)

    monkeypatch.setattr(builtins, "__import__", fake_import)
    assert monitoring.init_monitoring() is False


def test_init_succeeds_and_passes_settings(monkeypatch: pytest.MonkeyPatch) -> None:
    """Happy path: settings are forwarded to sentry_sdk.init verbatim."""
    monkeypatch.setattr(settings, "sentry_dsn", "https://key@example.org/1", raising=False)
    monkeypatch.setattr(settings, "sentry_traces_sample_rate", 0.25, raising=False)
    monkeypatch.setattr(settings, "sentry_send_default_pii", False, raising=False)

    captured: dict[str, Any] = {}

    class FakeSdk:
        @staticmethod
        def init(**kwargs: Any) -> None:
            captured.update(kwargs)

    real_import = builtins.__import__

    def fake_import(name: str, *args: Any, **kwargs: Any) -> Any:
        if name == "sentry_sdk":
            return FakeSdk
        return real_import(name, *args, **kwargs)

    monkeypatch.setattr(builtins, "__import__", fake_import)
    assert monitoring.init_monitoring() is True
    assert captured["dsn"] == "https://key@example.org/1"
    assert captured["traces_sample_rate"] == 0.25
    # PII 默认关闭是隐私底线，不能被悄悄改掉
    assert captured["send_default_pii"] is False
    assert captured["release"].startswith("rubbish-backend@")
