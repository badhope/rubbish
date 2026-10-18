"""Review blinding policy — single-blind (default) or double-blind.

Terminology (COPE / ICMJE 通行定义):

- **single-blind**（默认）：审稿人知道作者是谁，作者不知道审稿人是谁。
- **double-blind**：双方互不知情——审稿人也看不到作者姓名、单位、
  通讯邮箱等可识别信息。

作者侧的剥离（作者看不到审稿人身份）在两种模式下都生效，本模块只
额外处理 double-blind 特有的「审稿人侧剥离」。

模式存放在 ``Tenant.settings["review_mode"]``，无需 schema 迁移；
未设置时按 single-blind 处理（向后兼容既有部署）。
"""

from __future__ import annotations

from typing import Any, Literal, cast
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Tenant

ReviewMode = Literal["single_blind", "double_blind"]

DEFAULT_REVIEW_MODE: ReviewMode = "single_blind"
VALID_REVIEW_MODES: frozenset[str] = frozenset({"single_blind", "double_blind"})

# 双盲下对审稿人隐藏的占位文案。用可读占位而不是 None，让审稿人
# 明确知道「这里被刻意隐藏了」，而不是误以为作者没填。
ANONYMIZED_AUTHOR = "[双盲评审：作者信息已隐藏]"


async def get_review_mode(db: AsyncSession, tenant_id: UUID) -> ReviewMode:
    """Read the tenant's review mode; falls back to single-blind."""
    settings_blob = (
        await db.execute(select(Tenant.settings).where(Tenant.id == tenant_id))
    ).scalar_one_or_none()
    if not isinstance(settings_blob, dict):
        return DEFAULT_REVIEW_MODE
    mode = settings_blob.get("review_mode")
    if mode in VALID_REVIEW_MODES:
        return cast(ReviewMode, mode)
    return DEFAULT_REVIEW_MODE


async def set_review_mode(db: AsyncSession, tenant_id: UUID, mode: ReviewMode) -> None:
    """Persist the tenant's review mode (merged into the settings blob)."""
    if mode not in VALID_REVIEW_MODES:
        raise ValueError(f"Invalid review mode: {mode}")
    tenant = (await db.execute(select(Tenant).where(Tenant.id == tenant_id))).scalar_one_or_none()
    if tenant is None:
        raise LookupError("Tenant not found")
    # JSON 列必须整体替换，原地改 dict 不会被 SQLAlchemy 识别为脏数据。
    merged: dict[str, Any] = dict(tenant.settings or {})
    merged["review_mode"] = mode
    tenant.settings = merged


def anonymize_submission_fields(payload: dict[str, Any]) -> dict[str, Any]:
    """Strip author-identifying fields from a submission payload.

    Applied to the reviewer-facing view under double-blind. Returns a new
    dict; the caller's data is not mutated.

    隐藏项与其理由：
    - ``authors``：最直接的身份信息
    - ``corresponding_author_email``：邮箱域名常能反推单位
    - ``submitted_by``：用户 id 可反查用户资料
    - ``venue``：投稿阶段的 venue 常是作者所在机构的会议/刊物线索
    - ``doi``：预印本 DOI 一点即达作者页
    - ``download_url`` / ``external_url``：**作者可控**字段（创建端点与
      作者编辑端点均可写）。早期版本刻意保留它们，注释假设其为"编辑
      上传的匿名稿件链接"——与控制面（作者）不符，作者填一条带身份的
      链接即可直穿双盲。审稿人可见的匿名稿链接只经编辑端点写入的
      ``anonymized_file_url`` 流转，该字段原样保留。
    """
    scrubbed = dict(payload)
    scrubbed["authors"] = [ANONYMIZED_AUTHOR]
    scrubbed["corresponding_author_email"] = None
    scrubbed["submitted_by"] = None
    scrubbed["venue"] = None
    scrubbed["doi"] = None
    scrubbed["download_url"] = None
    scrubbed["external_url"] = None
    return scrubbed
