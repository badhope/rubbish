import { Link, useNavigate } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import {
  ArrowRight,
  ArrowUpRight,
  Bell,
  CheckCircle2,
  Clock3,
  FileText,
  MessagesSquare,
  PenLine,
} from 'lucide-react'
import type { MeWorkStats } from '@/hooks/api/use-modules'
import type { NotificationResponse, SubmissionStatus } from '@/lib/types'
import { useMarkRead, useMySubmissions, useNotifications } from '@/hooks/api/use-modules'
import { Button } from '@/components/ui/button'
import { notificationDestination } from '@/lib/notification-link'
import { shortDate } from './format'
import { MeAppeals } from './me-appeals'

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

const WORK_STATS: Array<{
  key: keyof Pick<MeWorkStats, 'draft' | 'under_review' | 'revision' | 'published'>
  label: string
  hint: string
  icon: typeof FileText
  status?: SubmissionStatus
}> = [
  { key: 'draft', label: '草稿', hint: '发文向导里存着', icon: FileText },
  { key: 'under_review', label: '审核中', hint: '含初筛、互评、重交', icon: Clock3, status: 'under_review' },
  { key: 'revision', label: '待修改', hint: '含大改、小改、返修', icon: PenLine, status: 'rework_requested' },
  { key: 'published', label: '已发布', hint: '已进入内容库', icon: CheckCircle2, status: 'accepted' },
]

const STATUS_LABEL: Record<string, string> = {
  pending: '待回应',
  under_review: '互评中',
  major_revision: '待大改',
  minor_revision: '待小改',
  rework_requested: '待修改',
  resubmitted: '已重交',
  accepted: '已公开',
  approved: '已公开',
  rejected: '未通过',
  withdrawn: '已撤回',
}

function WorkStatCard({
  item,
  value,
}: {
  item: (typeof WORK_STATS)[number]
  value: number
}) {
  const Icon = item.icon
  const inner = (
    <>
      <span className="flex items-center gap-2 text-xs text-muted-foreground">
        <Icon className="h-3.5 w-3.5" />
        {item.label}
      </span>
      <span className="mt-2 block font-serif text-2xl leading-none tracking-tight">{value}</span>
      <span className="mt-1 block text-[11px] text-muted-foreground">{item.hint}</span>
    </>
  )
  const cls =
    'group block border-r border-b p-4 transition-colors last:border-r-0 hover:bg-primary/[0.03] sm:border-b-0'
  if (item.key === 'draft') {
    return (
      <Link to="/submissions/new" className={cls}>
        {inner}
      </Link>
    )
  }
  return (
    <Link to="/submissions" search={item.status ? { status: item.status } : undefined} className={cls}>
      {inner}
    </Link>
  )
}

/** 同一标题、同一天的多条通知合成一行，避免个人中心出现“看起来重复”的通知。 */
function groupNotifications(items: NotificationResponse[]) {
  const groups = new Map<string, { item: NotificationResponse; count: number }>()
  for (const item of items) {
    const key = `${item.title}|${shortDate(item.created_at)}`
    const existing = groups.get(key)
    if (existing) existing.count += 1
    else groups.set(key, { item, count: 1 })
  }
  return Array.from(groups.values())
}

