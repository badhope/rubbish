import { useEffect, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { ArrowUpRight, Bell, CheckCheck, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { useDeleteNotification, useMarkAllRead, useMarkRead, useNotifications } from '@/hooks/api/use-modules'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Loading } from '@/components/common/state'
import { Pagination } from '@/components/common/pagination'
import { notificationDestination } from '@/lib/notification-link'
import { cn } from '@/lib/utils'
import { shortDateTime } from './format'

export function NotificationsDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [page, setPage] = useState(1)
  const notifications = useNotifications(page, 50)
  const markAll = useMarkAllRead()
  const markOne = useMarkRead()
  const remove = useDeleteNotification()
  const navigate = useNavigate()

  useEffect(() => {
    if (open) setPage(1)
  }, [open])

  const onMarkAll = async () => {
    try {
      await markAll.mutateAsync()
      toast.success('通知已全部标为已读')
    } catch {
      toast.error('操作失败，请稍后再试')
    }
  }

  const onMarkOne = async (id: number) => {
    try {
      await markOne.mutateAsync(id)
    } catch {
      toast.error('标记已读失败')
    }
  }

  const onDelete = async (id: number) => {
    try {
      await remove.mutateAsync(id)
      toast.success('通知已删除')
    } catch {
      toast.error('删除失败，请稍后再试')
    }
  }

  const openNotification = (
    id: number,
    isRead: boolean,
    destination: ReturnType<typeof notificationDestination>,
  ) => {
    if (!isRead) void onMarkOne(id)
    if (!destination) return
    if (destination.to === '/me') {
      // 这类通知没有更具体的目标；关掉弹窗留在个人中心，不要假装跳转。
      onOpenChange(false)
      return
    }
    // 直接去目标页，不先关弹窗：关闭会清理 URL 参数，和这次跳转抢同一次导航。
    void navigate({
      to: destination.to,
      params: destination.params,
      search: destination.search,
    } as never)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[86vh] max-w-2xl gap-0 overflow-hidden p-0">
        <DialogHeader className="border-b px-5 py-4">
          <div className="flex items-center justify-between gap-3 pr-6">
            <div>
              <DialogTitle className="flex items-center gap-2 text-lg">
                <Bell className="h-4 w-4 text-primary" />
                通知
              </DialogTitle>
              <DialogDescription className="mt-1 text-xs">
                最近 50 条。点一条，直接去处理；已读会自己记上。
              </DialogDescription>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void onMarkAll()}
              disabled={markAll.isPending || (notifications.data?.data.length ?? 0) === 0}
            >
              <CheckCheck className="h-3.5 w-3.5" />
              全部已读
            </Button>
          </div>
        </DialogHeader>

        <div className="min-h-0 overflow-y-auto px-5">
          {notifications.isLoading ? <Loading /> : null}
          {!notifications.isLoading && (notifications.data?.data.length ?? 0) === 0 ? (
            <div className="py-14 text-center text-sm text-muted-foreground">
              还没有通知。有人回复、提到你或关注的人发帖时会出现在这里。
            </div>
          ) : null}
          <ul className="divide-y">
            {notifications.data?.data.map((item) => {
              const destination = notificationDestination(item)
              return (
                <li key={item.id} className="group flex items-start gap-2">
                  <button
                    type="button"
                    onClick={() => openNotification(item.id, item.is_read, destination)}
                    className={cn(
                      'flex min-w-0 flex-1 items-start gap-3 py-4 text-left transition-colors hover:bg-primary/[0.03]',
                      !item.is_read && 'bg-primary/[0.025]',
                    )}
                  >
                    <span
                      aria-hidden
                      className={cn(
                        'mt-1.5 h-2 w-2 shrink-0 rounded-full',
                        item.is_read ? 'bg-transparent' : 'bg-primary',
                      )}
                    />
                    <span className="min-w-0 flex-1">
                      <span className={cn('block text-sm', !item.is_read && 'font-medium')}>
                        {item.title}
                      </span>
                      {item.body ? (
                        <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">
                          {item.body}
                        </span>
                      ) : null}
                      <span className="mt-1 flex items-center gap-2 text-[10px] text-muted-foreground">
                        <span className="font-mono">{shortDateTime(item.created_at)}</span>
                        {destination ? (
                          <span className="inline-flex items-center gap-0.5 font-medium text-primary/80">
                            {destination.label}
                            <ArrowUpRight className="h-3 w-3" />
                          </span>
                        ) : null}
                      </span>
                    </span>
                  </button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="mt-3 h-8 w-8 shrink-0 p-0 text-muted-foreground opacity-70 hover:text-destructive group-hover:opacity-100"
                    aria-label={`删除通知：${item.title}`}
                    onClick={() => void onDelete(item.id)}
                    disabled={remove.isPending}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </li>
              )
            })}
          </ul>
          {notifications.data && notifications.data.meta.total_pages > 1 ? (
            <div className="border-t py-3">
              <Pagination
                page={notifications.data.meta.page}
                totalPages={notifications.data.meta.total_pages}
                onPageChange={setPage}
              />
            </div>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  )
}
