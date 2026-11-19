#!/usr/bin/env bash
# 内容快照导出（A 方案）：只导出「已发表的公开内容」，不碰用户/投稿/审计/未发表稿件。
# 产物可直接进公开仓库；含脱敏与断言拦截，命中邮箱或内部标识就整体失败，不产出半成品。
set -euo pipefail

OUT_ROOT="${OUT_ROOT:-/home/ubuntu/rubbish-export}"
LOG="${LOG:-/home/ubuntu/rubbish-export.log}"
DB_CONTAINER="${DB_CONTAINER:-rubbish-db-1}"
DB_USER="${DB_USER:-rubbish_legacy}"
DB_NAME="${DB_NAME:-rubbish}"
UPLOADS_VOLUME="${UPLOADS_VOLUME:-rubbish_uploads}"
STAMP="$(date +%Y%m%d-%H%M)"
OUT="$OUT_ROOT/$STAMP"
STAGE="/tmp/rubbish-export-stage"

note(){ printf '[%s] %s\n' "$(date -Is)" "$*" >> "$LOG"; }
die(){ note "FAIL $*"; echo "FAIL $*" >&2; exit 1; }

sudo -n rm -rf "$STAGE" 2>/dev/null || rm -rf "$STAGE"
mkdir -p "$STAGE/db" "$OUT/content"
note "start $OUT"

# ── 1) 白名单表数据：只取已发表内容与纯配置字典 ────────────────────────────────
# 排除字段：owner_id / tenant_id / download_url（含内部租户 UUID）、
#           hashed_password 等任何 users 相关列（整张 users 表不导）
docker exec "$DB_CONTAINER" rm -rf /tmp/export && docker exec "$DB_CONTAINER" mkdir -p /tmp/export

docker exec "$DB_CONTAINER" psql -q -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 \
  -c "\copy (
        select id, slug, title, type, track, content_track, content_category, content_genre,
               article_section, issue_part, year, venue, volume, issue, pages, issn, isbn,
               publisher, short_container_title, language, discipline, subdiscipline,
               clc_code, clc_label, doi, license, publication_status, publish_at,
               created_at, updated_at,
               authors::text   as authors_json,
               tags::text      as tags_json,
               keywords::text  as keywords_json,
               abstract,
               regexp_replace(preview, '([A-Za-z0-9._%+-])[A-Za-z0-9._%+-]*@([A-Za-z0-9.-]+)', '\1***@\2', 'g') as preview,
               download_count, quality_score, quality_grade, absurdity_index,
               cover_image, cover_theme, funding, author_contributions, coi_statement, data_availability
        from resources
        where publication_status = 'published'
        order by id
      ) to '/tmp/export/resources.csv' with csv header" \
  -c "\copy (select id, slug, name, description from disciplines order by id) to '/tmp/export/disciplines.csv' with csv header" \
  -c "\copy (select id, discipline_id, slug, name from subdisciplines order by id) to '/tmp/export/subdisciplines.csv' with csv header" \
  -c "\copy (select id, reason, label, amount, daily_cap, is_active from coin_rules order by id) to '/tmp/export/coin_rules.csv' with csv header" \
  -c "\copy (select id, name, description, price_coin, stock, is_active, sort_order, effect from coin_shop_items order by id) to '/tmp/export/coin_shop_items.csv' with csv header" \
  -c "\copy (select id, name, description from roles order by id) to '/tmp/export/roles.csv' with csv header" \
  -c "\copy (
        select r.track, r.slug, s.markdown_path, s.file_path
        from resources r
        join submissions s on s.resource_id = r.id
        where r.publication_status = 'published'
          and s.status = 'accepted'
          and s.markdown_path is not null
        order by r.id
      ) to '/tmp/export/mdlist.tsv' with (format text, delimiter E'\t')" \
  || die "psql 导出失败"

docker cp "$DB_CONTAINER":/tmp/export/. "$STAGE/db/" >/dev/null
docker exec "$DB_CONTAINER" rm -rf /tmp/export

# ── 2) 正文文件：只按“已发表记录”反向取文件，绝不整卷打包 ──────────────────────
# 整卷里有 batch*.tgz、md_live*.tgz、.bak-* 目录等内部工作副本，一律不碰。
docker run --rm --user "$(id -u):$(id -g)" -v "$UPLOADS_VOLUME":/data:ro -v "$STAGE":/stage alpine sh -c '
  ok=0; miss=0
  : > /stage/missing.tsv
  while IFS="	" read -r track slug path file; do
    [ -z "$path" ] && continue
    if [ -f "/data/$path" ]; then
      mkdir -p "/stage/content/$track"
      cp "/data/$path" "/stage/content/$track/$slug.md"
      ok=$((ok+1))
    else
      miss=$((miss+1))
      printf "%s\t%s\n" "$slug" "$path" >> /stage/missing.tsv
    fi
  done < /stage/db/mdlist.tsv
  printf "copied=%s missing=%s\n" "$ok" "$miss"
