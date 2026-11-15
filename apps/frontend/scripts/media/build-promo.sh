#!/usr/bin/env bash
# 把录屏 + 片头片尾合成宣传片（1920×1080 / VP9 / WebM）。
#
# 为什么是 VP9 WebM 而不是 H.264 MP4：
#   - 沙箱 ffmpeg 没有 libx264，libopenh264 对 UI 屏幕内容压缩效率差
#     （60s 要 13 MB）；libvpx-vp9 对大面积静止 + 局部变化的屏幕内容
#     压缩效率高一个量级（同观感约 3-4 MB），且所有现代浏览器可播。
#
# 输入：
#   /tmp/promo/intro.png          — 片头卡片（fade + 缩放）
#   raw/*.webm                    — Playwright 录制的使用流程（取最新一个）
#   /tmp/promo/outro.png          — 片尾卡片（仓库地址 + 指标）
# 输出：
#   /workspace/rubbish-media/Rubbish-promo.webm   宣传片（含片头尾）
#
# 说明：不再单独产出 walkthrough —— 它与宣传片中间段完全重复，
# 需要的话把 list.txt 里的 intro/outro 两行删掉重跑即可。
set -euo pipefail

MEDIA=/workspace/rubbish-media
RAW=$(ls -t "$MEDIA"/raw/*.webm | head -1)
TMP=$(mktemp -d)
echo "raw: $RAW"

# VP9 参数：good 档 + cpu-used 2 是速度/质量的平衡点；row-mt 多线程。
# crf 34 对 UI 文字足够干净；b:v 0 = 让 crf 全权决定码率。
VP9="-c:v libvpx-vp9 -deadline good -cpu-used 2 -row-mt 1 -b:v 0 -pix_fmt yuv420p"

# ---------------------------------------------------------------
# 1) 片头：4.2s，深色渐变卡 + 轻微放大
# ---------------------------------------------------------------
ffmpeg -v error -y -loop 1 -i /tmp/promo/intro.png -t 4.2 \
  -vf "scale=2112:1188,zoompan=z='min(zoom+0.0004,1.10)':d=105:s=1920x1080:fps=25,format=yuv420p" \
  $VP9 -crf 30 "$TMP/intro.webm"

# ---------------------------------------------------------------
# 2) 片尾：5.2s，指标 + 仓库地址
# ---------------------------------------------------------------
ffmpeg -v error -y -loop 1 -i /tmp/promo/outro.png -t 5.2 \
  -vf "scale=2112:1188,zoompan=z='min(zoom+0.0003,1.08)':d=130:s=1920x1080:fps=25,format=yuv420p" \
  $VP9 -crf 30 "$TMP/outro.webm"

# ---------------------------------------------------------------
# 3) 使用演示：烧录底部中文字幕 + 淡入淡出
# ---------------------------------------------------------------
cat > "$TMP/subs.ass" <<ASS
[Script Info]
ScriptType: v4.00+
PlayResX: 1920
PlayResY: 1080

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: CN,Noto Serif CJK SC,30,&H00FFFFFF,&H00FFFFFF,&H00202020,&H99000000,1,0,0,0,100,100,0,0,3,1,0,2,80,80,48,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:00.40,0:00:04.20,CN,,0,0,0,,资源目录 · 支持按学科、年份、类型筛选
Dialogue: 0,0:00:04.60,0:00:09.00,CN,,0,0,0,,全文检索：标题 / 作者 / 摘要
Dialogue: 0,0:00:09.60,0:00:14.00,CN,,0,0,0,,资源详情 · DOI · 卷期页码 · 参考文献
Dialogue: 0,0:00:14.40,0:00:17.60,CN,,0,0,0,,邮箱验证 + 强密码登录
Dialogue: 0,0:00:18.60,0:00:23.60,CN,,0,0,0,,编辑工作台 · 一键分配审稿人
Dialogue: 0,0:00:24.20,0:00:29.00,CN,,0,0,0,,审稿工作台 · 接受邀请 / 提交评审意见
Dialogue: 0,0:00:29.60,0:00:34.60,CN,,0,0,0,,个性化推荐 · 基于阅读历史的内容画像
Dialogue: 0,0:00:34.80,0:00:38.60,CN,,0,0,0,,阅读列表 · 私人收藏与阅读清单
Dialogue: 0,0:00:39.00,0:00:43.00,CN,,0,0,0,,通知中心 · 审稿与投稿状态实时提醒
Dialogue: 0,0:00:43.60,0:00:50.00,CN,,0,0,0,,在线阅读器 · 进度自动同步
ASS

ffmpeg -v error -y -i "$RAW" \
  -vf "subtitles='$TMP/subs.ass':fontsdir=/usr/share/fonts/opentype/noto,fade=t=in:st=0:d=0.6,fade=t=out:st=49.6:d=0.8,format=yuv420p" \
  $VP9 -crf 34 -r 25 "$TMP/walk.webm"

# ---------------------------------------------------------------
# 4) 拼接三段 → 宣传片（解码后统一编码一遍，保证参数一致）
# ---------------------------------------------------------------
: > "$TMP/list.txt"
for f in intro walk outro; do echo "file '$TMP/$f.webm'" >> "$TMP/list.txt"; done
ffmpeg -v error -y -f concat -safe 0 -i "$TMP/list.txt" \
  $VP9 -crf 34 -r 25 "$MEDIA/Rubbish-promo.webm"

echo
echo "== Rubbish-promo.webm"
ffprobe -v error -select_streams v:0 \
  -show_entries stream=codec_name,width,height,r_frame_rate \
  -show_entries format=duration,size -of default=nw=1 "$MEDIA/Rubbish-promo.webm"
rm -rf "$TMP"
