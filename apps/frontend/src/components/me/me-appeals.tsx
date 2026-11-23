import { useEffect } from 'react'
import { Link } from '@tanstack/react-router'
import { Gavel } from 'lucide-react'
import { useMyAppeals } from '@/hooks/api/use-modules'
import type { AppealKind, AppealStatus } from '@/lib/types'
import { Badge } from '@/components/ui/badge'

const KIND_LABEL: Record<AppealKind, string> = {
  withdraw: '撤回作品',
  rescore: '复核作品判断',
  rescore_zone: '复核分区',
}

const STATUS_LABEL: Record<AppealStatus, string> = {
  pending: '待处理',
  accepted: '已通过',
  rejected: '已驳回',
}

const STATUS_STYLE: Record<AppealStatus, string> = {
  pending: 'border-amber-500/40 bg-amber-500/10 text-amber-700',
  accepted: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700',
  rejected: 'border-border bg-muted text-muted-foreground',
}

/** 个人的申诉记录。只有存在记录或通知深链时才渲染，避免给新用户添空白区。 */
export function MeAppeals({ highlightAppealId }: { highlightAppealId?: number }) {
  const query = useMyAppeals()
  const items = query.data?.items ?? []

  useEffect(() => {
    if (!highlightAppealId) return
    const timer = window.setTimeout(() => {
      document.getElementById(`me-appeal-${highlightAppealId}`)?.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
      })
    }, 100)
    return () => window.clearTimeout(timer)
  }, [highlightAppealId, items.length])

  if (query.isLoading) {
    return highlightAppealId ? <p className="border-y py-5 text-sm text-muted-foreground">正在读取申诉记录…</p> : null
  }
  if (items.length === 0 && !highlightAppealId) return null

  return (
    <section>
      <div className="mb-3 flex items-end justify-between gap-3">
        <div>
          <p className="text-[10px] uppercase tracking-[0.24em] text-muted-foreground">APPEALS</p>
          <h2 className="mt-1 flex items-center gap-2 font-serif text-xl tracking-tight">
            <Gavel className="h-4 w-4 text-primary" />
            我的申诉
          </h2>
        </div>
        <span className="text-xs text-muted-foreground">处理结果会同时发站内通知</span>
      </div>
      {items.length === 0 ? (
        <p className="border-y py-5 text-sm text-muted-foreground">
          通知指向的申诉不在当前账号的记录里，可能已被删除。
        </p>
      ) : (
        <div className="divide-y border-y">
          {items.map((item) => (
            <article
              key={item.id}
              id={`me-appeal-${item.id}`}
              className={`py-4 ${highlightAppealId === item.id ? 'rounded-md ring-2 ring-primary/60 ring-offset-2' : ''}`}
            >
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline" className={STATUS_STYLE[item.status]}>{STATUS_LABEL[item.status]}</Badge>
                <Badge variant="secondary">{KIND_LABEL[item.kind]}</Badge>
                <Link
                  to="/catalog/$resourceId"
                  params={{ resourceId: String(item.resource_id) }}
                  className="min-w-0 truncate text-sm font-medium hover:text-primary"
                >
                  《{item.resource_title}》
                </Link>
              </div>
              <p className="mt-1 text-[11px] text-muted-foreground">
                #{item.id} · {item.created_at ? new Date(item.created_at).toLocaleString() : '—'}
              </p>
              {item.editor_note ? (
                <p className="mt-2 whitespace-pre-wrap border-l-2 border-primary/40 bg-muted/25 px-3 py-2 text-xs leading-relaxed">
                  <span className="font-medium">处理说明：</span>{item.editor_note}
                </p>
              ) : (
                <p className="mt-2 text-xs text-muted-foreground">站务组还没有给出处理说明。</p>
              )}
            </article>
          ))}
        </div>
      )}
    </section>
  )
}
