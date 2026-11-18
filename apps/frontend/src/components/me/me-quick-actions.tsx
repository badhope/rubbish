import { Link } from '@tanstack/react-router'
import { ArrowRight, Bell, BookMarked, ClipboardCheck, FileText, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

interface QuickActionProps {
  label: string
  shortLabel: string
  hint: string
  count?: number | null
  icon: LucideIcon
  to?: '/me'
  tab?: 'submissions' | 'reviews' | 'library' | 'coins' | 'overview' | 'settings'
  onClick?: () => void
  accent?: boolean
}

function ActionBody({
  label,
  shortLabel,
  hint,
  count,
  icon: Icon,
  accent,
}: QuickActionProps) {
  return (
    <>
      <span
        className={cn(
          'hidden h-9 w-9 shrink-0 items-center justify-center border sm:flex',
          accent
            ? 'border-primary/25 bg-primary/10 text-primary'
            : 'border-border bg-muted/25 text-muted-foreground',
        )}
      >
        <Icon className="h-4 w-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline justify-between gap-1.5 sm:justify-start sm:gap-2">
          <span className="truncate text-xs font-medium sm:text-sm">
            <span className="sm:hidden">{shortLabel}</span>
            <span className="hidden sm:inline">{label}</span>
          </span>
          {count !== undefined && count !== null ? (
            <span className="font-mono text-[11px] text-muted-foreground">
              {count}
            </span>
          ) : null}
        </span>
        <span className="mt-0.5 hidden truncate text-[11px] text-muted-foreground sm:block">
          {hint}
        </span>
      </span>
      <ArrowRight className="hidden h-3.5 w-3.5 shrink-0 text-muted-foreground sm:block" />
    </>
  )
}

const actionClass =
  'group flex min-h-[62px] items-center gap-2 border bg-background px-2.5 py-2.5 text-left transition-colors hover:border-primary/45 hover:bg-primary/[0.025] sm:min-h-[76px] sm:gap-3 sm:px-3.5 sm:py-3'

export function MeQuickActions({
  submissionCount,
  reviewCount,
  libraryCount,
  unreadCount,
  reviewable,
  onOpenNotifications,
}: {
  submissionCount?: number | null
  reviewCount?: number | null
  libraryCount?: number | null
  unreadCount?: number | null
  reviewable: boolean
  onOpenNotifications: () => void
}) {
  return (
    <section aria-label="快捷入口" className="grid grid-cols-4 gap-1.5 py-5 sm:gap-2 sm:py-6">
      <Link to="/me" search={{ tab: 'submissions' }} className={actionClass}>
        <ActionBody
          label="我的投稿"
          shortLabel="投稿"
          hint="跟踪审稿与返修"
          count={submissionCount}
          icon={FileText}
          accent
        />
      </Link>
      {reviewable ? (
        <Link to="/me" search={{ tab: 'reviews' }} className={actionClass}>
          <ActionBody
            label="审稿任务"
            shortLabel="审稿"
            hint="待回应与在审"
            count={reviewCount}
            icon={ClipboardCheck}
          />
        </Link>
      ) : (
        <Link to="/rules" search={{ tab: 'levels' }} className={actionClass}>
          <ActionBody
            label="申请审稿"
            shortLabel="审稿"
            hint="查看资格与等级"
            icon={ClipboardCheck}
          />
        </Link>
      )}
      <Link to="/me" search={{ tab: 'library' }} className={actionClass}>
        <ActionBody
          label="收藏与关注"
          shortLabel="收藏"
          hint="阅读列表、作者"
          count={libraryCount}
          icon={BookMarked}
        />
      </Link>
      <button type="button" onClick={onOpenNotifications} className={actionClass}>
        <ActionBody
          label="通知"
          shortLabel="通知"
          hint={unreadCount ? `${unreadCount} 条未读` : '没有未读通知'}
          count={unreadCount || undefined}
          icon={Bell}
        />
      </button>
    </section>
  )
}
