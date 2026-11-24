import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { ChevronRight, Settings2, ShieldCheck, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/**
 * 运营快捷面板：前台浏览时不打断用户路径，只有运营/管理员展开后才出现。
 * 入口本身不暴露给普通访客；真正的权限仍由后端接口强制。
 */
export function OperatorQuickPanel({
  topicId,
  pending,
}: {
  topicId: number
  pending?: boolean
}) {
  const [open, setOpen] = useState(false)
  return (
    <div className="fixed bottom-5 right-4 z-40 sm:bottom-7 sm:right-7">
      {open ? (
        <div className="mb-2 w-56 rounded-xl border bg-background/95 p-3 shadow-lg backdrop-blur">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-xs font-semibold">运营快捷处理</p>
            <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => setOpen(false)} aria-label="收起运营快捷处理">
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
          <div className="space-y-1.5">
            <Button asChild variant="outline" size="sm" className="w-full justify-between">
              <Link to="/admin/content" search={{ section: 'moderation', topic: topicId }}>
                <span className="inline-flex items-center gap-1.5">
                  <ShieldCheck className="h-3.5 w-3.5" />
                  {pending ? '立即核验这条主题帖' : '打开人工核验队列'}
                </span>
                <ChevronRight className="h-3.5 w-3.5" />
              </Link>
            </Button>
            <Button asChild variant="ghost" size="sm" className="w-full justify-between">
              <Link to="/admin/content" search={{ section: 'forum' }}>
                <span className="inline-flex items-center gap-1.5">
                  <Settings2 className="h-3.5 w-3.5" />
                  主题巡检与置顶
                </span>
                <ChevronRight className="h-3.5 w-3.5" />
              </Link>
            </Button>
            <p className="px-1 pt-1 text-[10px] leading-4 text-muted-foreground">
              当前主题帖 #{topicId} · 处理后前台自动刷新
            </p>
          </div>
        </div>
      ) : null}
      <Button
        type="button"
        size="icon"
        aria-label="展开运营快捷处理"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className={cn(
          'h-11 w-11 rounded-full shadow-lg',
          pending ? 'bg-amber-600 hover:bg-amber-700' : 'bg-primary hover:bg-primary/90',
        )}
      >
        <ShieldCheck className="h-5 w-5" />
      </Button>
    </div>
  )
}
