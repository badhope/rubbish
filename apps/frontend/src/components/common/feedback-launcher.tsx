import { useRef, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { ImagePlus, Loader2, MessageSquareText, X } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { useAuth } from '@/hooks/use-auth'
import { uploadMediaImage } from '@/lib/media'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

const KINDS = [
  { value: 'bug', label: '页面或功能出错' },
  { value: 'suggestion', label: '功能建议' },
  { value: 'content', label: '内容问题（错字、图片、版权）' },
  { value: 'design', label: '版式与视觉问题' },
  { value: 'performance', label: '性能与加载问题' },
  { value: 'accessibility', label: '无障碍与移动端问题' },
  { value: 'submission', label: '投稿与审稿咨询' },
  { value: 'other', label: '其他问题' },
] as const

/**
 * 反馈表单弹窗。桌面端的全局浮钮和反馈墙的“提个问题”共用同一份表单，
 * 避免移动端把浮钮收进菜单后失去提交入口。
 */
export function FeedbackComposer({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { isAuthenticated } = useAuth()
  const [kind, setKind] = useState<(typeof KINDS)[number]['value']>('bug')
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [images, setImages] = useState<string[]>([])
  const [uploading, setUploading] = useState(false)
  const [sending, setSending] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  async function addImages(files: FileList | null) {
    if (!files?.length) return
    if (!isAuthenticated) {
      toast.error('登录后才能上传截图；文字反馈可以直接提交')
      return
    }
    if (images.length + files.length > 5) {
      toast.error('最多附 5 张图')
      return
    }
    setUploading(true)
    try {
      for (const file of Array.from(files)) {
        if (!file.type.startsWith('image/')) {
          toast.error(`${file.name} 不是图片`)
          continue
        }
        if (file.size > 5 * 1024 * 1024) {
          toast.error(`${file.name} 超过 5MB`)
          continue
        }
        const url = await uploadMediaImage(file, 'feedback')
        setImages((prev) => (prev.includes(url) ? prev : [...prev, url]))
      }
    } catch {
      toast.error('截图上传失败，请重试')
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  async function submit() {
    if (title.trim().length < 2) {
      toast.error('请写一个能看懂的标题')
      return
    }
    if (body.trim().length < 5) {
      toast.error('请把问题说清楚一点，至少 5 个字')
      return
    }
    setSending(true)
    try {
      await api.post('/catalog/feedback', {
        kind,
        title: title.trim(),
        body: body.trim(),
        page_url:
          typeof window === 'undefined'
            ? ''
            : window.location.pathname + window.location.search,
        images,
      })
      toast.success('已提交，主编会收到')
      onOpenChange(false)
      setTitle('')
      setBody('')
      setImages([])
    } catch {
      toast.error('提交失败，请稍后再试')
    } finally {
      setSending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>给编辑部提问题</DialogTitle>
          <DialogDescription>
            页面报错、内容有误、投稿疑问都可以写在这里。提交后会进入反馈墙并通知主编；反馈墙公开标题和正文，不显示提交人身份。
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="feedback-kind">问题类型</Label>
            <select
              id="feedback-kind"
              value={kind}
              onChange={(e) => setKind(e.target.value as typeof kind)}
              className="h-10 w-full rounded-md border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {KINDS.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="feedback-title">一句话标题</Label>
            <Input
              id="feedback-title"
              maxLength={120}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="例如：第 24 篇文章 PDF 打不开"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="feedback-body">具体情况</Label>
            <Textarea
              id="feedback-body"
              maxLength={2000}
              rows={5}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="说明你看到的现象、页面地址和操作步骤；内容问题请附文章标题。"
            />
          </div>
          <div className="space-y-2">
            <Label>截图（可选，最多 5 张）</Label>
            <div className="flex flex-wrap gap-2">
              {images.map((url) => (
                <div key={url} className="group relative h-20 w-20 overflow-hidden rounded-md border bg-muted">
                  <img src={url} alt="反馈截图" loading="lazy" className="h-full w-full object-cover" />
                  <button
                    type="button"
                    onClick={() => setImages((prev) => prev.filter((item) => item !== url))}
                    className="absolute right-1 top-1 grid h-5 w-5 place-items-center rounded-full bg-background/90 text-foreground shadow"
                    aria-label="移除截图"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
              {images.length < 5 ? (
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  disabled={uploading}
                  className="grid h-20 w-20 place-items-center rounded-md border border-dashed text-xs text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
                >
                  {uploading ? <Loader2 className="h-5 w-5 animate-spin" /> : <ImagePlus className="h-5 w-5" />}
                  <span className="mt-1">{uploading ? '上传中' : '加截图'}</span>
                </button>
              ) : null}
            </div>
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/gif,image/webp"
              multiple
              className="hidden"
              onChange={(event) => void addImages(event.target.files)}
            />
            <p className="text-xs text-muted-foreground">
              {isAuthenticated ? '支持 PNG / JPEG / GIF / WebP，单张不超过 5MB。' : '登录后可附截图；未登录也可以直接提交文字。'}
            </p>
          </div>
          <p className="text-xs text-muted-foreground">
            当前页面会自动附上：{typeof window !== 'undefined' ? window.location.pathname : '—'}
          </p>
          <Button className="w-full" onClick={submit} disabled={sending}>
            {sending ? '提交中…' : '提交给主编'}
          </Button>
          <Link
            to="/feedback"
            className="block text-center text-sm text-primary hover:underline"
            onClick={() => onOpenChange(false)}
          >
            查看反馈墙 · 大家提过的问题
          </Link>
        </div>
      </DialogContent>
    </Dialog>
  )
}

/**
 * 桌面端全局反馈入口。手机端不挂浮钮（会压正文和卡片按钮），
 * 从“功能”菜单进入反馈墙，再用反馈墙的“提个问题”提交。
 */
export function FeedbackLauncher() {
  const [open, setOpen] = useState(false)
  const pathname = typeof window === 'undefined' ? '' : window.location.pathname
  const isAuthScreen = /^\/(login|register|reset-password|forgot-password)/.test(pathname)

  if (isAuthScreen) return null

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="给编辑部提问题"
        data-testid="feedback-launcher"
        title="给编辑部提问题"
        className="fixed bottom-20 left-3 z-40 hidden h-11 items-center gap-1.5 rounded-full border bg-card/95 px-3 text-foreground shadow-lg backdrop-blur transition-colors hover:border-primary/50 hover:text-primary md:bottom-28 md:left-4 md:right-auto md:top-auto md:inline-flex"
      >
        <MessageSquareText className="h-4 w-4" />
        <span className="text-xs font-medium">反馈</span>
      </button>
      <FeedbackComposer open={open} onOpenChange={setOpen} />
    </>
  )
}
