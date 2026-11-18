import { Link } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import {
  ArrowRight,
  Bell,
  ClipboardCheck,
  FileText,
  Inbox,
} from 'lucide-react'
import {
  useMyReviewAssignments,
  useMySubmissions,
  useNotifications,
} from '@/hooks/api/use-modules'
import { Button } from '@/components/ui/button'
import { AssignmentStatusBadge, SubmissionStatusBadge } from './me-status'
import { shortDate } from './format'

function SectionHeading({
  kicker,
  title,
  action,
}: {
  kicker: string
  title: string
  action?: ReactNode
}) {
  return (
    <div className="mb-3 flex items-end justify-between gap-3">
      <div>
        <p className="text-[10px] uppercase tracking-[0.24em] text-muted-foreground">{kicker}</p>
        <h2 className="mt-1 font-serif text-xl tracking-tight">{title}</h2>
      </div>
      {action}
    </div>
  )
}

export function MeOverview({
  reviewable,
  onOpenNotifications,
}: {
  reviewable: boolean
  onOpenNotifications: () => void
}) {
  const submissions = useMySubmissions(undefined, 1, 5)
  const assignments = useMyReviewAssignments(undefined, 1, 5, { enabled: reviewable })
  const notifications = useNotifications(1, 4)

  const pendingSubmissions =
    submissions.data?.data.filter((item) =>
      ['pending', 'under_review', 'major_revision', 'minor_revision'].includes(item.status),
    ) ?? []
  const pendingReviews =
    assignments.data?.data.filter((item) => ['pending', 'accepted'].includes(item.status)) ?? []
  const latestNotifications = notifications.data?.data ?? []

  return (
    <div className="space-y-8">
      <section>
        <SectionHeading
          kicker="TO DO"
          title="待办"
          action={
            <span className="font-mono text-xs text-muted-foreground">
              {pendingSubmissions.length + pendingReviews.length} 项
            </span>
          }
        />
        {pendingSubmissions.length === 0 && pendingReviews.length === 0 ? (
          <div className="flex items-center gap-3 border-y py-5 text-sm text-muted-foreground">
            <Inbox className="h-4 w-4" />
            没有待处理事项。新的投稿状态和审稿邀请会出现在这里。
          </div>
        ) : (
          <div className="divide-y border-y">
            {pendingSubmissions.map((item) => (
              <Link
                key={`submission-${item.id}`}
                to="/me"
                search={{ tab: 'submissions' }}
                className="group flex items-start gap-3 py-3.5 transition-colors hover:bg-primary/[0.03] sm:items-center"
              >
                <FileText className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground sm:mt-0" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{item.title}</span>
                  <span className="mt-0.5 block text-[11px] text-muted-foreground">
                    {item.type === 'paper' ? '论文' : item.type} · {shortDate(item.submitted_at)}
                  </span>
                </span>
                <SubmissionStatusBadge status={item.status} />
                <ArrowRight className="hidden h-3.5 w-3.5 text-muted-foreground group-hover:text-primary sm:block" />
              </Link>
            ))}
            {pendingReviews.map((item) => (
              <Link
                key={`assignment-${item.id}`}
                to="/review/quick/$id"
                params={{ id: String(item.id) }}
                className="group flex items-start gap-3 py-3.5 transition-colors hover:bg-primary/[0.03] sm:items-center"
              >
                <ClipboardCheck className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground sm:mt-0" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">
                    {item.submission_title ?? `审稿任务 #${item.id}`}
                  </span>
                  <span className="mt-0.5 block text-[11px] text-muted-foreground">
                    {item.due_date ? `截止 ${shortDate(item.due_date)}` : `受邀 ${shortDate(item.invited_at)}`}
                  </span>
                </span>
                <AssignmentStatusBadge status={item.status} />
                <ArrowRight className="hidden h-3.5 w-3.5 text-muted-foreground group-hover:text-primary sm:block" />
              </Link>
            ))}
          </div>
        )}
      </section>

      <section>
        <SectionHeading
          kicker="NOTICES"
          title="最近通知"
          action={
            <Button variant="ghost" size="sm" onClick={onOpenNotifications}>
              <Bell className="h-3.5 w-3.5" />
              打开通知
            </Button>
          }
        />
        {latestNotifications.length === 0 ? (
          <p className="border-y py-5 text-sm text-muted-foreground">暂时没有通知。</p>
        ) : (
          <div className="divide-y border-y">
            {latestNotifications.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={onOpenNotifications}
                className="flex w-full items-start gap-3 py-3.5 text-left transition-colors hover:bg-primary/[0.03]"
              >
                <span
                  aria-hidden
                  className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${item.is_read ? 'bg-transparent' : 'bg-primary'}`}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm">{item.title}</span>
                  <span className="mt-0.5 block text-[11px] text-muted-foreground">
                    {shortDate(item.created_at)}
                  </span>
                </span>
                <ArrowRight className="mt-1 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              </button>
            ))}
          </div>
        )}
      </section>

      {!reviewable ? (
        <section className="border-t pt-5 text-sm">
          <p className="font-medium">想参与审稿？</p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            审稿人需要先满足作者等级与质量分要求，再由编辑部审批授予。你可以在等级页查看资格并提交申请。
          </p>
          <Button variant="outline" size="sm" className="mt-3" asChild>
            <Link to="/rules" search={{ tab: 'levels' }}>
              查看审稿资格
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </Button>
        </section>
      ) : null}
    </div>
  )
}
