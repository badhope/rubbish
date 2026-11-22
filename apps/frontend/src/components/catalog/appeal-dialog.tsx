import { useState } from 'react'
import { toast } from 'sonner'
import { useCreateAppeal } from '@/hooks/api/use-modules'
import type { AppealKind } from '@/lib/types'
import { extractError } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'

const KIND_OPTIONS: { value: AppealKind; label: string; hint: string }[] = [
  {
    value: 'withdraw',
    label: '撤回作品',
    hint: '通过后会立即从公开目录下架；适合本人要求停止公开的情况。',
  },
  {
    value: 'rescore',
    label: '重审评分',
    hint: '请站务组复核质量分；不会自动改分，需编辑核对后给出结论。',
  },
  {
    value: 'rescore_zone',
    label: '重审分区',
    hint: '请站务组复核栏目/分区归属；不会自动改栏目，需编辑核对后给出结论。',
  },
]

/** 作者对自己已发布作品的申诉入口；同一作品同一诉求只能提交一次。 */
export function AppealDialog({
  resourceId,
  open,
  onOpenChange,
}: {
  resourceId: number
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const create = useCreateAppeal(resourceId)
  const [kind, setKind] = useState<AppealKind>('withdraw')
  const [reason, setReason] = useState('')
  const [error, setError] = useState('')

  const selected = KIND_OPTIONS.find((item) => item.value === kind) ?? KIND_OPTIONS[0]
  const valid = reason.trim().length >= 100 && reason.trim().length <= 3000

  const submit = async () => {
    setError('')
    if (!valid) {
      setError('请把理由写完整，至少 100 字；站务组需要据此核对作品。')
      return
    }
    try {
      await create.mutateAsync({ kind, reason: reason.trim() })
      toast.success('申诉已提交，站务组会处理；进度可在「我的」查看')
      setReason('')
      setKind('withdraw')
      onOpenChange(false)
    } catch (err) {
      setError(extractError(err, '提交失败，请稍后再试'))
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) setError(''); onOpenChange(next) }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>作者申诉</DialogTitle>
          <DialogDescription>
            申诉会进入站务组队列，处理结果会以站内通知和邮件副本送达。同一作品同一诉求只能提交一次。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>诉求</Label>
            <Select value={kind} onValueChange={(value) => setKind(value as AppealKind)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {KIND_OPTIONS.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[11px] leading-relaxed text-muted-foreground">{selected.hint}</p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="appeal-reason">理由与依据</Label>
            <Textarea
              id="appeal-reason"
              rows={7}
              maxLength={3000}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="写清发生了什么、你希望站务组核对哪一部分、有哪些可供核对的事实。至少 100 字。"
            />
            <p className={`text-right text-[11px] ${valid ? 'text-muted-foreground' : 'text-amber-700'}`}>
              {reason.trim().length}/100 字起
            </p>
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
          <Button disabled={create.isPending || !valid} onClick={() => void submit()}>
            {create.isPending ? '提交中…' : '提交申诉'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
