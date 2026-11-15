"""SMTP 发信池与收件护栏测试。

覆盖：
- ``parse_smtp_accounts`` 对合法 / 畸形 JSON 的容忍度（畸形只记日志，不抛）。
- ``SmtpPoolEmailSender`` 的轮询、单账号失败自动切换、连续失败熔断。
- 收件护栏：冷却窗口、滚动窗口上限、大小写归一。
"""

from __future__ import annotations

import smtplib
from email.message import EmailMessage
from typing import ClassVar

import pytest

from app.core import email as email_mod
from app.core import mail_guard
from app.core.config import settings
from app.core.email import (
    SmtpAccount,
    SmtpPoolEmailSender,
    configured_accounts,
    get_email_sender,
    parse_smtp_accounts,
    reset_email_sender,
)
from app.core.mail_guard import allow_email_to, guard_stats, reset_mail_guard


def _account(name: str) -> SmtpAccount:
    return SmtpAccount(
        host=f"smtp.{name}.test",
        port=465,
        username=f"{name}@test",
        password="pw",
        from_address=f"{name}@test",
        from_name="Rubbish",
        use_tls=True,
        starttls=False,
    )


# ---------------------------------------------------------------------------
# 配置解析
# ---------------------------------------------------------------------------


def test_parse_accounts_empty() -> None:
    assert parse_smtp_accounts("") == []
    assert parse_smtp_accounts("   ") == []


def test_parse_accounts_invalid_json_is_tolerated(caplog) -> None:
    assert parse_smtp_accounts("{not json") == []


def test_parse_accounts_skips_incomplete_entries() -> None:
    raw = (
        '[{"host": "smtp.a.test", "username": "a@test", "from_address": "a@test"},'
        ' {"host": "", "username": "b@test"},'
        ' "nope"]'
    )
    accounts = parse_smtp_accounts(raw)
    assert len(accounts) == 1
    assert accounts[0].from_address == "a@test"
    # port 缺省回落 465（隐式 TLS 的常用端口），不是 587
    assert accounts[0].port == 465
    assert accounts[0].use_tls is True


def test_configured_accounts_falls_back_to_single(monkeypatch) -> None:
    monkeypatch.setattr(settings, "email_smtp_accounts", "")
    monkeypatch.setattr(settings, "email_smtp_host", "smtp.single.test")
    monkeypatch.setattr(settings, "email_from_address", "single@test")
    accounts = configured_accounts()
    assert len(accounts) == 1
    assert accounts[0].host == "smtp.single.test"


def test_pool_sender_selected_when_multiple_accounts(monkeypatch) -> None:
    monkeypatch.setattr(settings, "environment", "production")
    monkeypatch.setattr(settings, "email_backend", "smtp")
    monkeypatch.setattr(
        settings,
        "email_smtp_accounts",
        '[{"host":"smtp.a.test","username":"a@test","from_address":"a@test"},'
        '{"host":"smtp.b.test","username":"b@test","from_address":"b@test"}]',
    )
    sender = get_email_sender()
    assert isinstance(sender, SmtpPoolEmailSender)
    assert sender.account_count == 2


# ---------------------------------------------------------------------------
# 发信池行为
# ---------------------------------------------------------------------------


class _FakeSMTP:
    """按 host 选择性失败的 smtplib 替身。"""

    instances: ClassVar[list[_FakeSMTP]] = []
    failing_hosts: ClassVar[set[str]] = set()

    def __init__(self, host, port, timeout=None, context=None):
        self.host = host
        self.port = port
        self.sent: list[EmailMessage] = []
        _FakeSMTP.instances.append(self)

    def __enter__(self):
        if self.host in _FakeSMTP.failing_hosts:
            raise OSError(f"{self.host} unreachable")
        return self

    def __exit__(self, *exc):
        return False

    def starttls(self, context=None):
        return None

    def login(self, user, password):
        return None

    def send_message(self, msg):
        self.sent.append(msg)

    def noop(self):
        return (250, b"OK")


@pytest.fixture(autouse=True)
def _reset_senders():
    reset_email_sender()
    reset_mail_guard()
    _FakeSMTP.instances.clear()
    _FakeSMTP.failing_hosts = set()
    yield
    reset_email_sender()
    reset_mail_guard()


