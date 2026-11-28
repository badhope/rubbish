/**
 * Margins (页边): forum threads anchored to a passage of a published work.
 *
 * A passage is stored the way the W3C Web Annotation "TextQuoteSelector"
 * stores one: the exact words plus a little text before and after. The quote
 * is always the author's original language; nothing here translates it.
 *
 * Everything in this file is DOM-only and side-effect free so it can run in
 * unit tests: the reading page hands us the rendered article element and we
 * hand back Ranges. Highlighting uses the CSS Custom Highlight API, so we
 * never mutate the React-owned Markdown DOM.
 */

export interface Passage {
  quote: string
  prefix: string
  suffix: string
}

export interface MarginAuthor {
  id: number
  username: string
  display_name?: string | null
  avatar_url?: string | null
}

/** The slice of a forum topic the margins need. */
export interface MarginTopic {
  id: number
  title: string
  body: string
  paper_id: number | null
  passage?: Passage | null
  has_passage?: boolean
  reply_count: number
  created_at: string
  last_reply_at: string | null
  moderation_status?: string | null
  author: MarginAuthor | null
}

export const QUOTE_MAX = 600
export const CONTEXT_CHARS = 48

/** Blocks a passage may live in. Headings are excluded: the essay reader rewrites some of them. */
export const PASSAGE_BLOCKS = 'p, li, blockquote, dd, figcaption, td, th'

const SKIP_INSIDE = 'pre, code, .katex, h1, h2, h3, h4, h5, h6, script, style'

