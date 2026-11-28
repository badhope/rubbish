import { Link } from '@tanstack/react-router'
import { ArrowRight, BookOpen, CheckCircle2, Circle, MessageSquare, PenLine, Sparkles, UserRound } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { cn, extractError } from '@/lib/utils'
import {
  useAcknowledgeCommunity,
  useClaimForumStarter,
  useForumStarter,
} from '@/hooks/api/use-modules'

const TASK_ICON: Record<string, typeof BookOpen> = {
  rules: BookOpen,
  profile: UserRound,
  topic: PenLine,
  reply: MessageSquare,
}

/** 论坛首页的新手四项。读不到就安静不占位，不把接口故障变成一张红卡。 */
export function ForumStarterCard() {
  const starter = useForumStarter()
  const acknowledge = useAcknowledgeCommunity()
  const claim = useClaimForumStarter()

  if (starter.isLoading || starter.isError || !starter.data) return null
  const data = starter.data
  if (data.claimed) return null

  const ackRules = () => {
    acknowledge.mutate(undefined, {
      onSuccess: () => toast.success('社区规范已确认'),
      onError: () => toast.error('确认没成功，过一会儿再试'),
    })
  }

  const claimReward = () => {
    claim.mutate(undefined, {
      onSuccess: () => toast.success(`四项都完成，+${data.reward_xp} 经验`),
      onError: (err) => toast.error(extractError(err, '领取没成功，过一会儿再试')),
    })
  }

  return (
    <div className="overflow-hidden rounded-xl border bg-card/70">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3 sm:px-5">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
            <Sparkles className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-medium">新手四项</p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              先把话接上。四项都完成后，领 {data.reward_xp} 经验。
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs tabular-nums text-muted-foreground">
            {data.completed}/{data.total}
          </span>
          <div className="h-1.5 w-24 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-[width]"
              style={{ width: `${(data.completed / data.total) * 100}%` }}
            />
          </div>
        </div>
      </div>

      <div className="grid divide-y sm:grid-cols-2 sm:divide-x sm:divide-y-0">
        {data.tasks.map((task) => {
          const Icon = TASK_ICON[task.key] ?? Circle
          const inner = (
            <>
              <span
                className={cn(
                  'mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full',
                  task.done ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground',
                )}
              >
                {task.done ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Icon className="h-3.5 w-3.5" />}
              </span>
              <span className="min-w-0 flex-1">
                <span className={cn('block text-sm', task.done && 'text-muted-foreground line-through decoration-muted-foreground/40')}>
                  {task.label}
                </span>
                <span className="mt-0.5 block text-[11px] leading-5 text-muted-foreground">{task.hint}</span>
              </span>
              {!task.done ? <ArrowRight className="mt-1 h-3.5 w-3.5 shrink-0 text-muted-foreground" /> : null}
            </>
          )

          if (task.done) {
            return (
              <div key={task.key} className="flex items-start gap-3 px-4 py-3 opacity-70 sm:px-5">
                {inner}
              </div>
            )
          }

          if (task.action === 'ack_rules') {
            return (
              <button
                key={task.key}
                type="button"
                onClick={ackRules}
                disabled={acknowledge.isPending}
                className="flex items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-primary/[0.03] disabled:opacity-60 sm:px-5"
              >
                {inner}
              </button>
            )
          }

          if (task.key === 'topic') {
            return (
              <Link
                key={task.key}
                to="/forum"
                search={{ compose: 1 }}
                className="flex items-start gap-3 px-4 py-3 transition-colors hover:bg-primary/[0.03] sm:px-5"
              >
                {inner}
              </Link>
            )
          }

          if (task.key === 'profile') {
            return (
              <Link
                key={task.key}
                to="/me"
                search={{ tab: 'settings' }}
                className="flex items-start gap-3 px-4 py-3 transition-colors hover:bg-primary/[0.03] sm:px-5"
              >
                {inner}
              </Link>
            )
          }

          return (
            <Link
              key={task.key}
              to="/forum"
              className="flex items-start gap-3 px-4 py-3 transition-colors hover:bg-primary/[0.03] sm:px-5"
            >
              {inner}
            </Link>
          )
        })}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t bg-muted/20 px-4 py-3 sm:px-5">
        <p className="text-[11px] text-muted-foreground">
          {data.all_done ? '四项都齐了，可以领取。' : '不急着一次做完，先挑一项顺手的。'}
        </p>
        <Button
          size="sm"
          onClick={claimReward}
          disabled={!data.all_done || claim.isPending}
          className="h-8"
        >
          <Sparkles className="h-3.5 w-3.5" />
          {claim.isPending
            ? '领取中…'
            : data.all_done
              ? `领取 ${data.reward_xp} 经验`
              : `还差 ${data.total - data.completed} 项`}
        </Button>
      </div>
    </div>
  )
}
