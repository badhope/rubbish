"""Generic media upload/read API for user-generated content.

Unlike the legacy ``/api/forum/images`` endpoint, this route is scoped by
purpose (``submission`` / ``forum`` / ``note``) so the same Markdown editor can be
used by authors and the community without lying about where the image
belongs. The URL is a random 128-bit name, so it is a capability URL;
the bytes are served with immutable cache headers.

Security assessment (capability URL, accepted design):
- 不可猜测：文件名是 ``uuid4().hex``（128 位随机），暴力枚举不可行。
- 无路径穿越：``IMAGE_NAME_RE`` 严格限定 ``^[0-9a-f]{32}\\.(png|jpg|gif|webp)$``，
  不含斜杠/多余点，读取时只拼固定 purpose 前缀。
- 内容核验：上传按 magic bytes 校验真实格式，仅允许图片 MIME，挡伪装上传。
- 公开读取是**有意为之**：文章/论坛正文要能直接嵌图，故 GET 不鉴权。
- 已接受的残余风险：能力 URL 不过期、持 URL 者即可读。这对「公开嵌图」
  是合适的；**不要**把私密/敏感文件走本端点——那需要带鉴权与短时效签名
  的独立下载通道，而非公开能力 URL。
"""

from __future__ import annotations

from uuid import uuid4

from fastapi import APIRouter, Depends, File, HTTPException, Query, Response, UploadFile, status

from app.api.deps import get_current_user
from app.core.images import (
    IMAGE_CACHE_HEADERS,
    IMAGE_MAX_BYTES,
    IMAGE_MIME_EXT,
    IMAGE_NAME_RE,
    image_magic_ok,
    image_mime_for_name,
)
from app.core.storage import get_storage
from app.models import User

router = APIRouter(prefix="/media", tags=["media"])


@router.post("/images", status_code=status.HTTP_201_CREATED)
async def upload_media_image(
    file: UploadFile = File(...),
    purpose: str = Query(default="submission", pattern=r"^(submission|forum|note|feedback)$"),
    _user: User = Depends(get_current_user),
) -> dict[str, str]:
    """Upload a PNG/JPEG/GIF/WebP and return a directly embeddable URL."""
    mime = (file.content_type or "").lower()
    ext = IMAGE_MIME_EXT.get(mime)
    if ext is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="只支持 PNG / JPEG / GIF / WebP 图片",
        )
    contents = await file.read()
    if not contents:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="图片为空")
    if len(contents) > IMAGE_MAX_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail="图片不能超过 5MB",
        )
    if not image_magic_ok(contents, mime):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="图片内容与格式不符",
        )
    name = f"{uuid4().hex}{ext}"
    await get_storage().save(f"media/{purpose}/{name}", contents, content_type=mime)
    return {"url": f"/api/media/images/{name}"}


@router.get("/images/{filename}")
async def get_media_image(filename: str) -> Response:
    """Read a public media image; the random filename is the capability."""
    if not IMAGE_NAME_RE.match(filename):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="图片不存在")
    # Search the purpose prefixes; the URL carries only the filename.
    for purpose in ("submission", "forum", "note", "feedback"):
        try:
            contents = await get_storage().load(f"media/{purpose}/{filename}")
        except FileNotFoundError:
            continue
        mime = image_mime_for_name(filename)
        return Response(content=contents, media_type=mime, headers=IMAGE_CACHE_HEADERS)
    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="图片不存在")
