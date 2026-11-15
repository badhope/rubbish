"""Email layer tests — templates, SMTP behaviour, configuration gating.

No real network: SMTP is exercised through a fake ``smtplib.SMTP`` /
``SMTP_SSL`` patched at module level, so the retry/backoff and
message-shape contracts are locked without credentials.
"""

from __future__ import annotations

import smtplib
from email.message import EmailMessage
from typing import ClassVar

import pytest

from app.core import email as email_mod
from app.core.config import settings
from app.core.email import (
    ConsoleEmailSender,
    SMTPEmailSender,
    get_email_sender,
    reset_email_sender,
    smtp_configured,
    verify_smtp_connection,
)
from app.core.email_templates import (
    decision_notice,
    duplicate_registration,
    reset_password,
    review_assigned,
    review_reminder,
    verify_email,
)

# ---------------------------------------------------------------------------
# Templates
# ---------------------------------------------------------------------------


def test_verify_email_template_parts() -> None:
    subject, text, html = verify_email("小明", "https://x/verify-email?token=t1", 24)
    assert "Rubbish" in subject
    assert "小明" in text and "https://x/verify-email?token=t1" in text
    assert "24 小时" in text
    assert "<html" in html and "验证邮箱" in html
    # 链接必须进入两个版本（纯文本 + 按钮 href）
    assert "token=t1" in html


def test_reset_password_template_parts() -> None:
    subject, text, html = reset_password("小明", "https://x/reset-password?token=t2", 60)
    assert "重置" in subject
    assert "60 分钟" in text
    assert "token=t2" in html


def test_templates_escape_user_input() -> None:
    _, _text, html = verify_email("<script>alert(1)</script>", "https://x/v", 1)
    assert "<script>" not in html
    assert "&lt;script&gt;" in html


def test_review_templates_carry_due_and_days() -> None:
    _s1, t1, h1 = review_assigned("审稿人", "论文标题", "https://x/review", 14)
    assert "14 天" in t1 and "论文标题" in t1 and "review" in h1
    s2, t2, _h2 = review_reminder("审稿人", "论文标题", "https://x/review", 9)
    assert "9 天" in s2 and "9 天" in t2


def test_decision_notice_includes_note() -> None:
    subject, text, html = decision_notice(
        "作者", "论文", "录用", "按意见修订后录用。", "https://x/s/1"
    )
    assert "录用" in subject
    assert "按意见修订后录用。" in text and "按意见修订后录用。" in html


def test_duplicate_registration_template() -> None:
    subject, text, _ = duplicate_registration("已有用户")
    assert "已有用户" in text
    assert "注册" in subject


# ---------------------------------------------------------------------------
# Sender selection / configuration gating
# ---------------------------------------------------------------------------


@pytest.fixture(autouse=True)
def _reset_sender():
    reset_email_sender()
    yield
    reset_email_sender()


def test_console_backend_is_default_outside_production(monkeypatch) -> None:
    monkeypatch.setattr(settings, "email_backend", "console")
    assert isinstance(get_email_sender(), ConsoleEmailSender)


def test_smtp_without_host_falls_back_to_console(monkeypatch) -> None:
    monkeypatch.setattr(settings, "environment", "production")
    monkeypatch.setattr(settings, "email_backend", "smtp")
    monkeypatch.setattr(settings, "email_smtp_host", "")
    monkeypatch.setattr(settings, "email_from_address", "no-reply@example.com")
    assert isinstance(get_email_sender(), ConsoleEmailSender)
    assert smtp_configured() is False


def test_smtp_configured_flag_true_with_host(monkeypatch) -> None:
    monkeypatch.setattr(settings, "email_backend", "smtp")
    monkeypatch.setattr(settings, "email_smtp_host", "smtp.example.com")
    monkeypatch.setattr(settings, "email_from_address", "no-reply@example.com")
    assert smtp_configured() is True


# ---------------------------------------------------------------------------
# SMTPEmailSender behaviour (fake transport)
# ---------------------------------------------------------------------------


