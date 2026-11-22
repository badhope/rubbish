"""Review and decision emails must land on the exact in-app item."""

from __future__ import annotations

from types import SimpleNamespace

from app.core.config import settings
from app.domain.submission import review_reminders


class CaptureSender:
    def __init__(self) -> None:
        self.messages: list[dict[str, object]] = []

    async def send(self, **kwargs: object) -> None:
        self.messages.append(kwargs)


async def test_assignment_email_links_to_exact_assignment(monkeypatch) -> None:
    sender = CaptureSender()
    monkeypatch.setattr(review_reminders, "smtp_configured", lambda: True)
    monkeypatch.setattr(review_reminders, "get_email_sender", lambda: sender)
    monkeypatch.setattr(settings, "frontend_base_url", "https://example.test")

    reviewer = SimpleNamespace(username="reviewer", email="reviewer@example.com")
    await review_reminders.send_assignment_email(
        reviewer, submission_title="待互评作品", assignment_id=42
    )

    assert len(sender.messages) == 1
    assert "https://example.test/review?tab=assignments&assignment=42" in str(
        sender.messages[0]["body"]
    )


async def test_decision_email_links_to_exact_submission(monkeypatch) -> None:
    sender = CaptureSender()
    monkeypatch.setattr(review_reminders, "smtp_configured", lambda: True)
    monkeypatch.setattr(review_reminders, "get_email_sender", lambda: sender)
    monkeypatch.setattr(settings, "frontend_base_url", "https://example.test")

    author = SimpleNamespace(username="author", email="author@example.com")
    await review_reminders.send_decision_email(
        author,
        submission_title="被退回的作品",
        decision="reject",
        note="请补充材料。",
        submission_id=305,
    )

    assert len(sender.messages) == 1
    assert "https://example.test/submissions?submission=305" in str(
        sender.messages[0]["body"]
    )
