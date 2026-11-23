import { useState } from 'react'
import { Link2, Check, Copy } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

const DEFAULT_OG_IMAGE = '/brand/rubbish-og.png'

/**
 * 分享弹窗：复制当前链接，并按外链抓取时看到的样子做一张只读预览。
 * 标题、开头与封面由调用方从页面已有数据传入；不调用新的后端接口。
 * OG 元信息由服务端按页注入（见后端 seo.py），这里只做站内预览。
 */
export function ShareDialog({
  open,
  onOpenChange,
  title,
  description,
  url,
  image,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: string
  url: string
  image?: string | null
}) {
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('clipboard unavailable')
      await navigator.clipboard.writeText(url)
      setCopied(true)
      toast.success('链接已复制')
      window.setTimeout(() => setCopied(false), 1600)
    } catch {
      toast.error('复制失败，请手动复制地址栏链接')
    }
  }

  let displayUrl = url
  try {
    displayUrl = new URL(url).host + new URL(url).pathname
  } catch {
    // 相对地址直接展示路径
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Link2 className="h-4 w-4 text-primary" />
            分享这篇内容
          </DialogTitle>
          <DialogDescription>
            链接发给别人，打开后看到的就是下面这张预览卡。
          </DialogDescription>
        </DialogHeader>

        <div className="overflow-hidden rounded-lg border bg-card">
          <img
            src={image || DEFAULT_OG_IMAGE}
            alt=""
            className="aspect-[1200/630] w-full object-cover"
            loading="lazy"
          />
          <div className="space-y-1.5 p-4">
            <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
              Rubbish
            </p>
            <p className="line-clamp-2 text-sm font-medium leading-snug">{title}</p>
            {description ? (
              <p className="line-clamp-2 text-xs leading-relaxed text-muted-foreground">
                {description}
              </p>
            ) : null}
            <p className="truncate text-[11px] text-muted-foreground">{displayUrl}</p>
          </div>
        </div>

        <Button onClick={() => void copy()} className="w-full" disabled={copied}>
          {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
          {copied ? '已复制' : '复制链接'}
        </Button>
      </DialogContent>
    </Dialog>
  )
}
