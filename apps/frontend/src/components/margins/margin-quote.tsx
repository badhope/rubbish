import { cn } from '@/lib/utils'

/**
 * The author's own words, set off by a proofreader's bracket. Used wherever a
 * passage travels: the reading page margin, the composer, the thread page and
 * the forum list. Never translated (`data-i18n-skip`), and marked with the
 * work's language so screen readers pronounce it as written.
 */
export function MarginQuote({
  text,
  lang,
  faded = false,
  clamp,
  size = 'md',
  className,
}: {
  text: string
  lang?: string
  /** the author has since revised these words */
  faded?: boolean
  clamp?: 2 | 3 | 4
  size?: 'sm' | 'md' | 'lg'
  className?: string
}) {
  return (
    <blockquote
      data-i18n-skip
      lang={lang}
      data-faded={faded ? 'true' : undefined}
      className={cn(
        'margin-quote m-0',
        size === 'sm' && 'text-[13px] leading-6',
        size === 'md' && 'text-[15px] leading-7',
        size === 'lg' && 'text-[17px] leading-8 sm:text-lg sm:leading-8',
        clamp === 2 && 'line-clamp-2',
        clamp === 3 && 'line-clamp-3',
        clamp === 4 && 'line-clamp-4',
        faded && 'text-muted-foreground',
        className,
      )}
    >
      {text}
    </blockquote>
  )
}

/** Small letter-spaced label in margin ink: 页边 / Margins. */
export function MarginLabel({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.2em] text-margin-ink',
        className,
      )}
    >
      <span aria-hidden className="inline-block h-3 w-[5px] rounded-[1px] border-[1.5px] border-r-0 border-current" />
      {children}
    </span>
  )
}
