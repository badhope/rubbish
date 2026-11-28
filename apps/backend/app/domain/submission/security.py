"""Upload security policy, download gate and legacy-file backfill.

New uploads are scanned before they reach storage.  This module also owns
two adjacent concerns that used to be nobody's job:

- **download gate**: an infected historical file must stop being served
  immediately, even if no editor is online;
- **backfill**: files uploaded before ClamAV existed are scanned in small
  batches by the workflow scheduler, so the control covers old content
  instead of only new uploads.
"""

from __future__ import annotations

from typing import Any

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.antivirus import ScanResult, scan_bytes
from app.core.config import settings
from app.core.email_templates import upload_infected
from app.core.logging import get_logger
from app.core.storage import get_storage
from app.core.time import utcnow
from app.domain.notifications import services as notifications
from app.domain.submission.editor_recipients import editor_recipients
from app.domain.submission.models import Submission, SubmissionVersion
from app.models import AuditLog

logger = get_logger("rubbish.submission_security")

MAX_SCAN_ATTEMPTS = 3


class FileSecurityError(Exception):
    """Domain-level file security decision; HTTP mapping lives in main.py."""

    def __init__(self, status_code: int, detail: str) -> None:
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail


def scan_fields(result: ScanResult) -> dict[str, Any]:
    """Map a scan result onto the Submission/Version scan columns."""
    return {
        "file_scan_status": result.status,
        "file_scan_engine": result.engine,
        "file_scan_signature": result.signature,
        "file_scan_detail": result.detail,
        "file_scan_at": utcnow(),
        "file_sha256": result.sha256,
    }


def file_is_quarantined(entry: Any) -> bool:
    return str(getattr(entry, "file_scan_status", "") or "") == "infected"


def ensure_file_servable(entry: Any) -> None:
    """Raise a hard error when a stored file has been quarantined."""
    if file_is_quarantined(entry):
        raise FileSecurityError(
            451,
            "该文件已被安全引擎隔离，禁止下载。请作者重新上传干净版本，或联系站务复核。",
        )


async def _alert_infected(
    db: AsyncSession,
    *,
    entry: Submission,
    signature: str,
) -> None:
    tenant_id = entry.tenant_id
    base = settings.frontend_base_url.rstrip("/")
    link = f"{base}/editor/submissions/{entry.id}"
    subject, text, html = upload_infected(entry.title, entry.id, signature, link)
    recipients = await editor_recipients(db, tenant_id)
    for user in recipients:
        await notifications.create(
            db,
            tenant_id=tenant_id,
            user_id=user.id,
            type_="submission.file_infected",
            title=f"上传文件被隔离：{entry.title}",
            body=f"ClamAV 特征：{signature}。该文件已禁止下载，请要求作者重传。",
            related_type="submission",
            related_id=str(entry.id),
        )
        if notifications.wants(user, "email_submission"):
            await notifications.record_email_digest(
                db,
                tenant_id=tenant_id,
                user_id=user.id,
                event_type="submission.file_infected",
                recipient_email=user.email,
                subject=subject,
                text=text,
                html=html,
                related_type="submission",
                related_id=str(entry.id),
            )


async def assert_bytes_safe(contents: bytes, filename: str) -> ScanResult:
    """Scan a preview/conversion payload that is never written to storage."""
    result = await scan_bytes(contents, filename)
    if result.is_infected:
        raise FileSecurityError(
            422,
            f"文件被安全引擎判定为恶意，已拒绝处理。特征：{result.signature}",
        )
    if settings.virus_scan_enabled and result.status == "error":
        raise FileSecurityError(
            503,
            "文件安全扫描暂时不可用，请稍后重试。",
        )
    return result


async def scan_upload_or_reject(
    db: AsyncSession,
    *,
    contents: bytes,
    filename: str,
    actor_id: int,
    tenant_id: Any,
    submission_id: int | None = None,
    kind: str = "file",
) -> ScanResult:
    """Scan bytes before storage.  Infected/error uploads never persist."""
    result = await scan_bytes(contents, filename)
    if result.status == "disabled":
        return result
    if result.is_clean:
        return result
    db.add(
        AuditLog(
            tenant_id=tenant_id,
            actor_user_id=actor_id,
            action=f"submission.{kind}_scan_blocked",
            target_type="submission" if submission_id is not None else "upload",
            target_id=str(submission_id) if submission_id is not None else filename[:100],
            payload={
                "status": result.status,
                "signature": result.signature,
                "sha256": result.sha256,
                "filename": filename[:200],
            },
        )
    )
    await db.commit()
    if result.is_infected:
        raise FileSecurityError(
            422,
            f"文件被安全引擎判定为恶意，已拒绝保存。特征：{result.signature}。请上传干净版本。",
        )
    raise FileSecurityError(
        503,
        "上传安全扫描暂时不可用，文件未保存。请稍后重试；若持续失败请联系站务。",
    )


async def _scan_one(entry: Submission, data: bytes) -> ScanResult:
    return await scan_bytes(data, entry.file_path or "file")


