"""轻量内容风控：可解释的关键词/正则扫描。

定位：先挡「高置信度垃圾广告、引流、辱骂」，不假装是 AI 内容审核。
规则保守，宁可漏过让后台举报补位，也不把正常学术讨论（例如讨论“代写
现象”）误杀。需要扩展时用环境变量 ``RUBBISH_MODERATION_BLOCKLIST``
追加逗号分隔的词，重启生效。
"""

from __future__ import annotations

import os
import re
import unicodedata
from dataclasses import dataclass, field

# 高置信度引流/诈骗：命中即拦。避免单字“微信”“QQ”误伤正常讨论，
# 必须和“加/扫/群/私聊”等动作词同现。
_PATTERNS: tuple[tuple[str, str, re.Pattern[str]], ...] = (
    (
        "广告引流",
        "疑似广告引流：请去掉加微信/扫码进群/私聊等联系方式",
        re.compile(
            r"(?:加|扫|搜|私聊|私信|联系)\s*(?:微信|wechat|vx|v信|薇信|qq|群|飞机|telegram)"
            r"|(?:扫码|长按二维码)\s*(?:进群|加群|咨询|领取)"
            r"|(?:刷单|返利|博彩|网赌|赌球|六合彩|贷款秒批|代开发票|办证|内部渠道|稳赚不赔)",
            re.IGNORECASE,
        ),
    ),
    (
        "辱骂攻击",
        "内容包含人身攻击或侮辱性表达，请改为就事论事",
        re.compile(r"傻逼|脑残|去死|畜生|贱人|废物东西", re.IGNORECASE),
    ),
)


@dataclass(frozen=True)
class ModerationHit:
    category: str
    message: str
    term: str


def _normalize(text: str) -> str:
    # NFKC 折叠全角/兼容字符；去掉零宽字符，防止“微​信”拆字绕过。
    normalized = unicodedata.normalize("NFKC", text or "").lower()
    normalized = re.sub(r"[\u200b-\u200f\u2060\ufeff]", "", normalized)
    return normalized


def _extra_terms() -> list[str]:
    raw = os.getenv("RUBBISH_MODERATION_BLOCKLIST", "")
    return [term.strip() for term in raw.split(",") if term.strip()]


def scan_text(text: str, *, max_hits: int = 3) -> list[ModerationHit]:
    """返回命中项；空列表表示通过。只做确定性规则，不调用外部服务。"""
    normalized = _normalize(text)
    hits: list[ModerationHit] = []
    for category, message, pattern in _PATTERNS:
        match = pattern.search(normalized)
        if match:
            hits.append(ModerationHit(category=category, message=message, term=match.group(0)[:40]))
        if len(hits) >= max_hits:
            break
    for term in _extra_terms():
        if term.lower() in normalized:
            hits.append(
                ModerationHit(
                    category="站规词",
                    message="内容包含站点禁止的词，请修改后再提交",
                    term=term[:40],
                )
            )
        if len(hits) >= max_hits:
            break
    return hits


def rejection_detail(text: str) -> dict[str, object] | None:
    """路由层统一返回体：命中时给 code + 可读原因，不把原文回显给用户。"""
    hits = scan_text(text)
    if not hits:
        return None
    return {
        "code": "content_blocked",
        "message": hits[0].message,
        "categories": sorted({hit.category for hit in hits}),
    }


__all__ = ["ModerationHit", "rejection_detail", "scan_text"]


# ---------------------------------------------------------------------------
# 半自动化审核：确定性规则 + 人工兜底
#
# 这里只做“可解释的信号”，不假装是内容理解模型。硬命中继续由
# rejection_detail 直接拦；软信号累计成风险分，达到阈值就进入人工队列。
# 运营可以在后台调整阈值与权重，但规则本身仍由代码与配置共同约束。
# ---------------------------------------------------------------------------

SOFT_PATTERNS: tuple[tuple[str, str, str, int], ...] = (
    (
        "contact",
        "疑似联系方式",
        "正文包含邮箱、手机号、微信/QQ 等站外联系方式，需要运营确认是否适合公开。",
        32,
    ),
    (
        "external_link",
        "站外链接",
        "正文包含站外链接；社区允许引用，但集中出现时需要人工确认来源与安全性。",
        14,
    ),
    (
        "low_effort",
        "信息量偏低",
        "正文较短且没有图片/链接，可能缺少可讨论的上下文。",
        22,
    ),
    (
        "shouting",
        "格式异常",
        "正文大写字母或重复标点比例过高，可能影响阅读。",
        10,
    ),
)

