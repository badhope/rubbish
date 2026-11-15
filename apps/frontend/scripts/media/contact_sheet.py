"""把界面截图拼成一张暗黑品牌风总览图（README / 宣传物料用）。

深空底 + 靛蓝紫品牌色，顶部带数据条，4 列网格、每格带标题条与细边框，
桌面端 + 移动端混排。输出到仓库 docs/assets/screenshots-overview.png。

用法：python3 scripts/media/contact_sheet.py
"""

from __future__ import annotations

import os
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

SRC = Path("/workspace/rubbish/docs/assets/screenshots")
OUT = Path("/workspace/rubbish/docs/assets/screenshots-overview.png")

ITEMS = [
    ("01-home.png", "概览 Overview"),
    ("02-catalog.png", "资源目录 Catalog"),
    ("03-resource-detail.png", "资源详情 Detail"),
    ("04-dashboard.png", "个人面板 Dashboard"),
    ("05-editor-workbench.png", "编辑工作台 Editor"),
    ("06-reviewer-workbench.png", "审稿工作台 Reviewer"),
    ("07-my-submissions.png", "我的提交 Submissions"),
    ("08-admin-users.png", "用户管理 Users"),
    ("09-admin-audit.png", "审计日志 Audit"),
    ("10-ingest.png", "元数据导入 Ingest"),
    ("11-recommendations.png", "个性化推荐 Recommend"),
    ("12-library.png", "阅读列表 Library"),
    ("13-notifications.png", "通知中心 Notifications"),
    ("14-admin-journal.png", "期刊设置 Journal"),
    ("15-account-security.png", "账号安全 Security"),
    ("16-follows.png", "关注与订阅 Follows"),
    ("17-reader.png", "在线阅读器 Reader"),
    ("mobile-catalog.png", "移动端 · 目录 Mobile"),
    ("mobile-detail.png", "移动端 · 详情 Mobile"),
]

COLS = 4
CELL_W = 470
CAP_H = 40
THUMB_H = CELL_W * 900 // 1440  # 桌面截图 1440×900 等比
PAD = 18
HEADER_H = 150
BORDER = 2

# 暗黑品牌配色
BG = (11, 16, 32)          # 深空底 #0B1020
CARD = (17, 24, 46)        # 卡片底
FRAME = (49, 46, 129)      # 靛蓝紫边框 #312E81
CAP_BG = (30, 27, 75)      # 标题条 #1E1B4B
CAP_BG2 = (49, 46, 129)
INK = (241, 245, 249)      # 近白
MUTED = (148, 163, 184)    # 石板灰
ACCENT = (129, 140, 248)   # indigo-400
ACCENT2 = (45, 212, 191)   # teal-400

FONT_REG = "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc"
FONT_BOLD = "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc"


