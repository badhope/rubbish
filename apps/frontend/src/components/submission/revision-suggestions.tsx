/** Studio 预览栏的「修改建议」面板：复用作者可见的审稿报告接口
 * （单盲脱敏：无审稿人身份、无 comments_to_editor），把逐维建议与
 * 给作者的意见集中展示，方便边改稿边对照。 */
import { MessageSquareText } from 'lucide-react'
import { useSubmissionReports } from '@/hooks/api/use-modules'
import {
  REVIEW_DIMENSION_LABELS,
  reviewDimensionEntries,
} from '@/lib/review-dimensions'
import { Badge } from '@/components/ui/badge'
import { MarkdownContent } from '@/components/common/markdown-content'
import { EmptyState, ErrorState, LoadingSkeleton } from '@/components/common/state'

const RECOMMENDATION_LABELS: Record<string, string> = {
  accept: '录用',
  minor_revision: '小修',
  major_revision: '大修',
  reject: '拒稿',
}

const RECOMMENDATION_VARIANTS: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  accept: 'default',
  minor_revision: 'secondary',
  major_revision: 'outline',
  reject: 'destructive',
}

export function RevisionSuggestions({ submissionId }: { submissionId: number }) {
  const reports = useSubmissionReports(submissionId)

  if (reports.isLoading) return <LoadingSkeleton rows={5} />
  if (reports.isError) {
    return (
      <ErrorState
        message="审稿意见加载失败"
        onRetry={() => void reports.refetch()}
      />
    )
  }
  const items = reports.data ?? []
  if (items.length === 0) {
    return (
      <EmptyState
        compact
        title="还没有修改建议"
        description="审稿人提交报告后，逐维修改意见与给作者的意见会显示在这里。"
      />
    )
  }

  return (
    <div className="space-y-3" data-testid="revision-suggestions">
      <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <MessageSquareText className="h-3.5 w-3.5" />
        共 {items.length} 份审稿报告 · 单盲：审稿人身份保密
      </p>
      {items.map((report, index) => {
        const suggestions = reviewDimensionEntries(report.scores).filter(
          ([, view]) => (view.suggestion ?? '').trim(),
        )
        return (
          <div key={report.id} className="rounded-lg border bg-background p-3">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium">报告 {index + 1}</span>
              <Badge variant={RECOMMENDATION_VARIANTS[report.recommendation] ?? 'outline'}>
                {RECOMMENDATION_LABELS[report.recommendation] ?? report.recommendation}
              </Badge>
              <span className="text-xs text-muted-foreground">
                {new Date(report.submitted_at).toLocaleString()}
              </span>
            </div>
            {report.comments_to_author ? (
              <MarkdownContent
                text={report.comments_to_author}
                className="text-sm"
              />
            ) : (
              <p className="text-xs italic text-muted-foreground">
                审稿人未给作者整体意见
              </p>
            )}
            {suggestions.length > 0 && (
              <div className="mt-2 space-y-1.5 border-t pt-2">
                <div className="text-xs font-medium text-muted-foreground">
                  逐维修改建议
                </div>
                {suggestions.map(([key, view]) => (
                  <div key={key} className="rounded bg-muted/50 p-2 text-xs">
                    <div className="mb-0.5 font-medium">
                      {REVIEW_DIMENSION_LABELS[key] ?? key}
                      {typeof view.score === 'number' && (
                        <span className="ml-1.5 text-muted-foreground">
                          {view.score} 分
                        </span>
                      )}
                    </div>
                    <p className="whitespace-pre-wrap leading-relaxed">
                      {view.suggestion}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}