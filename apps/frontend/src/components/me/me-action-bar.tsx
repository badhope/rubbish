import { Link } from '@tanstack/react-router'
import { ArrowRight, Bell } from 'lucide-react'
import { Button } from '@/components/ui/button'

export function MeActionBar({
  unreadCount,
  onOpenNotifications,
}: {
  unreadCount?: number | null
  onOpenNotifications: () => void
}) {
  return (
    <section
      aria-label="个人中心操作"
      className="flex flex-wrap items-center justify-between gap-3 border-b py-4"
    >
      <div className="min-w-0">
        <p className="text-sm font-medium">开始下一篇</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          空白、提纲或文件都可以；投稿向导会分步保存。
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <Button variant="ghost" size="sm" onClick={onOpenNotifications} className="relative">
          <Bell className="h-3.5 w-3.5" />
          通知
          {unreadCount ? (
            <span className="ml-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 font-mono text-[10px] text-primary-foreground">
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          ) : null}
        </Button>
        <Button size="sm" asChild>
          <Link to="/submissions/new">
            新建投稿
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </Button>
      </div>
    </section>
  )
}
