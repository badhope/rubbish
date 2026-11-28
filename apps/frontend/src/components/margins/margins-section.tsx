import { Link } from '@tanstack/react-router'
import { ArrowRight, LogIn, MessageSquarePlus, ScanText, TextQuote } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { authorLabel, type MarginTopic, type Passage } from '@/lib/margins'
import type { MarginGroup } from './margin-layer'
import { MarginLabel, MarginQuote } from './margin-quote'

function TopicLine({ topic, onShow }: { topic: MarginTopic; onShow?: () => void }) {
  return (
    <div className="min-w-0">
      <Link
        to="/forum/$topicId"
        params={{ topicId: String(topic.id) }}
        className="group inline-flex max-w-full items-start gap-1.5 rounded-sm font-serif text-[17px] leading-snug text-foreground underline-offset-4 hover:text-margin-ink hover:underline focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-margin-wash"
      >
        <span data-i18n-skip className="min-w-0 break-words">
          {topic.title}
        </span>
        <ArrowRight className="mt-1 h-4 w-4 shrink-0 opacity-40 transition-opacity group-hover:opacity-100" />
      </Link>
      <p className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[12px] text-muted-foreground">
        <span data-i18n-skip>{authorLabel(topic.author)}</span>
        <span aria-hidden>·</span>
        <span>{`${topic.reply_count} 回应`}</span>
        {topic.moderation_status === 'manual_review' ? (
          <span className="rounded-full border border-amber-400/60 px-1.5 text-[11px] text-amber-700 dark:text-amber-300">
            核验中，暂时只有你看得到
          </span>
        ) : null}
        {onShow ? (
          <>
            <span aria-hidden>·</span>
            <button
              type="button"
              onClick={onShow}
              className="inline-flex items-center gap-1 rounded-sm font-medium text-margin-ink hover:underline focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-margin-wash"
            >
              <ScanText className="h-3.5 w-3.5" />
              在原文里看
            </button>
          </>
        ) : null}
      </p>
    </div>
  )
}

interface MarginsSectionProps {
  groups: MarginGroup[]
  whole: MarginTopic[]
  hidden: MarginTopic[]
  /** keys of groups found in today's text, in reading order */
  located: string[]
  /** anchored groups already sit in the rail beside the text */
  railShowsAnchored: boolean
  canWrite: boolean
  isAuthenticated: boolean
  loading: boolean
  workLang?: string
  loginRedirect: string
  onCompose: (passage: Passage | null, options?: { pick?: boolean }) => void
  onShowPassage: (key: string) => void
}

/**
 * The index of a work's margins, under the text. On a phone it is the main
 * way in; beside the desktop rail it keeps the whole-piece questions and any
 * passage the author has since rewritten.
 */