def font(path: str, size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(path, size)


def _round_rect(draw, box, radius, fill=None, outline=None, width=1):
    draw.rounded_rectangle(box, radius=radius, fill=fill, outline=outline, width=width)


def main() -> None:
    present = [(f, label) for f, label in ITEMS if (SRC / f).exists()]
    rows = (len(present) + COLS - 1) // COLS
    W = COLS * (CELL_W + PAD) + PAD
    H = HEADER_H + PAD + rows * (THUMB_H + CAP_H + PAD) + PAD

    canvas = Image.new("RGB", (W, H), BG)
    draw = ImageDraw.Draw(canvas)

    # ---- 顶部品牌带 ----
    draw.rectangle([0, 0, W, HEADER_H], fill=CARD)
    draw.line([0, HEADER_H - 1, W, HEADER_H - 1], fill=FRAME, width=2)
    # 品牌色竖条
    draw.rectangle([PAD, 34, PAD + 6, 96], fill=ACCENT)

    draw.text((PAD + 22, 30), "Rubbish · 界面总览", font=font(FONT_BOLD, 36), fill=INK)
    draw.text(
        (PAD + 22, 84),
        "投稿 · 审稿 · 发表 · 阅读 全流程 · 桌面 1440×900 · 移动端 390×844",
        font=font(FONT_REG, 17),
        fill=MUTED,
    )

    # ---- 右侧数据条 ----
    stats = [("11", "模块"), ("644", "测试"), ("84%", "覆盖率"), ("68", "E2E")]
    sx = W - PAD - (4 * 150)
    for i, (big, small) in enumerate(stats):
        x = sx + i * 150
        _round_rect(draw, [x, 36, x + 138, 104], radius=14, fill=CAP_BG, outline=FRAME, width=1)
        draw.text((x + 16, 46), big, font=font(FONT_BOLD, 30), fill=ACCENT2)
        draw.text((x + 16, 86), small, font=font(FONT_REG, 15), fill=MUTED)

    cap_font = font(FONT_BOLD, 16)
    for i, (fname, label) in enumerate(present):
        src = Image.open(SRC / fname).convert("RGB")
        sw, sh = src.size
        inner_w = CELL_W - BORDER * 2
        inner_h = THUMB_H - BORDER * 2

        if fname.startswith("mobile"):
            scale = min(inner_w / sw, inner_h / sh)
            nw, nh = max(1, int(sw * scale)), max(1, int(sh * scale))
            thumb = src.resize((nw, nh), Image.LANCZOS)
            tile = Image.new("RGB", (inner_w, inner_h), (255, 255, 255))
            tile.paste(thumb, ((inner_w - nw) // 2, (inner_h - nh) // 2))
        else:
            tile = src.resize((inner_w, inner_h), Image.LANCZOS)

        cell = Image.new("RGB", (CELL_W, THUMB_H + CAP_H), FRAME)
        cell.paste(tile, (BORDER, BORDER))
        cd = ImageDraw.Draw(cell)
        cd.rectangle([0, THUMB_H, CELL_W, THUMB_H + CAP_H], fill=CAP_BG)
        # 标题条左侧强调点
        cd.rectangle([14, THUMB_H + 13, 22, THUMB_H + 27], fill=ACCENT)
        cd.text((30, THUMB_H + 11), label, font=cap_font, fill=INK)

        col, row = i % COLS, i // COLS
        x = PAD + col * (CELL_W + PAD)
        y = HEADER_H + PAD + row * (THUMB_H + CAP_H + PAD)
        canvas.paste(cell, (x, y))

    # ---- 末行空格填一张品牌 CTA 卡 ----
    total_cells = rows * COLS
    if len(present) < total_cells:
        i = len(present)
        col, row = i % COLS, i // COLS
        x = PAD + col * (CELL_W + PAD)
        y = HEADER_H + PAD + row * (THUMB_H + CAP_H + PAD)
        _round_rect(
            draw,
            [x, y, x + CELL_W, y + THUMB_H + CAP_H],
            radius=16,
            fill=CAP_BG,
            outline=FRAME,
            width=2,
        )
        tx = x + 26
        draw.text((tx, y + 40), "Stop rebuilding", font=font(FONT_BOLD, 28), fill=INK)
        draw.text((tx, y + 78), "the journal", font=font(FONT_BOLD, 28), fill=INK)
        draw.text((tx, y + 116), "from scratch.", font=font(FONT_BOLD, 28), fill=ACCENT2)
        draw.text(
            (tx, y + 174),
            "One codebase · full loop",
            font=font(FONT_REG, 16),
            fill=MUTED,
        )
        draw.text(
            (tx, y + 200),
            "submit → review → publish → read",
            font=font(FONT_REG, 16),
            fill=MUTED,
        )
        # 底部品牌条
        draw.text(
            (tx, y + THUMB_H + CAP_H - 44),
            "github.com/x33834/rubbish",
            font=font(FONT_REG, 15),
            fill=ACCENT,
        )

    OUT.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(OUT, optimize=True)
    size_kb = os.path.getsize(OUT) // 1024
    print(f"总览图: {OUT}  {W}x{H}  {len(present)} 张  {size_kb} KB")


if __name__ == "__main__":
    main()
