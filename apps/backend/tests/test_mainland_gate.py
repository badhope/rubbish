from __future__ import annotations

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api import access
from app.core import mainland_gate as mg
from app.core.config import settings


def test_mainland_ip_ranges():
    assert mg.is_mainland_ip("1.0.1.1")
    assert mg.is_mainland_ip("2001:250::1")
    assert not mg.is_mainland_ip("8.8.8.8")
    assert not mg.is_mainland_ip("127.0.0.1")
    assert not mg.is_mainland_ip("not-an-ip")


def test_gate_token_roundtrip():
    token = mg.make_gate_token(now=1_000_000)
    assert mg.is_valid_gate_token(token, now=1_000_000)
    assert not mg.is_valid_gate_token(token, now=1_000_000 + 8 * 86400)
    assert not mg.is_valid_gate_token("v1.1000.deadbeef", now=900)
    assert not mg.is_valid_gate_token(None)


def test_gate_token_is_bound_to_password(monkeypatch):
    token = mg.make_gate_token(now=1_000_000)
    monkeypatch.setattr(settings, "mainland_gate_password", "another-password", raising=False)
    assert not mg.is_valid_gate_token(token, now=1_000_000)


def test_safe_next_only_local_paths():
    assert mg.safe_next("/catalog/304?x=1") == "/catalog/304?x=1"
    assert mg.safe_next("//evil.example") == "/"
    assert mg.safe_next("https://evil.example") == "/"
    assert mg.safe_next("/a\nb") == "/"


def test_middleware_blocks_mainland_and_accepts_cookie(monkeypatch):
    monkeypatch.setattr(settings, "mainland_gate_enabled", True, raising=False)
    monkeypatch.setattr(settings, "trusted_proxies_count", 1, raising=False)

    app = FastAPI()
    app.add_middleware(mg.MainlandGateMiddleware)

    @app.get("/")
    async def home():
        return {"ok": True}

    @app.get("/api/private")
    async def private():
        return {"private": True}

    client = TestClient(app)
    headers = {"X-Forwarded-For": "1.0.1.1"}

    blocked = client.get("/", headers=headers)
    assert blocked.status_code == 403
    assert "访问密码" in blocked.text
    assert blocked.headers["cache-control"] == "no-store"

    api_blocked = client.get("/api/private", headers=headers)
    assert api_blocked.status_code == 403
    assert api_blocked.json()["detail"] == "mainland_gate_required"

    allowed = client.get("/", headers=headers, cookies={mg.GATE_COOKIE_NAME: mg.make_gate_token()})
    assert allowed.status_code == 200
    assert allowed.json() == {"ok": True}

    # 非大陆出口不触发闸门。
    outside = client.get("/", headers={"X-Forwarded-For": "8.8.8.8"})
    assert outside.status_code == 200


def test_gate_accepts_non_ascii_password(monkeypatch):
    monkeypatch.setattr(settings, "mainland_gate_enabled", True, raising=False)
    monkeypatch.setattr(settings, "mainland_gate_password", "测试口令甲乙丙", raising=False)

    app = FastAPI()
    app.include_router(access.router)
    client = TestClient(app)

    bad = client.post("/api/access/gate", data={"password": "错误的密码", "next": "/catalog"})
    assert bad.status_code == 401

    ok = client.post(
        "/api/access/gate",
        data={"password": "测试口令甲乙丙", "next": "/catalog"},
        follow_redirects=False,
    )
    assert ok.status_code == 303
    assert ok.headers["location"] == "/catalog"
    assert "rubbish_mainland_gate" in ok.cookies
