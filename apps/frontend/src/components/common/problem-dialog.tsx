import { useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  Check,
  ClipboardCopy,
  Info,
  LifeBuoy,
  ShieldAlert,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { subscribeProblems, type Problem } from '@/lib/problem'

function toneMeta(tone: Problem['tone']) {
  if (tone === 'warning') {
    return {
      Icon: AlertTriangle,
      iconClass: 'text-amber-600',
      badge: '提醒',
      badgeClass: 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300',
    }
  }
  if (tone === 'info') {
    return {
      Icon: Info,
      iconClass: 'text-sky-600',
      badge: '提示',
      badgeClass: 'border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-300',
    }
  }
  return {
    Icon: ShieldAlert,
    iconClass: 'text-destructive',
    badge: '异常',
    badgeClass: 'border-destructive/40 bg-destructive/10 text-destructive',
  }
}

function diagnostics(problem: Problem): string {
  const lines = [
    `[Rubbish] ${problem.title}`,
    `消息：${problem.message}`,
    problem.cause ? `可能原因：${problem.cause}` : '',
    problem.hint ? `建议：${problem.hint}` : '',
    `页面：${problem.path}`,
    `时间：${problem.at}`,
    Object.entries(problem.context)
      .filter(([, value]) => value !== undefined && value !== '')
      .map(([key, value]) => `${key}：${value}`)
      .join('\n'),
  ]
  return lines.filter(Boolean).join('\n')
}

/**
 * One compact, dismissible diagnostic card for every abnormal event.
 * It stays a card even on mobile: no full-screen takeover, no dead-end page.
 */
export function ProblemDialogHost() {
  const [problem, setProblem] = useState<Problem | null>(null)
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)

  useEffect(
    () =>
      subscribeProblems((next) => {
        setProblem(next)
        setCopied(false)
        setOpen(true)
      }),
    [],
  )

  const meta = useMemo(
    () => (problem ? toneMeta(problem.tone) : toneMeta('error')),
    [problem],
  )

  const copy = async () => {
    if (!problem) return
    const payload = diagnostics(problem)
    try {
      await navigator.clipboard.writeText(payload)
      setCopied(true)
    } catch {
      // Clipboard can be unavailable on insecure origins. Keep the card open
      // and show the text in a selectable block instead of failing silently.
      setCopied(false)
    }
  }

  const { Icon } = meta

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        className="max-w-lg gap-0 overflow-hidden p-0 shadow-2xl sm:max-w-lg"
        data-testid="problem-dialog"
      >
        <DialogHeader className="border-b bg-muted/25 px-5 py-4 pr-12">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 rounded-full border p-1.5">
              <Icon className={`h-4 w-4 ${meta.iconClass}`} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <DialogTitle className="text-base">{problem?.title || '操作没有完成'}</DialogTitle>
                <Badge variant="outline" className={meta.badgeClass}>
                  {meta.badge}
                </Badge>
              </div>
              <DialogDescription className="mt-1 text-xs leading-relaxed">
                {problem?.path || '/'} · {problem ? new Date(problem.at).toLocaleString() : ''}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="max-h-[56dvh] overflow-y-auto px-5 py-4">
          <p className="break-words text-sm leading-relaxed">{problem?.message}</p>

          {problem?.cause ? (
            <div className="mt-3 rounded-md border bg-muted/35 px-3 py-2.5">
              <div className="text-[11px] font-medium text-muted-foreground">可能原因</div>
              <p className="mt-1 text-sm leading-relaxed">{problem.cause}</p>
            </div>
          ) : null}

          {problem?.hint ? (
            <div className="mt-3 flex items-start gap-2 rounded-md border border-primary/25 bg-primary/5 px-3 py-2.5">
              <LifeBuoy className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              <div>
                <div className="text-[11px] font-medium text-muted-foreground">建议下一步</div>
                <p className="mt-1 text-sm leading-relaxed">{problem.hint}</p>
              </div>
            </div>
          ) : null}

          {problem && Object.keys(problem.context).length > 0 ? (
            <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-md border px-3 py-2 text-[11px] text-muted-foreground">
              {Object.entries(problem.context)
                .filter(([, value]) => value !== undefined && value !== '')
                .map(([key, value]) => (
                  <div key={key} className="contents">
                    <dt className="font-mono uppercase">{key}</dt>
                    <dd className="break-all font-mono">{String(value)}</dd>
                  </div>
                ))}
            </dl>
          ) : null}
        </div>

        <DialogFooter className="border-t bg-muted/20 px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => void copy()}>
              {copied ? <Check className="h-3.5 w-3.5" /> : <ClipboardCopy className="h-3.5 w-3.5" />}
              {copied ? '已复制诊断' : '复制诊断信息'}
            </Button>
            <Button variant="ghost" size="sm" asChild>
              <a href="/status" onClick={() => setOpen(false)}>
                查看服务状态
              </a>
            </Button>
          </div>
          <Button size="sm" onClick={() => setOpen(false)}>
            我知道了
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
