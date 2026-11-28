import { useEffect, useId, useRef, useState } from 'react'
import { ArrowRight, Loader2, TextQuote, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { useCreateMarginTopic } from '@/hooks/api/use-work-margins'
import { cn, extractError } from '@/lib/utils'
import { useTitleMarks } from '@/hooks/use-title-marks'
import type { MarginTopic, ParagraphChoice, Passage } from '@/lib/margins'
import { MarginLabel, MarginQuote } from './margin-quote'

interface MarginComposerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  resourceId: number
  workTitle: string
  workLang?: string
  /** preset from a selection; null = ask about the whole piece */
  initialPassage: Passage | null
  /** start with the paragraph list open (keyboard and touch path) */
  startPicking?: boolean
  /** quotable paragraphs, read from the rendered article when the drawer opens */
  choices: ParagraphChoice[]
  onPassageChange?: (passage: Passage | null) => void
  onPublished: (topic: MarginTopic) => void
}

/**
 * A slip of paper beside the text. On a phone it rises from the bottom; on a
 * wider screen it slides in from the right, where the margin already is, so
 * the passage you are asking about stays visible on the left.
 */
export function MarginComposer({
  open,
  onOpenChange,
  resourceId,
  workTitle,
  workLang,
  initialPassage,
  startPicking = false,
  choices,
  onPassageChange,
  onPublished,
}: MarginComposerProps) {
  const [passage, setPassage] = useState<Passage | null>(initialPassage)
  const [picking, setPicking] = useState(startPicking && !initialPassage)
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [error, setError] = useState<string | null>(null)
  const titleRef = useRef<HTMLTextAreaElement>(null)
  const bodyRef = useRef<HTMLTextAreaElement>(null)
  const mut = useCreateMarginTopic()
  const ids = useId()
  const marks = useTitleMarks()

  // Each opening starts from what the reader just did: a fresh selection, a
  // paragraph choice, or a question about the whole piece.
  useEffect(() => {
    if (!open) return
    setPassage(initialPassage)
    setPicking(startPicking && !initialPassage)
    setError(null)
  }, [open, initialPassage, startPicking])

  useEffect(() => {
    onPassageChange?.(open ? passage : null)
  }, [open, passage, onPassageChange])

  const titleOk = title.trim().length >= 2
  const bodyOk = passage ? true : body.trim().length >= 2
  const canSend = titleOk && bodyOk && !mut.isPending

  const send = async () => {
    if (!canSend) return
    setError(null)
    try {
      const topic = await mut.mutateAsync({ resourceId, title, body, passage })
      setTitle('')
      setBody('')
      onOpenChange(false)
      onPublished(topic)
      if (topic.moderation_status === 'manual_review') {
        toast.success('已提交。核验通过后，其他读者会在页边看到它。')
      } else {
        toast.success('已写进页边，也发到了主题论坛。')
      }
    } catch (err) {
      const detail = (err as { response?: { data?: { detail?: { code?: string; message?: string } } } })
        ?.response?.data?.detail
      if (detail && typeof detail === 'object' && detail.code === 'passage_not_found') {
        setError('这段文字和作品正文对不上，可能作者刚改过。请回到正文重新选一次。')
      } else {
        setError(extractError(err, '没有发出去，请稍后再试。'))
      }
    }
  }

  const choose = (choice: ParagraphChoice) => {
    setPassage(choice.passage)
    setPicking(false)
    window.requestAnimationFrame(() => titleRef.current?.focus())
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        onOpenAutoFocus={(event) => {
          if (picking) return
          event.preventDefault()
          titleRef.current?.focus()
        }}
        className={cn(
          'margin-slip flex max-h-[92dvh] flex-col gap-0 overflow-hidden p-0',
          // phone: bottom sheet
          'top-auto bottom-0 left-0 w-full max-w-none translate-x-0 translate-y-0 rounded-t-2xl rounded-b-none border-x-0 border-b-0',
          'data-[state=open]:slide-in-from-bottom-8 data-[state=closed]:slide-out-to-bottom-8',
          // wider: a slip along the right edge, where the margin is
          'sm:top-0 sm:right-0 sm:bottom-0 sm:left-auto sm:h-[100dvh] sm:max-h-none sm:w-[460px] sm:max-w-[calc(100vw-2rem)] sm:rounded-none sm:rounded-l-2xl sm:border-y-0 sm:border-r-0 sm:border-l',
          'sm:data-[state=open]:slide-in-from-right-8 sm:data-[state=closed]:slide-out-to-right-8 data-[state=open]:zoom-in-100 data-[state=closed]:zoom-out-100',
        )}
      >
        <div className="flex items-start justify-between gap-3 border-b px-5 pt-4 pb-3 sm:px-6 sm:pt-6">
          <div className="min-w-0">
            <MarginLabel>页边</MarginLabel>
            <DialogTitle className="mt-2 font-serif text-xl leading-snug tracking-tight">
              在页边提问
            </DialogTitle>
            <DialogDescription className="mt-1 text-[13px] leading-5 text-muted-foreground">
              <span>写在</span>
              <span data-i18n-skip lang={workLang} className="mx-0.5 font-medium text-foreground">
                {`${marks[0]}${workTitle}${marks[1]}`}
              </span>
              <span>旁边。</span>{' '}
              <span>问题会发到主题论坛，回应在那里继续。</span>
            </DialogDescription>
          </div>
          <Button
            variant="ghost"
            size="icon-sm"
            className="-mr-2 shrink-0 text-muted-foreground"
            aria-label="关闭"
            onClick={() => onOpenChange(false)}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        <form
          className="flex min-h-0 flex-1 flex-col"
          onSubmit={(event) => {
            event.preventDefault()
            void send()
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
              event.preventDefault()
              void send()
            }
          }}
        >
          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-5 sm:px-6">
            <section aria-labelledby={`${ids}-passage`}>
              <div className="mb-2 flex items-center justify-between gap-2">
                <h3 id={`${ids}-passage`} className="margin-caption text-xs font-medium text-muted-foreground">
                  {passage ? '你在问这一段' : '引一段原文（可选）'}
                </h3>
                {passage ? (
                  <div className="flex items-center gap-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="xs"
                      className="text-margin-ink hover:text-margin-ink"
                      onClick={() => setPicking(true)}
                    >
                      换一段
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="xs"
                      className="text-muted-foreground"
                      onClick={() => {
                        setPassage(null)
                        setPicking(false)
                      }}
                    >
                      改问整篇
                    </Button>
                  </div>
                ) : null}
              </div>

              {passage && !picking ? (
                <MarginQuote text={passage.quote} lang={workLang} clamp={4} />
              ) : null}

              {!passage && !picking ? (
                <button
                  type="button"
                  onClick={() => setPicking(true)}
                  disabled={choices.length === 0}
                  className="flex w-full items-center gap-2 rounded-lg border border-dashed border-margin-ink-soft px-3 py-3 text-left text-sm text-muted-foreground transition-colors hover:border-margin-ink hover:bg-margin-wash hover:text-foreground focus-visible:border-margin-ink focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-margin-wash disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <TextQuote className="h-4 w-4 shrink-0 text-margin-ink" />
                  <span className="min-w-0 flex-1">从正文里选一段；不选就是问整篇。</span>
                  <ArrowRight className="h-4 w-4 shrink-0" />
                </button>
              ) : null}

              {picking ? (
                <fieldset className="space-y-1.5">
                  <legend className="sr-only">选择要引用的段落</legend>
                  <p className="mb-2 text-[12px] leading-5 text-muted-foreground">
                    方向键在段落间移动，回车确认。想引更短的一句，可以直接在正文里选中。
                  </p>
                  <div className="max-h-[38dvh] space-y-1.5 overflow-y-auto pr-1 sm:max-h-[46dvh]">
                    {choices.map((choice, index) => {
                      const id = `${ids}-${choice.key}`
                      const checked = passage?.quote === choice.passage.quote
                      return (
                        <label
                          key={choice.key}
                          htmlFor={id}
                          // A pointer click chooses at once; arrow keys only move the
                          // preview, and Enter confirms (see the input's onKeyDown).
                          onClick={(event) => {
                            if (!(event.target instanceof HTMLInputElement)) choose(choice)
                          }}
                          className={cn(
                            'group flex cursor-pointer gap-3 rounded-lg border px-3 py-2.5 transition-colors',
                            'hover:border-margin-ink-soft hover:bg-margin-wash',
                            'has-[:focus-visible]:border-margin-ink has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-margin-wash',
                            checked ? 'border-margin-ink bg-margin-wash' : 'border-border bg-background/60',
                          )}
                        >
                          <input
                            id={id}
                            type="radio"
                            name={`${ids}-paragraph`}
                            className="sr-only"
                            checked={checked}
                            autoFocus={index === 0 && !passage}
                            onChange={() => setPassage(choice.passage)}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter') {
                                event.preventDefault()
                                event.stopPropagation()
                                choose(choice)
                              }
                            }}
                          />
                          <span
                            aria-hidden
                            className="mt-1 text-[11px] font-medium tabular-nums text-margin-ink"
                          >
                            ¶{index + 1}
                          </span>
                          <span
                            data-i18n-skip
                            lang={workLang}
                            className="line-clamp-3 min-w-0 flex-1 font-serif text-[14px] leading-6"
                          >
                            {choice.passage.quote}
                            {choice.trimmed ? '…' : ''}
                          </span>
                        </label>
                      )
                    })}
                  </div>
                  <div className="flex justify-end pt-1">
                    <Button type="button" variant="ghost" size="xs" onClick={() => setPicking(false)}>
                      收起
                    </Button>
                  </div>
                </fieldset>
              ) : null}
            </section>

            <div className="space-y-1.5">
              <label htmlFor={`${ids}-title`} className="text-xs font-medium text-muted-foreground">
                你的问题
              </label>
              {/* A question can run two lines; the field grows instead of clipping it.
                  Enter moves on to "say more" rather than inserting a line break. */}
              <textarea
                id={`${ids}-title`}
                ref={titleRef}
                value={title}
                onChange={(event) => setTitle(event.target.value.replace(/\s*\n\s*/g, ' '))}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.metaKey && !event.ctrlKey && !event.nativeEvent.isComposing) {
                    event.preventDefault()
                    bodyRef.current?.focus()
                  }
                }}
                rows={1}
                maxLength={200}
                required
                aria-invalid={error ? true : undefined}
                placeholder={passage ? '关于这一段，你想问什么？' : '读完整篇，你想问什么？'}
                className="block min-h-10 w-full resize-none border-0 border-b border-border bg-transparent px-0 pb-2 font-serif text-[19px] leading-8 outline-none transition-colors [field-sizing:content] placeholder:text-muted-foreground/70 focus:border-margin-ink"
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor={`${ids}-body`} className="text-xs font-medium text-muted-foreground">
                {passage ? '多说一点（可选）' : '多说一点'}
              </label>
              <textarea
                id={`${ids}-body`}
                ref={bodyRef}
                value={body}
                onChange={(event) => setBody(event.target.value)}
                rows={5}
                maxLength={20000}
                placeholder="你读到了什么、卡在哪里、想听谁说说……支持 Markdown。"
                className="w-full resize-y rounded-lg border bg-background/70 px-3 py-2.5 text-[15px] leading-7 outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-margin-ink focus:ring-[3px] focus:ring-margin-wash"
              />
            </div>

            {error ? (
              <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                {error}
              </p>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t px-5 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] sm:px-6 sm:py-4">
            <p className="min-w-0 flex-1 basis-56 text-[11px] leading-5 text-muted-foreground">
              发在「写作讨论」，并留在这篇作品的页边。Ctrl / ⌘ + Enter 发布。
            </p>
            <div className="flex items-center gap-2">
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
                取消
              </Button>
              <Button type="submit" disabled={!canSend} className="min-w-24">
                {mut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {mut.isPending ? '发布中…' : '写进页边'}
              </Button>
            </div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
