"""收件地址级发信护栏（防轰炸，但保持宽松）。

设计取舍：

- 只约束**用户可反复触发**的邮件（注册验证、重发验证、找回密码）。
  审稿邀请、裁决通知这类系统事件不经过这里——它们的触发频率由业务
  状态决定，加护栏只会误伤。
- 两个维度：最短间隔（默认 60 秒，防连点）与滚动窗口总量
  （默认 30 分钟 8 封，防脚本换 IP 刷同一个受害者）。
- 超限时**仍然静默成功**：调用方返回 200，日志记
  ``email_throttled``。攻击者拿不到"这个地址被限流了"这一信息，
  正常用户偶尔点快两次也只会少收一封，不会看到报错。
- 纯内存实现：单节点部署（本项目就是）够用；多节点时每个节点
  各自计数，最坏情况是限额翻成 N 倍，仍远高于人类手速。
"""

from __future__ import annotations

import time
from collections import defaultdict

from app.core.config import settings
from app.core.logging import get_logger

logger = get_logger("rubbish.mail_guard")

# address -> monotonic timestamps of accepted sends (oldest first)
_sent: dict[str, list[float]] = defaultdict(list)


def _normalize(address: str) -> str:
    return address.strip().lower()


def allow_email_to(address: str) -> bool:
    """Return True when this recipient may receive another mail now.

    Records the hit when allowed. Never raises.
    """
    key = _normalize(address)
    if not key:
        return False
    now = time.monotonic()
    window = settings.email_per_address_window_minutes * 60.0
    cooldown = float(settings.email_per_address_cooldown)
    limit = settings.email_per_address_limit

    bucket = [ts for ts in _sent[key] if now - ts < window]
    if bucket and now - bucket[-1] < cooldown:
        _sent[key] = bucket
        logger.info(
            "email_throttled",
            reason="cooldown",
            address=key,
            seconds_since_last=round(now - bucket[-1], 1),
        )
        return False
    if len(bucket) >= limit:
        _sent[key] = bucket
        logger.info("email_throttled", reason="window_limit", address=key, count=len(bucket))
        return False
    bucket.append(now)
    _sent[key] = bucket
    return True


def reset_mail_guard() -> None:
    """Test helper: drop all counters."""
    _sent.clear()


def guard_stats() -> dict[str, int]:
    """Ops visibility: how many addresses are currently tracked."""
    return {"tracked_addresses": len(_sent)}
