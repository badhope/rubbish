"""Margin threads (1.21): a forum topic anchored to a passage of its work.

The properties pinned here:

- a reader can start a topic from a sentence of a published work, with only
  a question as the title; the quote is stored in the author's own words;
- the server refuses a quote that is not in the work, so a margin thread can
  never attribute invented words to an author;
- the quote is part of the body, so it follows body visibility: an overseas
  guest (who may browse threads but not open manuscripts) sees that a topic
  has a passage, never the words themselves;
- the author sees their own margin thread on the work while it awaits review;
- changing or removing the linked work removes the passage with it.
"""

from __future__ import annotations

import pytest
from conftest import auth_headers, register_user
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.storage import get_storage
from app.domain.catalog.models import Resource
from app.domain.forum.models import ForumTopic
from app.domain.forum.passages import fold, quote_in_text
from app.domain.submission.models import Submission

_ESSAY = (
    "## The second crossing\n\n"
    "At five forty the person beside me **folded** a paper timetable into a boat. "
    "The ferry was already coming around the bend. I drew both in the margin.\n\n"
    "## What the notebook missed\n\n"
    "The notes give the time of each departure. They leave out the sound of the "
    "[chain](https://example.org/chain) and the few seconds everybody spent looking up.\n"
)


async def _essay(client: AsyncClient, admin: dict, db: AsyncSession, *, title: str) -> int:
    response = await client.post(
        "/api/catalog",
        json={
            "type": "paper",
            "title": title,
            "authors": ["Rowan Xu"],
            "year": 2026,
            "discipline": "humanities",
            "tags": ["field notes"],
            "abstract": "Three crossings and a broken timetable.",
            "preview": "Three crossings and a broken timetable.",
            "publication_status": "published",
            "content_track": "essay",
        },
        headers=auth_headers(admin),
    )
    assert response.status_code == 201, response.text
    resource_id = int(response.json()["id"])
    resource = (await db.execute(select(Resource).where(Resource.id == resource_id))).scalar_one()
    path = f"{resource.tenant_id}/{resource_id}/preview.md"
    await get_storage().save(path, _ESSAY.encode("utf-8"))
    db.add(
        Submission(
            tenant_id=resource.tenant_id,
            title=title,
            type="paper",
            authors=["Rowan Xu"],
            year=2026,
            discipline="humanities",
            tags=["field notes"],
            abstract="Three crossings and a broken timetable.",
            preview="Three crossings and a broken timetable.",
            content_track="essay",
            resource_id=resource_id,
            submitted_by=int(admin["user_id"]),
            markdown_path=path,
            status="accepted",
        )
    )
    await db.commit()
    return resource_id


def _overseas(monkeypatch: pytest.MonkeyPatch) -> dict[str, str]:
    monkeypatch.setattr(settings, "region_access_enabled", True)
    monkeypatch.setattr(settings, "trusted_proxies_count", 1)
    monkeypatch.setattr(settings, "auth_wall_enabled", True)
    return {"x-forwarded-for": "8.8.8.8"}


def test_quote_matching_ignores_markup_but_not_words() -> None:
    assert quote_in_text("the person beside me folded a paper timetable", _ESSAY)
    assert quote_in_text("the sound of the chain and the few seconds", _ESSAY)
    # Line breaks, curly punctuation and spacing from the rendered page do not matter.
    assert quote_in_text("The ferry was already\ncoming around the bend", _ESSAY)
    # One invented word is enough to refuse.
    assert not quote_in_text("the person beside me burned a paper timetable", _ESSAY)
    assert not quote_in_text("。", _ESSAY)
    assert fold("看  一眼，再看。") == "看一眼再看"


async def test_margin_thread_round_trip(
    client: AsyncClient, test_user: dict, admin_user: dict, db_session: AsyncSession
) -> None:
    work_id = await _essay(client, admin_user, db_session, title="The last ferry leaves at six")
    created = await client.post(
        "/api/forum/topics",
        json={
            "title": "Why keep the paper boat?",
            "paper_id": work_id,
            "passage": {
                "quote": "the person beside me folded a paper timetable into a boat.",
                "prefix": "At five forty ",
                "suffix": " The ferry was already",
            },
        },
        headers=auth_headers(test_user),
    )
    assert created.status_code == 201, created.text
    topic = created.json()
    assert topic["body"] == ""
    assert topic["has_passage"] is True
    assert topic["passage"] == {
        "quote": "the person beside me folded a paper timetable into a boat.",
        "prefix": "At five forty",
        "suffix": "The ferry was already",
    }

    # The work's page lists it with the words for a signed-in reader.
    listing = await client.get(
        "/api/forum/topics", params={"paper_id": work_id}, headers=auth_headers(test_user)
    )
    assert listing.status_code == 200
    rows = listing.json()["data"]
    assert [row["id"] for row in rows] == [topic["id"]]
    assert rows[0]["passage"]["quote"].startswith("the person beside me")

    detail = await client.get(f"/api/forum/topics/{topic['id']}", headers=auth_headers(test_user))
    assert detail.json()["passage"]["quote"] == topic["passage"]["quote"]


async def test_invented_quote_is_refused(
    client: AsyncClient, test_user: dict, admin_user: dict, db_session: AsyncSession
) -> None:
    work_id = await _essay(client, admin_user, db_session, title="A ferry essay")
    response = await client.post(
        "/api/forum/topics",
        json={
            "title": "Did the author really say this?",
            "paper_id": work_id,
            "passage": {"quote": "the ferry never came and I was glad"},
        },
        headers=auth_headers(test_user),
    )
    assert response.status_code == 422, response.text
    assert response.json()["detail"]["code"] == "passage_not_found"


