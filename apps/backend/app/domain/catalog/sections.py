"""文章栏目定义（仅展示分组，不参与 paper/essay 判定）。"""

from typing import Any

SECTIONS: list[dict[str, Any]] = [
    {
        "slug": "this-week",
        "label": "本周",
        "description": "本周社论、世界观与方法亮点。",
        "parts": [
            {"slug": "editorial", "label": "社论"},
            {"slug": "world-view", "label": "世界观"},
            {"slug": "research-highlights", "label": "研究亮点"},
        ],
    },
    {
        "slug": "news-focus",
        "label": "新闻焦点",
        "description": "新闻与深度特写。",
        "parts": [
            {"slug": "news", "label": "新闻"},
            {"slug": "features", "label": "特写"},
        ],
    },
    {
        "slug": "books-arts",
        "label": "书与艺术",
        "description": "书评与艺术评论。",
        "parts": [
            {"slug": "book-review", "label": "书评"},
            {"slug": "arts-review", "label": "文艺评论"},
        ],
    },
    {
        "slug": "opinion",
        "label": "观点",
        "description": "评论与读者来信。",
        "parts": [
            {"slug": "comment", "label": "评论"},
            {"slug": "correspondence", "label": "读者来信"},
        ],
    },
    {
        "slug": "工作",
        "label": "工作",
        "description": "职业、技术与科研工作现场。",
        "parts": [
            {"slug": "work-feature", "label": "工作特写"},
            {"slug": "technology-feature", "label": "技术特写"},
        ],
    },
    {
        "slug": "research",
        "label": "研究",
        "description": "研究文章、综述与新闻评述。",
        "parts": [
            {"slug": "news-views", "label": "新闻与观点"},
            {"slug": "reviews", "label": "综述"},
            {"slug": "articles", "label": "研究文章"},
        ],
    },
    {
        "slug": "amendments",
        "label": "更正与撤稿",
        "description": "更正、撤稿与编辑部说明。",
        "parts": [
            {"slug": "amendments-corrections", "label": "更正与撤稿"},
        ],
    },
    {
        "slug": "collections",
        "label": "专题合集",
        "description": "专题合集与跨批聚合。",
        "parts": [{"slug": "collections", "label": "专题合集"}],
    },
]

SECTION_SLUGS = {p["slug"] for s in SECTIONS for p in s["parts"]}
SECTION_LABELS = {p["slug"]: p["label"] for s in SECTIONS for p in s["parts"]}
