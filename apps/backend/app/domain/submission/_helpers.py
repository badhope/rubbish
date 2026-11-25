"""Submission 模块共享辅助函数与常量（从 routes.py 拆出，供各路由文件复用）。

拆分说明：routes.py 曾是 52KB 单文件（作者侧 + 编辑侧 + 文件侧混在一起）。
现按工作流拆为 routes.py（作者侧）/ routes_editor.py（编辑与互评侧）/
routes_files.py（文件上传下载），本模块承载三者共享的纯辅助逻辑。
"""

from __future__ import annotations

import logging
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import search as fulltext
from app.core.config import get_settings
from app.core.tracks import canonicalize_track_category, normalize_track
from app.domain.catalog import cover_defaults
from app.domain.catalog.genre import classify_essay_genre
from app.domain.catalog.journal import sync_resource_issue
from app.domain.catalog.models import Resource as ResourceORM
from app.domain.submission.models import Submission, SubmissionVersion

logger = logging.getLogger(__name__)

__all__ = [
    "DEFAULT_PAGE_SIZE",
    "MAX_PAGE_SIZE",
    "_VERSIONED_FIELDS",
    "_materialize_resource_from_submission",
    "_snapshot_submission",
    "_try_delete_storage",
    "_version_payload",
]


async def _try_delete_storage(key: str | None) -> None:
    """Best-effort storage cleanup.

    A failed delete must never block the caller's primary operation
    (e.g. deleting a submission). Orphaned objects are rare — they only
    appear when the storage backend is momentarily unreachable — and the
    operator can spot the warning in the logs.
    """
    if not key:
        return
    from app.core.storage import get_storage

    try:
        await get_storage().delete(key)
    except Exception:
        logger.warning("storage_delete_failed", extra={"key": key}, exc_info=True)


DEFAULT_PAGE_SIZE = 20
MAX_PAGE_SIZE = 100


async def _materialize_resource_from_submission(
    db: AsyncSession, submission: Submission, *, publication_status: str = "published"
) -> ResourceORM:
    """Create a catalog Resource from a submission payload.

    Calls the same shape the catalog admin POST endpoint expects, so the
    conversion logic (preview truncation, defaults, etc.) stays where
    Resource creation belongs. We construct the ORM Resource directly
    rather than re-routing through the HTTP layer to keep it
    transactional with the review commit.

    ``publication_status`` 支持通过即公开（默认 published，兼容旧行为）或
    暂存草稿（draft）——后者进入发布前整理阶段，由 admin 发布。
    """
    # 本地作品文件：不再使用 /uploads 静态路径（该挂载无鉴权，任何人都能
    # 下载在审作品，见 app/main.py 的说明）。改为物化后在下方写入指向
    # 公开端点 /api/catalog/{id}/file 的 download_url——只有进入公开目录的
    # 资源才能读到文件，未公开的发布仍然只走鉴权端点。
    settings = get_settings()
    resource = ResourceORM(
        tenant_id=submission.tenant_id,
        publication_status=publication_status,
        # 新通过文章进入当前卷、期；合集只做文章归档，不表示身份等级。
        volume=settings.current_volume,
        issue=settings.current_issue,
        type=submission.type,
        title=submission.title,
        # 发布即绑定作者（P0）：owner_id = 作者。已绑定的文章不再可被他人
        # 认领（POST claim 返回 403）；历史批量导入稿 owner_id 为 NULL 才可走认领。
        owner_id=submission.submitted_by,
        # 赛道随物化带过去。目录的公开面按 track 分组，丢失这一列等于
        # 让读者无法区分"这是真研究"与"这是荒诞研究"——本站的立身之本。
        track=normalize_track(getattr(submission, "track", None)),
        authors=submission.authors,
        year=submission.year,
        venue=submission.venue,
        discipline=submission.discipline,
        subdiscipline=submission.subdiscipline,
        article_section=getattr(submission, "article_section", None),
        issue_part=getattr(submission, "issue_part", None),
        tags=submission.tags,
        abstract=submission.abstract,
        preview=submission.preview,
        # download_url 在 flush 拿到 id 后回填（见下方），此处先留空。
        download_url=submission.download_url,
        external_url=submission.external_url,
        doi=submission.doi,
        # P3-1：声明与许可跟随物化，前台不再把全站许可硬编码到每一篇。
        license=getattr(submission, "license", None),
        author_contributions=getattr(submission, "author_contributions", None),
        funding=getattr(submission, "funding", None),
        coi_statement=getattr(submission, "coi_statement", None),
        data_availability=getattr(submission, "data_availability", None),
        # 物化时把 submission 的 keywords 带过去，与 catalog.Resource 对齐。
        # jel_codes 不在此物化——catalog.Resource 没有该列（功能未落地），
        # 此处不声称不存在的字段对齐。
        keywords=submission.keywords or None,
        # 中图分类号（P0）：随作品一并带到目录。
        clc_code=getattr(submission, "clc_code", None),
        clc_label=getattr(submission, "clc_label", None),
        # 封面随物化带到目录；空则按学科回填默认封面——「已发布必有封面」
        # 是 v1.11 生态规范的硬约束，无封面的内容不允许以裸态上线。
        cover_image=submission.cover_image
        or cover_defaults.default_cover_for(
            submission.discipline,
            seed=sum(ord(c) for c in (submission.title or "x")),
        ),
    )
    # 内容赛道（唯一权威）：以 submission.content_track 为准（缺省 paper），
    # content_category 由 track 推导——paper→academic，essay→fun。
    # submissions 表无 content_category 列；编辑部要 rant 可在目录后台改口。
    resource.content_track, resource.content_category = canonicalize_track_category(
        getattr(submission, "content_track", None), None
    )
    if resource.content_track == "essay":
        resource.content_genre = classify_essay_genre(
            submission.title, category=resource.content_category
        )
    db.add(resource)
    await db.flush()
    await sync_resource_issue(db, resource)
    if not resource.download_url and submission.file_path:
        # 作品带着本地上传文件时，暴露一个"只读已发表资源"的公开端点，
        # 而不是把 storage 目录整个挂出去。阅读器（pdf.js）与详情页都走它。
        resource.download_url = f"/api/catalog/{resource.id}/file"
    # 同步全文索引（best-effort）。即使后续事务回滚产生幽灵文档也无害：
    # 搜索路由按 id 回读 DB，查不到的命中会被静默丢弃。
    await fulltext.index_resource(resource)
    return resource