_CONTACT_RE = re.compile(
    r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}"
    r"|(?<!\d)1[3-9]\d{9}(?!\d)"
    r"|(?:微信|wechat|vx|v信|qq|扣扣)\s*[:：]?\s*[A-Za-z0-9_-]{5,20}",
    re.IGNORECASE,
)
_URL_RE = re.compile(r"https?://[^\s<>()]+", re.IGNORECASE)


@dataclass(frozen=True)
class ModerationSignal:
    code: str
    label: str
    detail: str
    weight: int


@dataclass(frozen=True)
class ModerationAssessment:
    action: str  # auto_approved | manual_review | blocked
    risk_score: int
    signals: list[ModerationSignal] = field(default_factory=list)
    reason: str = ""
    eta_minutes: int = 0


def _review_terms() -> list[str]:
    raw = os.getenv("RUBBISH_MODERATION_REVIEW_TERMS", "")
    return [term.strip() for term in raw.split(",") if term.strip()]


def assess_text(
    title: str,
    body: str,
    *,
    manual_threshold: int = 40,
    auto_publish_enabled: bool = True,
    sla_minutes: int = 30,
    weights: dict[str, int] | None = None,
) -> ModerationAssessment:
    """返回可解释的审核结论。

    硬命中（广告/辱骂）直接 blocked；其余软信号累计风险分。
    ``weights`` 允许后台覆盖单项权重，未知 key 忽略。
    """
    text = f"{title}\n{body}"
    hard_hits = scan_text(text)
    if hard_hits:
        return ModerationAssessment(
            action="blocked",
            risk_score=100,
            signals=[
                ModerationSignal(
                    code=f"hard_{hit.category}",
                    label=hit.category,
                    detail=hit.message,
                    weight=100,
                )
                for hit in hard_hits
            ],
            reason=hard_hits[0].message,
        )

    if not auto_publish_enabled:
        return ModerationAssessment(
            action="manual_review",
            risk_score=50,
            signals=[
                ModerationSignal(
                    code="auto_publish_off",
                    label="自动发布已关闭",
                    detail="运营当前要求所有新主题帖先进入人工核验。",
                    weight=50,
                )
            ],
            reason="自动发布已关闭，全部新主题帖进入人工核验。",
            eta_minutes=sla_minutes,
        )

    normalized = _normalize(body)
    signals: list[ModerationSignal] = []
    overrides = weights or {}

    def add(code: str, label: str, detail: str, default_weight: int) -> None:
        weight = int(overrides.get(code, default_weight))
        if weight <= 0:
            return
        signals.append(ModerationSignal(code=code, label=label, detail=detail, weight=weight))

    contact_matches = _CONTACT_RE.findall(text)
    if contact_matches:
        add(
            "contact",
            "疑似联系方式",
            "正文包含邮箱、手机号、微信/QQ 等站外联系方式，需要运营确认是否适合公开。",
            32,
        )

    link_count = len(_URL_RE.findall(text))
    if link_count:
        add(
            "external_link",
            "站外链接",
            f"正文包含 {link_count} 个站外链接；社区允许引用，但集中出现时需要人工确认来源与安全性。",
            14 + max(0, link_count - 1) * 4,
        )

    plain_len = len(re.sub(r"!\[[^\]]*\]\([^)]*\)|\s+", "", body))
    if plain_len < 40 and "![" not in body and "http" not in body:
        add(
            "low_effort",
            "信息量偏低",
            "正文较短且没有图片/链接，可能缺少可讨论的上下文。",
            22,
        )

    letters = [c for c in body if c.isalpha()]
    if len(letters) >= 24 and sum(c.isupper() for c in letters) / len(letters) > 0.55:
        add(
            "shouting",
            "格式异常",
            "正文大写字母比例过高，可能影响阅读。",
            10,
        )

    for term in _review_terms():
        if term.lower() in normalized:
            add(
                "review_term",
                "运营关注词",
                f"命中运营配置的关注词「{term[:24]}」。",
                24,
            )

    score = min(100, sum(item.weight for item in signals))
    if score >= max(1, int(manual_threshold)):
        reason = "、".join(item.label for item in signals) or "规则命中"
        return ModerationAssessment(
            action="manual_review",
            risk_score=score,
            signals=signals,
            reason=f"命中{reason}，进入人工核验。",
            eta_minutes=sla_minutes,
        )
    return ModerationAssessment(
        action="auto_approved",
        risk_score=score,
        signals=signals,
        reason="规则自动通过。",
    )


__all__ = [
    "SOFT_PATTERNS",
    "ModerationAssessment",
    "ModerationHit",
    "ModerationSignal",
    "assess_text",
    "rejection_detail",
    "scan_text",
]
