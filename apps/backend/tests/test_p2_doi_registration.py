"""P2-13 DataCite adapter hardening."""

from __future__ import annotations

from types import SimpleNamespace
from uuid import uuid4

from app.core.config import settings
from app.domain.doi import registration


class _Response:
    def __init__(self, status_code: int, text: str = "") -> None:
        self.status_code = status_code
        self.text = text


class _FakeClient:
    def __init__(self, responses: dict[str, list[_Response]], calls: list[tuple[str, str, dict]]):
        self.responses = responses
        self.calls = calls

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_exc):
        return None

    def _next(self, method: str) -> _Response:
        queue = self.responses[method]
        return queue.pop(0) if queue else _Response(500, "unexpected")

    async def get(self, url: str, headers: dict, **_kwargs):
        self.calls.append(("GET", url, headers, None))
        return self._next("GET")

    async def post(self, url: str, headers: dict, json: dict):
        self.calls.append(("POST", url, headers, json))
        return self._next("POST")

    async def put(self, url: str, headers: dict, json: dict):
        self.calls.append(("PUT", url, headers, json))
        return self._next("PUT")


def _resource():
    return SimpleNamespace(
        id=7,
        tenant_id=uuid4(),
        title="A test paper",
        authors=[
            {"name": "Alice", "given_name": "Alice", "family_name": "A", "orcid": "0000-0001"},
            {"name": ""},
            "Bob",
        ],
        year=2024,
        abstract="Abstract",
        tags=["tag"],
        publisher="Rubbish",
        type="article",
    )


def test_datacite_metadata_uses_article_landing_page(monkeypatch) -> None:
    monkeypatch.setattr(settings, "public_base_url", "https://journal.example", raising=False)
    meta = registration._build_datacite_metadata(_resource(), "10.1234/7")
    attrs = meta["data"]["attributes"]
    assert attrs["url"] == "https://journal.example/catalog/7"
    assert attrs["doi"] == "10.1234/7"
    assert [c["name"] for c in attrs["creators"]] == ["Alice", "Bob"]
    assert attrs["creators"][0]["nameIdentifiers"][0]["nameIdentifier"] == "0000-0001"


async def test_mint_doi_creates_then_publishes(monkeypatch) -> None:
    monkeypatch.setattr(settings, "datacite_api_url", "https://sandbox.datacite.org", raising=False)
    monkeypatch.setattr(settings, "datacite_prefix", "10.1234", raising=False)
    monkeypatch.setattr(settings, "datacite_api_key", "dXNlcjpwYXNz", raising=False)
    monkeypatch.setattr(settings, "public_base_url", "https://journal.example", raising=False)
    responses = {
        "GET": [_Response(404)],
        "POST": [_Response(201)],
        "PUT": [_Response(200)],
    }
    calls: list[tuple[str, str, dict]] = []

    def fake_client(*_args, **_kwargs):
        return _FakeClient(responses, calls)

    monkeypatch.setattr(registration.httpx, "AsyncClient", fake_client)
    doi, state = await registration.mint_doi(_resource(), suffix="7")
    assert state == "completed"
    assert doi == "10.1234/7"
    assert [call[0] for call in calls] == ["GET", "POST", "PUT"]
    assert calls[0][1] == "https://sandbox.datacite.org/dois/10.1234/7"
    assert calls[2][1] == "https://sandbox.datacite.org/dois/10.1234/7"
    assert calls[1][3]["data"]["attributes"]["url"] == "https://journal.example/catalog/7"


async def test_mint_doi_retry_skips_create_when_draft_exists(monkeypatch) -> None:
    monkeypatch.setattr(settings, "datacite_api_url", "https://sandbox.datacite.org", raising=False)
    monkeypatch.setattr(settings, "datacite_prefix", "10.1234", raising=False)
    monkeypatch.setattr(settings, "datacite_api_key", "dXNlcjpwYXNz", raising=False)
    responses = {
        "GET": [_Response(200)],
        "POST": [],
        "PUT": [_Response(200), _Response(200)],
    }
    calls: list[tuple[str, str, dict]] = []
    monkeypatch.setattr(
        registration.httpx,
        "AsyncClient",
        lambda *_args, **_kwargs: _FakeClient(responses, calls),
    )
    _doi, state = await registration.mint_doi(_resource(), suffix="7")
    assert state == "completed"
    # GET existing draft -> PUT metadata -> PUT publish, no POST create.
    assert [call[0] for call in calls] == ["GET", "PUT", "PUT"]


def test_datacite_disabled_without_key(monkeypatch) -> None:
    monkeypatch.setattr(settings, "datacite_api_url", "https://sandbox.datacite.org", raising=False)
    monkeypatch.setattr(settings, "datacite_prefix", "10.1234", raising=False)
    monkeypatch.setattr(settings, "datacite_api_key", "", raising=False)
    assert registration.datacite_enabled() is False