# 参与版本快照的书目字段。故意不含 status / editor_note / resource_id ——
# 那些是工作流状态而非「作者写了什么」，把它们塞进快照会让 diff 充满
# 与作品内容无关的噪音。
_VERSIONED_FIELDS = (
    "title",
    "type",
    # 赛道进快照：作者从荒诞改成正经（或反之）是一次实质的内容变更，
    # 版本 diff 必须能看出来，否则「我投的时候明明是正经的」无法追溯。
    "track",
    "authors",
    "year",
    "venue",
    "discipline",
    "subdiscipline",
    # 分区/分部也是作者可改的实质元数据：版本回滚时必须一起恢复，
    # 否则会出现“回滚了正文但分区仍留在新版本”的静默错位。
    "article_section",
    "issue_part",
    "keywords",
    "jel_codes",
    "tags",
    "abstract",
    "preview",
    "download_url",
    "external_url",
    "doi",
    "corresponding_author_email",
    "license",
    "author_contributions",
    "funding",
    "coi_statement",
    "data_availability",
)


def _version_payload(entry: Submission) -> dict[str, Any]:
    """Extract the versioned bibliographic payload from a submission.

    除原始列值外，额外写入一份规范化题录 ``manuscript_meta``：作者上标/通讯
    标记、单位序号、主副标题都在这里固定下来，后续导出或重排无需再从自由
    文本里猜。它是派生数据，不回写数据库列，不改变既有版本的兼容性。
    """
    payload = {field: getattr(entry, field) for field in _VERSIONED_FIELDS}
    try:
        from app.domain.submission.manuscript_meta import build_manuscript_meta

        payload["manuscript_meta"] = build_manuscript_meta(
            title=entry.title,
            authors=entry.authors,
            affiliations=entry.author_affiliations,
            abstract=entry.abstract or "",
            keywords=entry.keywords,
            doi=entry.doi,
            funding=entry.funding,
            clc=entry.clc_code,
            license=entry.license,
            track=entry.track,
        )
    except Exception:  # 快照绝不能因派生元信息失败而中断
        pass
    return payload


async def _snapshot_submission(
    db: AsyncSession,
    entry: Submission,
    *,
    created_by: int | None,
    note: str | None = None,
) -> SubmissionVersion:
    """Append an immutable snapshot of ``entry`` to its version history.

    版本号取「当前最大版本 + 1」。并发重投理论上可能撞号，此时
    (submission_id, version) 唯一约束会抛 IntegrityError —— 交给调用方
    转成 409，比静默写重号安全。

    调用方负责 commit：快照必须与触发它的状态变更在同一事务里，
    否则可能出现「状态变了但没留版本」的空洞。
    """
    current_max = (
        await db.execute(
            select(func.max(SubmissionVersion.version)).where(
                SubmissionVersion.submission_id == entry.id
            )
        )
    ).scalar()
    # 尽力抓取 Markdown 正文，供服务端版本 diff 使用；读取失败/无正文
    # 不能阻断快照本身（版本记录仍以题录 payload 为准）。
    body_text: str | None = None
    markdown_path = getattr(entry, "markdown_path", None)
    if markdown_path:
        try:
            from app.core.storage import get_storage

            raw = await get_storage().load(markdown_path)
            body_text = raw.decode("utf-8", errors="replace")[:2_000_000]
        except Exception:
            body_text = None
    snapshot = SubmissionVersion(
        tenant_id=entry.tenant_id,
        submission_id=entry.id,
        version=(current_max or 0) + 1,
        payload=_version_payload(entry),
        file_path=entry.file_path,
        file_scan_status=getattr(entry, "file_scan_status", None),
        file_scan_engine=getattr(entry, "file_scan_engine", None),
        file_scan_signature=getattr(entry, "file_scan_signature", None),
        file_scan_at=getattr(entry, "file_scan_at", None),
        file_sha256=getattr(entry, "file_sha256", None),
        file_scan_attempts=getattr(entry, "file_scan_attempts", 0) or 0,
        body=body_text,
        note=note,
        created_by=created_by,
    )
    db.add(snapshot)
    return snapshot