class _FakeSMTP:
    """Minimal smtplib.SMTP stand-in recording sent messages."""

    instances: ClassVar[list[_FakeSMTP]] = []
    fail_times = 0

    def __init__(self, host, port, timeout=None, context=None):
        self.host = host
        self.port = port
        self.timeout = timeout
        self.sent: list[EmailMessage] = []
        self.logged_in = False
        self.started_tls = False
        _FakeSMTP.instances.append(self)

    def __enter__(self):
        if _FakeSMTP.fail_times > 0:
            _FakeSMTP.fail_times -= 1
            raise OSError("connection reset by peer")
        return self

    def __exit__(self, *exc):
        return False

    def starttls(self, context=None):
        self.started_tls = True

    def login(self, user, password):
        self.logged_in = True

    def send_message(self, msg):
        self.sent.append(msg)

    def noop(self):
        return (250, b"OK")


def _sender(**kw) -> SMTPEmailSender:
    return SMTPEmailSender(
        host="smtp.example.com",
        port=587,
        username="u",
        password="p",
        from_addr="no-reply@example.com",
        from_name="Rubbish",
        use_tls=False,
        starttls=True,
        timeout=5,
        retries=2,
        **kw,
    )


@pytest.mark.asyncio
async def test_smtp_send_builds_multipart_message(monkeypatch) -> None:
    _FakeSMTP.instances.clear()
    _FakeSMTP.fail_times = 0
    monkeypatch.setattr(smtplib, "SMTP", _FakeSMTP)

    await _sender().send(
        to="reader@example.com",
        subject="标题",
        body="纯文本",
        html="<p>富文本</p>",
    )

    assert len(_FakeSMTP.instances) == 1
    sent = _FakeSMTP.instances[0].sent
    assert len(sent) == 1
    msg = sent[0]
    assert msg["To"] == "reader@example.com"
    assert msg["From"] == "Rubbish <no-reply@example.com>"
    assert msg["Subject"] == "标题"
    assert msg.is_multipart()
    parts = {p.get_content_type() for p in msg.walk()}
    assert "text/plain" in parts and "text/html" in parts


@pytest.mark.asyncio
async def test_smtp_retries_then_succeeds(monkeypatch) -> None:
    _FakeSMTP.instances.clear()
    _FakeSMTP.fail_times = 1  # 第一次连接失败，第二次成功
    monkeypatch.setattr(smtplib, "SMTP", _FakeSMTP)

    await _sender().send(to="a@example.com", subject="s", body="b")

    assert len(_FakeSMTP.instances) == 2
    assert len(_FakeSMTP.instances[1].sent) == 1


@pytest.mark.asyncio
async def test_smtp_raises_after_exhausting_retries(monkeypatch) -> None:
    _FakeSMTP.instances.clear()
    _FakeSMTP.fail_times = 10
    monkeypatch.setattr(smtplib, "SMTP", _FakeSMTP)

    with pytest.raises(OSError):
        await _sender().send(to="a@example.com", subject="s", body="b")
    assert len(_FakeSMTP.instances) == 3  # 首次 + 2 次重试


@pytest.mark.asyncio
async def test_starttls_and_login_are_used(monkeypatch) -> None:
    _FakeSMTP.instances.clear()
    _FakeSMTP.fail_times = 0
    monkeypatch.setattr(smtplib, "SMTP", _FakeSMTP)

    await _sender().send(to="a@example.com", subject="s", body="b")
    inst = _FakeSMTP.instances[0]
    assert inst.started_tls is True
    assert inst.logged_in is True


@pytest.mark.asyncio
async def test_verify_smtp_connection_without_config(monkeypatch) -> None:
    monkeypatch.setattr(settings, "email_backend", "console")
    ok, detail = await verify_smtp_connection()
    assert ok is False
    assert "未配置" in detail


@pytest.mark.asyncio
async def test_verify_smtp_connection_success(monkeypatch) -> None:
    _FakeSMTP.instances.clear()
    _FakeSMTP.fail_times = 0
    monkeypatch.setattr(smtplib, "SMTP", _FakeSMTP)
    monkeypatch.setattr(settings, "email_backend", "smtp")
    monkeypatch.setattr(settings, "email_smtp_host", "smtp.example.com")
    monkeypatch.setattr(settings, "email_from_address", "no-reply@example.com")
    monkeypatch.setattr(settings, "email_smtp_use_tls", False)
    monkeypatch.setattr(settings, "email_smtp_starttls", True)

    ok, detail = await verify_smtp_connection()
    assert ok is True
    assert "连接成功" in detail


def test_email_module_exposes_protocol() -> None:
    assert isinstance(ConsoleEmailSender(), email_mod.EmailSender)