export function collapse(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

interface Segment {
  node: Text
  /** index in `text` where this node's first kept character lands */
  start: number
  /** for each kept character, its offset inside the node */
  offsets: number[]
}

export interface TextIndex {
  text: string
  segments: Segment[]
}

/**
 * Flatten the article into one whitespace-collapsed string, keeping a map
 * back to text nodes. Blocks are separated by a newline sentinel, so a quote
 * can never match across two paragraphs.
 */
export function buildTextIndex(root: HTMLElement): TextIndex {
  const blocks = Array.from(root.querySelectorAll<HTMLElement>(PASSAGE_BLOCKS)).filter(
    (block) =>
      !block.closest(SKIP_INSIDE) &&
      // nested blocks (li > p, blockquote > p) are indexed once, through the innermost
      !block.querySelector(PASSAGE_BLOCKS),
  )
  let text = ''
  const segments: Segment[] = []
  for (const block of blocks) {
    if (text) text += '\n'
    let lastWasSpace = true
    const walker = block.ownerDocument.createTreeWalker(block, NodeFilter.SHOW_TEXT)
    let node = walker.nextNode() as Text | null
    while (node) {
      const skip = node.parentElement?.closest(SKIP_INSIDE)
      if (skip && block.contains(skip)) {
        node = walker.nextNode() as Text | null
        continue
      }
      const data = node.data
      const offsets: number[] = []
      const start = text.length
      for (let i = 0; i < data.length; i += 1) {
        const ch = data[i]
        if (/\s/.test(ch)) {
          if (lastWasSpace) continue
          text += ' '
          lastWasSpace = true
        } else {
          text += ch
          lastWasSpace = false
        }
        offsets.push(i)
      }
      if (offsets.length) segments.push({ node, start, offsets })
      node = walker.nextNode() as Text | null
    }
    // drop a trailing space inside the block so "word \n" never becomes part of a match
    if (text.endsWith(' ')) {
      text = text.slice(0, -1)
      const last = segments[segments.length - 1]
      if (last && last.start + last.offsets.length > text.length) last.offsets.pop()
    }
  }
  return { text, segments }
}

function locate(index: TextIndex, position: number, edge: 'start' | 'end'): [Text, number] | null {
  for (const seg of index.segments) {
    const end = seg.start + seg.offsets.length
    if (position >= seg.start && position < end) {
      const offset = seg.offsets[position - seg.start]
      return [seg.node, edge === 'start' ? offset : offset + 1]
    }
  }
  return null
}

/** A DOM Range for [start, end) in the flattened text. */
export function rangeFor(index: TextIndex, start: number, end: number): Range | null {
  if (end <= start) return null
  const from = locate(index, start, 'start')
  const to = locate(index, end - 1, 'end')
  if (!from || !to) return null
  const range = from[0].ownerDocument.createRange()
  range.setStart(from[0], from[1])
  range.setEnd(to[0], to[1])
  return range
}

function commonSuffix(a: string, b: string): number {
  let n = 0
  while (n < a.length && n < b.length && a[a.length - 1 - n] === b[b.length - 1 - n]) n += 1
  return n
}

function commonPrefix(a: string, b: string): number {
  let n = 0
  while (n < a.length && n < b.length && a[n] === b[n]) n += 1
  return n
}

/**
 * Where a stored passage sits in the article today, or null when the author
 * has since revised those words. Ties between repeated sentences are broken
 * by how much of the stored prefix/suffix still matches.
 */
export function findPassage(index: TextIndex, passage: Passage): { start: number; end: number } | null {
  const quote = collapse(passage.quote)
  if (quote.length < 2) return null
  const prefix = collapse(passage.prefix ?? '')
  const suffix = collapse(passage.suffix ?? '')
  let best: { start: number; end: number; score: number } | null = null
  let from = 0
  for (;;) {
    const at = index.text.indexOf(quote, from)
    if (at < 0) break
    const before = index.text.slice(Math.max(0, at - prefix.length - 1), at).trimEnd()
    const after = index.text.slice(at + quote.length, at + quote.length + suffix.length + 1).trimStart()
    const score = commonSuffix(before, prefix) + commonPrefix(after, suffix)
    if (!best || score > best.score) best = { start: at, end: at + quote.length, score }
    from = at + 1
  }
  return best ? { start: best.start, end: best.end } : null
}

export type SelectionResult =
  | { ok: true; passage: Passage; block: HTMLElement }
  | { ok: false; reason: 'outside' | 'empty' | 'multi-block' | 'too-long' }

function blockOf(node: Node, root: HTMLElement): HTMLElement | null {
  const el = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement
  const block = el?.closest<HTMLElement>(PASSAGE_BLOCKS) ?? null
  if (!block || !root.contains(block) || block.closest(SKIP_INSIDE)) return null
  return block
}

/** Text of `block` before / after a boundary, collapsed. */
function sideText(block: HTMLElement, range: Range, side: 'before' | 'after'): string {
  const doc = block.ownerDocument
  const r = doc.createRange()
  r.selectNodeContents(block)
  if (side === 'before') r.setEnd(range.startContainer, range.startOffset)
  else r.setStart(range.endContainer, range.endOffset)
  return collapse(r.toString())
}

/**
 * Turn the reader's selection into a passage: one block at a time, the
 * author's exact words, plus context on either side for re-anchoring.
 */
export function passageFromRange(root: HTMLElement, range: Range | null): SelectionResult {
  if (!range || range.collapsed) return { ok: false, reason: 'empty' }
  if (!root.contains(range.commonAncestorContainer)) return { ok: false, reason: 'outside' }
  const startBlock = blockOf(range.startContainer, root)
  const endBlock = blockOf(range.endContainer, root)
  if (!startBlock || !endBlock) return { ok: false, reason: 'outside' }
  if (startBlock !== endBlock) return { ok: false, reason: 'multi-block' }
  const quote = collapse(range.toString())
  if (quote.length < 2) return { ok: false, reason: 'empty' }
  if (quote.length > QUOTE_MAX) return { ok: false, reason: 'too-long' }
  const prefix = sideText(startBlock, range, 'before').slice(-CONTEXT_CHARS)
  const suffix = sideText(startBlock, range, 'after').slice(0, CONTEXT_CHARS)
  return { ok: true, passage: { quote, prefix, suffix }, block: startBlock }
}

export interface ParagraphChoice {
  key: string
  passage: Passage
  /** true when the paragraph was longer than QUOTE_MAX and we kept its opening */
  trimmed: boolean
}

function trimToSentence(text: string, max: number): string {
  if (text.length <= max) return text
  const head = text.slice(0, max)
  const stop = Math.max(
    head.lastIndexOf('。'),
    head.lastIndexOf('！'),
    head.lastIndexOf('？'),
    head.lastIndexOf('. '),
    head.lastIndexOf('! '),
    head.lastIndexOf('? '),
  )
  if (stop > max * 0.4) return head.slice(0, stop + 1).trim()
  const space = head.lastIndexOf(' ')
  return (space > max * 0.6 ? head.slice(0, space) : head).trim()
}

/** Every quotable paragraph, for the keyboard / touch passage picker. */
export function paragraphChoices(root: HTMLElement): ParagraphChoice[] {
  const index = buildTextIndex(root)
  const blocks = index.text.split('\n')
  const seen = new Set<string>()
  const choices: ParagraphChoice[] = []
  blocks.forEach((block, i) => {
    const text = collapse(block)
    if (text.length < 2 || seen.has(text)) return
    seen.add(text)
    const quote = trimToSentence(text, QUOTE_MAX)
    choices.push({
      key: `p${i}`,
      passage: { quote, prefix: '', suffix: text.slice(quote.length, quote.length + CONTEXT_CHARS).trim() },
      trimmed: quote.length < text.length,
    })
  })
  return choices
}

/**
 * The dominant script of an author's text, used only to set `lang` on the
 * markup so browsers hyphenate and screen readers pronounce it correctly.
 */
export function detectLang(text: string): 'zh' | 'en' | undefined {
  const sample = text.slice(0, 4000)
  const han = (sample.match(/[㐀-鿿]/g) ?? []).length
  const latin = (sample.match(/[A-Za-z]/g) ?? []).length
  if (han + latin < 20) return undefined
  // One Han character carries roughly a word; weigh Latin letters down.
  return han * 4 >= latin ? 'zh' : 'en'
}

/** Group topics by the passage they quote, in reading order. */
export function topicsByPassage(topics: MarginTopic[]): {
  anchored: Array<{ key: string; passage: Passage; topics: MarginTopic[] }>
  whole: MarginTopic[]
  hidden: MarginTopic[]
} {
  const anchored = new Map<string, { key: string; passage: Passage; topics: MarginTopic[] }>()
  const whole: MarginTopic[] = []
  const hidden: MarginTopic[] = []
  for (const topic of topics) {
    if (topic.passage?.quote) {
      const key = `${collapse(topic.passage.prefix).slice(-16)}|${collapse(topic.passage.quote)}`
      const group = anchored.get(key) ?? { key, passage: topic.passage, topics: [] }
      group.topics.push(topic)
      anchored.set(key, group)
    } else if (topic.has_passage) {
      hidden.push(topic)
    } else {
      whole.push(topic)
    }
  }
  return { anchored: Array.from(anchored.values()), whole, hidden }
}

export function authorLabel(author: MarginAuthor | null): string {
  return author?.display_name || author?.username || '已注销用户'
}
