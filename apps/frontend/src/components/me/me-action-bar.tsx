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
        <p className="text-sm font-medium">写一点东西，或者去说话区坐会儿</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          长文可以先存草稿，短帖直接留在主题论坛。
        </p>
      </div>
      <div className="flex w-full flex-wrap items-center gap-1.5 lg:w-auto lg:flex-nowrap">
        <Button variant="ghost" size="sm" onClick={onOpenNotifications} className="relative">
          <Bell className="h-3.5 w-3.5" />
          通知
          {unreadCount ? (
            <span className="ml-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 font-mono text-[10px] text-primary-foreground">
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          ) : null}
        </Button>
        <Button variant="ghost" size="sm" asChild>
          <Link to="/forum" search={{ compose: 1 }}>
            去说话
          </Link>
        </Button>
        <Button variant="ghost" size="sm" asChild>
          <Link to="/levels">参与记录</Link>
        </Button>
        <Button variant="ghost" size="sm" asChild>
          <Link to="/submissions">我的作品</Link>
        </Button>
        <Button size="sm" asChild>
          <Link to="/submissions/new">
            开始写
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </Button>
      </div>
    </section>
  )
}
