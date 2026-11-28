"""Pluggable file storage: local filesystem (default) or S3/MinIO.

Same opt-in philosophy as ``monitoring.py`` / ``search.py``: the default
deployment writes to the local filesystem and pulls in zero extra
dependencies. Setting ``RUBBISH_STORAGE_BACKEND=s3`` switches every
read/write to S3-compatible object storage (AWS S3, MinIO, Cloudflare R2,
阿里云 OSS 的 S3 兼容端点等) via boto3.

Unlike search/monitoring, storage is NOT fail-open: a manuscript that
silently fails to save is data loss. Misconfiguration raises at call
time with an actionable message.

Object keys are the same relative paths used by the local backend
(``{tenant_id}/{submission_id}/{uuid}{ext}``), so switching backends
does not require a DB migration — only a one-off data copy.
"""

from __future__ import annotations

import logging
from functools import lru_cache
from pathlib import Path
from typing import Any, Protocol

from app.core.config import get_settings

logger = logging.getLogger(__name__)


class StorageError(RuntimeError):
    """Raised when a storage operation cannot be completed."""


class Storage(Protocol):
    """Minimal object-store interface used by upload/download routes."""

    backend: str

    async def save(self, key: str, data: bytes, *, content_type: str | None = None) -> None: ...

    async def load(self, key: str) -> bytes: ...

    async def delete(self, key: str) -> None: ...

    async def exists(self, key: str) -> bool: ...

    def presigned_url(self, key: str, *, expires_in: int = 300) -> str | None:
        """Direct-download URL, or None when the backend can't issue one."""
        ...


def _validate_key(key: str) -> str:
    """Reject absolute paths and parent traversal before touching disk/S3."""
    if not key or key.startswith("/") or key.startswith("\\"):
        raise StorageError("Storage key must be a non-empty relative path")
    if ".." in Path(key).parts:
        raise StorageError("Storage key must not contain parent traversal")
    return key


class LocalStorage:
    """Filesystem backend rooted at ``settings.storage_path``."""

    backend = "local"

    def __init__(self, root: str) -> None:
        self._root = Path(root)

    def _abs(self, key: str) -> Path:
        return self._root / _validate_key(key)

    async def save(self, key: str, data: bytes, *, content_type: str | None = None) -> None:
        dest = self._abs(key)
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(data)

    async def load(self, key: str) -> bytes:
        path = self._abs(key)
        if not path.is_file():
            raise FileNotFoundError(key)
        return path.read_bytes()

    async def delete(self, key: str) -> None:
        path = self._abs(key)
        if path.is_file():
            path.unlink()

    async def exists(self, key: str) -> bool:
        return self._abs(key).is_file()

    def presigned_url(self, key: str, *, expires_in: int = 300) -> str | None:
        # Local files are never served directly — the API streams them so
        # ownership/role checks stay enforced.
        return None


class S3Storage:
    """S3-compatible backend (AWS S3 / MinIO / R2 / OSS) via boto3.

    boto3 is synchronous; calls are pushed to a worker thread so the event
    loop is never blocked by network I/O.
    """

    backend = "s3"

    def __init__(
        self,
        *,
        bucket: str,
        endpoint_url: str | None,
        region: str | None,
        access_key: str | None,
        secret_key: str | None,
    ) -> None:
        try:
            import boto3
        except ImportError as exc:  # pragma: no cover - import guard
            raise StorageError(
                "STORAGE_BACKEND=s3 requires boto3; run 'uv sync --extra s3'"
            ) from exc
        if not bucket:
            raise StorageError("STORAGE_BACKEND=s3 requires RUBBISH_S3_BUCKET")
        self._bucket = bucket
        self._client: Any = boto3.client(
            "s3",
            endpoint_url=endpoint_url or None,
            region_name=region or None,
            aws_access_key_id=access_key or None,
            aws_secret_access_key=secret_key or None,
        )

    async def _run(self, fn: Any, *args: Any, **kwargs: Any) -> Any:
        import anyio

        return await anyio.to_thread.run_sync(lambda: fn(*args, **kwargs))

    async def save(self, key: str, data: bytes, *, content_type: str | None = None) -> None:
        _validate_key(key)
        extra: dict[str, Any] = {}
        if content_type:
            extra["ContentType"] = content_type
        await self._run(self._client.put_object, Bucket=self._bucket, Key=key, Body=data, **extra)

    async def load(self, key: str) -> bytes:
        _validate_key(key)
        try:
            obj = await self._run(self._client.get_object, Bucket=self._bucket, Key=key)
        except Exception as exc:
            if _is_not_found(exc):
                raise FileNotFoundError(key) from exc
            raise StorageError(f"S3 get_object failed for {key}") from exc
        return bytes(obj["Body"].read())

    async def delete(self, key: str) -> None:
        _validate_key(key)
        await self._run(self._client.delete_object, Bucket=self._bucket, Key=key)

    async def exists(self, key: str) -> bool:
        _validate_key(key)
        try:
            await self._run(self._client.head_object, Bucket=self._bucket, Key=key)
        except Exception as exc:
            if _is_not_found(exc):
                return False
            raise StorageError(f"S3 head_object failed for {key}") from exc
        return True

    def presigned_url(self, key: str, *, expires_in: int = 300) -> str | None:
        _validate_key(key)
        try:
            return str(
                self._client.generate_presigned_url(
                    "get_object",
                    Params={"Bucket": self._bucket, "Key": key},
                    ExpiresIn=expires_in,
                )
            )
        except Exception:
            logger.warning("presigned_url failed for %s; will stream instead", key, exc_info=True)
            return None


def _is_not_found(exc: Exception) -> bool:
    """Detect 404/NoSuchKey across botocore error shapes."""
    response = getattr(exc, "response", None)
    if isinstance(response, dict):
        code = str(response.get("Error", {}).get("Code", ""))
        status_code = response.get("ResponseMetadata", {}).get("HTTPStatusCode")
        if code in {"404", "NoSuchKey", "NotFound"} or status_code == 404:
            return True
    return exc.__class__.__name__ in {"NoSuchKey", "404"}


@lru_cache(maxsize=1)
def get_storage() -> Storage:
    """Return the configured storage backend (cached per process)."""
    settings = get_settings()
    if settings.storage_backend == "s3":
        return S3Storage(
            bucket=settings.s3_bucket,
            endpoint_url=settings.s3_endpoint_url,
            region=settings.s3_region,
            access_key=settings.s3_access_key_id,
            secret_key=settings.s3_secret_access_key,
        )
    return LocalStorage(settings.storage_path)


def reset_storage_cache() -> None:
    """Test hook: drop the cached backend so settings changes take effect."""
    get_storage.cache_clear()