' | tee "$STAGE/copy-stat.txt"

# ── 3) 兜底脱敏：正文里夹带的邮箱也打码 ────────────────────────────────────────
find "$STAGE" -type f \( -name '*.csv' -o -name '*.md' \) -print0 \
  | xargs -0 -r sed -i -E 's/([A-Za-z0-9._%+-])[A-Za-z0-9._%+-]*@([A-Za-z0-9.-]+)/\1***@\2/g'

# ── 4) 落盘 ───────────────────────────────────────────────────────────────────
cp "$STAGE"/db/*.csv "$OUT"/
cp -r "$STAGE"/content/* "$OUT"/content/ 2>/dev/null || true
[ -s "$STAGE/missing.tsv" ] && cp "$STAGE/missing.tsv" "$OUT/missing-bodies.tsv"

# ── 5) 安全断言：命中即失败，不产出可误传的快照 ────────────────────────────────
grep -rIlE '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}' "$OUT" 2>/dev/null | grep -v missing-bodies.tsv > "$STAGE/email-hits.txt" || true
[ -s "$STAGE/email-hits.txt" ] && die "仍有邮箱: $(head -3 "$STAGE/email-hits.txt" | tr '\n' ' ')"
# 内部租户 UUID / 密码字段 / 用户表痕迹一律不允许出现
for bad in 'ba9a864d-d300-48eb-94da-38e82840aa47' 'hashed_password' 'totp_secret' 'webauthn_credentials' 'corresponding_author_email'; do
  grep -rIl "$bad" "$OUT" 2>/dev/null && die "命中敏感标记: $bad"
done

# ── 6) 清单与校验和 ───────────────────────────────────────────────────────────
nres=$(python3 -c 'import csv,sys;print(sum(1 for _ in csv.reader(open(sys.argv[1],newline="")))-1)' "$OUT/resources.csv")
nmd=$(find "$OUT/content" -name '*.md' | wc -l)
bytes=$(du -sb "$OUT" | cut -f1)

cat > "$OUT/README.md" <<EOF
# Rubbish 公开内容快照

导出时间：$(date -Is)
数据来源：https://rubbish.argjiemi.cn （生产库只读查询，未改动任何数据）

本目录**只包含已发表的公开内容**，与站点公开 API 所见一致：

| 文件 | 内容 |
|---|---|
| \`resources.csv\` | ${nres} 篇已发表论文/副刊的元数据（标题、作者、摘要、关键词、分类、卷期页、DOI、统计数） |
| \`content/<track>/<slug>.md\` | ${nmd} 篇正文 Markdown，路径与 \`resources.csv\` 的 \`slug\` 一一对应 |
| \`disciplines.csv\` \`subdisciplines.csv\` | 学科分类字典 |
| \`coin_rules.csv\` \`coin_shop_items.csv\` \`roles.csv\` | 积分规则、积分货架、角色定义等纯配置 |
| \`checksums.sha256\` | 全部文件的 SHA-256，用于校验 |
| \`missing-bodies.tsv\` | 若有正文缺失记录会列在这里（正常应为空） |

明确**不包含**：用户账号与邮箱、密码哈希、投稿与审稿记录、未发表稿件、审计日志、
阅读/通知行为、API token、任何内部租户 UUID 与部署密钥。

字段脱敏：刊面预览（\`preview\`）与正文里的通讯作者邮箱已做打码，形如 \`w***@1ab.edu\`。
EOF

(cd "$OUT" && find . -type f ! -name 'checksums.sha256' -print0 | sort -z \
  | xargs -0 sha256sum > checksums.sha256)

printf '{"exported_at":"%s","resources":%s,"markdown":%s,"bytes":%s}\n' \
  "$(date -Is)" "$nres" "$nmd" "$bytes" > "$OUT/MANIFEST.json"

note "done $OUT resources=$nres md=$nmd bytes=$bytes"
echo "OUT=$OUT"
echo "resources=$nres markdown=$nmd size=$((bytes/1024))KB"
echo "--- 断言通过：无邮箱、无内部UUID、无密码字段 ---"
