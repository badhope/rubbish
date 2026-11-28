import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { MessageSquarePlus, Plus, TextQuote } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import {
  authorLabel,
  buildTextIndex,
  findPassage,
  passageFromRange,
  rangeFor,
  type MarginTopic,
  type Passage,
  type SelectionResult,
  type TextIndex,
} from '@/lib/margins'
import { MarginLabel, MarginQuote } from './margin-quote'

export interface MarginGroup {
  key: string
  passage: Passage
  topics: MarginTopic[]
}

interface Placed {
  key: string
  range: Range
  /** first line box, relative to the wrapper */
  top: number
  height: number
}

interface MarginLayerProps {
  /** positioned (relative) ancestor of the article; all coordinates are relative to it */
  wrapper: HTMLElement | null
  /** the rendered `.markdown-body` article */
  article: HTMLElement | null
  groups: MarginGroup[]
  activeKey: string | null
  onActivate: (key: string | null) => void
  /** below the rail breakpoint, a mark opens the passage's threads in a sheet */
  onOpenGroup: (key: string) => void
  onCompose: (passage: Passage | null, options?: { pick?: boolean }) => void
  /** passage currently being written about (composer open) */
  draftPassage: Passage | null
  canWrite: boolean
  showRail: boolean
  workLang?: string
  /** scroll this group into view once it is placed, then report back */
  focusKey: string | null
  onFocused: () => void
  /** keys of the passages found in today's text, in reading order */
  onLocated: (keys: string[]) => void
}

const RAIL_GAP = 12
const MARK = 22

type HighlightCtor = new (...ranges: Range[]) => unknown
type HighlightRegistry = { set: (name: string, h: unknown) => void; delete: (name: string) => void }

function highlightApi(): { registry: HighlightRegistry; Ctor: HighlightCtor } | null {
  const registry = (globalThis.CSS as unknown as { highlights?: HighlightRegistry } | undefined)?.highlights
  const Ctor = (globalThis as unknown as { Highlight?: HighlightCtor }).Highlight
  return registry && Ctor ? { registry, Ctor } : null
}

function useCoarsePointer(): boolean {
  const [coarse, setCoarse] = useState(() =>
    typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: coarse)').matches,
  )
  useEffect(() => {
    const mql = window.matchMedia?.('(pointer: coarse)')
    if (!mql) return
    const on = () => setCoarse(mql.matches)
    mql.addEventListener('change', on)
    return () => mql.removeEventListener('change', on)
  }, [])
  return coarse
}

function relTime(iso: string | null): string {
  if (!iso) return ''
  const diff = Date.now() - new Date(iso).getTime()
  const min = Math.round(diff / 60000)
  if (min < 1) return '刚刚'
  if (min < 60) return `${min} 分钟前`
  const hr = Math.round(min / 60)
  if (hr < 24) return `${hr} 小时前`
  return `${Math.round(hr / 24)} 天前`
}

/**
 * Everything the margin draws on top of the article. The Markdown DOM is
 * never touched: passages are painted with the CSS Highlight API, and marks,
 * slips and the selection button are positioned in an overlay.
 */
