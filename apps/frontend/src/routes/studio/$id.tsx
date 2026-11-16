import { useEffect, useMemo, useRef, useState } from 'react'
import { createFileRoute, Link, redirect } from '@tanstack/react-router'
import {
  ArrowLeft,
  CheckCircle2,
  Download,
  Eye,
  FileText,
  Save,
  Settings2,
} from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { getAuthState } from '@/lib/auth'
import {
  useSaveSubmissionMarkdown,
  useSubmission,
  useSubmissionMarkdown,
  useUpdateSubmission,
} from '@/hooks/api/use-modules'
import { cn, extractError } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { MarkdownEditor } from '@/components/common/markdown-editor'
import { ErrorState, LoadingSkeleton } from '@/components/common/state'
import { PaperProof } from '@/components/submission/paper-proof'

export const Route = createFileRoute('/studio/$id')({
  beforeLoad: () => {
    if (!getAuthState().isAuthenticated) throw redirect({ to: '/login' })
  },
  component: StudioPage,
})

const EDITABLE_STATUSES = ['pending', 'major_revision', 'minor_revision']
const LICENSE_OPTIONS = [
  'CC BY 4.0',
  'CC BY-NC 4.0',
  'CC BY-NC-ND 4.0',
  'CC BY-SA 4.0',
  '作者保留版权',
]

type Track = 'paper' | 'essay'

interface StudioMeta {
  title: string
  authors: string
  affiliations: string
  abstract: string
  keywords: string
  doi: string
  funding: string
  license: string
  clc: string
  track: Track
}

const EMPTY_META: StudioMeta = {
  title: '',
  authors: '',
  affiliations: '',
  abstract: '',
  keywords: '',
  doi: '',
  funding: '',
  license: 'CC BY-NC 4.0',
  clc: '',
  track: 'paper',
}

function splitList(value: string): string[] {
  return value
    .split(/[,，;；、\n]+/)
    .map((item) => item.trim())
    .filter(Boolean)
}

/** 作者分隔：换行/分号优先；逗号只在后面不是单位序号时才算分隔符。
 * 例如「张伟1,2*」里的逗号是单位序号，不能拆成两个人。 */
function splitAuthors(value: string): string[] {
  return value
    .split(/[\n；;]+/)
    .flatMap((segment) => segment.split(/,(?![0-9*])/))
    .map((item) => item.trim())
    .filter(Boolean)
}

function splitLines(value: string): string[] {
  return value
    .split(/[\n；;]+/)
    .map((item) => item.trim())
    .filter(Boolean)
}

