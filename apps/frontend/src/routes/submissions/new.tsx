import { useEffect, useMemo, useRef, useState } from 'react'
import {
  createFileRoute,
  redirect,
  useNavigate,
  useRouterState,
  useSearch,
} from '@tanstack/react-router'
import {
  AlertCircle,
  Check,
  Eye,
  ChevronLeft,
  ChevronRight,
  FileText,
  ListChecks,
  Loader2,
  Save,
  Upload,
  X,
} from 'lucide-react'
import { toast } from 'sonner'
import { getAuthState } from '@/lib/auth'
import { HelpTip } from '@/components/common/help-tip'
import { useCapabilities } from '@/hooks/use-capabilities'
import { useMediaQuery } from '@/hooks/use-media-query'
import {
  useCreateSubmission,
  useDeleteSubmissionDraft,
  useSaveSubmissionDraft,
  useSaveSubmissionMarkdown,
  useSubmissionDraft,
  useSubmission,
  useSubmissionMarkdown,
  useUpdateSubmission,
  useUploadSubmissionFile,
  useConvertSubmissionPreview,
  previewUploadedSourcePages,
} from '@/hooks/api/use-modules'
import { MarkdownEditor } from '@/components/common/markdown-editor'
import { PaperProof } from '@/components/submission/paper-proof'
import { ExpertiseCoverage } from '@/components/submission/expertise-coverage'
import { uploadMediaImage } from '@/lib/media'
import { api } from '@/lib/api'
import AuthPngPreview from '@/components/auth-png-preview'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import type {
  IngestResource,
  SubmissionCreate,
  SubmissionResponse,
  SubmissionType,
} from '@/lib/types'
import { DISCIPLINES } from '@/lib/disciplines'
import { ARTICLE_SECTION_OPTIONS } from '@/lib/article-sections'
import { extractError, parseListField } from '@/lib/utils'
import { checkManuscript, type ManuscriptIssue } from '@/lib/manuscript-checks'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

// ---------------------------------------------------------------------------
// 路由：/submissions/new?edit=<id>
//   新建作品四步向导。edit 存在时为「修改作品」模式（复用同一套表单）。
// ---------------------------------------------------------------------------

export const Route = createFileRoute('/submissions/new')({
  beforeLoad: () => {
    if (!getAuthState().isAuthenticated) throw redirect({ to: '/login', search: { redirect: '/submissions/new' } })
  },
  component: SubmissionWizardPage,
})

interface WizardSearch {
  edit?: number
  section?: string
}

// Nature 式栏目 / 分部选项与后台新建资源共用 lib/article-sections.ts。

// 年份给前后两年，避免手打错；合集主题仍可手填。
const YEAR_OPTIONS = Array.from({ length: 5 }, (_, i) =>
  String(new Date().getFullYear() - 2 + i),
)

const ISSUE_PART_OPTIONS = [
  '系统与故障',
  '方法之争',
  '实验室里的人类',
  '语言与人格',
  '游戏即田野',
  '游戏、语言与身体',
]

// ---------------------------------------------------------------------------
// 表单状态：字段命名贴近向导语义，提交时再拍平成 SubmissionCreate。
//   clc  → jel_codes（后端只有这个分类号数组字段，前端按「中图分类号」暴露）
//   type → 'paper'（研究文章）/ 'tutorial'（自由创作）
// ---------------------------------------------------------------------------
interface WizardForm {
  title: string
  type: SubmissionType
  /** 文章子类型：研究/荒诞；自由创作不发送 */
  paperKind: 'serious' | 'absurd'
  year: string
  discipline: string
  subdiscipline: string
  articleSection: string
  issuePart: string
  abstract: string
  preview: string
  keywords: string
  clc: string
  authors: string
  affiliations: string
  correspondingAuthorEmail: string
  body: string
  file: File | null
  venue: string
  doi: string
  externalUrl: string
  downloadUrl: string
  // 声明（纯前端勾选，提交时随 body 一起发出——后端 SubmissionCreate 无对应字段，
  // 但勾选本身是作者的承诺动作；编辑部在详情/审稿环节可读到对应承诺）。
  declOriginal: boolean
  declConfidential: boolean
  declCopyright: boolean
  // P3-1：声明与许可逐篇结构化，提交后随作品物化到目录条目。
  license: string
  authorContributions: string
  funding: string
  coiStatement: string
  dataAvailability: string
}

const EMPTY_FORM: WizardForm = {
  title: '',
  type: 'paper',
  paperKind: 'serious',
  year: String(new Date().getFullYear()),
  discipline: '',
  subdiscipline: '',
  articleSection: '',
  issuePart: '',
  abstract: '',
  preview: '',
  keywords: '',
  clc: '',
  authors: '',
  affiliations: '',
  correspondingAuthorEmail: '',
  body: '',
  file: null,
  venue: '',
  doi: '',
  externalUrl: '',
  downloadUrl: '',
  declOriginal: false,
  declConfidential: false,
  declCopyright: false,
  license: 'CC BY-NC 4.0',
  authorContributions: '',
  funding: '',
  coiStatement: '',
  dataAvailability: '',
}

const DRAFT_STRING_FIELDS = [
  'title',
  'year',
  'discipline',
  'subdiscipline',
  'articleSection',
  'issuePart',
  'abstract',
  'preview',
  'keywords',
  'clc',
  'authors',
  'affiliations',
  'correspondingAuthorEmail',
  'venue',
  'doi',
  'externalUrl',
  'downloadUrl',
  'license',
  'authorContributions',
  'funding',
  'coiStatement',
  'dataAvailability',
] as const

const DRAFT_BOOLEAN_FIELDS = [
  'declOriginal',
  'declConfidential',
  'declCopyright',
] as const

/** 服务端草稿不包含本地 File；正文单独存 body，避免同一份 Markdown 存两遍。 */
function formToDraftPayload(form: WizardForm): Record<string, unknown> {
  const { file: _file, body: _body, ...rest } = form
  return rest
}

function draftPayloadToForm(
  payload: Record<string, unknown>,
  body: string,
): WizardForm {
  const next: WizardForm = { ...EMPTY_FORM, body }
  for (const field of DRAFT_STRING_FIELDS) {
    const value = payload[field]
    if (typeof value === 'string') next[field] = value
  }
  for (const field of DRAFT_BOOLEAN_FIELDS) {
    const value = payload[field]
    if (typeof value === 'boolean') next[field] = value
  }
  if (
    payload.type === 'paper' ||
    payload.type === 'book' ||
    payload.type === 'dataset' ||
    payload.type === 'tutorial'
  ) {
    next.type = payload.type
  }
  if (payload.paperKind === 'serious' || payload.paperKind === 'absurd') {
    next.paperKind = payload.paperKind
  }
  return next
}

function submissionToForm(s: SubmissionResponse, body: string): WizardForm {
  const validTypes: SubmissionType[] = ['paper', 'book', 'dataset', 'tutorial']
  const type = validTypes.includes(s.type as SubmissionType)
    ? (s.type as SubmissionType)
    : 'paper'
  return {
    ...EMPTY_FORM,
    title: s.title,
    // 编辑旧作品时若 type 是 book/dataset，向导只暴露 研究文章/自由创作 两档，
    // 但不把旧值清掉——提交时原样回写，避免数据被静默改成 paper。
    type,
    year: String(s.year),
    discipline: s.discipline,
    subdiscipline: s.subdiscipline ?? '',
    articleSection: s.article_section ?? '',
    issuePart: s.issue_part ?? '',
    abstract: s.abstract,
    preview: s.preview,
    keywords: s.keywords.join(', '),
    clc: s.jel_codes.join(', '),
    authors: s.authors.join(', '),
    affiliations: (s.author_affiliations ?? []).join(', '),
    correspondingAuthorEmail: s.corresponding_author_email ?? '',
    body,
    venue: s.venue ?? '',
    doi: s.doi ?? '',
    externalUrl: s.external_url ?? '',
    downloadUrl: s.download_url ?? '',
  }
}