export function MarginLayer({
  wrapper,
  article,
  groups,
  activeKey,
  onActivate,
  onOpenGroup,
  onCompose,
  draftPassage,
  canWrite,
  showRail,
  workLang,
  focusKey,
  onFocused,
  onLocated,
}: MarginLayerProps) {
  const [index, setIndex] = useState<TextIndex | null>(null)
  const [layoutTick, setLayoutTick] = useState(0)
  const [hoverKey, setHoverKey] = useState<string | null>(null)
  const [selection, setSelection] = useState<
    { result: SelectionResult; x: number; y: number } | null
  >(null)
  const coarse = useCoarsePointer()
  const railHeaderRef = useRef<HTMLDivElement>(null)
  const slipRefs = useRef(new Map<string, HTMLDivElement>())
  const [slipHeights, setSlipHeights] = useState<Record<string, number>>({})
  const [headerHeight, setHeaderHeight] = useState(0)

  // 1. Index the article's text, and re-index if its content changes.
  useEffect(() => {
    if (!article) {
      setIndex(null)
      return
    }
    const rebuild = () => setIndex(buildTextIndex(article))
    rebuild()
    const mo = new MutationObserver(rebuild)
    mo.observe(article, { childList: true, subtree: true, characterData: true })
    return () => mo.disconnect()
  }, [article])

  // 2. Re-measure when anything that moves lines around changes:
  //    window width, reading-size preferences, late fonts and images.
  useEffect(() => {
    if (!article || !wrapper) return
    const bump = () => setLayoutTick((n) => n + 1)
    const ro = new ResizeObserver(bump)
    ro.observe(article)
    ro.observe(wrapper)
    void document.fonts?.ready.then(bump)
    window.addEventListener('resize', bump)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', bump)
    }
  }, [article, wrapper])

  const { ranges, order } = useMemo(() => {
    const map = new Map<string, Range>()
    const starts: Array<[string, number]> = []
    if (index) {
      for (const group of groups) {
        const hit = findPassage(index, group.passage)
        const range = hit ? rangeFor(index, hit.start, hit.end) : null
        if (hit && range) {
          map.set(group.key, range)
          starts.push([group.key, hit.start])
        }
      }
    }
    return { ranges: map, order: starts.sort((a, b) => a[1] - b[1]).map(([key]) => key) }
  }, [index, groups])

  useEffect(() => {
    onLocated(order)
  }, [order, onLocated])

  const placed: Placed[] = useMemo(() => {
    void layoutTick
    if (!wrapper) return []
    const origin = wrapper.getBoundingClientRect()
    const out: Placed[] = []
    for (const group of groups) {
      const range = ranges.get(group.key)
      if (!range) continue
      const first = range.getClientRects()[0] ?? range.getBoundingClientRect()
      out.push({ key: group.key, range, top: first.top - origin.top, height: first.height })
    }
    return out.sort((a, b) => a.top - b.top)
  }, [groups, ranges, wrapper, layoutTick])

  // 3. Paint passages. The emphasised one (hovered slip or active mark) is darker.
  const emphasis = hoverKey ?? activeKey
  useEffect(() => {
    const api = highlightApi()
    if (!api) return
    const quiet = placed.filter((p) => p.key !== emphasis).map((p) => p.range)
    const loud = placed.find((p) => p.key === emphasis)?.range
    api.registry.set('margin-passage', new api.Ctor(...quiet))
    if (loud) api.registry.set('margin-passage-active', new api.Ctor(loud))
    else api.registry.delete('margin-passage-active')
    return () => {
      api.registry.delete('margin-passage')
      api.registry.delete('margin-passage-active')
    }
  }, [placed, emphasis])

  useEffect(() => {
    const api = highlightApi()
    if (!api || !index || !draftPassage) return
    const hit = findPassage(index, draftPassage)
    const range = hit ? rangeFor(index, hit.start, hit.end) : null
    if (!range) return
    api.registry.set('margin-draft', new api.Ctor(range))
    return () => api.registry.delete('margin-draft')
  }, [index, draftPassage])

  // 4. Deep links (?passage=) and freshly published notes scroll into place.
  useEffect(() => {
    if (!focusKey) return
    const target = placed.find((p) => p.key === focusKey)
    if (!target || !wrapper) return
    const y = wrapper.getBoundingClientRect().top + window.scrollY + target.top
    window.scrollTo({ top: Math.max(0, y - 160), behavior: 'smooth' })
    onActivate(focusKey)
    onFocused()
  }, [focusKey, placed, wrapper, onActivate, onFocused])

  // 5. Selection → "discuss this passage".
  useEffect(() => {
    if (!article || !wrapper || !canWrite) return
    let timer: number | undefined
    const read = () => {
      const sel = document.getSelection()
      if (!sel || sel.rangeCount === 0 || sel.isCollapsed) {
        setSelection(null)
        return
      }
      const range = sel.getRangeAt(0)
      if (!article.contains(range.commonAncestorContainer)) {
        setSelection(null)
        return
      }
      const result = passageFromRange(article, range)
      const rects = range.getClientRects()
      const last = rects[rects.length - 1] ?? range.getBoundingClientRect()
      const origin = wrapper.getBoundingClientRect()
      setSelection({ result, x: last.right - origin.left, y: last.bottom - origin.top })
    }
    const onChange = () => {
      window.clearTimeout(timer)
      timer = window.setTimeout(read, 140)
    }
    document.addEventListener('selectionchange', onChange)
    return () => {
      window.clearTimeout(timer)
      document.removeEventListener('selectionchange', onChange)
    }
  }, [article, wrapper, canWrite])

  // 6. Tapping painted words opens their margin, like tapping a pencil mark.
  useEffect(() => {
    if (!article) return
    const onClick = (event: MouseEvent) => {
      const sel = document.getSelection()
      if (sel && !sel.isCollapsed) return
      for (const p of placed) {
        for (const r of Array.from(p.range.getClientRects())) {
          if (
            event.clientX >= r.left - 2 &&
            event.clientX <= r.right + 2 &&
            event.clientY >= r.top - 2 &&
            event.clientY <= r.bottom + 2
          ) {
            if (showRail) onActivate(p.key)
            else onOpenGroup(p.key)
            return
          }
        }
      }
    }
    article.addEventListener('click', onClick)
    return () => article.removeEventListener('click', onClick)
  }, [article, placed, showRail, onActivate, onOpenGroup])

  // 7. Rail slips stack beside their passages without overlapping.
  const measureSlips = useCallback(() => {
    const next: Record<string, number> = {}
    slipRefs.current.forEach((el, key) => {
      next[key] = el.offsetHeight
    })
    setSlipHeights((prev) => {
      const same =
        Object.keys(next).length === Object.keys(prev).length &&
        Object.entries(next).every(([k, v]) => prev[k] === v)
      return same ? prev : next
    })
    setHeaderHeight(railHeaderRef.current?.offsetHeight ?? 0)
  }, [])

  useLayoutEffect(() => {
    if (!showRail) return
    measureSlips()
  }, [showRail, placed, groups, emphasis, measureSlips])

  useEffect(() => {
    if (!showRail) return
    const ro = new ResizeObserver(measureSlips)
    slipRefs.current.forEach((el) => ro.observe(el))
    if (railHeaderRef.current) ro.observe(railHeaderRef.current)
    return () => ro.disconnect()
  }, [showRail, placed, measureSlips])

  const slipTops = useMemo(() => {
    const tops: Record<string, number> = {}
    let floor = headerHeight ? headerHeight + 20 : 0
    for (const p of placed) {
      const desired = p.top - 6
      const top = Math.max(desired, floor)
      tops[p.key] = top
      floor = top + (slipHeights[p.key] ?? 120) + RAIL_GAP
    }
    return tops
  }, [placed, slipHeights, headerHeight])

  const articleLeft = useMemo(() => {
    void layoutTick
    if (!article || !wrapper) return 0
    return article.getBoundingClientRect().left - wrapper.getBoundingClientRect().left
  }, [article, wrapper, layoutTick])

  const byKey = useMemo(() => new Map(groups.map((g) => [g.key, g])), [groups])

  const discussSelection = () => {
    if (!selection?.result.ok) return
    const passage = selection.result.passage
    document.getSelection()?.removeAllRanges()
    setSelection(null)
    onCompose(passage)
  }

  const wrapperWidth = wrapper?.clientWidth ?? 0

  return (
    <>
      {/* Gutter marks: one per discussed passage, keyboard-reachable. */}
      {placed.map((p) => {
        const group = byKey.get(p.key)
        if (!group) return null
        const active = emphasis === p.key
        const count = group.topics.length
        return (
          <button
            key={p.key}
            type="button"
            data-margin-mark={p.key}
            className={cn(
              'margin-mark absolute z-10 grid place-items-center rounded-md border text-[11px] font-semibold tabular-nums',
              'before:absolute before:-inset-2.5 before:content-[""]',
              'focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-margin-wash',
              active
                ? 'border-margin-ink bg-margin-ink text-background'
                : 'border-margin-ink-soft bg-margin-paper text-margin-ink hover:border-margin-ink hover:bg-margin-wash',
            )}
            style={{
              width: MARK,
              height: MARK,
              top: p.top + Math.max(0, (p.height - MARK) / 2),
              left: Math.max(-8, articleLeft - MARK - 8),
            }}
            aria-pressed={showRail ? active : undefined}
            aria-label={`页边有 ${count} 条讨论：${group.passage.quote.slice(0, 40)}`}
            onMouseEnter={() => setHoverKey(p.key)}
            onMouseLeave={() => setHoverKey(null)}
            onFocus={() => setHoverKey(p.key)}
            onBlur={() => setHoverKey(null)}
            onClick={() => (showRail ? onActivate(active && activeKey === p.key ? null : p.key) : onOpenGroup(p.key))}
          >
            {count}
          </button>
        )
      })}

      {/* The rail: the page's real margin, from 1280px up. */}
      {showRail ? (
        <aside
          aria-label="页边"
          className="absolute top-0 hidden w-[288px] xl:block"
          style={{ left: wrapperWidth + 40, bottom: 0 }}
        >
          <div ref={railHeaderRef} className="border-l border-dashed border-margin-ink-soft pl-4">
            <MarginLabel>页边</MarginLabel>
            <p className="mt-2 text-[13px] leading-6 text-muted-foreground">
              {placed.length ? '划线的句子旁边，是读者留下的问题。' : '在正文里选中一句话，就能在这里提问。'}
            </p>
            {canWrite ? (
              <div className="mt-2 flex flex-wrap gap-1.5">
                <Button
                  type="button"
                  size="xs"
                  variant="outline"
                  className="border-margin-ink-soft text-margin-ink hover:border-margin-ink hover:bg-margin-wash hover:text-margin-ink"
                  onClick={() => onCompose(null, { pick: true })}
                >
                  <TextQuote className="h-3.5 w-3.5" />
                  选一段提问
                </Button>
                <Button
                  type="button"
                  size="xs"
                  variant="ghost"
                  className="text-muted-foreground"
                  onClick={() => onCompose(null)}
                >
                  问整篇
                </Button>
              </div>
            ) : null}
          </div>

          {placed.map((p) => {
            const group = byKey.get(p.key)
            if (!group) return null
            const active = emphasis === p.key
            return (
              <div
                key={p.key}
                ref={(el) => {
                  if (el) slipRefs.current.set(p.key, el)
                  else slipRefs.current.delete(p.key)
                }}
                data-active={active ? 'true' : undefined}
                data-margin-slip={p.key}
                className="margin-slip absolute inset-x-0 rounded-xl p-3.5"
                style={{ top: slipTops[p.key] ?? p.top }}
                onMouseEnter={() => setHoverKey(p.key)}
                onMouseLeave={() => setHoverKey(null)}
              >
                <button
                  type="button"
                  className="block w-full rounded-md text-left focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-margin-wash"
                  aria-pressed={active}
                  aria-label={`在正文中标出：${group.passage.quote.slice(0, 40)}`}
                  onFocus={() => setHoverKey(p.key)}
                  onBlur={() => setHoverKey(null)}
                  onClick={() => onActivate(activeKey === p.key ? null : p.key)}
                >
                  <MarginQuote text={group.passage.quote} lang={workLang} size="sm" clamp={active ? undefined : 2} />
                </button>
                <ul className="mt-2.5 space-y-2.5 border-t border-dashed border-margin-ink-soft/60 pt-2.5">
                  {group.topics.map((topic) => (
                    <li key={topic.id}>
                      <Link
                        to="/forum/$topicId"
                        params={{ topicId: String(topic.id) }}
                        className="block rounded-sm text-[14px] font-medium leading-5 text-foreground underline-offset-4 hover:text-margin-ink hover:underline focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-margin-wash"
                        onFocus={() => setHoverKey(p.key)}
                        onBlur={() => setHoverKey(null)}
                      >
                        <span data-i18n-skip>{topic.title}</span>
                      </Link>
                      <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[11px] text-muted-foreground">
                        <span data-i18n-skip>{authorLabel(topic.author)}</span>
                        <span aria-hidden>·</span>
                        <span>{`${topic.reply_count} 回应`}</span>
                        {topic.moderation_status === 'manual_review' ? (
                          <span className="rounded-full border border-amber-400/60 px-1.5 text-amber-700 dark:text-amber-300">
                            核验中
                          </span>
                        ) : (
                          <>
                            <span aria-hidden>·</span>
                            <span>{relTime(topic.last_reply_at ?? topic.created_at)}</span>
                          </>
                        )}
                      </p>
                    </li>
                  ))}
                </ul>
                {canWrite ? (
                  <button
                    type="button"
                    className="mt-2.5 inline-flex items-center gap-1 rounded-sm text-[12px] font-medium text-margin-ink hover:underline focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-margin-wash"
                    onClick={() => onCompose(group.passage)}
                  >
                    <Plus className="h-3.5 w-3.5" />
                    在这段继续问
                  </button>
                ) : null}
              </div>
            )
          })}
        </aside>
      ) : null}

      {/* Selection → ask. A floating button on desktop; a bar at the thumb on touch. */}
      {selection && canWrite ? (
        coarse ? (
          <div className="fixed inset-x-3 bottom-[calc(0.75rem+env(safe-area-inset-bottom))] z-40 flex items-center gap-2 rounded-2xl border bg-background/95 p-2 pl-3 shadow-xl backdrop-blur">
            {selection.result.ok ? (
              <>
                <span className="min-w-0 flex-1 truncate text-[13px] text-muted-foreground">
                  选中了一段原文
                </span>
                <Button
                  type="button"
                  onClick={discussSelection}
                >
                  <MessageSquarePlus className="h-4 w-4" />
                  在页边提问
                </Button>
              </>
            ) : (
              <span className="px-1 py-2 text-[13px] text-muted-foreground">
                {selection.result.reason === 'too-long' ? '选短一点：600 字以内' : '一次选一段之内的文字'}
              </span>
            )}
          </div>
        ) : (
          <div
            className="absolute z-20"
            style={{
              top: selection.y + 8,
              left: Math.min(Math.max(0, selection.x - 80), Math.max(0, wrapperWidth - 220)),
            }}
          >
            {selection.result.ok ? (
              <Button
                type="button"
                size="sm"
                className="shadow-lg"
                onMouseDown={(event) => event.preventDefault()}
                onClick={discussSelection}
              >
                <MessageSquarePlus className="h-4 w-4" />
                在页边提问
              </Button>
            ) : selection.result.reason === 'multi-block' || selection.result.reason === 'too-long' ? (
              <span className="rounded-md border bg-background px-2.5 py-1.5 text-[12px] text-muted-foreground shadow">
                {selection.result.reason === 'too-long' ? '选短一点：600 字以内' : '一次选一段之内的文字'}
              </span>
            ) : null}
          </div>
        )
      ) : null}
    </>
  )
}
