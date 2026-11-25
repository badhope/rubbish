import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { MarkdownContent } from '@/components/common/markdown-content'
import { usePublicReviews } from '@/hooks/api/use-modules'
import { cn } from '@/lib/utils'

const RECOMMENDATION_META: Record<
  string,
  { label: string; className: string }
> = {
  accept: {
    label: '通过',
    className: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  },
  minor_revision: {
    label: '小改',
    className: 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300',
  },
  major_revision: {
    label: '大改',
    className: 'border-orange-500/30 bg-orange-500/10 text-orange-700 dark:text-orange-300',
  },
  reject: {
    label: '不通过',
    className: 'border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300',
  },
}

function formatReviewTime(value: string) {
  try {
    return new Date(value).toLocaleDateString('zh-CN', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    })
  } catch {
    return ''
  }
}

/**
 * 文章页公开评审。只展示“给作者的意见”、推荐结论与署名选择；
 * 给编辑的内部意见、评分明细不进这个接口。
 */
export function PublicReviewCard({ resourceId, enabled }: { resourceId: number; enabled: boolean }) {
  const reviewsQ = usePublicReviews(resourceId, enabled)
  const data = reviewsQ.data
  if (!data) return null
  if (data.reports.length === 0 && !data.author_response) return null

  return (
    <Card id="public-reviews">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm">同行评审记录</CardTitle>
        <p className="text-xs leading-6 text-muted-foreground">
          审稿意见与作者回复随文章公开。审稿人可自行选择匿名或署名；给编辑的内部意见与评分明细不公开。
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {data.reports.map((report) => {
          const meta = RECOMMENDATION_META[report.recommendation] ?? {
            label: report.recommendation,
            className: 'border-border bg-muted text-muted-foreground',
          }
          return (
            <article key={report.id} className="rounded-lg border bg-muted/[0.18] p-3">
              <div className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1">
                <Badge variant="outline">第 {report.round} 轮</Badge>
                <Badge variant="outline" className={cn('border', meta.className)}>
                  {meta.label}
                </Badge>
                <span className="text-xs text-muted-foreground">{report.reviewer_label}</span>
                <span className="ml-auto text-[11px] tabular-nums text-muted-foreground">
                  {formatReviewTime(report.submitted_at)}
                </span>
              </div>
              {report.comments_to_author?.trim() ? (
                <MarkdownContent text={report.comments_to_author} className="text-sm leading-7" />
              ) : (
                <p className="text-xs italic text-muted-foreground">该轮未留下公开意见。</p>
              )}
            </article>
          )
        })}

        {data.author_response ? (
          <article className="rounded-lg border border-primary/25 bg-primary/[0.05] p-3">
            <div className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1">
              <Badge className="border-primary/30 bg-primary/10 text-primary">作者回复</Badge>
              {data.author_response_at ? (
                <span className="ml-auto text-[11px] tabular-nums text-muted-foreground">
                  {formatReviewTime(data.author_response_at)}
                </span>
              ) : null}
            </div>
            <MarkdownContent text={data.author_response} className="text-sm leading-7" />
          </article>
        ) : null}
      </CardContent>
    </Card>
  )
}
