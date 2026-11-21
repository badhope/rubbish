import { useMemo } from 'react'
import { AlertTriangle, CheckCircle2, FileSearch, Info, PencilLine } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'

export type ReviewTrack = 'academic' | 'absurd'

export interface DimensionReview {
  score: number | null
  reason: string
  evidence: string
  /** 逐维给作者的修改意见：证据右侧独立输入，避免和评分理由混在一起。 */
  suggestion: string
}

export type DimensionReviews = Record<string, DimensionReview>

interface DimensionMeta {
  key: string
  label: string
  hint: string
  weight: number
  watch: string
}

export const ACADEMIC_REVIEW_DIMENSIONS: DimensionMeta[] = [
  {
    key: 'question',
    label: '主题与问题',
    hint: '主题清楚、问题具体，读者知道这篇要写什么',
    weight: 20,
    watch: '标题和开头能不能一句话说清写什么？有没有明确的新角度？只是泛泛而谈，这一维最多 60。',
  },
  {
    key: 'argument',
    label: '结构与逻辑',
    hint: '段落推进有依据，转折有交代，结尾收得住',
    weight: 25,
    watch: '逐节问：这一段在推进什么？有没有从 A 跳到 C？结论有没有前提？结构断裂时总分直接封顶 59。',
  },
  {
    key: 'method',
    label: '材料与写法',
    hint: '素材来源、取舍范围、关键做法交代到别人能理解',
    weight: 20,
    watch: '换个人拿这份材料能不能看懂？来源、范围、关键做法、失败或没写到的部分，缺一项就写进证据里。',
  },
  {
    key: 'evidence',
    label: '表达与完成度',
    hint: '详略得当，语言清楚，标题与正文对得上',
    weight: 20,
    watch: '有没有空话、重复、未完成段落？标题和正文是否对得上？材料很少却下很大的结论，也只能给弱分。',
  },
  {
    key: 'integrity',
    label: '规范与诚信',
    hint: '引用可核、隐私脱敏、外部素材有说明（0 分一票否决）',
    weight: 15,
    watch: '抽查 2–3 条引用能否定位原文；图片、数据与外部素材是否说明来源；真人隐私是否脱敏。发现抄袭或造假给 0。',
  },
]

export const ABSURD_REVIEW_DIMENSIONS: DimensionMeta[] = [
  {
    key: 'absurdity',
    label: '荒诞度',
    hint: '反讽、悖论、夸张推演、冷面错位进入正文并持续起作用',
    weight: 20,
    watch: '正文至少 3 处可指认的荒诞信号，且服务于论点；只有标题/结尾玩梗，这一维不高。荒诞度低于 50，总分封顶 69。',
  },
  {
    key: 'concept',
    label: '荒诞设定与原创',
    hint: '设定真荒诞、新鲜、有记忆点，不是普通吐槽换皮',
    weight: 20,
    watch: '把核心设定用一句话讲给没看过的人听；他会不会想继续听？只是“离谱”但没有新规则，这一维不高。',
  },
  {
    key: 'coherence',
    label: '内部自洽',
    hint: '设定内规则自洽，前后不打架',
    weight: 15,
    watch: '允许无中生有，但不允许人物、时间、数字、规则互相打架。自洽低于 50，总分封顶 59。',
  },
  {
    key: 'execution',
    label: '一本正经的执行',
    hint: '用完整结构把荒诞当正事推进，不是段子拼贴',
    weight: 20,
    watch: '摘要/方法/结果或叙事推进是否完整？作者有没有自己跳出来解释“这很好笑”？执行低于 50，总分封顶 69。',
  },
  {
    key: 'material',
    label: '材料与梗的可核查',
    hint: '梗、案例、数据有出处，或自造规则被明确交代',
    weight: 15,
    watch: '引用的台词、文章、事件能不能核到？自造数据有没有标注“自造”？张冠李戴直接扣到底。',
  },
  {
    key: 'voice',
    label: '文风与节奏',
    hint: '有节奏、有包袱、不啰嗦，荒诞感靠写法立住',
    weight: 10,
    watch: '读出声来，哪里会笑、哪里会拖？靠括号解释笑点、靠重复词凑字数，都写进证据。',
  },
]

export const TRACK_DIMENSIONS: Record<ReviewTrack, DimensionMeta[]> = {
  academic: ACADEMIC_REVIEW_DIMENSIONS,
  absurd: ABSURD_REVIEW_DIMENSIONS,
}

export const TRACK_LABELS: Record<ReviewTrack, string> = {
  academic: '研究长文',
  absurd: '荒诞写作',
}

