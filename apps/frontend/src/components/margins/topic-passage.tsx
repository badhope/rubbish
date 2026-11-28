import { Link } from '@tanstack/react-router'
import { ArrowUpRight, LogIn } from 'lucide-react'
import { useAuth } from '@/hooks/use-auth'
import { detectLang, type Passage } from '@/lib/margins'
import { MarginLabel, MarginQuote } from './margin-quote'
import { useTitleMarks } from '@/hooks/use-title-marks'

interface TopicPassageProps {
  topicId: number
  paperId: number | null | undefined
  passage: Passage | null | undefined
  hasPassage: boolean
  workTitle?: string | null
  workAuthors?: string[]
}

/**
 * The opening of a margin thread: the sentence it was written beside, then
 * the question. "Read it in context" lands on that sentence in the work.
 * Readers who cannot open the work's body (overseas guests) are told a
 * passage exists and how to read it; the words themselves stay with the body.
 */
export function TopicPassage({
  topicId,
  paperId,
  passage,
  hasPassage,
  workTitle,
  workAuthors,
}: TopicPassageProps) {
  const { isAuthenticated } = useAuth()
  const marks = useTitleMarks()
  if (!hasPassage || !paperId) return null
  const lang = passage ? detectLang(`${workTitle ?? ''} ${passage.quote}`) : undefined
  const redirect = `/forum/${topicId}`

  return (
    <figure className="margin-slip m-0 mb-2 rounded-xl px-4 py-4 sm:px-5 sm:py-5">
      <figcaption className="mb-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <MarginLabel>页边</MarginLabel>
        {workTitle ? (
          <span className="min-w-0 text-[12px] text-muted-foreground">
            <span>摘自</span>
            <span data-i18n-skip lang={lang} className="mx-1 text-foreground/80">
              {`${marks[0]}${workTitle}${marks[1]}`}
            </span>
            {workAuthors?.length ? (
              <>
                <span aria-hidden>· </span>
                <span data-i18n-skip>{workAuthors.join('、')}</span>
              </>
            ) : null}
          </span>
        ) : null}
      </figcaption>

      {passage ? (
        <MarginQuote text={passage.quote} lang={lang} size="lg" />
      ) : (
        <div className="rounded-lg border border-dashed border-margin-ink-soft px-3 py-3 text-[13px] leading-6 text-muted-foreground">
          <p>这条讨论写在正文的一段话旁边。登录后可以读到那段原文。</p>
          {!isAuthenticated ? (
            <p className="mt-2 flex flex-wrap gap-3">
              <Link
                to="/login"
                search={{ redirect }}
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
      )}

      {passage ? (
        <Link
          to="/catalog/$resourceId"
          params={{ resourceId: String(paperId) }}
          search={{ passage: topicId }}
          className="mt-3 inline-flex items-center gap-1 rounded-sm text-[13px] font-medium text-margin-ink underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-margin-wash"
        >
          <span data-i18n-allow>在原文里读这一段</span>
          <ArrowUpRight className="h-3.5 w-3.5" />
        </Link>
      ) : null}
    </figure>
  )
}
