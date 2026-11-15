/** 轻量、可复现的 Markdown 编校检查。
 *
 * 只报机器能确定的事实，不做“写得好不好”的判断：
 * - 图/表编号是否连续、重复；
 * - 参考文献序号是否从 1 开始、是否断号/重号；
 * - 是否存在重复段落、占位符；
 * - 摘要/关键词/参考文献章节是否缺失。
 */

export type CheckLevel = 'blocker' | 'warning' | 'info'

export interface ManuscriptIssue {
  level: CheckLevel
  code: string
  message: string
  line?: number
}

interface NumberedItem {
  number: number
  line: number
  raw: string
}

const FIGURE_RE = /(?:^|\s)(?:图|Figure|Fig\.?)\s*([0-9]+)/gi
const TABLE_RE = /(?:^|\s)(?:表|Table)\s*([0-9]+)/gi
const REF_LINE_RE = /^\s*\[([0-9]+)\]\s*(\S.*)$/
const PLACEHOLDER_RE = /(TODO|TBD|待补|待填|XXX|Lorem ipsum|占位)/i

function collectNumbers(text: string, regex: RegExp): NumberedItem[] {
  const items: NumberedItem[] = []
  const source = text
  regex.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = regex.exec(source)) !== null) {
    const number = Number.parseInt(match[1], 10)
    const line = source.slice(0, match.index).split('\n').length
    items.push({ number, line, raw: match[0].trim() })
  }
  return items
}

function sequenceIssues(items: NumberedItem[], label: string): ManuscriptIssue[] {
  const issues: ManuscriptIssue[] = []
  if (items.length === 0) return issues
  const seen = new Set<number>()
  for (const item of items) {
    if (seen.has(item.number)) {
      issues.push({
        level: 'warning',
        code: `${label}-duplicate`,
        line: item.line,
        message: `${label}编号 ${item.number} 重复出现（首次也在文中）。`,
      })
    }
    seen.add(item.number)
  }
  const sorted = [...seen].sort((a, b) => a - b)
  const expected = Array.from({ length: sorted[sorted.length - 1] ?? 0 }, (_, i) => i + 1)
  const missing = expected.filter((n) => !seen.has(n))
  if (missing.length) {
    issues.push({
      level: 'warning',
      code: `${label}-gap`,
      message: `${label}编号不连续，缺少：${missing.join('、')}。`,
    })
  }
  if (sorted[0] !== 1) {
    issues.push({
      level: 'info',
      code: `${label}-start`,
      message: `${label}编号不是从 1 开始（当前最小为 ${sorted[0]}）。`,
    })
  }
  return issues
}

function collectReferences(text: string): { items: NumberedItem[]; duplicateLines: number[] } {
  const items: NumberedItem[] = []
  const seen = new Map<number, number>()
  const duplicateLines: number[] = []
  text.split('\n').forEach((line, index) => {
    const match = line.match(REF_LINE_RE)
    if (!match) return
    const number = Number.parseInt(match[1], 10)
    if (seen.has(number)) duplicateLines.push(index + 1)
    else seen.set(number, index + 1)
    items.push({ number, line: index + 1, raw: match[2] })
  })
  return { items, duplicateLines }
}

function duplicateParagraphs(text: string): ManuscriptIssue[] {
  const issues: ManuscriptIssue[] = []
  const seen = new Map<string, number>()
  const paragraphs = text.split(/\n{2,}/)
  let line = 1
  for (const paragraph of paragraphs) {
    const normalized = paragraph
      .replace(/[#>*_`~\-[\]()]/g, ' ')
      .replace(/\s+/g, '')
      .trim()
    if (normalized.length >= 40) {
      if (seen.has(normalized)) {
        issues.push({
          level: 'warning',
          code: 'duplicate-paragraph',
          line,
          message: `该段与第 ${seen.get(normalized)} 行附近的段落重复。`,
        })
      } else {
        seen.set(normalized, line)
      }
    }
    line += paragraph.split('\n').length + 1
  }
  return issues
}

export function checkManuscript(markdown: string): ManuscriptIssue[] {
  const text = markdown.replace(/\r\n/g, '\n')
  const issues: ManuscriptIssue[] = []
  if (!text.trim()) {
    return [{ level: 'blocker', code: 'empty', message: '正文为空。' }]
  }

  const figures = collectNumbers(text, FIGURE_RE)
  const tables = collectNumbers(text, TABLE_RE)
  issues.push(...sequenceIssues(figures, '图'))
  issues.push(...sequenceIssues(tables, '表'))

  const { items: references, duplicateLines } = collectReferences(text)
  if (references.length) {
    issues.push(...sequenceIssues(references, '参考文献'))
    for (const line of duplicateLines) {
      issues.push({
        level: 'warning',
        code: 'reference-duplicate',
        line,
        message: '参考文献序号重复。',
      })
    }
  } else if (!/参考文献|References/i.test(text)) {
    issues.push({
      level: 'warning',
      code: 'references-missing',
      message: '未检测到「参考文献 / References」章节或编号条目。',
    })
  }

  if (!/摘要|Abstract/i.test(text)) {
    issues.push({
      level: 'warning',
      code: 'abstract-missing',
      message: '未检测到「摘要 / Abstract」章节。',
    })
  }
  if (!/关键词|Keywords/i.test(text)) {
    issues.push({
      level: 'info',
      code: 'keywords-missing',
      message: '未检测到「关键词 / Keywords」章节。',
    })
  }

  text.split('\n').forEach((line, index) => {
    if (PLACEHOLDER_RE.test(line)) {
      issues.push({
        level: 'blocker',
        code: 'placeholder',
        line: index + 1,
        message: '发现占位符或未完成标记，提交前必须清理。',
      })
    }
  })
  issues.push(...duplicateParagraphs(text))

  return issues
}