const ANCHORS: Record<ReviewTrack, { min: number; text: string }[]> = {
  academic: [
    { min: 95, text: '范例：可直接作为同题材写作范例，几乎没有需要实质修改的地方。' },
    { min: 90, text: '高完成：完成度与判断力达到同题材成熟作品水准，只剩细节问题。' },
    { min: 80, text: '优秀：五个判断面都站得住，有清晰角度，短板只在局部。' },
    { min: 70, text: '良好：主题与结构成立，材料或写法有一处实质不足，补充后可成立。' },
    { min: 60, text: '合格：能读下去，但材料透明度或完成度有明显缺口，需较大补充。' },
    { min: 50, text: '待改：核心环节勉强成立，完成度存疑，需要重做关键部分。' },
    { min: 0, text: '需重写：该维度缺失、写法性错误，或存在抄袭造假。' },
  ],
  absurd: [
    { min: 95, text: '荒诞范本：设定、执行、文风合一，读完想转给别人。' },
    { min: 90, text: '高完成度荒诞：荒诞信号密集且克制，设定极新，规则严丝合缝，一本正经到忘记它在胡说。' },
    { min: 80, text: '优秀：荒诞点清楚，结构完整，梗有出处或规则自洽。' },
    { min: 70, text: '良好：设定成立，执行基本完整，但局部靠硬凑梗。' },
    { min: 60, text: '合格：有荒诞点，但内部规则开始打架，或后半程写不下去。' },
    { min: 50, text: '待改：只有零散段子，缺少完整设定与推进。' },
    { min: 0, text: '需重写：设定平庸或前后矛盾，通篇堆梗。' },
  ],
}

export function anchorFor(track: ReviewTrack, score: number | null): string {
  if (score === null) return '尚未给分'
  return ANCHORS[track].find((a) => score >= a.min)?.text ?? ANCHORS[track][ANCHORS[track].length - 1].text
}

export function emptyDimensionReviews(track: ReviewTrack): DimensionReviews {
  return Object.fromEntries(
    TRACK_DIMENSIONS[track].map((d) => [d.key, { score: null, reason: '', evidence: '', suggestion: '' }]),
  )
}

export function mergeDimensionReviews(
  track: ReviewTrack,
  raw: Partial<Record<string, Partial<DimensionReview>>> | null | undefined,
): DimensionReviews {
  const base = emptyDimensionReviews(track)
  return Object.fromEntries(
    TRACK_DIMENSIONS[track].map((d) => [
      d.key,
      { ...base[d.key], ...(raw?.[d.key] ?? {}), suggestion: raw?.[d.key]?.suggestion ?? '' },
    ]),
  ) as DimensionReviews
}

export function dimensionIssue(_dim: DimensionMeta, value: DimensionReview | undefined): string | null {
  if (!value || value.score === null) return '未给分'
  if (value.score < 0 || value.score > 100) return '分数需在 0–100'
  // 分数是唯一必填项；理由、正文证据、修改意见都由互评成员自行决定填不填。
  return null
}