export function MeOverview({
  onOpenNotifications,
  highlightAppealId,
  workStats,
  username,
}: {
  onOpenNotifications: () => void
  highlightAppealId?: number
  workStats?: MeWorkStats
  username?: string
}) {
  const notifications = useNotifications(1, 6)
  const latestNotifications = notifications.data?.data ?? []
  const recentWorks = useMySubmissions(undefined, 1, 4)
  const markOne = useMarkRead()
  const navigate = useNavigate()

  const openNotification = (item: NotificationResponse) => {
    const destination = notificationDestination(item)
    if (!item.is_read) markOne.mutate(item.id)
    if (!destination) {
      onOpenNotifications()
      return
    }
    void navigate({
      to: destination.to,
      params: destination.params,
      search: destination.search,
    } as never)
  }

  const stats = workStats ?? { total: 0, draft: 0, under_review: 0, revision: 0, published: 0 }
  const grouped = groupNotifications(latestNotifications)
  const works = recentWorks.data?.data ?? []

  return (
    <div className="space-y-8">
      <section>
        <SectionHeading
          kicker="WRITING"
          title="创作进度"
          action={
            <Button variant="ghost" size="sm" asChild>
              <Link to="/submissions">
                全部作品
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </Button>
          }
        />
        <div className="grid grid-cols-2 border-y sm:grid-cols-4">
          {WORK_STATS.map((item) => (
            <WorkStatCard key={item.key} item={item} value={stats[item.key]} />
          ))}
        </div>
      </section>

      <section>
        <SectionHeading
          kicker="RECENT"
          title="最近作品"
          action={
            <Button variant="ghost" size="sm" asChild>
              <Link to="/submissions">查看进度</Link>
            </Button>
          }
        />
        {recentWorks.isLoading ? (
          <p className="border-y py-5 text-sm text-muted-foreground">加载中…</p>
        ) : recentWorks.isError ? (
          <p className="border-y py-5 text-sm text-muted-foreground">
            作品没加载出来。
            <button
              type="button"
              className="ml-2 text-primary underline-offset-2 hover:underline"
              onClick={() => void recentWorks.refetch()}
            >
              重试
            </button>
          </p>
        ) : works.length === 0 ? (
          <div className="flex flex-wrap items-center justify-between gap-3 border-y py-5">
            <p className="text-sm text-muted-foreground">
              还没有投过稿。先写一篇，或者去主题论坛聊两句。
            </p>
            <Button size="sm" asChild>
              <Link to="/submissions/new">
                <PenLine className="h-3.5 w-3.5" />
                开始写
              </Link>
            </Button>
          </div>
        ) : (
          <div className="divide-y border-y">
            {works.map((work) => (
              <Link
                key={work.id}
                to="/submissions"
                search={{ submission: work.id }}
                className="group flex min-w-0 items-center gap-3 py-3.5 transition-colors hover:text-primary"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{work.title}</span>
                  <span className="mt-0.5 block text-[11px] text-muted-foreground">
                    {STATUS_LABEL[work.status] ?? work.status}
                    {work.latest_version ? ` · v${work.latest_version}` : ''}
                    {' · '}
                    {shortDate(work.submitted_at)}
                  </span>
                </span>
                <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground group-hover:text-primary" />
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
        {notifications.isLoading ? (
          <p className="border-y py-5 text-sm text-muted-foreground">加载中…</p>
        ) : notifications.isError ? (
          <p className="border-y py-5 text-sm text-muted-foreground">
            通知没加载出来。
            <button
              type="button"
              className="ml-2 text-primary underline-offset-2 hover:underline"
              onClick={() => void notifications.refetch()}
            >
              重试
            </button>
          </p>
        ) : grouped.length === 0 ? (
          <p className="border-y py-5 text-sm text-muted-foreground">还没有通知。</p>
        ) : (
          <div className="divide-y border-y">
            {grouped.map(({ item, count }) => (
              <button
                key={item.id}
                type="button"
                onClick={() => openNotification(item)}
                className="flex w-full items-start gap-3 py-3.5 text-left transition-colors hover:bg-primary/[0.03]"
              >
                <span
                  aria-hidden
                  className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${item.is_read ? 'bg-transparent' : 'bg-primary'}`}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm">{item.title}</span>
                  <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
                    {shortDate(item.created_at)}
                    {count > 1 ? ` · 同标题 ${count} 条` : ''}
                  </span>
                </span>
                {notificationDestination(item) ? (
                  <ArrowUpRight className="mt-1 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                ) : (
                  <ArrowRight className="mt-1 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                )}
              </button>
            ))}
          </div>
        )}
      </section>

      <section>
        <SectionHeading kicker="COMMUNITY" title="桌边" />
        <div className="grid gap-3 border-y py-5 sm:grid-cols-2">
          <Link
            to="/forum"
            className="group flex items-start gap-3 rounded-lg border p-4 transition-colors hover:border-primary/40 hover:bg-primary/[0.03]"
          >
            <MessagesSquare className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            <span>
              <span className="block text-sm font-medium">去主题论坛</span>
              <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">
                读帖、回复、收藏；先聊起来，再补记录。
              </span>
            </span>
          </Link>
          <Link
            to="/u/$username"
            params={{ username: username ?? '' }}
            className="group flex items-start gap-3 rounded-lg border p-4 transition-colors hover:border-primary/40 hover:bg-primary/[0.03]"
          >
            <ArrowUpRight className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            <span>
              <span className="block text-sm font-medium">看看公开主页</span>
              <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">
                别人点进来时，看到的是这份作者页。
              </span>
            </span>
          </Link>
        </div>
      </section>

      <MeAppeals highlightAppealId={highlightAppealId} />
    </div>
  )
}