// ingest 页 "提交到目录" 经 router state 传预填数据：收敛到向导表单。
function presetToForm(p: IngestResource): WizardForm {
  const validTypes: SubmissionType[] = ['paper', 'book', 'dataset', 'tutorial']
  const type = validTypes.includes(p.type as SubmissionType)
    ? (p.type as SubmissionType)
    : 'paper'
  return {
    ...EMPTY_FORM,
    title: p.title,
    type,
    authors: p.authors
      .map((a) => {
        const parts = a
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
        return parts.length >= 2 ? `${parts.slice(1).join(' ')} ${parts[0]}` : a
      })
      .join(', '),
    year: p.year ? String(p.year) : EMPTY_FORM.year,
    discipline: p.discipline,
    subdiscipline: p.subdiscipline ?? '',
    abstract: p.abstract,
    preview: p.abstract,
    keywords: p.tags.join(', '),
    venue: p.venue ?? '',
    doi: p.doi ?? '',
  }
}

// 注册 router state 预设字段（与列表页保持一致的声明合并）
declare module '@tanstack/history' {
  interface HistoryState {
    preset?: IngestResource
  }
}

// ---------------------------------------------------------------------------
// 硬门槛：摘要 / 关键词 / 中图分类号 / 参考文献（外加标题、作者、三项声明）。
//   参考文献：正文 Markdown 出现「参考文献/References」标题，或已选择上传文件
//   （上传后由后端 format_report 复核，前端只能做启发式判定）。
// ---------------------------------------------------------------------------
const RE_REFS_HEADING =
  /^#{1,6}\s*(参考文献|参考资料|References|Bibliography)\s*$/m