function StudioPage() {
  const { id } = Route.useParams()
  const submissionId = Number(id)
  const detail = useSubmission(submissionId)
  const markdown = useSubmissionMarkdown(submissionId, submissionId > 0)
  const updateSubmission = useUpdateSubmission()
  const saveMarkdown = useSaveSubmissionMarkdown()

  const [meta, setMeta] = useState<StudioMeta>(EMPTY_META)
  const [body, setBody] = useState('')
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [pdfBusy, setPdfBusy] = useState(false)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [metaOpen, setMetaOpen] = useState(false)
  const metaLoaded = useRef(false)
  const bodyLoaded = useRef(false)

  const editable =
    !!detail.data && EDITABLE_STATUSES.includes(detail.data.status)

  useEffect(() => {
    if (!detail.data || metaLoaded.current) return
    const data = detail.data
    setMeta({
      title: data.title ?? '',
      authors: (data.authors ?? []).join('\n'),
      affiliations: (data.author_affiliations ?? []).join('\n'),
      abstract: data.abstract ?? '',
      keywords: (data.keywords ?? []).join(', '),
      doi: data.doi ?? '',
      funding: data.funding ?? '',
      license: data.license ?? 'CC BY-NC 4.0',
      clc: '',
      track: data.type === 'paper' ? 'paper' : 'essay',
    })
    metaLoaded.current = true
  }, [detail.data])

  useEffect(() => {
    if (!markdown.data || bodyLoaded.current) return
    setBody(markdown.data.content ?? '')
    bodyLoaded.current = true
  }, [markdown.data])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault()
        void handleSave()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  })

  const updateMeta = <K extends keyof StudioMeta>(key: K, value: StudioMeta[K]) => {
    setMeta((prev) => ({ ...prev, [key]: value }))
    setDirty(true)
  }

  const updateBody = (next: string) => {
    setBody(next)
    setDirty(true)
  }

  async function handleSave() {
    if (!detail.data || !editable || saving) return
    setSaving(true)
    try {
      await updateSubmission.mutateAsync({
        id: submissionId,
        body: {
          title: meta.title.trim(),
          ...(splitAuthors(meta.authors).length
            ? { authors: splitAuthors(meta.authors) }
            : {}),
          author_affiliations: splitLines(meta.affiliations),
          ...(meta.abstract.trim() ? { abstract: meta.abstract.trim() } : {}),
          keywords: splitList(meta.keywords),
          doi: meta.doi || null,
          funding: meta.funding || null,
          license: meta.license || null,
        },
      })
      await saveMarkdown.mutateAsync({ id: submissionId, content: body })
      setDirty(false)
      toast.success('已保存到稿件')
    } catch (error) {
      toast.error(extractError(error, '保存失败'))
    } finally {
      setSaving(false)
    }
  }

  async function handleDownloadPdf() {
    if (pdfBusy) return
    setPdfBusy(true)
    try {
      const res = await api.post(
        '/submissions/studio-pdf',
        {
          title: meta.title,
          authors: splitAuthors(meta.authors),
          affiliations: meta.affiliations,
          abstract: meta.abstract.trim(),
          keywords: splitList(meta.keywords),
          body,
          doi: meta.doi || undefined,
          funding: meta.funding || undefined,
          clc: meta.clc || undefined,
          license: meta.license || undefined,
          track: meta.track,
        },
        { responseType: 'blob' },
      )
      const url = URL.createObjectURL(res.data as Blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `${(meta.title || 'paper').slice(0, 40)}-排版.pdf`
      anchor.click()
      URL.revokeObjectURL(url)
      toast.success('排版 PDF 已生成')
    } catch (error) {
      toast.error(extractError(error, 'PDF 生成失败'))
    } finally {
      setPdfBusy(false)
    }
  }

  const proof = (
    <PaperProof
      title={meta.title}
      authors={splitAuthors(meta.authors)}
      affiliations={meta.affiliations}
      abstract={meta.abstract}
      keywords={splitList(meta.keywords)}
      body={body}
      doi={meta.doi}
      funding={meta.funding}
      clc={meta.clc}
      license={meta.license}
      track={meta.track}
      onDownloadPdf={handleDownloadPdf}
      pdfBusy={pdfBusy}
    />
  )

  const statusText = useMemo(() => {
    if (!detail.data) return ''
    const labels: Record<string, string> = {
      draft: '草稿',
      pending: '待审核',
      resubmitted: '已重投',
      under_review: '审稿中',
      major_revision: '大修',
      minor_revision: '小修',
      accepted: '已录用',
      rejected: '拒稿',
      withdrawn: '已撤稿',
    }
    return labels[detail.data.status] ?? detail.data.status
  }, [detail.data])

  if (detail.isLoading || markdown.isLoading) {
    return (
      <div className="mx-auto w-full max-w-[1600px] p-4">
        <LoadingSkeleton rows={8} />
      </div>
    )
  }

  if (detail.isError || markdown.isError || !detail.data) {
    return (
      <div className="mx-auto w-full max-w-2xl p-6">
        <ErrorState message="读不到这篇稿件：稿件不存在，或者你没有权限查看。" />
      </div>
    )
  }

  return (
    <div className="mx-auto flex w-full max-w-[1680px] flex-col gap-3 p-3 lg:p-5">
      <header className="flex flex-wrap items-center gap-2 border-b pb-3">
        <Button variant="ghost" size="sm" asChild>
          <Link to="/submissions">
            <ArrowLeft className="h-4 w-4" />
            <span className="hidden sm:inline">我的提交</span>
          </Link>
        </Button>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-base font-semibold lg:text-lg">Studio 工作台</h1>
          <p className="truncate text-xs text-muted-foreground">
            {meta.title || '未填写标题'}
          </p>
        </div>
        <Badge
          variant={editable ? 'secondary' : 'outline'}
          className="hidden sm:inline-flex"
        >
          {editable ? '可编辑' : `只读 · ${statusText}`}
        </Badge>
        {dirty && <span className="text-xs text-amber-600">有未保存修改</span>}
        <div className="flex w-full flex-wrap items-center justify-end gap-2 sm:w-auto sm:flex-nowrap">
          <Button
            variant="outline"
            size="sm"
            className="md:hidden"
            onClick={() => setMetaOpen((value) => !value)}
          >
            <FileText className="h-4 w-4" />
            {metaOpen ? '收起' : '元信息'}
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="xl:hidden"
            onClick={() => setPreviewOpen(true)}
          >
            <Eye className="h-4 w-4" />
            预览
          </Button>
          <Button
            variant="outline"
            size="sm"
            aria-label="下载 PDF"
            onClick={handleDownloadPdf}
            disabled={pdfBusy}
          >
            <Download className="h-4 w-4" />
            <span className="hidden sm:inline">
              {pdfBusy ? '生成中…' : '下载 PDF'}
            </span>
          </Button>
          <Button
            size="sm"
            aria-label="保存"
            onClick={handleSave}
            disabled={!editable || saving || !dirty}
          >
            {saving ? (
              <CheckCircle2 className="h-4 w-4" />
            ) : (
              <Save className="h-4 w-4" />
            )}
            <span className="hidden sm:inline">
              {saving ? '保存中…' : '保存'}
            </span>
          </Button>
        </div>
      </header>

      <div className="grid min-h-0 grid-cols-1 gap-3 md:grid-cols-[280px_minmax(0,1fr)] xl:grid-cols-[320px_minmax(0,1fr)_430px]">
        <aside
          className={cn(
            'min-w-0 md:sticky md:top-3 md:block md:max-h-[calc(100vh-6rem)] md:overflow-auto',
            !metaOpen && 'hidden',
          )}
        >
          <div className="rounded-lg border bg-background">
            <Tabs defaultValue="meta">
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="meta">
                  <FileText className="mr-1 h-3.5 w-3.5" />
                  元信息
                </TabsTrigger>
                <TabsTrigger value="export">
                  <Settings2 className="mr-1 h-3.5 w-3.5" />
                  导出设置
                </TabsTrigger>
              </TabsList>

              <TabsContent value="meta" className="space-y-3 p-3">
                <div className="space-y-1.5">
                  <Label htmlFor="studio-title">标题（用“——”分主副标题）</Label>
                  <Textarea
                    id="studio-title"
                    value={meta.title}
                    disabled={!editable}
                    onChange={(event) => updateMeta('title', event.target.value)}
                    className="min-h-16"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="studio-authors">作者（一行一个；张伟1,2* 里的逗号算单位序号）</Label>
                  <Textarea
                    id="studio-authors"
                    value={meta.authors}
                    disabled={!editable}
                    placeholder="张伟1,2*, 李娜2"
                    onChange={(event) => updateMeta('authors', event.target.value)}
                    className="min-h-14"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="studio-affiliations">单位（一行一个，序号自动生成）</Label>
                  <Textarea
                    id="studio-affiliations"
                    value={meta.affiliations}
                    disabled={!editable}
                    placeholder="示例科技大学 智能信息学院，上海，中国"
                    onChange={(event) => updateMeta('affiliations', event.target.value)}
                    className="min-h-20"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="studio-abstract">摘要</Label>
                  <Textarea
                    id="studio-abstract"
                    value={meta.abstract}
                    disabled={!editable}
                    onChange={(event) => updateMeta('abstract', event.target.value)}
                    className="min-h-28"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="studio-keywords">关键词（逗号分隔）</Label>
                  <Input
                    id="studio-keywords"
                    value={meta.keywords}
                    disabled={!editable}
                    onChange={(event) => updateMeta('keywords', event.target.value)}
                  />
                </div>
                <div className="grid grid-cols-1 gap-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="studio-doi">DOI</Label>
                    <Input
                      id="studio-doi"
                      value={meta.doi}
                      disabled={!editable}
                      placeholder="10.12345/rubbish.2026.001"
                      onChange={(event) => updateMeta('doi', event.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="studio-funding">基金</Label>
                    <Input
                      id="studio-funding"
                      value={meta.funding}
                      disabled={!editable}
                      placeholder="基金名称（编号）"
                      onChange={(event) => updateMeta('funding', event.target.value)}
                    />
                  </div>
                </div>
              </TabsContent>

              <TabsContent value="export" className="space-y-3 p-3">
                <div className="space-y-1.5">
                  <Label>许可</Label>
                  <Select
                    value={meta.license}
                    disabled={!editable}
                    onValueChange={(value) => updateMeta('license', value)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {LICENSE_OPTIONS.map((item) => (
                        <SelectItem key={item} value={item}>
                          {item}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>轨道</Label>
                  <Select
                    value={meta.track}
                    onValueChange={(value) => updateMeta('track', value as Track)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="paper">论文轨 · 学术排版</SelectItem>
                      <SelectItem value="essay">副刊轨 · 非论文格式</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="studio-clc">中图分类号（仅本次导出）</Label>
                  <Input
                    id="studio-clc"
                    value={meta.clc}
                    placeholder="O152"
                    onChange={(event) => updateMeta('clc', event.target.value)}
                  />
                  <p className="text-[11px] text-muted-foreground">
                    投稿表里没有 CLC 列，这里填的值只用于预览与本次 PDF，不会写回稿件。
                  </p>
                </div>
                <div className="rounded-md border bg-muted/30 p-2 text-[11px] leading-relaxed text-muted-foreground">
                  导出为 A4（595×842pt）、Noto Serif CJK、页眉 RUBBISH JOURNAL /
                  rubbish.argjiemi.cn，页脚“轨道·许可”“第 i 页 / 共 N 页”。
                  与右侧纸面预览同一题录顺序。
                </div>
                <Button
                  className="w-full"
                  variant="outline"
                  onClick={handleDownloadPdf}
                  disabled={pdfBusy}
                >
                  <Download className="h-4 w-4" />
                  {pdfBusy ? '生成中…' : '下载排版 PDF'}
                </Button>
              </TabsContent>
            </Tabs>
          </div>

          {!editable && (
            <p className="mt-2 rounded-md border border-dashed p-2 text-[11px] text-muted-foreground">
              当前状态只读；仍可预览与下载 PDF，但不能改元信息或正文。
            </p>
          )}
        </aside>

        <main className="min-w-0">
          <MarkdownEditor
            value={body}
            onChange={updateBody}
            placeholder="正文支持 Markdown；标题、摘要、关键词已在左侧题录里，不必重复。"
            minHeight={560}
            disabled={!editable}
            testId="studio-editor"
            academicTools
            snapshotKey={`studio-${submissionId}`}
          />
          <p className="mt-2 text-[11px] text-muted-foreground">
            工具栏「学术」可插入公式、脚注、图注、表题、参考文献与交叉引用；Ctrl/⌘+S 保存。
          </p>
        </main>

        {!previewOpen && (
          <aside className="hidden min-w-0 xl:block">
            <div className="sticky top-3 max-h-[calc(100vh-5rem)] overflow-auto pr-1">
              {proof}
            </div>
          </aside>
        )}
      </div>

      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-h-[92vh] max-w-4xl overflow-auto">
          <DialogHeader>
            <DialogTitle>排版预览</DialogTitle>
          </DialogHeader>
          {proof}
        </DialogContent>
      </Dialog>
    </div>
  )
}
