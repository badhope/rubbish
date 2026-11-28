import { Minus, Plus, ShieldCheck } from 'lucide-react'
import { useForumCredit } from '@/hooks/api/use-modules'
import { shortDate } from './format'

/** 社区信用：只呈现当前分数与可回溯的加减分来源，不做排行榜。 */
export function ForumCreditCard() {
  const credit = useForumCredit()

  if (credit.isLoading) {
    return <p className="border-y py-5 text-sm text-muted-foreground">正在算社区信用…</p>
  }
  if (credit.isError || !credit.data) {
    return (
      <p className="border-y py-5 text-sm text-muted-foreground">
        信用记录没加载出来。
        <button
          type="button"
          className="ml-2 text-primary underline-offset-2 hover:underline"
          onClick={() => void credit.refetch()}
        >
          重试
        </button>
      </p>
    )
  }

  const data = credit.data
  const recent = data.records.slice(0, 5)
  return (
    <div className="border-y">
      <div className="flex flex-wrap items-end justify-between gap-3 py-4">
        <div className="flex items-end gap-3">
          <span className="font-serif text-4xl leading-none tracking-tight">{data.score}</span>
          <span className="pb-0.5 text-xs text-muted-foreground">/ {data.max_score}</span>
          <span className="mb-0.5 inline-flex items-center gap-1 rounded-full border border-primary/25 bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
            <ShieldCheck className="h-3 w-3" />
            {data.tier_label}
          </span>
        </div>
        <p className="text-[11px] leading-5 text-muted-foreground">
          公开主题 {data.counts.published_topics} · 公开回复 {data.counts.published_replies}
          {data.counts.rejected_topics + data.counts.removed_contents > 0
            ? ` · 处置 ${data.counts.rejected_topics + data.counts.removed_contents}`
            : ''}
        </p>
      </div>

      {recent.length === 0 ? (
        <p className="border-t py-5 text-sm text-muted-foreground">
          还没有可记下的行为。发一个主题或回一条讨论，信用记录就会从这里开始。
        </p>
      ) : (
        <div className="divide-y border-t">
          {recent.map((record) => (
            <div key={`${record.ref_type}-${record.ref_id}-${record.kind}`} className="flex items-start gap-3 py-3">
              <span
                className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${
                  record.delta > 0
                    ? 'bg-primary/10 text-primary'
                    : 'bg-destructive/10 text-destructive'
                }`}
              >
                {record.delta > 0 ? <Plus className="h-3.5 w-3.5" /> : <Minus className="h-3.5 w-3.5" />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-sm">{record.label}</span>
                  <span
                    className={`font-mono text-xs tabular-nums ${
                      record.delta > 0 ? 'text-primary' : 'text-destructive'
                    }`}
                  >
                    {record.delta > 0 ? '+' : ''}
                    {record.delta}
                  </span>
                </span>
                <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
                  {record.detail} · {shortDate(record.at)}
                </span>
              </span>
            </div>
          ))}
        </div>
      )}

      <p className="border-t py-3 text-[11px] leading-5 text-muted-foreground">{data.scoring}</p>
    </div>
  )
}