// 上传文件识别后的轻量元数据：只做“能填就填”，解析不出来不阻塞。
// 正文仍以 Markdown 为准；标题/摘要/关键词只是给作者省手工录入。
function extractMarkdownMeta(markdown: string): {
  title?: string
  abstract?: string
  keywords?: string
} {
  const lines = markdown.split(/\r?\n/)
  const titleLine = lines.find((line) => {
    const trimmed = line.trim()
    if (!/^#\s+\S/.test(trimmed)) return false
    const heading = trimmed.replace(/^#\s+/, '').trim()
    return !/^(摘\s*要|关键词|关键字|Abstract|Keywords?|参考文献|References?|中图分类号|CLC)$/i.test(
      heading,
    )
  })
  const title = titleLine?.replace(/^#\s+/, '').trim()
  const section = (names: string) => {
    const re = new RegExp(`^#{1,6}\\s*(?:${names})\\s*$`, 'i')
    const start = lines.findIndex((line) => re.test(line.trim()))
    if (start < 0) return ''
    const out: string[] = []
    for (let i = start + 1; i < lines.length; i++) {
      if (/^#{1,6}\s+/.test(lines[i].trim())) break
      out.push(lines[i])
    }
    return out.join('\n').trim()
  }
  // DOCX/PDF 转换器常把标题、作者、摘要压成一个 **...** 前置块；
  // 没有 # 标题时从首个加粗短语兜底识别标题。
  const firstNonEmpty = lines.find((line) => line.trim())?.trim() ?? ''
  const boldLead = firstNonEmpty.match(/^\*\*([^*]{2,120})\*\*/)?.[1]?.trim()
  let abstract = section('摘\\s*要|Abstract')
  if (!abstract) {
    const inline = markdown.match(
      /\*\*摘\s*要[：:]\*\*\s*([\s\S]*?)(?=\*\*关键词|\*\*关键字|\n#{1,6}\s|$)/i,
    )
    abstract = inline?.[1]?.trim() ?? ''
  }
  let keywordsRaw = section('关键词|关键字|Keywords?')
  if (!keywordsRaw) {
    keywordsRaw =
      markdown.match(/\*\*关键词[：:]\*\*\s*([^\n]+)/i)?.[1]?.trim() ?? ''
  }
  const keywords = keywordsRaw
    .split(/[；;，,、]/)
    .map((s) => s.trim())
    .filter(Boolean)
    .join(', ')
  return {
    title: title || boldLead || undefined,
    abstract: abstract || undefined,
    keywords: keywords || undefined,
  }
}

interface GateResult {
  key: string
  label: string
  step: number // 所属步骤 0..3
  ok: boolean
}

function computeGates(f: WizardForm): GateResult[] {
  return [
    { key: 'title', label: '标题', step: 0, ok: f.title.trim().length > 0 },
    {
      key: 'abstract',
      label: '摘要',
      step: 0,
      ok: f.abstract.trim().length > 0,
    },
    {
      key: 'authors',
      label: '作者',
      step: 2,
      ok: parseListField(f.authors).length > 0,
    },
    {
      key: 'declOriginal',
      label: '原创性声明',
      step: 2,
      ok: f.declOriginal,
    },
    {
      key: 'declConfidential',
      label: '保密声明',
      step: 2,
      ok: f.declConfidential,
    },
    {
      key: 'declCopyright',
      label: '版权许可确认',
      step: 2,
      ok: f.declCopyright,
    },
  ]
}

const STEPS = [
  { id: 0, title: '基本信息', hint: '标题、摘要、关键词、方向' },
  { id: 1, title: '正文与上传', hint: '在线正文或上传作品文件' },
  { id: 2, title: '作者与声明', hint: '作者顺序、联系邮箱、三项确认' },
  { id: 3, title: '预览并提交', hint: '通读一遍，确认后提交' },
]

const DRAFT_KEY = 'submission-wizard-draft-v1'

function SubmissionWizardPage() {
  const navigate = useNavigate()
  const search = useSearch({ strict: false }) as WizardSearch
  const editId = typeof search.edit === 'number' ? search.edit : undefined

  const caps = useCapabilities()
  const uploadMaxMb = Math.round(
    (caps.data?.upload_max_bytes ?? 50 * 1024 * 1024) / 1024 / 1024,
  )
  const maxUploadBytes = caps.data?.upload_max_bytes ?? 50 * 1024 * 1024
  const acceptAttr = (
    caps.data?.upload_extensions ?? ['.docx', '.doc', '.pdf', '.txt', '.zip']
  ).join(',')

  const [step, setStep] = useState(0)
  // Studio 排版预览抽屉：任何时候都能看一眼“印出来是什么样”
  const [proofOpen, setProofOpen] = useState(false)
  const [pdfBusy, setPdfBusy] = useState(false)
  // ≥1280 常驻右栏；窄屏只在需要时开抽屉，避免后台白跑一遍分页
  const showSidePreview = useMediaQuery('(min-width: 1280px)')
  // 用户已访问过的步骤：进入过 / 点过「上一步/下一步」的步骤才显示红框，
  // 避免刚打开页面就满屏红字。
  const [visited, setVisited] = useState<boolean[]>([true, false, false, false])
  const [form, setForm] = useState<WizardForm>(() => ({
    ...EMPTY_FORM,
    articleSection: typeof search.section === 'string' ? search.section : '',
  }))
  const [savedAt, setSavedAt] = useState<Date | null>(null)
  const [draftLoaded, setDraftLoaded] = useState(false)
  const [cloudSavedAt, setCloudSavedAt] = useState<Date | null>(null)
  const serverDraftApplied = useRef(false)
  const lastDraftSignature = useRef('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  // ingest 页跳转过来的预填数据（router state）
  const preset = useRouterState({
    select: (s) => s.location.state?.preset,
  })
  const presetHandled = useRef(false)
  useEffect(() => {
    if (!preset || presetHandled.current || editId !== undefined) return
    presetHandled.current = true
    setForm(presetToForm(preset))
    // 消费完清空 state，避免后退/前进再次触发
    void navigate({ to: '/submissions/new', state: {}, replace: true })
  }, [preset, navigate, editId])

  // --- 编辑模式：拉取已有作品回填 ---
  const editSubQ = useSubmission(editId ?? 0)
  const editBodyQ = useSubmissionMarkdown(editId ?? 0, editId !== undefined)
  const editLoadedRef = useRef<number | null>(null)
  useEffect(() => {
    if (!editId) return
    if (editLoadedRef.current === editId) return
    // 详情和正文是两个请求：详情先回来时若先回填空正文，正文随后到达
    // 也不会再触发（ref 已标记），移动端尤其容易丢正文。两者都结束再回填。
    if (!editSubQ.data || editBodyQ.isLoading) return
    editLoadedRef.current = editId
    setForm(submissionToForm(editSubQ.data, editBodyQ.data?.content ?? ''))
  }, [editId, editSubQ.data, editBodyQ.data?.content, editBodyQ.isLoading])

  // --- 新建模式：从 localStorage 恢复草稿 ---
  useEffect(() => {
    if (editId || draftLoaded) return
    try {
      const raw = localStorage.getItem(DRAFT_KEY)
      if (raw) {
        const parsed = JSON.parse(raw) as WizardForm & { _savedAt?: number }
        // 草稿恢复是异步的：用户在页面刚打开时就输入的内容不能被它盖掉。
        // 只要当前表单已有任何用户输入，就保留现状，只补空缺字段。
        setForm((prev) => {
          const hasUserInput = Boolean(
            prev.title ||
            prev.abstract ||
            prev.keywords ||
            prev.authors ||
            prev.body,
          )
          if (hasUserInput) return prev
          return {
            ...EMPTY_FORM,
            ...parsed,
            ...(typeof search.section === 'string' && search.section
              ? { articleSection: search.section }
              : {}),
          }
        })
        if (parsed._savedAt) setSavedAt(new Date(parsed._savedAt))
      }
    } catch {
      // 草稿损坏时静默忽略，不阻塞提交
    }
    setDraftLoaded(true)
  }, [editId, draftLoaded, search.section])

  // --- 草稿自动保存（防抖 600ms）；编辑模式不写草稿 ---
  useEffect(() => {
    if (editId || !draftLoaded) return
    // 完全空白时不写，避免刚打开就落下一条空草稿
    const isBlank =
      !form.title &&
      !form.abstract &&
      !form.keywords &&
      !form.authors &&
      !form.body &&
      !form.file
    if (isBlank) return
    const t = setTimeout(() => {
      try {
        const payload = { ...form, _savedAt: Date.now() }
        localStorage.setItem(DRAFT_KEY, JSON.stringify(payload))
        setSavedAt(new Date())
      } catch {
        // 存储满或隐私模式：不打断用户
      }
    }, 600)
    return () => clearTimeout(t)
  }, [form, editId, draftLoaded])

  // --- 服务端草稿：登录账号跨设备恢复；本地草稿优先，避免同机旧数据被云端盖掉 ---
  const serverDraftQ = useSubmissionDraft(editId === undefined)
  useEffect(() => {
    if (
      editId !== undefined ||
      !draftLoaded ||
      !serverDraftQ.isFetched ||
      serverDraftApplied.current
    ) {
      return
    }
    serverDraftApplied.current = true
    const draft = serverDraftQ.data?.draft
    if (!draft) return
    setForm((prev) => {
      const hasUserInput = Boolean(
        prev.title ||
        prev.abstract ||
        prev.keywords ||
        prev.authors ||
        prev.body,
      )
      if (hasUserInput) return prev
      return draftPayloadToForm(draft.payload, draft.body)
    })
    setCloudSavedAt(new Date(draft.updated_at))
  }, [editId, draftLoaded, serverDraftQ.isFetched, serverDraftQ.data])

  // --- mutations ---
  const createMut = useCreateSubmission()
  const updateMut = useUpdateSubmission()
  const saveBodyMut = useSaveSubmissionMarkdown()
  const saveDraftMut = useSaveSubmissionDraft()
  const deleteDraftMut = useDeleteSubmissionDraft()
  const saveDraft = saveDraftMut.mutate
  const uploadMut = useUploadSubmissionFile()

  // --- 服务端草稿自动保存（防抖 1.5s）；编辑模式不写 ---
  useEffect(() => {
    if (editId !== undefined || !draftLoaded) return
    const isBlank =
      !form.title &&
      !form.abstract &&
      !form.keywords &&
      !form.authors &&
      !form.body &&
      !form.file
    if (isBlank) return
    const payload = formToDraftPayload(form)
    const signature = `${JSON.stringify(payload)}\n${form.body}`
    if (signature === lastDraftSignature.current) return
    const t = setTimeout(() => {
      saveDraft(
        { payload, body: form.body },
        {
          onSuccess: (state) => {
            lastDraftSignature.current = signature
            setCloudSavedAt(new Date(state.draft?.updated_at ?? Date.now()))
          },
        },
      )
    }, 1500)
    return () => clearTimeout(t)
  }, [form, editId, draftLoaded, saveDraft])

  const convertMut = useConvertSubmissionPreview()
  const [converting, setConverting] = useState(false)

  const gates = useMemo(() => computeGates(form), [form])
  const missing = gates.filter((g) => !g.ok)
  const missingCount = missing.length

  // 每个步骤的红/绿状态：当前步骤只在 visited 后才标红
  const stepGateState = useMemo(() => {
    return STEPS.map((s) => {
      const stepGates = gates.filter((g) => g.step === s.id)
      const failed = stepGates.filter((g) => !g.ok)
      return {
        id: s.id,
        failedCount: failed.length,
        // 已完成：本步骤所有门槛都过了
        done: failed.length === 0,
      }
    })
  }, [gates])

  const set = <K extends keyof WizardForm>(key: K, value: WizardForm[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  const goTo = (next: number) => {
    setVisited((prev) => {
      const copy = [...prev]
      for (let i = 0; i <= next; i++) copy[i] = true
      return copy
    })
    setStep(next)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  // 「下一步」门槛：当前步骤的硬门槛必须全部通过（已 visited 才提示）。
  // 未 visited 的步骤自动放行——用户可以从左侧步骤条直接跳。
  const canProceed = stepGateState[step].failedCount === 0

  const onPickFile = (f: File) => {
    if (f.size > maxUploadBytes) {
      toast.error(
        `文件 ${(f.size / 1024 / 1024).toFixed(1)} MB 超过 ${uploadMaxMb} MB 上限，请改用网盘或仓库链接`,
      )
      return
    }
    set('file', f)
    // 选文件当下先识别一次，把 Markdown 回填到编辑器；正式提交时后端
    // 还会用同一条转换管线再跑一次并落库，编辑器内容由作者确认后提交。
    const ext = f.name.split('.').pop()?.toLowerCase()
    if (!['docx', 'doc', 'pdf', 'txt', 'md', 'markdown'].includes(ext ?? '')) {
      return
    }
    void (async () => {
      setConverting(true)
      try {
        const result = await convertMut.mutateAsync(f)
        if (!result.markdown) {
          toast.error(
            result.reason || '未能从文件中识别出正文，请另存为 .docx 后重试',
          )
          return
        }
        if (
          form.body.trim() &&
          !window.confirm('当前正文已有内容，是否用识别结果替换？')
        ) {
          toast.info('已保留当前正文；文件仍会随作品上传')
          return
        }
        set('body', result.markdown)
        const meta = extractMarkdownMeta(result.markdown)
        if (!form.title.trim() && meta.title) set('title', meta.title)
        if (!form.abstract.trim() && meta.abstract)
          set('abstract', meta.abstract)
        if (!form.keywords.trim() && meta.keywords)
          set('keywords', meta.keywords)
        if (result.warnings.length > 0)
          toast.warning(result.warnings.join('；'))
        toast.success(
          `已识别 ${result.markdown.replace(/\s/g, '').length} 字，正文已填入编辑器`,
        )
      } catch (err) {
        toast.error(
          extractError(
            err,
            '文件识别失败，可先提交文件，服务器会在上传后再解析',
          ),
        )
      } finally {
        setConverting(false)
      }
    })()
  }

  const onSubmit = async () => {
    if (missingCount > 0) {
      // 把所有步骤都 visited，让红框一次性全部亮出来
      setVisited([true, true, true, true])
      toast.error(
        `还有 ${missingCount} 项未完成：${missing.map((m) => m.label).join('、')}`,
      )
      return
    }
    const body: SubmissionCreate = {
      title: form.title.trim(),
      type: form.type,
      track: form.type === 'paper' ? form.paperKind : undefined,
      authors: parseListField(form.authors),
      author_affiliations: parseListField(form.affiliations),
      year: Number(form.year) || new Date().getFullYear(),
      discipline: form.discipline.trim(),
      subdiscipline: form.subdiscipline.trim() || undefined,
      article_section: form.articleSection.trim() || undefined,
      issue_part: form.issuePart.trim() || undefined,
      abstract: form.abstract.trim(),
      preview: form.preview.trim() || form.abstract.trim().slice(0, 500),
      tags: [],
      keywords: parseListField(form.keywords),
      jel_codes: parseListField(form.clc),
      corresponding_author_email:
        form.correspondingAuthorEmail.trim() || undefined,
      venue: form.venue.trim() || undefined,
      doi: form.doi.trim() || undefined,
      download_url: form.downloadUrl.trim() || undefined,
      external_url: form.externalUrl.trim() || undefined,
      license: form.license.trim() || undefined,
      author_contributions: form.authorContributions.trim() || undefined,
      funding: form.funding.trim() || undefined,
      coi_statement: form.coiStatement.trim() || undefined,
      data_availability: form.dataAvailability.trim() || undefined,
    }

    try {
      let created: SubmissionResponse
      if (editId !== undefined) {
        created = await updateMut.mutateAsync({ id: editId, body })
        // 上传会重新转换并写 markdown_path；必须先把文件传完，再保存编辑器
        // 正文，否则作者在预览里改过的正文会被上传转换结果覆盖（旧顺序
        // 正是 create→saveBody→upload，下载件/网页与编辑器可能分叉）。
        if (form.file) {
          try {
            await uploadMut.mutateAsync({ id: editId, file: form.file })
          } catch (err) {
            toast.warning(extractError(err, '文件上传失败，已保留在线正文'))
          }
        }
        if (form.body.trim() !== '') {
          await saveBodyMut.mutateAsync({ id: editId, content: form.body })
        }
        toast.success('作品已更新')
      } else {
        created = await createMut.mutateAsync(body)
        if (form.file) {
          try {
            await uploadMut.mutateAsync({ id: created.id, file: form.file })
          } catch (err) {
            // 文件上传失败不阻塞主流程：元数据已提交，作者可在详情页补传
            toast.warning(extractError(err, '文件上传失败，可稍后在详情页补传'))
          }
        }
        if (form.body.trim() !== '') {
          await saveBodyMut.mutateAsync({ id: created.id, content: form.body })
        }
        // 草稿已落地为正式作品，清掉本地和云端草稿
        try {
          localStorage.removeItem(DRAFT_KEY)
        } catch {
          // ignore
        }
        void deleteDraftMut.mutate()
        toast.success('已提交，等待内容整理处理')
      }
      // 回到列表页；列表会自动 invalidate，新提交出现在第一行
      void navigate({ to: '/submissions' })
    } catch (err) {
      const detail = (err as { response?: { data?: { detail?: unknown } } })
        ?.response?.data?.detail as { code?: string } | string | undefined
      const code =
        typeof detail === 'object' && detail !== null ? detail.code : undefined
      if (code === 'rules_ack_required') {
        toast.error('发布前需要先阅读并确认《作品与发布规范》', {
          description: '正在为你打开确认页…',
          duration: 6000,
        })
        void navigate({ to: '/guide', search: { tab: 'authors' } })
        return
      }
      toast.error(
        extractError(err, editId !== undefined ? '更新失败' : '提交失败'),
      )
    }
  }

  const fieldError = (key: string): boolean => {
    if (!visited[step]) return false
    return gates.find((g) => g.key === key)?.ok === false
  }

  /** 当前表单 → 服务端同源排版 PDF（与预览同一题录顺序）。 */
  const downloadStudioPdf = async () => {
    if (pdfBusy) return
    setPdfBusy(true)
    try {
      const res = await api.post(
        '/submissions/studio-pdf',
        {
          title: form.title,
          authors: parseListField(form.authors),
          affiliations: form.affiliations,
          abstract: form.abstract,
          keywords: parseListField(form.keywords),
          body: form.body,
          doi: form.doi,
          funding: form.funding,
          clc: form.clc,
          license: form.license,
          track: form.type === 'paper' ? 'paper' : 'essay',
        },
        { responseType: 'blob' },
      )
      const blob = res.data as Blob
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${(form.title || 'paper').slice(0, 40)}-排版.pdf`
      a.click()
      URL.revokeObjectURL(url)
      toast.success('排版 PDF 已生成')
    } catch {
      toast.error('排版 PDF 生成失败，请稍后再试')
    } finally {
      setPdfBusy(false)
    }
  }

  // -----------------------------------------------------------------------
  // 渲染
  // -----------------------------------------------------------------------
  return (
    <div className="mx-auto w-full max-w-6xl pb-24 sm:pb-10">
      {/* 顶部：标题 + 草稿状态 */}
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">
            {editId !== undefined ? '修改作品' : '新建作品'}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            分四步完成：基本信息 → 正文 → 作者与声明 →
            预览提交。草稿会自动保存在本机和登录账号。
            <HelpTip
              className="ml-1"
              text="研究长文可以申请互评；自由创作不套固定格式，也不计分，只做基础校对。"
            />
          </p>
        </div>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          {savedAt && editId === undefined && (
            <span className="inline-flex items-center gap-1">
              <Save className="h-3.5 w-3.5" />
              本机 · {savedAt.toLocaleTimeString()}
            </span>
          )}
          {cloudSavedAt && editId === undefined && (
            <span className="inline-flex items-center gap-1">
              <Save className="h-3.5 w-3.5" />
              云端 · {cloudSavedAt.toLocaleTimeString()}
            </span>
          )}
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={() => setProofOpen(true)}
          >
            <Eye className="h-4 w-4" />
            排版预览
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate({ to: '/submissions' })}
          >
            <ChevronLeft className="h-4 w-4" />
            返回列表
          </Button>
        </div>
      </div>

      <div className="mb-4 rounded-md border border-dashed bg-muted/30 p-3 text-xs leading-relaxed text-muted-foreground">
        <span className="mr-2 font-medium text-foreground">
          发布前先看规格与版式：
        </span>
        <a
          className="font-medium text-primary hover:underline"
          href="/templates/rubbish-submission-template.docx"
          download
        >
          Word 模板（推荐）
        </a>
        <span className="mx-2">·</span>
        <a
          className="font-medium text-primary hover:underline"
          href="/templates/rubbish-submission-template-word.md"
          download
        >
          Word 排版要求
        </a>
        <span className="mx-2">·</span>
        <a
          className="font-medium text-primary hover:underline"
          href="/templates/rubbish-editorial-standards.md"
          download
        >
          发布规范
        </a>
        <span className="mx-2">·</span>
        <a className="font-medium text-primary hover:underline" href="/guide?tab=authors">
          作品指南
        </a>
        <div className="mt-1">
          推荐提交 Word（.docx）：系统识别、排版和送审最稳；PDF
          也可上传，下载时会自动转成 Word。
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[220px_minmax(0,1fr)] xl:grid-cols-[220px_minmax(0,1fr)_400px]">
        {/* 左侧：步骤导航（桌面纵向；移动横向可滑动） */}
        <nav
          aria-label="作品步骤"
          className="grid grid-cols-4 gap-1.5 pb-2 lg:flex lg:flex-col lg:gap-2 lg:pb-0"
        >
          {STEPS.map((s) => {
            const state = stepGateState[s.id]
            const isActive = step === s.id
            const showRed = visited[s.id] && state.failedCount > 0
            const showDone = visited[s.id] && state.done && !isActive
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => goTo(s.id)}
                className={[
                  'flex min-w-0 flex-col items-center gap-1 rounded-lg border px-1 py-2 text-center transition-colors lg:w-full lg:flex-row lg:items-center lg:gap-3 lg:px-3 lg:py-2.5 lg:text-left',
                  isActive
                    ? 'border-primary bg-primary/5'
                    : showRed
                      ? 'border-destructive/50 bg-destructive/5'
                      : 'border-border bg-card hover:bg-muted/40',
                ].join(' ')}
              >
                <span
                  className={[
                    'flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-medium',
                    isActive
                      ? 'bg-primary text-primary-foreground'
                      : showDone
                        ? 'bg-emerald-500 text-white'
                        : showRed
                          ? 'bg-destructive text-white'
                          : 'bg-muted text-muted-foreground',
                  ].join(' ')}
                >
                  {showDone ? <Check className="h-4 w-4" /> : s.id + 1}
                </span>
                <span className="min-w-0">
                  <span className="block text-[11px] font-medium leading-tight lg:truncate lg:text-sm">
                    {s.title}
                    {showRed && (
                      <span className="ml-1 hidden text-xs text-destructive lg:inline">
                        · {state.failedCount} 项待补
                      </span>
                    )}
                  </span>
                  <span className="hidden truncate text-xs text-muted-foreground lg:block">
                    {s.hint}
                  </span>
                </span>
              </button>
            )
          })}
        </nav>

        {/* 右侧：当前步骤 */}
        <div className="min-w-0">
          <div className="rounded-lg border bg-card p-5 sm:p-6">
            {step === 0 && (
              <StepBibliography
                form={form}
                set={set}
                fieldError={fieldError}
              />
            )}
            {step === 1 && (
              <StepUpload
                form={form}
                set={set}
                acceptAttr={acceptAttr}
                uploadMaxMb={uploadMaxMb}
                fileInputRef={fileInputRef}
                onPickFile={onPickFile}
                converting={converting}
                snapshotKey={
                  editId !== undefined
                    ? `submission-${editId}`
                    : 'submission-wizard-new'
                }
              />
            )}
            {step === 2 && (
              <StepAuthors form={form} set={set} fieldError={fieldError} />
            )}
            {step === 3 && (
              <StepReview
                form={form}
                missing={missing}
                uploadMaxMb={uploadMaxMb}
              />
            )}

            {/* 底部按钮区 */}
            <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t pt-4">
              <div className="text-xs text-muted-foreground">
                {step > 0 ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => goTo(step - 1)}
                  >
                    <ChevronLeft className="h-4 w-4" />
                    上一步
                  </Button>
                ) : (
                  <span />
                )}
              </div>
              <div className="flex items-center gap-2">
                {missingCount > 0 && step === 3 && (
                  <span className="inline-flex items-center gap-1 text-xs text-destructive">
                    <AlertCircle className="h-3.5 w-3.5" />
                    还差 {missingCount} 项：
                    {missing.map((m) => m.label).join('、')}
                  </span>
                )}
                {step < 3 ? (
                  <Button
                    onClick={() => goTo(step + 1)}
                    disabled={!canProceed && visited[step]}
                  >
                    下一步
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                ) : (
                  <Button
                    onClick={onSubmit}
                    disabled={
                      missingCount > 0 ||
                      createMut.isPending ||
                      updateMut.isPending ||
                      uploadMut.isPending
                    }
                  >
                    {(createMut.isPending || updateMut.isPending) && (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    )}
                    {editId !== undefined
                      ? updateMut.isPending
                        ? '保存中…'
                        : '保存修改'
                      : createMut.isPending
                        ? '提交中…'
                        : missingCount > 0
                          ? `还差 ${missingCount} 项`
                          : '确认提交'}
                  </Button>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* 宽屏常驻右栏：边写边看纸面，不必反复开抽屉。 */}
        {showSidePreview && !proofOpen ? (
        <aside>
          <div className="sticky top-20 max-h-[calc(100vh-6rem)] overflow-y-auto rounded-lg border bg-card p-3">
            <PaperProof
              title={form.title}
              authors={parseListField(form.authors)}
              affiliations={form.affiliations}
              abstract={form.abstract}
              keywords={parseListField(form.keywords)}
              body={form.body}
              doi={form.doi}
              funding={form.funding}
                  license={form.license}
              track={form.type === 'paper' ? 'paper' : 'essay'}
              onDownloadPdf={downloadStudioPdf}
              pdfBusy={pdfBusy}
            />
          </div>
        </aside>
        ) : null}
      </div>

      <Dialog open={proofOpen} onOpenChange={setProofOpen}>
        <DialogContent className="max-h-[90vh] w-[min(96vw,56rem)] overflow-y-auto p-0 sm:max-w-4xl">
          <DialogHeader className="sr-only">
            <DialogTitle>文章排版预览</DialogTitle>
          </DialogHeader>
          <PaperProof
            title={form.title}
            authors={parseListField(form.authors)}
            affiliations={form.affiliations}
            abstract={form.abstract}
            keywords={parseListField(form.keywords)}
            body={form.body}
            doi={form.doi}
            funding={form.funding}
              license={form.license}
            track={form.type === 'paper' ? 'paper' : 'essay'}
            onDownloadPdf={downloadStudioPdf}
            pdfBusy={pdfBusy}
          />
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ---------------------------------------------------------------------------
// 子步骤组件
// ---------------------------------------------------------------------------

function StepBibliography({
  form,
  set,
  fieldError,
}: {
  form: WizardForm
  set: <K extends keyof WizardForm>(key: K, value: WizardForm[K]) => void
  fieldError: (key: string) => boolean
}) {
  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold">基本信息</h2>
        <p className="text-sm text-muted-foreground">
          这一步写清「这是什么」。标题和摘要就够了；关键词、方向、合集分类都可以之后再补。
        </p>
      </div>

            {/* 作品类型：研究文章 / 荒诞研究 / 自由创作 */}
      <div className="space-y-2">
        <Label>作品类型</Label>
        <div className="grid max-w-2xl grid-cols-1 gap-2 sm:grid-cols-3">
          <button
            type="button"
            onClick={() => {
              set('type', 'paper')
              set('paperKind', 'serious')
            }}
            className={[
              'rounded-lg border px-4 py-3 text-left text-sm transition-colors',
              form.type === 'paper' && form.paperKind === 'serious'
                ? 'border-primary bg-primary/5 font-medium'
                : 'border-border bg-card hover:bg-muted/40',
            ].join(' ')}
          >
            研究长文
            <span className="mt-0.5 block text-xs text-muted-foreground">
              真实问题、可核查材料、完整论证
            </span>
          </button>
          <button
            type="button"
            onClick={() => {
              set('type', 'paper')
              set('paperKind', 'absurd')
            }}
            className={[
              'rounded-lg border px-4 py-3 text-left text-sm transition-colors',
              form.type === 'paper' && form.paperKind === 'absurd'
                ? 'border-absurd bg-absurd-soft font-medium'
                : 'border-border bg-card hover:bg-muted/40',
            ].join(' ')}
          >
            荒诞研究
            <span className="mt-0.5 block text-xs text-muted-foreground">
              用正经文章格式，论证一个荒诞命题
            </span>
          </button>
          <button
            type="button"
            onClick={() => set('type', 'tutorial')}
            className={[
              'rounded-lg border px-4 py-3 text-left text-sm transition-colors',
              form.type === 'tutorial'
                ? 'border-primary bg-primary/5 font-medium'
                : 'border-border bg-card hover:bg-muted/40',
            ].join(' ')}
          >
            自由创作
            <span className="mt-0.5 block text-xs text-muted-foreground">
              小说、随笔、评论、指南、吐槽；不用学术文章格式
            </span>
          </button>
        </div>
        <p className="text-[11px] leading-5 text-muted-foreground">
          研究长文和荒诞研究都可以申请互评，区别只在命题是否荒诞；自由创作不套固定格式，也不计分。
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="w-title">
          标题 <span className="text-destructive">*</span>
        </Label>
        <Input
          id="w-title"
          value={form.title}
          onChange={(e) => set('title', e.target.value)}
          placeholder="一句话说清这篇作品讲什么"
          className={fieldError('title') ? 'border-destructive' : ''}
        />
        {fieldError('title') && <FieldError>标题不能为空</FieldError>}
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="w-discipline">方向（选填）</Label>
          <Input
            id="w-discipline"
            list="w-discipline-options"
            value={form.discipline}
            onChange={(e) => set('discipline', e.target.value)}
            placeholder="如：计算机、社会学、文学"
            className={fieldError('discipline') ? 'border-destructive' : ''}
          />
          <datalist id="w-discipline-options">
            {DISCIPLINES.flatMap((c) => c.items).map((d) => (
              <option key={d.code} value={d.name}>
                {d.name}（{d.code}）
              </option>
            ))}
          </datalist>

        </div>
        <div className="space-y-2">
          <Label htmlFor="w-subdiscipline">细分方向（选填）</Label>
          <Input
            id="w-subdiscipline"
            list="w-subdiscipline-options"
            value={form.subdiscipline}
            onChange={(e) => set('subdiscipline', e.target.value)}
            placeholder="更细的方向，可留空"
          />
          <datalist id="w-subdiscipline-options">
            {DISCIPLINES.flatMap((c) => c.items).map((d) => (
              <option key={d.code} value={d.name}>
                {d.name}（{d.code}）
              </option>
            ))}
          </datalist>
        </div>
      </div>

      <ExpertiseCoverage currentDiscipline={form.discipline} />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="w-section">分类（选填）</Label>
          <select
            id="w-section"
            value={form.articleSection}
            onChange={(e) => set('articleSection', e.target.value)}
            className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="">自动归入默认分类，之后可调整</option>
            {ARTICLE_SECTION_OPTIONS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
          <p className="text-xs text-muted-foreground">
            分类只做浏览分组，不改变作品类型；通过后进入内容库对应分类。
          </p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="w-issue-part">合集主题（选填）</Label>
          <Input
            id="w-issue-part"
            list="w-issue-part-options"
            value={form.issuePart}
            onChange={(e) => set('issuePart', e.target.value)}
            placeholder="如：系统与故障"
          />
          <datalist id="w-issue-part-options">
            {ISSUE_PART_OPTIONS.map((part) => (
              <option key={part} value={part} />
            ))}
          </datalist>
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="w-abstract">
          摘要 <span className="text-destructive">*</span>
        </Label>
        <Textarea
          id="w-abstract"
          rows={6}
          value={form.abstract}
          onChange={(e) => set('abstract', e.target.value)}
          placeholder="研究问题、方法、主要结论（建议 200–400 字）"
          className={fieldError('abstract') ? 'border-destructive' : ''}
        />
        {fieldError('abstract') && <FieldError>摘要不能为空</FieldError>}
      </div>

      <div className="space-y-2">
        <Label htmlFor="w-keywords">关键词（选填，逗号分隔）</Label>
        <Input
          id="w-keywords"
          value={form.keywords}
          onChange={(e) => set('keywords', e.target.value)}
          placeholder="例如：大语言模型, Agent, RAG；不填也能发布"
        />
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="w-year">年份</Label>
          <select
            id="w-year"
            value={form.year}
            onChange={(e) => set('year', e.target.value)}
            className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
          >
            {YEAR_OPTIONS.map((year) => (
              <option key={year} value={year}>
                {year}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="w-venue">来源 / 首发平台（选填）</Label>
          <Input
            id="w-venue"
            value={form.venue}
            onChange={(e) => set('venue', e.target.value)}
            placeholder="若已有正式出处"
          />
        </div>
      </div>
    </div>
  )
}

function StepUpload({
  form,
  set,
  acceptAttr,
  uploadMaxMb,
  fileInputRef,
  onPickFile,
  converting,
  snapshotKey,
}: {
  form: WizardForm
  set: <K extends keyof WizardForm>(key: K, value: WizardForm[K]) => void
  acceptAttr: string
  uploadMaxMb: number
  fileInputRef: React.RefObject<HTMLInputElement | null>
  onPickFile: (f: File) => void
  converting: boolean
  snapshotKey: string
}) {
  const hasRefsHeading = RE_REFS_HEADING.test(form.body)
  const [sourcePreviewOpen, setSourcePreviewOpen] = useState(false)
  const [sourcePreview, setSourcePreview] = useState<{
    token: string
    pages: number
  } | null>(null)
  const [sourcePreviewLoading, setSourcePreviewLoading] = useState(false)

  const openSourcePreview = async () => {
    if (!form.file) {
      toast.error('请先选择要预览的 Word / PDF 文件')
      return
    }
    setSourcePreviewLoading(true)
    try {
      const preview = await previewUploadedSourcePages(form.file)
      setSourcePreview(preview)
      setSourcePreviewOpen(true)
    } catch (err) {
      toast.error(
        extractError(err, '原件预览失败；可先提交，服务器会在上传后解析'),
      )
    } finally {
      setSourcePreviewLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">正文与文件</h2>
        <p className="text-sm text-muted-foreground">
          先上传 Word /
          PDF，系统识别后自动填到下面的正文；也可以直接在线写。两条都保留时，以你在编辑器里最终改定的正文为准。
        </p>
      </div>

      {/* 1. 上传优先：人的动作是“先给稿，再校对”，不是先面对一个空编辑器。 */}
      <section className="rounded-xl border bg-card p-4 sm:p-5">
        <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
          <div>
            <div className="flex items-center gap-2">
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary text-[11px] font-semibold text-primary-foreground">
                1
              </span>
              <h3 className="text-sm font-semibold">上传 Word / PDF</h3>
              <Badge variant="secondary" className="text-[10px]">
                可选 · 推荐
              </Badge>
            </div>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              选完文件就会自动识别并回填正文，不需要先提交。DOCX 识别最稳；PDF
              识别后会转成可编辑正文。
            </p>
          </div>
          {form.file && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={sourcePreviewLoading}
              onClick={() => void openSourcePreview()}
            >
              {sourcePreviewLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <FileText className="h-4 w-4" />
              )}
              原件预览
            </Button>
          )}
        </div>

        <div className="rounded-lg border border-dashed bg-muted/20 p-3">
          <input
            ref={fileInputRef}
            type="file"
            accept={acceptAttr}
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) onPickFile(f)
              e.target.value = ''
            }}
          />
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            {form.file ? (
              <div className="flex min-w-0 flex-1 items-center gap-3">
                <FileText className="h-7 w-7 shrink-0 text-primary" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">
                    {form.file.name}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {(form.file.size / 1024).toFixed(0)} KB ·
                    {converting
                      ? ' 正在识别并回填正文…'
                      : ' 已识别，可在下方正文继续修改'}
                  </div>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="shrink-0 text-destructive"
                  onClick={() => set('file', null)}
                >
                  <X className="h-4 w-4" />
                  移除
                </Button>
              </div>
            ) : (
              <div className="flex min-w-0 flex-1 items-start gap-3">
                <Upload className="h-7 w-7 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-foreground">
                    还没有选择文件
                  </div>
                  <div className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                    支持 DOCX / PDF 等 {acceptAttr.split(',').length}{' '}
                    种格式，单文件 ≤ {uploadMaxMb} MB
                  </div>
                </div>
              </div>
            )}
            <Button
              type="button"
              variant={form.file ? 'outline' : 'default'}
              size="sm"
              disabled={converting}
              className="w-full sm:w-auto"
              onClick={() => fileInputRef.current?.click()}
            >
              {converting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Upload className="h-4 w-4" />
              )}
              {form.file ? '替换文件' : '选择文件'}
            </Button>
          </div>
        </div>
        {converting && (
          <p className="mt-2 flex items-center gap-2 text-xs text-primary">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            正在识别文档结构并填入正文，请稍候…
          </p>
        )}
      </section>

      {/* 2. 正文：上传后自动回填到这里，校对/修改都在这一块完成。 */}
      <section className="rounded-xl border bg-card p-4 sm:p-5">
        <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
          <div>
            <div className="flex items-center gap-2">
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary text-[11px] font-semibold text-primary-foreground">
                2
              </span>
              <h3 className="text-sm font-semibold">在线正文（Markdown）</h3>
            </div>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              这里就是最终发布与 Word/PDF
              导出使用的正文。上方识别结果会自动填进来。
            </p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {hasRefsHeading ? (
              <Badge className="bg-emerald-500/15 text-emerald-700">
                已附出处说明
              </Badge>
            ) : (
              <Badge variant="outline">出处说明可选</Badge>
            )}
          </div>
        </div>
        <MarkdownEditor
          value={form.body}
          onChange={(v) => set('body', v)}
          minHeight={320}
          placeholder={
            '# 1 起因\n\n# 2 经过\n\n# 3 结果\n\n# 4 我想说的\n\n正文可以自由分段。'
          }
          testId="wizard-body-editor"
          snapshotKey={snapshotKey}
          onUploadImage={(file) => uploadMediaImage(file, 'submission')}
        />
      </section>

      {/* 3. 规范与模板：不常看，收进折叠；需要时再展开，不再占正文上方一整屏。 */}
      <details className="rounded-lg border border-dashed bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
        <summary className="cursor-pointer select-none font-medium text-foreground">
          排版与文件说明（可选）
        </summary>
        <ul className="mt-2 list-inside list-disc space-y-1 leading-relaxed">
          <li>
            允许格式：{acceptAttr.split(',').join(' / ')} 等；单文件 ≤{' '}
            {uploadMaxMb} MB。
          </li>
          <li>
            正文建议写清标题、摘要和分段；出处说明可选，不强制凑条目。
          </li>
          <li>
            版式：先下载
            <a
              className="mx-1 font-medium text-primary hover:underline"
              href="/templates/rubbish-submission-template.docx"
              download
            >
              Word 模板（推荐）
            </a>
            照着改；逐项设置见
            <a
              className="mx-1 font-medium text-primary hover:underline"
              href="/templates/rubbish-submission-template-word.md"
              download
            >
              Word 排版要求
            </a>
            ，完整细则见
            <a
              className="mx-1 font-medium text-primary hover:underline"
              href="/templates/rubbish-editorial-standards.md"
              download
            >
              发布规范
            </a>
            。
          </li>
        </ul>
      </details>

      <Dialog open={sourcePreviewOpen} onOpenChange={setSourcePreviewOpen}>
        <DialogContent className="flex h-[100dvh] max-h-[100dvh] w-screen max-w-none flex-col overflow-hidden rounded-none p-0 sm:h-[86vh] sm:max-h-[86vh] sm:w-full sm:max-w-5xl sm:rounded-lg">
          <DialogHeader className="border-b px-4 py-3">
            <DialogTitle className="text-sm">
              原件预览 · {form.file?.name ?? ''}
            </DialogTitle>
          </DialogHeader>
          <div className="min-h-0 flex-1 p-2">
            {sourcePreview ? (
              <AuthPngPreview
                baseUrl={`/submissions/source-preview/${sourcePreview.token}`}
                pages={sourcePreview.pages}
              />
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                正在生成原件预览…
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* 4. 补充材料：不打断主流程，需要时展开。 */}
      <details className="rounded-lg border bg-card px-3 py-2">
        <summary className="cursor-pointer select-none text-sm font-medium">
          补充材料（代码 / 数据 / 外部链接，可选）
        </summary>
        <div className="mt-3 grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="w-ext">代码与数据链接</Label>
            <Input
              id="w-ext"
              type="url"
              value={form.externalUrl}
              onChange={(e) => set('externalUrl', e.target.value)}
              placeholder="https://github.com/you/paper"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="w-dl">作品直链</Label>
            <Input
              id="w-dl"
              type="url"
              value={form.downloadUrl}
              onChange={(e) => set('downloadUrl', e.target.value)}
              placeholder="https://…/paper.pdf"
            />
          </div>
        </div>
      </details>
    </div>
  )
}

function StepAuthors({
  form,
  set,
  fieldError,
}: {
  form: WizardForm
  set: <K extends keyof WizardForm>(key: K, value: WizardForm[K]) => void
  fieldError: (key: string) => boolean
}) {
  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold">作者与声明</h2>
        <p className="text-sm text-muted-foreground">
          作者顺序即署名顺序；请确认通讯作者与三项承诺。
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="w-authors">
          作者（逗号分隔，顺序即署名顺序）{' '}
          <span className="text-destructive">*</span>
        </Label>
        <Input
          id="w-authors"
          value={form.authors}
          onChange={(e) => set('authors', e.target.value)}
          placeholder="张三, 李四, 王五"
          className={fieldError('authors') ? 'border-destructive' : ''}
        />
        {fieldError('authors') && <FieldError>至少填写一位作者</FieldError>}
      </div>

      <div className="space-y-2">
        <Label htmlFor="w-affiliations">作者单位（逗号分隔，选填）</Label>
        <Input
          id="w-affiliations"
          value={form.affiliations}
          onChange={(e) => set('affiliations', e.target.value)}
          placeholder="清华大学计算机系, 北京大学信息学院"
        />
        <p className="text-xs text-muted-foreground">
          多位作者可按署名顺序对应填写；只用于站内联系与互评回避，不对外展示。
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="w-corresp">联系邮箱（选填）</Label>
        <Input
          id="w-corresp"
          type="email"
          value={form.correspondingAuthorEmail}
          onChange={(e) => set('correspondingAuthorEmail', e.target.value)}
          placeholder="corresponding@example.com"
        />
        <p className="text-xs text-muted-foreground">
          互评反馈和通过通知会发到这里；留空则用账号注册邮箱。
        </p>
      </div>

      <div className="space-y-3 rounded-lg border p-4">
        <div>
          <div className="text-sm font-medium">声明与许可</div>
          <p className="text-xs text-muted-foreground">
            逐篇保存并在作品页展示；没有的内容写“无”，不要留空冒充已声明。
          </p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="w-license">许可</Label>
          <Input
            id="w-license"
            value={form.license}
            onChange={(e) => set('license', e.target.value)}
            placeholder="CC BY-NC 4.0"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="w-contributions">作者贡献（CRediT，选填）</Label>
          <Textarea
            id="w-contributions"
            value={form.authorContributions}
            onChange={(e) => set('authorContributions', e.target.value)}
            placeholder="概念化、方法学、软件、验证、写作……"
            rows={3}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="w-funding">基金与资助（选填）</Label>
          <Textarea
            id="w-funding"
            value={form.funding}
            onChange={(e) => set('funding', e.target.value)}
            placeholder="资助方、项目编号；无则写“无”"
            rows={2}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="w-coi">利益冲突声明（选填）</Label>
          <Textarea
            id="w-coi"
            value={form.coiStatement}
            onChange={(e) => set('coiStatement', e.target.value)}
            placeholder="作者声明无利益冲突"
            rows={2}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="w-data">数据可用性（选填）</Label>
          <Textarea
            id="w-data"
            value={form.dataAvailability}
            onChange={(e) => set('dataAvailability', e.target.value)}
            placeholder="数据位置、获取方式或受限说明"
            rows={2}
          />
        </div>
      </div>

      <div className="space-y-3 rounded-lg border p-4">
        <div className="text-sm font-medium">作品承诺</div>
        <DeclCheckbox
          checked={form.declOriginal}
          onChange={(v) => set('declOriginal', v)}
          label="原创性声明"
          description="本作品由我独立完成；引用他人内容已标注来源，不存在抄袭或冒充他人。"
          error={fieldError('declOriginal')}
        />
        <DeclCheckbox
          checked={form.declConfidential}
          onChange={(v) => set('declConfidential', v)}
          label="隐私与合规确认"
          description="作品不涉及未公开的涉密数据、他人隐私数据或侵权内容。"
          error={fieldError('declConfidential')}
        />
        <DeclCheckbox
          checked={form.declCopyright}
          onChange={(v) => set('declCopyright', v)}
          label="发布授权"
          description="同意本站按所选许可协议公开展示这篇作品，并做基础校对与导出。"
          error={fieldError('declCopyright')}
        />
      </div>
    </div>
  )
}

function ManuscriptCheck({ body }: { body: string }) {
  const issues = useMemo(() => checkManuscript(body), [body])
  if (!body.trim()) return null
  const blockers = issues.filter((issue) => issue.level === 'blocker').length
  const warnings = issues.filter((issue) => issue.level === 'warning').length
  return (
    <div className="rounded-lg border p-4 text-sm">
      <div className="flex items-center gap-2 font-medium">
        <ListChecks className="h-4 w-4 text-primary" />
        发布前基础检查
      </div>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
        {blockers > 0
          ? `发现 ${blockers} 个阻断项、${warnings} 个提醒项，建议修正后再提交。`
          : warnings > 0
            ? `发现 ${warnings} 个提醒项，请确认是否需要调整。`
            : '未发现编号、引用序号或重复段落等明显问题。'}
      </p>
      {issues.length > 0 ? (
        <details className="mt-2">
          <summary className="cursor-pointer text-xs text-primary">
            查看 {issues.length} 条检查结果
          </summary>
          <ul className="mt-2 space-y-2">
            {issues.map((issue: ManuscriptIssue, index) => (
              <li key={`${issue.code}-${issue.line ?? 0}-${index}`} className="flex items-start gap-2 text-xs">
                <span
                  className={
                    issue.level === 'blocker'
                      ? 'shrink-0 rounded bg-destructive/10 px-1.5 py-0.5 text-destructive'
                      : 'shrink-0 rounded bg-muted px-1.5 py-0.5 text-muted-foreground'
                  }
                >
                  {issue.level === 'blocker' ? '阻断' : issue.level === 'warning' ? '提醒' : '提示'}
                </span>
                <span className="min-w-0">
                  {issue.message}
                  <span className="ml-1 text-muted-foreground">
                    {issue.line ? `第 ${issue.line} 行 · ` : ''}
                    {issue.code}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  )
}

function StepReview({
  form,
  missing,
  uploadMaxMb,
}: {
  form: WizardForm
  missing: { key: string; label: string }[]
  uploadMaxMb: number
}) {
  const authors = parseListField(form.authors)
  const keywords = parseListField(form.keywords)
  const firstPara =
    form.abstract
      .split(/\n+/)
      .map((s) => s.trim())
      .filter(Boolean)[0] ?? ''
  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold">预览并提交</h2>
        <p className="text-sm text-muted-foreground">
          请通读一遍。确认无误后点击下方「确认提交」，提交后状态为「排队中」。
        </p>
      </div>

      <ManuscriptCheck body={form.body} />

      {missing.length > 0 && (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
          <div className="mb-1 flex items-center gap-1.5 font-medium">
            <AlertCircle className="h-4 w-4" />
            还有 {missing.length} 项未完成
          </div>
          <ul className="list-inside list-disc text-xs">
            {missing.map((m) => (
              <li key={m.key}>{m.label}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="space-y-3 rounded-lg border p-4 text-sm">
        <div>
          <div className="text-xs text-muted-foreground">标题</div>
          <div className="mt-0.5 font-medium">{form.title || '—'}</div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <div className="text-xs text-muted-foreground">类型</div>
            <div>
              {form.type === 'tutorial'
                ? '自由创作'
                : form.paperKind === 'absurd'
                  ? '荒诞研究'
                  : '研究长文'}
            </div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">方向 / 分类</div>
            <div>{form.discipline || '—'}</div>
          </div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground">摘要（首段）</div>
          <p className="mt-0.5 whitespace-pre-wrap text-muted-foreground">
            {firstPara || '—'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {keywords.length > 0 ? (
            keywords.map((k) => (
              <Badge key={k} variant="secondary">
                {k}
              </Badge>
            ))
          ) : (
            <span className="text-xs text-muted-foreground">关键词未填</span>
          )}
        </div>
        <div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground">作者</div>
          <div className="mt-0.5">
            {authors.length > 0 ? authors.join('、') : '—'}
          </div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground">作品文件</div>
          <div className="mt-0.5">
            {form.file ? (
              <span>
                {form.file.name} · {(form.file.size / 1024).toFixed(0)} KB（≤{' '}
                {uploadMaxMb} MB）
              </span>
            ) : form.body.trim() ? (
              <span>使用在线正文（{form.body.length} 字）</span>
            ) : (
              <span className="text-destructive">
                未上传文件，也未填写在线正文
              </span>
            )}
          </div>
        </div>
        <div className="flex flex-wrap gap-2 pt-1">
          <DeclBadge ok={form.declOriginal} label="原创性声明" />
          <DeclBadge ok={form.declConfidential} label="保密声明" />
          <DeclBadge ok={form.declCopyright} label="版权许可" />
        </div>
      </div>

      {form.body.trim() ? (
        <PaperProof
          title={form.title}
          authors={authors}
          affiliations={form.affiliations}
          abstract={form.abstract}
          keywords={keywords}
          body={form.body}
          doi={form.doi}
          funding={form.funding}
          license={form.license}
          track={form.type === 'paper' ? 'paper' : 'essay'}
        />
      ) : (
        <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
          还没有正文，无法生成发布效果预览。请先上传 Word/PDF 或填写在线正文。
        </div>
      )}
    </div>
  )
}

function FieldError({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex items-center gap-1 text-xs text-destructive">
      <AlertCircle className="h-3 w-3" />
      {children}
    </p>
  )
}

function DeclCheckbox({
  checked,
  onChange,
  label,
  description,
  error,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label: string
  description: string
  error?: boolean
}) {
  return (
    <label
      className={[
        'flex cursor-pointer items-start gap-3 rounded-md p-2',
        error ? 'bg-destructive/5' : 'hover:bg-muted/40',
      ].join(' ')}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-4 w-4"
      />
      <span>
        <span className="block text-sm font-medium">{label}</span>
        <span className="block text-xs text-muted-foreground">
          {description}
        </span>
      </span>
    </label>
  )
}

function DeclBadge({ ok, label }: { ok: boolean; label: string }) {
  return ok ? (
    <Badge className="bg-emerald-500/15 text-emerald-700">
      <Check className="mr-1 h-3 w-3" />
      {label}已确认
    </Badge>
  ) : (
    <Badge variant="outline" className="border-destructive/50 text-destructive">
      {label}未勾选
    </Badge>
  )
}
