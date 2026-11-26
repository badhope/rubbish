import { useEffect, useId, useState } from 'react'
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
import { Textarea } from '@/components/ui/textarea'

interface Props {
  open: boolean
  title: string
  description?: string
  label: string
  placeholder?: string
  defaultValue?: string
  minLength?: number
  confirmText?: string
  pending?: boolean
  onConfirm: (reason: string) => void
  onOpenChange: (open: boolean) => void
}

/**
 * 需要填写原因的高风险操作弹窗。
 * 浏览器原生 prompt 无法做长度校验，也不会继承站内样式，因此统一收口到这里。
 */
export function ReasonDialog({
  open,
  title,
  description,
  label,
  placeholder,
  defaultValue = '',
  minLength = 3,
  confirmText = '确认',
  pending = false,
  onConfirm,
  onOpenChange,
}: Props) {
  const fieldId = useId()
  const [value, setValue] = useState(defaultValue)

  useEffect(() => {
    if (open) setValue(defaultValue)
  }, [defaultValue, open])

  const trimmed = value.trim()
  const valid = trimmed.length >= minLength

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor={fieldId}>{label}</Label>
          <Textarea
            id={fieldId}
            rows={4}
            maxLength={500}
            autoFocus
            value={value}
            placeholder={placeholder}
            onChange={(event) => setValue(event.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            至少 {minLength} 个字，当前 {trimmed.length} 个字。
          </p>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            取消
          </Button>
          <Button
            type="button"
            onClick={() => onConfirm(trimmed)}
            disabled={!valid || pending}
          >
            {pending ? '处理中…' : confirmText}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
