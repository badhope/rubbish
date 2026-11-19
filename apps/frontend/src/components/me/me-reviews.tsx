import { Link } from '@tanstack/react-router'
import { ArrowRight, ClipboardCheck, ShieldCheck } from 'lucide-react'
import { useMyReviewAssignments } from '@/hooks/api/use-modules'
import { Button } from '@/components/ui/button'
import { ErrorState, Loading } from '@/components/common/state'
import { AssignmentStatusBadge } from './me-status'
import { shortDate } from './format'

export function MeReviews({ reviewable }: { reviewable: boolean }) {
  const assignments = useMyReviewAssignments(undefined, 1, 20, { enabled: reviewable })

  if (!reviewable) {
    return (
      <section className="border-y py-8">
        <div className="flex items-start gap-3">
          <ShieldCheck className="mt-0.5 h-5 w-5 text-muted-foreground" />
          <div>
            <h2 className="font-serif text-xl tracking-tight">审稿任务</h2>
            <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted-foreground">
              当前账号还没有审稿权限。审稿人由编辑部审批授予；作者等级与质量分满足条件后，可以在等级页提交申请。
            </p>
            <Button variant="outline" size="sm" className="mt-4" asChild>
              <Link to="/guide" search={{ tab: 'levels' }}>
                查看审稿资格
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </Button>
          </div>
        </div>
      </section>
    )
  }

  if (assignments.isLoading) return <Loading />
  if (assignments.isError) {
    return <ErrorState message="加载审稿任务失败" onRetry={() => assignments.refetch()} />
  }

  const rows = assignments.data?.data ?? []

  return (
    <section>
      <div className="flex flex-wrap items-end justify-between gap-3 border-b pb-4">
        <div>
          <p className="text-[10px] uppercase tracking-[0.24em] text-muted-foreground">REVIEW DESK</p>
          <h2 className="mt-1 font-serif text-xl tracking-tight">审稿任务</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            待回应、进行中和已完成的稿件 · 共 {assignments.data?.meta.total ?? 0} 份
          </p>
        </div>
        <Button variant="outline" size="sm" asChild>
          <Link to="/review" search={{ tab: 'assignments' }}>
            打开审稿工作台
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </Button>
      </div>

      {rows.length === 0 ? (
        <div className="flex items-center gap-3 border-b py-8 text-sm text-muted-foreground">
          <ClipboardCheck className="h-4 w-4" />
          没有审稿任务。编辑部邀请后会出现在这里。
        </div>
      ) : (
        <div className="divide-y">
          {rows.map((item) => {
            const canOpen = ['pending', 'accepted', 'completed'].includes(item.status)
            return (
              <div key={item.id} className="flex flex-col gap-2 py-4 sm:flex-row sm:items-center sm:gap-4">
                <ClipboardCheck className="hidden h-4 w-4 shrink-0 text-muted-foreground sm:block" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {item.submission_title ?? `审稿任务 #${item.id}`}
                  </p>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    {item.due_date ? `截止 ${shortDate(item.due_date)}` : `受邀 ${shortDate(item.invited_at)}`}
                    {item.is_adjudicator ? ' · 第三方裁决' : ''}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <AssignmentStatusBadge status={item.status} />
                  {canOpen ? (
                    <Button variant="ghost" size="sm" asChild>
                      <Link to="/review" search={{ tab: 'assignments' }}>
                        打开
                        <ArrowRight className="h-3.5 w-3.5" />
                      </Link>
                    </Button>
                  ) : null}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}