@pytest.mark.asyncio
async def test_pool_round_robins_between_accounts(monkeypatch) -> None:
    monkeypatch.setattr(smtplib, "SMTP_SSL", _FakeSMTP)
    pool = SmtpPoolEmailSender([_account("a"), _account("b")], retries=0)

    for _ in range(4):
        await pool.send(to="reader@test", subject="s", body="b")

    hosts = [inst.host for inst in _FakeSMTP.instances]
    assert hosts == ["smtp.a.test", "smtp.b.test", "smtp.a.test", "smtp.b.test"]


@pytest.mark.asyncio
async def test_pool_fails_over_on_first_send(monkeypatch) -> None:
    monkeypatch.setattr(smtplib, "SMTP_SSL", _FakeSMTP)
    _FakeSMTP.failing_hosts = {"smtp.a.test"}
    pool = SmtpPoolEmailSender([_account("a"), _account("b")], retries=0)

    await pool.send(to="reader@test", subject="s", body="b")

    attempted = [inst.host for inst in _FakeSMTP.instances]
    assert attempted == ["smtp.a.test", "smtp.b.test"]
    assert len(_FakeSMTP.instances[-1].sent) == 1


@pytest.mark.asyncio
async def test_pool_parks_account_after_repeated_failures(monkeypatch) -> None:
    monkeypatch.setattr(smtplib, "SMTP_SSL", _FakeSMTP)
    _FakeSMTP.failing_hosts = {"smtp.a.test"}
    pool = SmtpPoolEmailSender(
        [_account("a"), _account("b")],
        retries=0,
        breaker_threshold=1,
        breaker_cooldown=300,
    )

    await pool.send(to="r@test", subject="s", body="b")
    first_round = len(_FakeSMTP.instances)
    # 熔断后 a 被摘除，后续整轮只碰 b
    await pool.send(to="r@test", subject="s", body="b")
    await pool.send(to="r@test", subject="s", body="b")
    assert len(_FakeSMTP.instances) - first_round == 2
    assert all(i.host == "smtp.b.test" for i in _FakeSMTP.instances[first_round:])


@pytest.mark.asyncio
async def test_pool_raises_when_every_account_fails(monkeypatch) -> None:
    monkeypatch.setattr(smtplib, "SMTP_SSL", _FakeSMTP)
    _FakeSMTP.failing_hosts = {"smtp.a.test", "smtp.b.test"}
    pool = SmtpPoolEmailSender([_account("a"), _account("b")], retries=0)

    with pytest.raises(OSError):
        await pool.send(to="r@test", subject="s", body="b")


def test_pool_requires_at_least_one_account() -> None:
    with pytest.raises(ValueError):
        SmtpPoolEmailSender([])


def test_pool_sender_is_protocol_instance() -> None:
    assert isinstance(SmtpPoolEmailSender([_account("a")]), email_mod.EmailSender)


# ---------------------------------------------------------------------------
# 收件护栏
# ---------------------------------------------------------------------------


def test_guard_blocks_immediate_resend(monkeypatch) -> None:
    monkeypatch.setattr(settings, "email_per_address_cooldown", 60)
    assert allow_email_to("reader@test") is True
    assert allow_email_to("reader@test") is False
    # 大小写与空白归一：换大小写不能绕过冷却
    assert allow_email_to(" Reader@Test ") is False
    # 其它地址不受影响
    assert allow_email_to("other@test") is True


def test_guard_window_limit(monkeypatch) -> None:
    monkeypatch.setattr(settings, "email_per_address_cooldown", 10)
    monkeypatch.setattr(settings, "email_per_address_limit", 3)
    monkeypatch.setattr(settings, "email_per_address_window_minutes", 30)
    now = [1000.0]
    monkeypatch.setattr(mail_guard.time, "monotonic", lambda: now[0])

    for i in range(3):
        now[0] = 1000.0 + i * 20
        assert allow_email_to("x@test") is True
    now[0] = 1000.0 + 3 * 20
    assert allow_email_to("x@test") is False
    # 窗口滑过之后恢复
    now[0] = 1000.0 + 30 * 60 + 1
    assert allow_email_to("x@test") is True


def test_guard_stats_counts_addresses() -> None:
    allow_email_to("a@test")
    allow_email_to("b@test")
    assert guard_stats()["tracked_addresses"] == 2
