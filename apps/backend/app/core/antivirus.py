"""Upload malware scanning through a local ClamAV daemon.

The production upload surface accepts PDF, Office documents, archives and
images from authenticated authors.  MIME/extension checks only prove the
bytes claim to be a PDF; they do not prove the PDF is safe for the editor
who downloads it, or for the parser that converts it to Markdown.

Policy:
- ``RUBBISH_VIRUS_SCAN_ENABLED=true`` in production.  ``clamdscan`` talks
  to a local ``clamav-daemon``; signature updates are handled by the OS.
- A clean scan is required before an upload is written to storage.
- An infected upload is rejected and only its signature/hash is recorded.
- If the scanner itself is down, the upload is rejected (fail closed).  A
  transient scanner outage is visible in the admin health page; silently
  accepting unscanned files would defeat the control.
"""

from __future__ import annotations

import asyncio
import hashlib
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from app.core.config import settings
from app.core.logging import get_logger

logger = get_logger("rubbish.antivirus")


@dataclass(frozen=True)
class ScanResult:
    status: str  # clean | infected | error | disabled
    engine: str
    signature: str | None
    sha256: str
    detail: str | None = None

    @property
    def is_clean(self) -> bool:
        return self.status == "clean"

    @property
    def is_infected(self) -> bool:
        return self.status == "infected"


def _run_scanner(data: bytes) -> subprocess.CompletedProcess[bytes]:
    # Stream bytes over stdin instead of creating a 0600 temp file. The
    # clamd daemon runs as a different user and cannot read those temp
    # files; piping also avoids writing potentially malicious samples to
    # disk. ``-`` is clamdscan's stdin marker.
    return subprocess.run(
        [settings.virus_scan_command, "--stdout", "--no-summary", "-"],
        input=data,
        capture_output=True,
        text=False,
        timeout=settings.virus_scan_timeout_seconds,
        check=False,
    )


def _parse_signature(output: str) -> str | None:
    for line in output.splitlines():
        line = line.strip()
        if not line:
            continue
        # clamdscan: "<path>: <Signature> FOUND" ; clamscan adds "FOUND"
        if " FOUND" in line:
            parts = line.rsplit(":", 1)
            if len(parts) == 2:
                sig = parts[1].replace("FOUND", "").strip()
                return sig[:190] or "Unknown"
    return None


def scan_bytes_sync(data: bytes, filename: str = "upload") -> ScanResult:
    """Synchronous scan entry point (runs in a worker thread)."""
    digest = hashlib.sha256(data).hexdigest()
    if not settings.virus_scan_enabled:
        return ScanResult("disabled", "none", None, digest, "扫描开关未启用")

    try:
        proc = _run_scanner(data)
        stdout = (proc.stdout or b"").decode(errors="replace")
        stderr = (proc.stderr or b"").decode(errors="replace")
        output = f"{stdout}\n{stderr}".strip()
        signature = _parse_signature(output)
        if proc.returncode == 0 and signature is None:
            return ScanResult("clean", "clamav", None, digest)
        if proc.returncode == 1 and signature:
            logger.warning(
                "upload_malware_detected",
                filename=filename[:120],
                signature=signature,
                sha256=digest,
            )
            return ScanResult("infected", "clamav", signature, digest)
        detail = output[:300] or f"clamdscan exit {proc.returncode}"
        logger.warning("upload_scan_failed", filename=filename[:120], detail=detail)
        return ScanResult("error", "clamav", None, digest, detail)
    except subprocess.TimeoutExpired:
        detail = f"扫描超时（{settings.virus_scan_timeout_seconds}s）"
        logger.warning("upload_scan_timeout", filename=filename[:120])
        return ScanResult("error", "clamav", None, digest, detail)
    except FileNotFoundError:
        detail = f"找不到扫描命令 {settings.virus_scan_command}"
        logger.error("upload_scanner_missing", command=settings.virus_scan_command)
        return ScanResult("error", "clamav", None, digest, detail)
    except Exception as exc:
        detail = str(exc)[:300]
        logger.warning("upload_scan_error", filename=filename[:120], exc_info=True)
        return ScanResult("error", "clamav", None, digest, detail)


async def scan_bytes(data: bytes, filename: str = "upload") -> ScanResult:
    """Scan without blocking the event loop."""
    return await asyncio.to_thread(scan_bytes_sync, data, filename)


async def antivirus_health() -> dict[str, Any]:
    """Probe the local scanner for the admin health page. Never raises."""
    if not settings.virus_scan_enabled:
        # Test/dev instances intentionally run without ClamAV. Reporting a
        # production-only control as a warning there would make every local
        # health check look degraded; production still gets the warning.
        status = "ok" if settings.is_test else "warn"
        return {
            "status": status,
            "detail": "测试环境未启用上传安全扫描" if settings.is_test else "上传安全扫描未启用",
        }
    try:
        # ``--version`` only proves the client binary exists; it does not
        # contact clamd. Probe the daemon itself so a dead scanner shows up
        # as fail before the first upload gets rejected.
        command = Path(settings.virus_scan_command).name
        args = (
            [settings.virus_scan_command, "--ping", "1"]
            if command == "clamdscan"
            else [settings.virus_scan_command, "--version"]
        )
        proc = await asyncio.to_thread(
            subprocess.run,
            args,
            capture_output=True,
            text=True,
            timeout=5,
            check=False,
        )
        out = (proc.stdout or proc.stderr).strip().splitlines()
        detail = out[0][:160] if out else "unknown"
        if proc.returncode == 0:
            return {"status": "ok", "detail": f"扫描器可达 · {detail}"}
        return {"status": "fail", "detail": f"扫描器不可用：{detail}"}
    except Exception as exc:
        return {"status": "fail", "detail": f"扫描器不可用：{str(exc)[:160]}"}


__all__ = ["ScanResult", "antivirus_health", "scan_bytes", "scan_bytes_sync"]