async def test_passage_needs_a_work_and_plain_topics_still_need_a_body(
    client: AsyncClient, test_user: dict
) -> None:
    orphan = await client.post(
        "/api/forum/topics",
        json={"title": "A quote from nowhere", "passage": {"quote": "a paper timetable"}},
        headers=auth_headers(test_user),
    )
    assert orphan.status_code == 422
    empty = await client.post(
        "/api/forum/topics",
        json={"title": "Only a title", "body": " "},
        headers=auth_headers(test_user),
    )
    assert empty.status_code == 422


async def test_overseas_guest_sees_the_thread_but_not_the_quoted_words(
    client: AsyncClient,
    test_user: dict,
    admin_user: dict,
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    work_id = await _essay(client, admin_user, db_session, title="Guest visibility essay")
    created = await client.post(
        "/api/forum/topics",
        json={
            "title": "What does the margin hold?",
            "body": "I keep coming back to this line.",
            "paper_id": work_id,
            "passage": {"quote": "I drew both in the margin."},
        },
        headers=auth_headers(test_user),
    )
    assert created.status_code == 201, created.text
    topic_id = created.json()["id"]

    guest = _overseas(monkeypatch)
    # Baseline: this guest may not open the manuscript itself ...
    manuscript = await client.get(f"/api/catalog/{work_id}/manuscript", headers=guest)
    assert manuscript.status_code == 401
    # ... so the quoted words are withheld everywhere a guest can read threads.
    detail = await client.get(f"/api/forum/topics/{topic_id}", headers=guest)
    assert detail.status_code == 200, detail.text
    assert detail.json()["has_passage"] is True
    assert detail.json()["passage"] is None
    assert detail.json()["body"] == "I keep coming back to this line."
    listing = await client.get("/api/forum/topics", params={"paper_id": work_id}, headers=guest)
    assert listing.status_code == 200
    assert listing.json()["data"][0]["passage"] is None
    assert "I drew both" not in str(listing.json()["data"][0])

    # A signed-in reader in the same region gets the passage.
    signed_in = await client.get(
        f"/api/forum/topics/{topic_id}", headers={**guest, **auth_headers(test_user)}
    )
    assert signed_in.json()["passage"]["quote"] == "I drew both in the margin."


async def test_author_sees_own_pending_margin_thread_on_the_work(
    client: AsyncClient, test_user: dict, admin_user: dict, db_session: AsyncSession
) -> None:
    work_id = await _essay(client, admin_user, db_session, title="Pending margin essay")
    created = await client.post(
        "/api/forum/topics",
        json={
            "title": "A question about the chain",
            "paper_id": work_id,
            "passage": {"quote": "the sound of the chain"},
        },
        headers=auth_headers(test_user),
    )
    assert created.status_code == 201, created.text
    topic_id = created.json()["id"]
    row = (
        await db_session.execute(select(ForumTopic).where(ForumTopic.id == topic_id))
    ).scalar_one()
    row.moderation_status = "manual_review"
    await db_session.commit()

    own = await client.get(
        "/api/forum/topics", params={"paper_id": work_id}, headers=auth_headers(test_user)
    )
    assert [r["id"] for r in own.json()["data"]] == [topic_id]
    assert own.json()["data"][0]["moderation_status"] == "manual_review"

    other = await register_user(client, email="reader@example.com", username="reader")
    theirs = await client.get(
        "/api/forum/topics", params={"paper_id": work_id}, headers=auth_headers(other)
    )
    assert theirs.json()["data"] == []
    public = await client.get("/api/forum/topics", params={"paper_id": work_id})
    assert public.json()["data"] == []


async def test_relinking_the_work_drops_the_passage(
    client: AsyncClient, test_user: dict, admin_user: dict, db_session: AsyncSession
) -> None:
    work_id = await _essay(client, admin_user, db_session, title="First essay")
    other_id = await _essay(client, admin_user, db_session, title="Second essay")
    created = await client.post(
        "/api/forum/topics",
        json={
            "title": "Only a question",
            "paper_id": work_id,
            "passage": {"quote": "a paper timetable into a boat"},
        },
        headers=auth_headers(test_user),
    )
    topic_id = created.json()["id"]

    # Title-only edits keep the passage and the empty body is still fine.
    kept = await client.patch(
        f"/api/forum/topics/{topic_id}/edit",
        json={"title": "Only a sharper question"},
        headers=auth_headers(test_user),
    )
    assert kept.status_code == 200, kept.text
    assert kept.json()["passage"]["quote"] == "a paper timetable into a boat"

    # Moving to another work without a body would leave an empty topic: refuse.
    refused = await client.patch(
        f"/api/forum/topics/{topic_id}/edit",
        json={"paper_id": other_id},
        headers=auth_headers(test_user),
    )
    assert refused.status_code == 422

    moved = await client.patch(
        f"/api/forum/topics/{topic_id}/edit",
        json={"paper_id": other_id, "body": "Now about the other essay."},
        headers=auth_headers(test_user),
    )
    assert moved.status_code == 200, moved.text
    assert moved.json()["paper_id"] == other_id
    assert moved.json()["passage"] is None
    assert moved.json()["has_passage"] is False


async def test_related_work_reports_its_track(
    client: AsyncClient, test_user: dict, admin_user: dict, db_session: AsyncSession
) -> None:
    work_id = await _essay(client, admin_user, db_session, title="Track label essay")
    created = await client.post(
        "/api/forum/topics",
        json={"title": "Linked essay", "body": "About the essay.", "paper_id": work_id},
        headers=auth_headers(test_user),
    )
    related = await client.get(f"/api/forum/topics/{created.json()['id']}/related")
    assert related.status_code == 200
    assert related.json()["paper"]["content_track"] == "essay"
