from __future__ import annotations

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.core import auth_wall as aw
from app.core.config import settings
from app.core.security import create_access_token


def _app() -> FastAPI:
    app = FastAPI()
    app.add_middleware(aw.AuthWallMiddleware)

    @app.get("/api/private")
    async def private():
        return {"ok": True}

    @app.get("/api/auth/login")
    async def login():
        return {"login": True}

    @app.get("/api/capabilities")
    async def capabilities():
        return {"registration_open": True}

    return app


def test_auth_wall_blocks_anonymous_business_api(monkeypatch):
    monkeypatch.setattr(settings, "auth_wall_enabled", True, raising=False)
    client = TestClient(_app())

    blocked = client.get("/api/private")
    assert blocked.status_code == 401
    assert blocked.json()["detail"] == "authentication_required"
    assert blocked.headers["www-authenticate"] == "Bearer"

    assert client.get("/api/auth/login").status_code == 200
    assert client.get("/api/capabilities").status_code == 200


def test_auth_wall_allows_valid_bearer(monkeypatch):
    monkeypatch.setattr(settings, "auth_wall_enabled", True, raising=False)
    token = create_access_token({"sub": "1", "token_version": 1})
    client = TestClient(_app())

    ok = client.get("/api/private", headers={"Authorization": f"Bearer {token}"})
    assert ok.status_code == 200
    assert ok.json() == {"ok": True}


def test_auth_wall_rejects_broken_bearer(monkeypatch):
    monkeypatch.setattr(settings, "auth_wall_enabled", True, raising=False)
    client = TestClient(_app())
    bad = client.get("/api/private", headers={"Authorization": "Bearer not-a-jwt"})
    assert bad.status_code == 401


def test_auth_wall_off_keeps_local_and_public_mode(monkeypatch):
    monkeypatch.setattr(settings, "auth_wall_enabled", False, raising=False)
    client = TestClient(_app())
    assert client.get("/api/private").status_code == 200
