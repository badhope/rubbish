"""账号级登录失败节流（进程内，与 mail_guard 同款实现哲学）。

为什么需要：RateLimitMiddleware 按 IP 限流，攻击者换 IP（或拿着大段
代理池）即可绕过；而密码爆破的目标是**账号**，最后一道闸必须按账号
计数。中间件注释声称「暴力破解由账号锁定兜住」，此前并没有这个兜底。

设计取舍：

- 只在**密码验证失败**时记一次，成功登录立即清零 —— 不会把正常用户
  的输错习惯升级成锁定。
- 5 次失败 → 15 分钟冷却（对人类足够宽容，对爆破是 7200× 降速）。
- 冷却期内直接 401 「Invalid credentials」：不区分「密码错」和
  「被节流」，避免把锁定状态泄漏给攻击者。
- 纯内存实现：单节点部署够用；多节点各计数一份，等于限额变 N 倍，
  仍有 IP 限流与 2FA 低尝试窗口兜底。
"""

from __future__ import annotations

import time

from app.core.config import settings
from app.core.logging import get_logger

logger = get_logger("rubbish.login_throttle")

_MAX_FAILURES = 5
_COOLDOWN_SECONDS = 15 * 60.0

# key -> (failure_count, last_failure_monotonic)
_failures: dict[str, tuple[int, float]] = {}


def _key(tenant_id: object, identifier: str) -> str:
    return f"{tenant_id}|{identifier.strip().lower()}"


def is_locked(tenant_id: object, identifier: str) -> bool:
    """True 当该标识正处于失败冷却期。不产生任何写入。"""
    entry = _failures.get(_key(tenant_id, identifier))
    if entry is None:
        return False
    count, last = entry
    if count < _MAX_FAILURES:
        return False
    if time.monotonic() - last >= _COOLDOWN_SECONDS:
        # 冷却已过：过期条目就地清除，下次失败重新从 1 计数。
        _failures.pop(_key(tenant_id, identifier), None)
        return False
    return True


def record_failure(tenant_id: object, identifier: str) -> None:
    """记一次密码失败；达到阈值进入冷却。永不抛错。"""
    if settings.is_test:
        return
    key = _key(tenant_id, identifier)
    count, _ = _failures.get(key, (0, 0.0))
    _failures[key] = (count + 1, time.monotonic())
    if count + 1 == _MAX_FAILURES:
        logger.warning("login_throttle_engaged", identifier=key.split("|", 1)[1])


def record_success(tenant_id: object, identifier: str) -> None:
    """登录成功即清零：正常用户偶发输错不该积累成锁定。"""
    _failures.pop(_key(tenant_id, identifier), None)


def reset_login_throttle() -> None:
    """Test helper: drop all counters."""
    _failures.clear()


__all__ = ["is_locked", "record_failure", "record_success", "reset_login_throttle"]
