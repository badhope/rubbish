import { Link } from '@tanstack/react-router'
import { Clock3, ShieldCheck } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { MODERATION_STATUS_LABEL, MODERATION_STATUS_TONE } from '@/lib/forum-copy'

export interface ModerationState {
  id?: number
  moderation_status?: string | null
  risk_score?: number | null
  manual_review_reason?: string | null
  review_eta_at?: string | null
  published_at?: string | null
}

export function ModerationBadge({ status }: { status?: string | null }) {
  const key = status || 'published'
  return (
    <Badge variant="outline" className={cn('h-5 px-1.5 text-[10px]', MODERATION_STATUS_TONE[key])}>
      {MODERATION_STATUS_LABEL[key] ?? key}
    </Badge>
  )
}

function etaLabel(iso?: string | null): string {
  if (!iso) return '预计 30 分钟内完成'
  const minutes = Math.max(0, Math.round((new Date(iso).getTime() - Date.now()) / 60000))
  if (minutes <= 0) return '预计很快完成'
  return `预计 ${minutes} 分钟内完成`
}

export function ModerationNotice({
  topic,
  canOperate,
}: {
  topic: ModerationState
  canOperate?: boolean
}) {
  const status = topic.moderation_status || 'published'
  if (status === 'published' || status === 'auto_approved' || status === 'approved') return null
  const pending = status === 'manual_review' || status === 'pending'
  return (
    <div
      className={cn(
        'mb-4 rounded-xl border px-4 py-3 text-sm',
        pending
          ? 'border-amber-500/25 bg-amber-500/5'
          : 'border-sky-500/25 bg-sky-500/5',
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <ShieldCheck className="h-4 w-4 text-amber-600 dark:text-amber-300" />
        <span className="font-medium">
          {pending ? '当前内容已进入运营人工核验环节' : '当前内容需要调整'}
        </span>
        <ModerationBadge status={status} />
        {pending ? (
          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
            <Clock3 className="h-3.5 w-3.5" />
            {etaLabel(topic.review_eta_at)}
          </span>
        ) : null}
      </div>
      {topic.manual_review_reason ? (
        <p className="mt-2 text-xs leading-6 text-muted-foreground">{topic.manual_review_reason}</p>
      ) : null}
      <p className="mt-1 text-xs leading-6 text-muted-foreground">
        {pending
          ? '核验通过后会自动进入公开列表；这段时间不需要重复提交，也不会丢失草稿。'
          : '按说明修改正文后会重新进入核验，原主题帖与历史不会被删除。'}
      </p>
      {canOperate ? (
        <Link
          to="/admin/content"
          search={{ section: 'moderation', ...(topic.id ? { topic: topic.id } : {}) }}
          className="mt-2 inline-flex text-xs font-medium text-primary hover:underline"
        >
          运营快捷处理 →
        </Link>
      ) : null}
    </div>
  )
}
