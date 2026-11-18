import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { MessageSquareText } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

const KINDS = [
  { value: 'bug', label: '页面或功能出错' },
  { value: 'suggestion', label: '功能建议' },
  { value: 'content', label: '内容问题（错字、图片、版权）' },
  { value: 'submission', label: '投稿与审稿咨询' },
] as const

/**
 * 全站反馈入口：每个页面右下角常驻，提交后落审计并通知主编。
 * 移动端抬高到 Tab 栏之上，桌面端贴右下角；不遮挡返回顶部按钮。
 */
export function FeedbackLauncher() {
  const [open, setOpen] = useState(false)
  const pathname = typeof window === 'undefined' ? '' : window.location.pathname
  const isAuthScreen = /^\/(login|register|reset-password|forgot-password)/.test(pathname)

  const [kind, setKind] = useState<(typeof KINDS)[number]['value']>('bug')
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [sending, setSending] = useState(false)

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
        page_url: window.location.pathname + window.location.search,
      })
      toast.success('已提交，主编会收到')
      setOpen(false)
      setTitle('')
      setBody('')
    } catch {
      toast.error('提交失败，请稍后再试')
    } finally {
      setSending(false)
    }
  }

  // 认证页不显示反馈入口，避免抢登录表单的视觉焦点。
  if (isAuthScreen) return null

  // 全站常驻：手机端收进「功能」菜单；桌面端放在左侧栏底部，避开正文卡片。
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          aria-label="给编辑部提问题"
          data-testid="feedback-launcher"
          title="给编辑部提问题"
          className="fixed bottom-20 right-3 z-40 hidden h-11 w-11 items-center justify-center rounded-full border bg-card/95 text-foreground shadow-lg backdrop-blur transition-colors hover:border-primary/50 hover:text-primary md:bottom-28 md:left-4 md:right-auto md:top-auto md:inline-flex"
        >
          <MessageSquareText className="h-4 w-4" />
        </button>
      </DialogTrigger>
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
          <p className="text-xs text-muted-foreground">
            当前页面会自动附上：{typeof window !== 'undefined' ? window.location.pathname : '—'}
          </p>
          <Button className="w-full" onClick={submit} disabled={sending}>
            {sending ? '提交中…' : '提交给主编'}
          </Button>
          <Link
            to="/feedback"
            className="block text-center text-sm text-primary hover:underline"
            onClick={() => setOpen(false)}
          >
            查看反馈墙 · 大家提过的问题
          </Link>
        </div>
      </DialogContent>
    </Dialog>
  )
}