async def run_file_scan_backfill(
    db: AsyncSession, *, tenant_id: Any, limit: int = 5
) -> dict[str, int]:
    """Scan a small batch of legacy submissions and versions."""
    stats = {"scanned": 0, "clean": 0, "infected": 0, "error": 0, "missing": 0}
    if not settings.virus_scan_enabled:
        return stats
    submissions = list(
        (
            await db.execute(
                select(Submission)
                .where(
                    Submission.tenant_id == tenant_id,
                    Submission.file_path.is_not(None),
                    Submission.file_path != "",
                    or_(
                        Submission.file_scan_status.is_(None),
                        Submission.file_scan_status.in_(("legacy", "unscanned", "scan_error")),
                    ),
                    Submission.file_scan_attempts < MAX_SCAN_ATTEMPTS,
                )
                .order_by(Submission.id.desc())
                .limit(limit)
            )
        )
        .scalars()
        .all()
    )
    storage = get_storage()
    for entry in submissions:
        try:
            data = await storage.load(entry.file_path or "")
        except FileNotFoundError:
            # Old intake pipelines converted PDFs to Markdown and removed
            # the original bytes. A missing source can never be recovered
            # by retrying, so stop after this attempt instead of blocking
            # the queue for three rounds.
            entry.file_scan_attempts = MAX_SCAN_ATTEMPTS
            entry.file_scan_status = "missing"
            entry.file_scan_detail = "源文件不存在，无法补扫"
            entry.file_scan_at = utcnow()
            stats["missing"] += 1
            continue
        except Exception as exc:
            entry.file_scan_attempts += 1
            entry.file_scan_status = "scan_error"
            entry.file_scan_detail = f"读取文件失败：{str(exc)[:200]}"
            entry.file_scan_at = utcnow()
            stats["error"] += 1
            continue
        result = await _scan_one(entry, data)
        entry.file_scan_attempts += 1
        for key, value in scan_fields(result).items():
            setattr(entry, key, value)
        stats["scanned"] += 1
        if result.is_clean:
            stats["clean"] += 1
            # 同一路径的历史版本继承结论，避免重复扫描同一份字节。
            versions = (
                await db.execute(
                    select(SubmissionVersion).where(
                        SubmissionVersion.tenant_id == tenant_id,
                        SubmissionVersion.file_path == entry.file_path,
                        SubmissionVersion.file_scan_status.is_(None),
                    )
                )
            ).scalars()
            for version in versions:
                version.file_scan_status = "clean"
                version.file_scan_engine = result.engine
                version.file_sha256 = result.sha256
                version.file_scan_at = utcnow()
        elif result.is_infected:
            stats["infected"] += 1
            entry.file_scan_status = "infected"
            db.add(
                AuditLog(
                    tenant_id=tenant_id,
                    actor_user_id=None,
                    action="submission.file_infected",
                    target_type="submission",
                    target_id=str(entry.id),
                    payload={
                        "signature": result.signature,
                        "sha256": result.sha256,
                        "path": entry.file_path,
                    },
                )
            )
            if result.signature:
                await _alert_infected(db, entry=entry, signature=result.signature)
        else:
            stats["error"] += 1

    # Legacy versions whose submission row is already gone.
    legacy_versions = list(
        (
            await db.execute(
                select(SubmissionVersion)
                .where(
                    SubmissionVersion.tenant_id == tenant_id,
                    SubmissionVersion.file_path.is_not(None),
                    SubmissionVersion.file_path != "",
                    or_(
                        SubmissionVersion.file_scan_status.is_(None),
                        SubmissionVersion.file_scan_status.in_(
                            ("legacy", "unscanned", "scan_error")
                        ),
                    ),
                    SubmissionVersion.file_scan_attempts < MAX_SCAN_ATTEMPTS,
                )
                .order_by(SubmissionVersion.id.desc())
                .limit(limit)
            )
        )
        .scalars()
        .all()
    )
    for version in legacy_versions:
        try:
            data = await storage.load(version.file_path or "")
        except FileNotFoundError:
            version.file_scan_attempts = MAX_SCAN_ATTEMPTS
            version.file_scan_status = "missing"
            version.file_scan_at = utcnow()
            stats["missing"] += 1
            continue
        except Exception:
            version.file_scan_attempts += 1
            version.file_scan_status = "scan_error"
            version.file_scan_at = utcnow()
            stats["error"] += 1
            continue
        result = await scan_bytes(data, version.file_path or "version")
        version.file_scan_attempts += 1
        version.file_scan_status = result.status
        version.file_scan_engine = result.engine
        version.file_scan_signature = result.signature
        version.file_scan_at = utcnow()
        version.file_sha256 = result.sha256
        stats["scanned"] += 1
        if result.is_clean:
            stats["clean"] += 1
        elif result.is_infected:
            stats["infected"] += 1
            db.add(
                AuditLog(
                    tenant_id=tenant_id,
                    actor_user_id=None,
                    action="submission.version_infected",
                    target_type="submission_version",
                    target_id=str(version.id),
                    payload={
                        "signature": result.signature,
                        "sha256": result.sha256,
                        "path": version.file_path,
                        "submission_id": version.submission_id,
                    },
                )
            )
        else:
            stats["error"] += 1

    if stats["scanned"] or stats["error"] or stats["missing"]:
        await db.flush()
        logger.info("file_scan_backfill", tenant_id=str(tenant_id), **stats)
    return stats


__all__ = [
    "MAX_SCAN_ATTEMPTS",
    "FileSecurityError",
    "assert_bytes_safe",
    "ensure_file_servable",
    "file_is_quarantined",
    "run_file_scan_backfill",
    "scan_fields",
    "scan_upload_or_reject",
]
