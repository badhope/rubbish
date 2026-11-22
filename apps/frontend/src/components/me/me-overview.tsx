import { Link, useNavigate } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { ArrowRight, ArrowUpRight, Bell, MessagesSquare, PenLine } from 'lucide-react'
import { useMarkRead, useNotifications } from '@/hooks/api/use-modules'
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

export function MeOverview({
  onOpenNotifications,
  highlightAppealId,
}: {
  onOpenNotifications: () => void
  highlightAppealId?: number
}) {
  const notifications = useNotifications(1, 6)
  const latestNotifications = notifications.data?.data ?? []
  const markOne = useMarkRead()
  const navigate = useNavigate()

  const openNotification = (item: (typeof latestNotifications)[number]) => {
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

  return (
    <div className="space-y-8">
      <section>
        <SectionHeading kicker="COMMUNITY" title="社区入口" />
        <div className="grid gap-3 border-y py-5 sm:grid-cols-2">
          <Link
            to="/forum"
            className="group flex items-start gap-3 rounded-lg border p-4 transition-colors hover:border-primary/40 hover:bg-primary/[0.03]"
          >
            <MessagesSquare className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            <span>
              <span className="block text-sm font-medium">去讨论区看看</span>
              <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">
                读帖、回复、收藏；先聊起来，再补记录。
              </span>
            </span>
          </Link>
          <Link
            to="/submissions/new"
            className="group flex items-start gap-3 rounded-lg border p-4 transition-colors hover:border-primary/40 hover:bg-primary/[0.03]"
          >
            <PenLine className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            <span>
              <span className="block text-sm font-medium">写点东西</span>
              <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">
                可以先存草稿；短帖留给讨论区。
              </span>
            </span>
          </Link>
        </div>
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
                onClick={() => openNotification(item)}
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

      <MeAppeals highlightAppealId={highlightAppealId} />
    </div>
  )
}
