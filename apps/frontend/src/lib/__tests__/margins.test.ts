import { describe, expect, it } from 'vitest'
import {
  buildTextIndex,
  detectLang,
  findPassage,
  paragraphChoices,
  passageFromRange,
  rangeFor,
  topicsByPassage,
  type MarginTopic,
} from '@/lib/margins'

function article(html: string): HTMLElement {
  const el = document.createElement('article')
  el.className = 'markdown-body'
  el.innerHTML = html
  document.body.appendChild(el)
  return el
}

const ESSAY = `
  <h2>The second crossing</h2>
  <p>At five forty the person beside me <strong>folded</strong> a paper
     timetable into a boat. The ferry was already coming around the bend.</p>
  <h2>What the notebook missed</h2>
  <p>The notes give the time. They leave out the <a href="/x">sound of the chain</a>.</p>
  <p>The ferry was already coming around the bend, again.</p>
  <pre><code>The ferry was already coming</code></pre>
`

function topic(id: number, passage?: MarginTopic['passage'], hasPassage = !!passage): MarginTopic {
  return {
    id,
    title: `t${id}`,
    body: '',
    paper_id: 1,
    passage,
    has_passage: hasPassage,
    reply_count: 0,
    created_at: '2026-11-28T00:00:00Z',
    last_reply_at: null,
    author: null,
  }
}

describe('margins: anchoring a stored passage', () => {
  it('finds words across inline markup and line breaks, and returns a Range over them', () => {
    const root = article(ESSAY)
    const index = buildTextIndex(root)
    // headings and code are not quotable text
    expect(index.text).not.toContain('The second crossing')
    expect(index.text).not.toContain('coming</code>')
    const hit = findPassage(index, {
      quote: 'the person beside me folded a paper timetable into a boat.',
      prefix: 'At five forty',
      suffix: '',
    })
    expect(hit).not.toBeNull()
    const range = rangeFor(index, hit!.start, hit!.end)!
    expect(range.toString().replace(/\s+/g, ' ')).toBe(
      'the person beside me folded a paper timetable into a boat.',
    )
    root.remove()
  })

  it('uses the stored context to choose between repeated sentences', () => {
    const root = article(ESSAY)
    const index = buildTextIndex(root)
    const quote = 'The ferry was already coming around the bend'
    const first = findPassage(index, { quote, prefix: 'into a boat.', suffix: '.' })!
    const second = findPassage(index, { quote, prefix: 'sound of the chain.', suffix: ', again.' })!
    expect(first.start).toBeLessThan(second.start)
    expect(rangeFor(index, second.start, second.end)!.startContainer.parentElement!.textContent).toContain(
      'again',
    )
    root.remove()
  })

  it('reports a revised passage as not found instead of guessing', () => {
    const root = article(ESSAY)
    expect(findPassage(buildTextIndex(root), { quote: 'a paper crane', prefix: '', suffix: '' })).toBeNull()
    root.remove()
  })
})

describe('margins: turning a selection into a passage', () => {
  it('keeps the exact words and a little context on each side', () => {
    const root = article(ESSAY)
    const p = root.querySelectorAll('p')[1]
    const link = p.querySelector('a')!
    const range = document.createRange()
    range.setStart(p.firstChild!, 'The notes give the time. They leave out the '.length - 'They leave out the '.length)
    range.setEnd(link.firstChild!, 'sound of the chain'.length)
    const result = passageFromRange(root, range)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.passage.quote).toBe('They leave out the sound of the chain')
    expect(result.passage.prefix).toBe('The notes give the time.')
    expect(result.passage.suffix).toBe('.')
    root.remove()
  })

  it('refuses a selection that spans two paragraphs', () => {
    const root = article(ESSAY)
    const [a, b] = Array.from(root.querySelectorAll('p'))
    const range = document.createRange()
    range.setStart(a.lastChild!, 3)
    range.setEnd(b.firstChild!, 5)
    expect(passageFromRange(root, range)).toEqual({ ok: false, reason: 'multi-block' })
    root.remove()
  })

  it('refuses selections outside the article or in headings', () => {
    const root = article(ESSAY)
    const h2 = root.querySelector('h2')!
    const range = document.createRange()
    range.selectNodeContents(h2)
    expect(passageFromRange(root, range)).toEqual({ ok: false, reason: 'outside' })
    root.remove()
  })

  it('offers one choice per paragraph for the keyboard picker, headings excluded', () => {
    const root = article(ESSAY)
    const choices = paragraphChoices(root)
    expect(choices).toHaveLength(3)
    expect(choices[0].passage.quote.startsWith('At five forty')).toBe(true)
    expect(choices.every((c) => !c.passage.quote.includes('The second crossing'))).toBe(true)
    root.remove()
  })
})

describe('margins: helpers', () => {
  it('detects the language an author wrote in, without translating anything', () => {
    expect(detectLang('The notes give the time of each departure and leave out the chain.')).toBe('en')
    expect(detectLang('笔记只记下了每一班船的时间，没有记下铁链的声音和大家抬头的那几秒。')).toBe('zh')
    expect(detectLang('ok')).toBeUndefined()
  })

  it('groups threads by passage, keeps whole-piece threads apart, and respects withheld quotes', () => {
    const p = { quote: 'folded a paper timetable', prefix: 'beside me', suffix: 'into a boat' }
    const groups = topicsByPassage([topic(1, p), topic(2, { ...p }), topic(3), topic(4, null, true)])
    expect(groups.anchored).toHaveLength(1)
    expect(groups.anchored[0].topics.map((t) => t.id)).toEqual([1, 2])
    expect(groups.whole.map((t) => t.id)).toEqual([3])
    expect(groups.hidden.map((t) => t.id)).toEqual([4])
  })
})
