"""Pydantic schemas for the library module.

Two response shapes:

- ``ReadingListResponse`` — list view, includes ``item_count`` (computed
  from ``items``, which is excluded from the JSON output).
- ``ReadingListDetailResponse`` — detail view, includes full ``items``
  with each item's ``resource`` reference (ResourceRef).
"""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, computed_field

from app.core.schemas import MessageResponse, PaginationMeta

Visibility = Literal["public", "private"]


class ReadingListBase(BaseModel):
    """Shared fields for create / update."""

    name: str = Field(min_length=1, max_length=100)
    description: str | None = Field(default=None, max_length=2000)


class ReadingListCreate(ReadingListBase):
    """Body for POST /reading-lists."""

    # 缺省 private；显式传 public 才对其他读者可读。
    visibility: Visibility | None = None


class ReadingListUpdate(BaseModel):
    """Body for PATCH /reading-lists/{id}. All fields optional."""

    name: str | None = Field(default=None, min_length=1, max_length=100)
    description: str | None = Field(default=None, max_length=2000)
    visibility: Visibility | None = None


class ReadingListItemCreate(BaseModel):
    """Body for POST /reading-lists/{id}/items."""

    resource_id: int


class ResourceRef(BaseModel):
    """Minimal resource reference for item responses.

    Full resource fields belong to the catalog module; here we only
    expose what a list view needs to render a row.
    """

    model_config = ConfigDict(from_attributes=True)

    id: int
    title: str
    type: str
    authors: list[str]
    year: int


class ReadingListItemResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    resource_id: int
    added_at: datetime
    resource: ResourceRef


class ReadingListResponse(BaseModel):
    """List view — without full items, with count and public preview."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    description: str | None
    visibility: Visibility = "private"
    # Loaded to compute item_count but excluded from the JSON output.
    items: list[ReadingListItemResponse] = Field(exclude=True, default_factory=list)
    # 公开索引页需要知道“是谁整理的”；旧客户端不依赖这两个字段。
    owner_username: str | None = None
    owner_display_name: str | None = None
    created_at: datetime
    updated_at: datetime

    @computed_field  # type: ignore[prop-decorator]
    @property
    def item_count(self) -> int:
        return len(self.items)

    @computed_field  # type: ignore[prop-decorator]
    @property
    def preview_items(self) -> list[ResourceRef]:
        """Three public titles for the index card; never leak unpublished works."""
        return [ResourceRef.model_validate(item.resource) for item in self.items[:3]]


class ReadingListDetailResponse(BaseModel):
    """Detail view — with items."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    description: str | None
    visibility: Visibility = "private"
    items: list[ReadingListItemResponse]
    # 公开列表人人可读，但只有归属者能改名/增删条目。前端据此隐藏编辑控件；
    # 真正的写权限仍由后端 owner-only 查询强制。
    is_owner: bool = False
    owner_username: str | None = None
    owner_display_name: str | None = None
    created_at: datetime
    updated_at: datetime


class ReadingListListResponse(BaseModel):
    data: list[ReadingListResponse]
    meta: PaginationMeta


__all__ = [
    "MessageResponse",
    "ReadingListBase",
    "ReadingListCreate",
    "ReadingListDetailResponse",
    "ReadingListItemCreate",
    "ReadingListItemResponse",
    "ReadingListListResponse",
    "ReadingListResponse",
    "ReadingListUpdate",
    "ResourceRef",
]