export function scoreReviewTotal(track: ReviewTrack, reviews: DimensionReviews): {
  total: number
  uncapped: number
  cap: number | null
  capNotes: string[]
  grade: string
  gradeLabel: string
  complete: boolean
  incomplete: string[]
} {
  const dims = TRACK_DIMENSIONS[track]
  let uncapped = 0
  for (const d of dims) {
    const score = reviews[d.key]?.score ?? 0
    uncapped += (d.weight * score) / 100
  }
  uncapped = Math.round(uncapped * 10) / 10
  const caps: number[] = []
  let capNotes: string[] = []
  const entries = dims.map((d) => ({ key: d.key, score: reviews[d.key]?.score ?? 0 }))
  if (track === 'academic' && reviews.integrity?.score === 0) {
    caps.push(0)
    capNotes.push('诚信维度 0 分：总分归零')
  }
  const low = entries.filter((e) => e.score < 50)
  if (low.length >= 2) {
    caps.push(49)
    capNotes.push('两项及以上维度低于 50 分：总分封顶 49（需重写）')
  } else if (low.length === 1) {
    caps.push(59)
    capNotes.push('有维度低于 50 分：总分封顶 59（不能进入良好及以上）')
  }
  const mid = entries.filter((e) => e.score >= 50 && e.score < 60)
  if (mid.length && !low.length) {
    caps.push(79)
    capNotes.push('有维度低于 60 分：总分封顶 79（不进高分段）')
  }
  if (track === 'academic' && (reviews.argument?.score ?? 0) < 50) {
    caps.push(59)
    capNotes.push('论证低于 50 分：总分封顶 59')
  }
  if (track === 'absurd' && (reviews.coherence?.score ?? 0) < 50) {
    caps.push(59)
    capNotes.push('自洽低于 50 分：总分封顶 59')
  }
  if (track === 'absurd' && (reviews.execution?.score ?? 0) < 50) {
    caps.push(69)
    capNotes.push('执行低于 50 分：总分封顶 69')
  }
  const cap = caps.length ? Math.min(...caps) : null
  const ratedTotal = cap !== null && uncapped > cap ? cap : uncapped
  const incomplete = entries.filter((e) => e.score < 50).map((e) => e.key)
  const complete = incomplete.length === 0
  // 不完整稿不评级，也不封顶诊断分：封顶只对完整稿的等级有意义。
  if (!complete) {
    capNotes = track === 'academic' && reviews.integrity?.score === 0
      ? ['诚信维度 0 分：总分归零，不进入内容整理补充']
      : ['任一维低于 50 分：暂不评级；内容整理按原思路补充后直接评级，不退回作者']
  }
  const total = complete ? ratedTotal : uncapped
  const grade = complete
    ? total >= 95 ? 'T1+' : total >= 90 ? 'T1' : total >= 80 ? 'Q1' : total >= 70 ? 'Q2' : total >= 60 ? 'Q3' : total >= 50 ? 'Q4' : 'R'
    : 'NA'
  const gradeLabel = complete
    ? grade === 'T1+' ? '范例' : grade === 'T1' ? '高完成' : grade === 'Q1' ? '优秀' : grade === 'Q2' ? '良好' : grade === 'Q3' ? '合格' : grade === 'Q4' ? '待改' : '需重写'
    : '待内容整理补充，暂不评级'
  return { total, uncapped, cap, capNotes, grade, gradeLabel, complete, incomplete }
}

