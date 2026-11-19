// 展示层的中英映射：后端存的是 ISO/内部枚举，界面不该把 `en`、`paper`
// 这类机器值直接丢给读者。

const LANGUAGE_LABELS: Record<string, string> = {
  zh: '中文',
  'zh-cn': '中文',
  'zh-hans': '中文',
  en: '英文',
  'en-us': '英文',
  'en-gb': '英文',
  ja: '日文',
  ko: '韩文',
  de: '德文',
  fr: '法文',
  ru: '俄文',
  es: '西班牙文',
}

export function languageLabel(code: string | null | undefined): string {
  if (!code) return '—'
  return LANGUAGE_LABELS[code.toLowerCase()] ?? code
}

const TYPE_LABELS: Record<string, string> = {
  paper: '研究记录',
  book: '图书',
  dataset: '数据集',
  tutorial: '教程',
}

export function typeLabel(type: string | null | undefined): string {
  if (!type) return '—'
  return TYPE_LABELS[type] ?? type
}

// 赛道标签已随赛道下线移除（后端 core/tracks.py）：不再按正经/玩梗分组展示。

const STATUS_LABELS: Record<string, string> = {
  published: '已公开',
  in_review: '整理中',
  draft: '草稿',
}

export function statusLabel(status: string | null | undefined): string {
  if (!status) return '—'
  return STATUS_LABELS[status] ?? status
}

/**
 * 把推荐引擎的 reason 翻成读者能看懂的一句话。
 *
 * 引擎输出的是 `matches 2 tags: ['x']` / `discipline 'y'` /
 * `no reading history; showing latest` 这类内部诊断串，直接展示等于把
 * 开发日志漏到界面上。
 */
export function recommendationReason(reason: string | null | undefined): string {
  if (!reason) return '为你推荐'
  if (reason.includes('no reading history')) return '最新收录'
  if (reason.includes('you have read everything')) return '你已读完现有全部文章'
  const tags = reason.match(/matches (\d+) tags?: \[(.*)\]/)
  if (tags) {
    const names = tags[2]
      .split(',')
      .map((t) => t.trim().replace(/^['"]|['"]$/g, ''))
      .filter(Boolean)
    return names.length > 0 ? `匹配标签：${names.join('、')}` : `匹配 ${tags[1]} 个标签`
  }
  const discipline = reason.match(/discipline '([^']+)'/)
  if (discipline) return `学科匹配：${discipline[1]}`
  const subdiscipline = reason.match(/subdiscipline '([^']+)'/)
  if (subdiscipline) return `子学科匹配：${subdiscipline[1]}`
  if (reason.includes('no direct match')) return '相关领域新作'
  return reason
}

// ---------------------------------------------------------------------------
// 内容类别（v1.11）：academic / fun / rant——类别不是等级，是编辑部
// 评定的一等公民属性；目录筛选、排行分域都按类别走。
// ---------------------------------------------------------------------------
const CATEGORY_LABELS: Record<string, string> = {
  academic: '研究',
  fun: '自由创作',
  rant: '吐槽',
}

export function contentCategoryLabel(category: string | null | undefined): string {
  return (category && CATEGORY_LABELS[category]) || ''
}

// ---------------------------------------------------------------------------
// 学术 vs 娱乐：content_category 为 fun/rant，或后端给出 content_track=essay
// 时，这篇是娱乐稿——全站不渲染任何学术评分元素（站内热度/分区、
// RQS、quality_grade）。阅读量/收藏/评论等内容侧数据照常保留。
// ---------------------------------------------------------------------------
export function isScholarlyContent(
  contentCategory: string | null | undefined,
  contentTrack?: string | null,
): boolean {
  // 轨道优先：content_track 是唯一权威口径（历史稿件 category 可能未同步）。
  if (contentTrack === 'paper') return true
  if (contentTrack === 'essay') return false
  if (contentCategory === 'fun' || contentCategory === 'rant') return false
  return true
}

// 类型 chip：研究档案按资源类型显示（研究记录/图书/…）；自由创作直接显示类型。
export function displayTypeLabel(
  type: string | null | undefined,
  contentCategory?: string | null,
  contentTrack?: string | null,
  paperKind?: string | null,
): string {
  if (contentTrack === 'essay') return contentCategory === 'rant' ? '吐槽' : '自由创作'
  if (contentTrack === 'paper') {
    if (paperKind === 'absurd') return '荒诞研究'
    if (paperKind === 'serious') return '实证研究'
    return TYPE_LABELS[type ?? ''] ?? '研究记录'
  }
  if (contentCategory === 'fun') return '自由创作'
  if (contentCategory === 'rant') return '吐槽'
  return typeLabel(type)
}

// ---------------------------------------------------------------------------
// 四轨呈现（v3 规范表）：决定详情页渲染哪些块。
// - paper    研究档案：概要/关键词/参考文献/说明；不再展示评分与旧刊号
// - sci_pop  科普：导语 + 正文 + 延伸阅读
// - fun      娱乐：正文 + 标签 + 可选参考资料；无学术块
// - rant     吐槽：正文 + 标签；无学术块
// - plain    未知：只渲染正文，不渲染任何学术块（兜底）
//
// 判定以 content_category 为准（后续会批量改分类）；content_track 仅作
// essay 兜底。后续新增科普类值（science/science_pop/popular/科普）在此加。
// ---------------------------------------------------------------------------
export type ContentKind = 'paper' | 'sci_pop' | 'fun' | 'rant' | 'plain'

export function contentTrackKind(
  contentCategory: string | null | undefined,
  contentTrack?: string | null,
): ContentKind {
  const cat = (contentCategory ?? '').toLowerCase()
  if (cat === 'fun') return 'fun'
  if (cat === 'rant') return 'rant'
  if (cat === 'science' || cat === 'science_pop' || cat === 'popular' || cat === 'scipop' || cat === '科普') {
    return 'sci_pop'
  }
  if (cat === 'academic' || cat === 'paper') return 'paper'
  // content_track=essay 但 category 不是 fun/rant：归 plain（只渲染正文）
  if (contentTrack === 'essay') return 'plain'
  // 缺省：保守按 paper 处理（研究档案默认版式）
  return 'paper'
}
