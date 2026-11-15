"""Captcha verifier resolution and cache behaviour (provider pluggability)."""

from __future__ import annotations

import captcha_probe
import pytest
from httpx import AsyncClient

from app.core import captcha
from app.core.captcha import _FunctionVerifier, _is_verifier, _resolve_verifier
from app.core.config import settings


def test_resolve_accepts_verifier_instance() -> None:
    resolved = _resolve_verifier("captcha_probe.probe_instance")
    assert resolved is captcha_probe.probe_instance


def test_resolve_wraps_bare_async_function() -> None:
    resolved = _resolve_verifier("captcha_probe.bare_verify")
    assert isinstance(resolved, _FunctionVerifier)


@pytest.mark.asyncio
async def test_function_verifier_awaits_and_coerces_result() -> None:
    async def true_fn(token: str, *, remote_ip: str | None) -> bool:
        return True

    verifier = _FunctionVerifier(true_fn)
    assert await verifier.verify("t", remote_ip="1.2.3.4") is True


def test_resolve_accepts_factory() -> None:
    resolved = _resolve_verifier("captcha_probe.instance_factory")
    assert hasattr(resolved, "verify")


def test_resolve_rejects_factory_without_verifier() -> None:
    with pytest.raises(RuntimeError, match="factory"):
        _resolve_verifier("captcha_probe.broken_factory")


def test_resolve_rejects_sync_method_object() -> None:
    with pytest.raises(RuntimeError):
        _resolve_verifier("captcha_probe.sync_method_object")


def test_resolve_rejects_path_without_module() -> None:
    with pytest.raises(RuntimeError, match="Invalid"):
        _resolve_verifier("nodots")


def test_resolve_rejects_missing_attribute() -> None:
    with pytest.raises(RuntimeError, match="does not resolve"):
        _resolve_verifier("captcha_probe.no_such_attr")


def test_is_verifier_false_for_plain_objects() -> None:
    assert _is_verifier(object()) is False
    assert _is_verifier(None) is False


def test_load_verifier_caches_resolved_instance(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "captcha_verifier", "captcha_probe.probe_instance")
    monkeypatch.setattr(captcha, "_verifier_cache", None)
    calls = {"n": 0}

    def counting_resolve(dotted: str) -> object:
        calls["n"] += 1
        return _resolve_verifier(dotted)

    monkeypatch.setattr(captcha, "_resolve_verifier", counting_resolve)

    first = captcha._load_verifier()
    second = captcha._load_verifier()
    assert first is second
    assert calls["n"] == 1


@pytest.mark.asyncio
async def test_register_rejected_when_verifier_fails(
    client: AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(settings, "captcha_required_for_registration", True)
    monkeypatch.setattr(settings, "captcha_verifier", "captcha_probe.rejecting_instance")
    monkeypatch.setattr(captcha, "_verifier_cache", None)

    r = await client.post(
        "/api/auth/register",
        json={
            "email": "captcha-fail@example.com",
            "username": "captchafail",
            "password": "Sup3rSecret!",
            "captcha_token": "will-be-rejected",
        },
    )
    assert r.status_code == 400
    assert "failed" in r.json()["detail"].lower()