export function RubricScoreFields({
  track,
  reviews,
  onChange,
  disabled,
}: {
  track: ReviewTrack
  reviews: DimensionReviews
  onChange: (next: DimensionReviews) => void
  disabled?: boolean
}) {
  const dims = TRACK_DIMENSIONS[track]
  const summary = useMemo(() => scoreReviewTotal(track, reviews), [track, reviews])
  const completed = dims.filter((d) => !dimensionIssue(d, reviews[d.key])).length

  const update = (key: string, patch: Partial<DimensionReview>) => {
    const base = reviews[key] ?? { score: null, reason: '', evidence: '' }
    onChange({ ...reviews, [key]: { ...base, ...patch } })
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Label>评分（百分制 0–100）· 按赛道维度逐项审批</Label>
        <span className="text-[11px] tabular-nums text-muted-foreground">
          {completed}/{dims.length} 维完整
        </span>
      </div>
      <p className="text-[11px] leading-5 text-muted-foreground">
        每个维度必须给 <strong>分数</strong>；评分理由、正文证据、修改意见均为<strong>选填</strong>。
        建议填写理由和证据方便复核，但不填不会阻断提交，也不影响计分。
      </p>

      {dims.map((dim) => {
        const value = reviews[dim.key] ?? { score: null, reason: '', evidence: '' }
        const issue = dimensionIssue(dim, value)
        return (
          <div key={dim.key} className={cn('rounded-lg border bg-card p-3', issue && 'border-dashed')}>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="flex items-center gap-1.5 text-sm font-medium">
                  {dim.label}
                  <Badge variant="outline" className="text-[9px] tabular-nums">
                    权重 {dim.weight}%
                  </Badge>
                </p>
                <p className="mt-0.5 text-[11px] text-muted-foreground">{dim.hint}</p>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <Input
                  type="number"
                  min={0}
                  max={100}
                  step={1}
                  value={value.score ?? ''}
                  placeholder="—"
                  disabled={disabled}
                  onChange={(e) => {
                    const raw = e.target.value
                    update(dim.key, { score: raw === '' ? null : Math.max(0, Math.min(100, Math.round(Number(raw)))) })
                  }}
                  aria-label={`${dim.label}分数（0–100）`}
                  className="h-9 w-20 px-2 text-center text-sm tabular-nums"
                />
                <span className="text-[10px] text-muted-foreground">分</span>
              </div>
            </div>
            <p className="mt-1.5 rounded bg-muted/40 px-2 py-1.5 text-[11px] leading-5 text-muted-foreground">
              {anchorFor(track, value.score)}
            </p>
            <p className="mt-1.5 text-[11px] leading-5 text-muted-foreground">{dim.watch}</p>
            <div className="mt-2 grid gap-2 lg:grid-cols-3">
              <div className="space-y-1">
                <p className="flex items-center gap-1 text-[11px] font-medium">
                  <FileSearch className="h-3.5 w-3.5" /> 评分理由（选填）
                </p>
                <Textarea
                  value={value.reason}
                  disabled={disabled}
                  onChange={(e) => update(dim.key, { reason: e.target.value })}
                  placeholder="例：问题成立，但增量只对比了 1 篇 2019 年的旧文，没覆盖 2023 年后的同类工作。"
                  rows={3}
                  className="text-xs"
                  aria-label={`${dim.label}评分理由`}
                />
              </div>
              <div className="space-y-1">
                <p className="flex items-center gap-1 text-[11px] font-medium">
                  <FileSearch className="h-3.5 w-3.5" /> 正文证据（选填）
                </p>
                <Textarea
                  value={value.evidence}
                  disabled={disabled}
                  onChange={(e) => update(dim.key, { evidence: e.target.value })}
                  placeholder="例：§1 第 3 段“已有研究仅覆盖……”；出处[7] 2019；§4 表 2 仅 3 个样本。"
                  rows={3}
                  className="text-xs"
                  aria-label={`${dim.label}正文证据`}
                />
              </div>
              <div className="space-y-1">
                <p className="flex items-center gap-1 text-[11px] font-medium">
                  <PencilLine className="h-3.5 w-3.5" /> 修改意见
                </p>
                <Textarea
                  value={value.suggestion}
                  disabled={disabled}
                  onChange={(e) => update(dim.key, { suggestion: e.target.value })}
                  placeholder="例：§1 补 2023 年后的同类工作对比；§4 表 2 扩到 30 个样本并说明抽样标准。"
                  rows={3}
                  className="text-xs"
                  aria-label={`${dim.label}修改意见`}
                />
              </div>
            </div>
            <div className="mt-1.5 flex items-center justify-between text-[10px]">
              <span className={cn('text-muted-foreground', issue && 'text-amber-700 dark:text-amber-300')}>
                {issue ? `待补：${issue}` : '已给分 · 可选填理由/证据'}
              </span>
              <span className="text-muted-foreground tabular-nums">
                理由 {value.reason.trim().length} 字 · 证据 {value.evidence.trim().length} 字 · 修改意见 {value.suggestion.trim().length} 字
              </span>
            </div>
          </div>
        )
      })}

      <div className="rounded-lg border border-primary/25 bg-primary/[0.06] p-3 dark:border-primary/25 dark:bg-primary/10">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="flex items-center gap-1.5 text-sm font-medium">
            {summary.grade === 'R' || summary.grade === 'NA' ? <AlertTriangle className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
            {summary.complete ? `当前合计 ${summary.total} 分 · ${summary.gradeLabel}` : `当前诊断 ${summary.uncapped} 分 · ${summary.gradeLabel}；补全后直接评级，不打回作者`}
          </p>
          <span className="text-[11px] text-muted-foreground tabular-nums">
            未封顶 {summary.uncapped} · {completed}/{dims.length} 维
          </span>
        </div>
        {summary.cap !== null && (
          <div className="mt-1.5 space-y-0.5 text-[11px] leading-5 text-amber-800 dark:text-amber-200">
            {summary.capNotes.map((n) => (
              <p key={n}>· {n}</p>
            ))}
          </div>
        )}
        <p className="mt-1.5 flex items-start gap-1.5 text-[10px] leading-4 text-muted-foreground">
          <Info className="mt-0.5 h-3 w-3 shrink-0" />
          90+ 高完成，80/70/60/50 分别为优秀/良好/合格/待改。完整稿才评级；任一维低于 50 进内容整理补充，暂不评级，补充后按实际内容重评。
        </p>
      </div>
    </div>
  )
}

export function reviewAverage(track: ReviewTrack, reviews: DimensionReviews): string {
  const dims = TRACK_DIMENSIONS[track]
  const scored = dims.filter((d) => reviews[d.key]?.score !== null && reviews[d.key]?.score !== undefined)
  if (!scored.length) return '—'
  const sum = scored.reduce((n, d) => n + (reviews[d.key]?.score ?? 0), 0)
  return (sum / scored.length).toFixed(1)
}

export function dimensionLabel(track: ReviewTrack, key: string): string {
  return TRACK_DIMENSIONS[track].find((d) => d.key === key)?.label ?? key
}
