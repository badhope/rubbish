"""Probe objects for captcha verifier resolution tests.

Imported by dotted path (``captcha_probe.<attr>``) from
``app.core.captcha._resolve_verifier`` — pytest puts ``tests/`` on
``sys.path``, so this module is importable without a package.
"""

from __future__ import annotations


class InstanceVerifier:
    async def verify(self, token: str, *, remote_ip: str | None) -> bool:
        return True


class RejectingInstanceVerifier:
    async def verify(self, token: str, *, remote_ip: str | None) -> bool:
        return False


class SyncMethodObject:
    def verify(self, token: str, *, remote_ip: str | None) -> bool:
        return True


probe_instance = InstanceVerifier()
rejecting_instance = RejectingInstanceVerifier()
sync_method_object = SyncMethodObject()


async def bare_verify(token: str, *, remote_ip: str | None) -> bool:
    return True


def instance_factory() -> InstanceVerifier:
    return InstanceVerifier()


def broken_factory() -> object:
    return object()