export function MarginsSection({
  groups,
  whole,
  hidden,
  located,
  railShowsAnchored,
  canWrite,
  isAuthenticated,
  loading,
  workLang,
  loginRedirect,
  onCompose,
  onShowPassage,
}: MarginsSectionProps) {
  const byKey = new Map(groups.map((g) => [g.key, g]))
  const found = located.map((key) => byKey.get(key)).filter((g): g is MarginGroup => !!g)
  const revised = groups.filter((g) => !located.includes(g.key))
  const anchoredCount = found.reduce((n, g) => n + g.topics.length, 0)
  const total = anchoredCount + revised.reduce((n, g) => n + g.topics.length, 0) + whole.length + hidden.length

  return (
    <section id="margins" aria-labelledby="margins-title" className="mt-12 scroll-mt-24 border-t border-dashed border-margin-ink-soft pt-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0 max-w-xl">
          <MarginLabel>页边</MarginLabel>
          <h2 id="margins-title" className="mt-2 font-serif text-[1.6rem] leading-tight tracking-tight">
            读者在页边写下的问题
          </h2>
          <p className="mt-2 text-[14px] leading-6 text-muted-foreground">
            {canWrite
              ? '选中正文里的一句话就能提问。每个问题都会成为主题论坛里的一条讨论，回应也在那里继续。'
              : '读者可以选中正文里的一句话提问；每个问题都是主题论坛里的一条讨论。'}
          </p>
        </div>
        {canWrite ? (
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              className="border-margin-ink-soft text-margin-ink hover:border-margin-ink hover:bg-margin-wash hover:text-margin-ink"
              onClick={() => onCompose(null, { pick: true })}
            >
              <TextQuote className="h-4 w-4" />
              选一段提问
            </Button>
            <Button type="button" variant="ghost" onClick={() => onCompose(null)}>
              <MessageSquarePlus className="h-4 w-4" />
              问整篇
            </Button>
          </div>
        ) : null}
      </div>

      {loading ? (
        <div className="mt-6 space-y-3" aria-busy="true">
          <div className="skeleton-shimmer h-4 w-2/3 rounded" />
          <div className="skeleton-shimmer h-4 w-1/2 rounded" />
        </div>
      ) : total === 0 ? (
        <p className="mt-6 rounded-xl border border-dashed border-margin-ink-soft px-4 py-5 text-[14px] leading-6 text-muted-foreground">
          还没有人在页边留下问题。第一句可以是你的。
        </p>
      ) : (
        <div className="mt-6 space-y-8">
          {railShowsAnchored && anchoredCount > 0 ? (
            <p className="hidden items-center gap-2 text-[13px] text-muted-foreground xl:flex">
              <span className="inline-block h-px w-6 bg-margin-ink-soft" aria-hidden />
              <span>{`${anchoredCount} 条讨论贴在正文右侧的页边上`}</span>
            </p>
          ) : null}

          {found.length ? (
            <ol className={cn('space-y-6', railShowsAnchored && 'xl:hidden')}>
              {found.map((group) => (
                <li key={group.key} className="space-y-3">
                  <MarginQuote text={group.passage.quote} lang={workLang} clamp={4} />
                  <div className="space-y-3 pl-[1.05rem]">
                    {group.topics.map((topic) => (
                      <TopicLine key={topic.id} topic={topic} onShow={() => onShowPassage(group.key)} />
                    ))}
                  </div>
                </li>
              ))}
            </ol>
          ) : null}

          {revised.length ? (
            <div className="space-y-4">
              <h3 className="margin-caption text-xs font-medium text-muted-foreground">原文已经改过的段落</h3>
              <ol className="space-y-6">
                {revised.map((group) => (
                  <li key={group.key} className="space-y-3">
                    <MarginQuote text={group.passage.quote} lang={workLang} faded clamp={3} />
                    <div className="space-y-3 pl-[1.05rem]">
                      {group.topics.map((topic) => (
                        <TopicLine key={topic.id} topic={topic} />
                      ))}
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          ) : null}

          {hidden.length ? (
            <div className="space-y-4">
              <div className="rounded-xl border border-dashed border-margin-ink-soft px-4 py-3 text-[13px] leading-6 text-muted-foreground">
                <p>这些讨论引用了正文里的句子。登录后可以读到原文，也能看到它在文中的位置。</p>
                {!isAuthenticated ? (
                  <p className="mt-2 flex flex-wrap gap-3">
                    <Link
                      to="/login"
                      search={{ redirect: loginRedirect }}
                      className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
                    >
                      <LogIn className="h-3.5 w-3.5" />
                      登录
                    </Link>
                    <Link to="/register" className="font-medium text-primary hover:underline">
                      注册
                    </Link>
                  </p>
                ) : null}
              </div>
              <ol className="space-y-5">
                {hidden.map((topic) => (
                  <li key={topic.id} className="pl-[1.05rem]">
                    <TopicLine topic={topic} />
                  </li>
                ))}
              </ol>
            </div>
          ) : null}

          {whole.length ? (
            <div className="space-y-4">
              <h3 className="margin-caption text-xs font-medium text-muted-foreground">关于整篇</h3>
              <ol className="space-y-5">
                {whole.map((topic) => (
                  <li key={topic.id} data-margin-whole={topic.id} className="rounded-lg pl-[1.05rem] transition-colors">
                    <TopicLine topic={topic} />
                  </li>
                ))}
              </ol>
            </div>
          ) : null}
        </div>
      )}
    </section>
  )
}

/** Below the rail breakpoint: tapping a mark opens that passage's threads here. */
export function MarginThreadsSheet({
  group,
  open,
  onOpenChange,
  canWrite,
  workLang,
  onCompose,
}: {
  group: MarginGroup | null
  open: boolean
  onOpenChange: (open: boolean) => void
  canWrite: boolean
  workLang?: string
  onCompose: (passage: Passage) => void
}) {
  return (
    <Dialog open={open && !!group} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          'margin-slip gap-0 p-0',
          'top-auto bottom-0 left-0 max-h-[82dvh] w-full max-w-none translate-x-0 translate-y-0 rounded-t-2xl rounded-b-none border-x-0 border-b-0',
          'data-[state=open]:slide-in-from-bottom-8 data-[state=closed]:slide-out-to-bottom-8 data-[state=open]:zoom-in-100 data-[state=closed]:zoom-out-100',
          'sm:top-[50dvh] sm:bottom-auto sm:left-1/2 sm:max-w-lg sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl sm:border',
        )}
      >
        {group ? (
          <div className="flex max-h-[82dvh] flex-col">
            <div className="space-y-3 border-b px-5 pt-5 pb-4">
              <MarginLabel>页边</MarginLabel>
              <DialogTitle className="sr-only">这段的页边讨论</DialogTitle>
              <DialogDescription asChild>
                <div>
                  <MarginQuote text={group.passage.quote} lang={workLang} size="lg" />
                </div>
              </DialogDescription>
            </div>
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
              {group.topics.map((topic) => (
                <TopicLine key={topic.id} topic={topic} />
              ))}
            </div>
            {canWrite ? (
              <div className="border-t px-5 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
                <Button
                  type="button"
                  className="w-full"
                  onClick={() => onCompose(group.passage)}
                >
                  <MessageSquarePlus className="h-4 w-4" />
                  在这段继续问
                </Button>
              </div>
            ) : null}
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
