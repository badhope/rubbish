import { useMemo, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { AlertTriangle, CheckCircle2, Copy, Info, ListChecks, Quote } from 'lucide-react'
import { toast } from 'sonner'
import { PageHeader } from '@/components/common/page-header'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import {
  formatBibtex,
  formatCitation,
  formatRis,
  type CitationResource,
  type CitationStyle,
} from '@/lib/citation'
import { checkManuscript, type ManuscriptIssue } from '@/lib/manuscript-checks'

export const Route = createFileRoute('/tools')({
  component: ToolsPage,
})

const STYLE_OPTIONS: { value: CitationStyle | 'bibtex' | 'ris'; label: string }[] = [
  { value: 'gb-t-7714', label: 'GB/T 7714' },
  { value: 'apa', label: 'APA 7' },
  { value: 'mla', label: 'MLA 9' },
  { value: 'bibtex', label: 'BibTeX' },
  { value: 'ris', label: 'RIS' },
]

const TYPE_OPTIONS = [
  { value: 'paper', label: '论文' },
  { value: 'book', label: '图书' },
  { value: 'dataset', label: '数据集' },
  { value: 'tutorial', label: '教程' },
] as const

function splitAuthors(value: string): string[] {
  return value
    .split(/[；;、,，\n]/)
    .map((name) => name.trim())
    .filter(Boolean)
}

function CitationTool() {
  const [title, setTitle] = useState('')
  const [authors, setAuthors] = useState('')
  const [year, setYear] = useState('')
  const [type, setType] = useState<CitationResource['type']>('paper')
  const [venue, setVenue] = useState('')
  const [volume, setVolume] = useState('')
  const [issue, setIssue] = useState('')
  const [pages, setPages] = useState('')
  const [doi, setDoi] = useState('')
  const [url, setUrl] = useState('')
  const [style, setStyle] = useState<(typeof STYLE_OPTIONS)[number]['value']>('gb-t-7714')

  const resource: CitationResource = {
    title: title.trim() || '无题',
    authors: splitAuthors(authors),
    year: Number.parseInt(year, 10) || 0,
    type,
    venue: venue.trim() || null,
    volume: volume.trim() || null,
    issue: issue.trim() || null,
    pages: pages.trim() || null,
    doi: doi.trim() || null,
    external_url: url.trim() || null,
  }

  const output = useMemo(() => {
    if (style === 'bibtex') return formatBibtex(resource)
    if (style === 'ris') return formatRis(resource)
    return formatCitation(resource, style)
    // resource 的字段都是上面的 state 派生值
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, authors, year, type, venue, volume, issue, pages, doi, url, style])

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(output)
      toast.success('引用已复制')
    } catch {
      toast.error('复制失败，请手动选中')
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
      <Card>
        <CardContent className="space-y-3 p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1 text-xs text-muted-foreground sm:col-span-2">
              标题
              <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="文章或图书标题" />
            </label>
            <label className="space-y-1 text-xs text-muted-foreground">
              作者（顿号/逗号分隔）
              <Input value={authors} onChange={(e) => setAuthors(e.target.value)} placeholder="张三、李四" />
            </label>
            <label className="space-y-1 text-xs text-muted-foreground">
              年份
              <Input value={year} onChange={(e) => setYear(e.target.value.replace(/[^0-9]/g, ''))} placeholder="2026" inputMode="numeric" />
            </label>
            <label className="space-y-1 text-xs text-muted-foreground">
              类型
              <select
                value={type}
                onChange={(e) => setType(e.target.value as CitationResource['type'])}
                className="h-9 w-full rounded-md border bg-background px-2 text-sm"
              >
                {TYPE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1 text-xs text-muted-foreground">
              期刊 / 出版方
              <Input value={venue} onChange={(e) => setVenue(e.target.value)} placeholder="Rubbish" />
            </label>
            <label className="space-y-1 text-xs text-muted-foreground">
              卷
              <Input value={volume} onChange={(e) => setVolume(e.target.value)} placeholder="1" />
            </label>
            <label className="space-y-1 text-xs text-muted-foreground">
              期
              <Input value={issue} onChange={(e) => setIssue(e.target.value)} placeholder="06" />
            </label>
            <label className="space-y-1 text-xs text-muted-foreground">
              页码
              <Input value={pages} onChange={(e) => setPages(e.target.value)} placeholder="45-58" />
            </label>
            <label className="space-y-1 text-xs text-muted-foreground">
              DOI
              <Input value={doi} onChange={(e) => setDoi(e.target.value)} placeholder="10.xxxx/xxxxx" />
            </label>
            <label className="space-y-1 text-xs text-muted-foreground sm:col-span-2">
              链接
              <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" />
            </label>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground">格式</span>
            {STYLE_OPTIONS.map((option) => (
              <Button
                key={option.value}
                type="button"
                size="sm"
                variant={style === option.value ? 'default' : 'outline'}
                onClick={() => setStyle(option.value)}
              >
                {option.label}
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-3 p-4">
          <div className="flex items-center justify-between gap-2">
            <h2 className="flex items-center gap-2 text-sm font-medium">
              <Quote className="h-4 w-4 text-primary" />
              生成结果
            </h2>
            <Button type="button" size="sm" variant="outline" onClick={() => void copy()}>
              <Copy className="h-3.5 w-3.5" />
              复制
            </Button>
          </div>
          <pre className="max-h-[28rem] overflow-auto whitespace-pre-wrap break-words rounded-md border bg-muted/30 p-3 text-xs leading-relaxed">
            {output}
          </pre>
          <p className="text-xs leading-relaxed text-muted-foreground">
            作者名按录入顺序保留，不擅自拆成姓/名；GB/T 7714 超过三位作者用“等”。正式投稿仍以
            <a className="mx-1 text-primary hover:underline" href="/templates/rubbish-editorial-standards.md" download>
              编辑规范
            </a>
            为准。
          </p>
        </CardContent>
      </Card>
    </div>
  )
}

const LEVEL_META = {
  blocker: { label: '阻断', variant: 'destructive' as const, icon: AlertTriangle },
  warning: { label: '警告', variant: 'outline' as const, icon: AlertTriangle },
  info: { label: '提示', variant: 'secondary' as const, icon: Info },
}

function IssueRow({ issue }: { issue: ManuscriptIssue }) {
  const meta = LEVEL_META[issue.level]
  const Icon = meta.icon
  return (
    <div className="flex items-start gap-3 border-b py-2 text-sm last:border-b-0">
      <Badge variant={meta.variant} className="mt-0.5 shrink-0 gap-1">
        <Icon className="h-3 w-3" />
        {meta.label}
      </Badge>
      <div className="min-w-0">
        <p className="leading-relaxed">{issue.message}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {issue.line ? `第 ${issue.line} 行 · ` : ''}
          {issue.code}
        </p>
      </div>
    </div>
  )
}

function ManuscriptTool() {
  const [markdown, setMarkdown] = useState('')
  const [checked, setChecked] = useState(false)
  const issues = useMemo(() => (checked ? checkManuscript(markdown) : []), [checked, markdown])
  const blockers = issues.filter((issue) => issue.level === 'blocker').length
  const warnings = issues.filter((issue) => issue.level === 'warning').length

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
      <Card>
        <CardContent className="space-y-3 p-4">
          <div className="flex items-center justify-between gap-2">
            <h2 className="flex items-center gap-2 text-sm font-medium">
              <ListChecks className="h-4 w-4 text-primary" />
              粘贴 Markdown 正文
            </h2>
            <Button type="button" size="sm" onClick={() => setChecked(true)} disabled={!markdown.trim()}>
              开始检查
            </Button>
          </div>
          <Textarea
            value={markdown}
            onChange={(event) => {
              setMarkdown(event.target.value)
              setChecked(false)
            }}
            rows={20}
            placeholder={'# 摘要\n…\n\n# 1 引言\n…\n\n图 1 …\n\n# 参考文献\n[1] …'}
            className="min-h-[28rem] font-mono text-xs"
          />
          <p className="text-xs text-muted-foreground">
            只检查编号、重复段落、占位符和结构缺失；不判断论证质量，也不替代编辑审稿。
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-3 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-medium">检查结果</h2>
            {checked && (
              <div className="flex flex-wrap gap-2">
                <Badge variant={blockers ? 'destructive' : 'secondary'}>{blockers} 阻断</Badge>
                <Badge variant={warnings ? 'outline' : 'secondary'}>{warnings} 警告</Badge>
              </div>
            )}
          </div>
          {!checked ? (
            <div className="flex min-h-[18rem] flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
              <ListChecks className="h-8 w-8 opacity-40" />
              粘贴正文后点“开始检查”
            </div>
          ) : issues.length === 0 ? (
            <div className="flex min-h-[18rem] flex-col items-center justify-center gap-2 text-sm text-emerald-700">
              <CheckCircle2 className="h-8 w-8" />
              没发现机器可确定的编号/结构问题
            </div>
          ) : (
            <div className="max-h-[32rem] overflow-auto rounded-md border px-3">
              {issues.map((issue, index) => (
                <IssueRow key={`${issue.code}-${issue.line ?? 0}-${index}`} issue={issue} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function ToolsPage() {
  return (
    <div>
      <PageHeader
        title="写作工具"
        description="引用格式生成与 Markdown 编校检查。全部在浏览器本地计算，不上传正文。"
      />
      <Tabs defaultValue="citation">
        <TabsList>
          <TabsTrigger value="citation">引用生成</TabsTrigger>
          <TabsTrigger value="check">编校检查</TabsTrigger>
        </TabsList>
        <TabsContent value="citation" className="mt-4">
          <CitationTool />
        </TabsContent>
        <TabsContent value="check" className="mt-4">
          <ManuscriptTool />
        </TabsContent>
      </Tabs>
    </div>
  )
}
