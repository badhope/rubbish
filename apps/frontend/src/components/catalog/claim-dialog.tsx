import { useState } from 'react'
import { toast } from 'sonner'
import { useClaimResource } from '@/hooks/api/use-modules'
import type { AuthorDetail, ClaimEvidenceType } from '@/lib/types'
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
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'

const EVIDENCE_LABEL: Record<ClaimEvidenceType, string> = {
  email: '原稿邮箱',
  orcid: 'ORCID',
  manuscript_id: '作品编号',
}

const EVIDENCE_HINT: Record<ClaimEvidenceType, string> = {
  email: '填提交作品时留下的邮箱',
  orcid: '填你的 ORCID iD',
  manuscript_id: '填作品编号，例如 RUB-A-2603-00634',
}

/**
 * 作者认领入口：一个弹窗完成，不再单开认领页。
 * 只对 owner_id 为空、且没有待审申请的文章显示。
 */
export function ClaimDialog({
  open,
  onOpenChange,
  resourceId,
  authors,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  resourceId: number
  authors: AuthorDetail[] | null
}) {
  const claim = useClaimResource()
  const [position, setPosition] = useState('1')
  const [evidenceType, setEvidenceType] = useState<ClaimEvidenceType>('email')
  const [evidenceValue, setEvidenceValue] = useState('')
  const [note, setNote] = useState('')

  const options = (authors ?? []).map((author) => ({
    value: String(author.order + 1),
    label: `${author.name}${author.roles.includes('first') ? '（第一作者）' : ''}`,
  }))

  const submit = async () => {
    if (!evidenceValue.trim()) {
      toast.error(`请填写${EVIDENCE_LABEL[evidenceType]}`)
      return
    }
    try {
      await claim.mutateAsync({
        resourceId,
        body: {
          author_position: Number(position),
          evidence_type: evidenceType,
          evidence_value: evidenceValue.trim(),
          note: note.trim() || null,
        },
      })
      toast.success('认领申请已提交，内容整理组核对后会通知你')
      setEvidenceValue('')
      setNote('')
      onOpenChange(false)
    } catch (err) {
      toast.error(extractError(err, '认领失败'))
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>认领这篇记录</DialogTitle>
          <DialogDescription>
            认领会交给内容整理组核对；通过后文章会挂到你的主页。请只认领自己参与过的文章。
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {options.length > 0 ? (
            <div className="space-y-2">
              <Label>你是第几位作者</Label>
              <Select value={position} onValueChange={setPosition}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {options.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : (
            <div className="space-y-2">
              <Label htmlFor="claim-position">你是第几位作者</Label>
              <Input
                id="claim-position"
                type="number"
                min={1}
                value={position}
                onChange={(event) => setPosition(event.target.value)}
              />
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-[0.9fr_1.4fr]">
            <div className="space-y-2">
              <Label>核对材料</Label>
              <Select value={evidenceType} onValueChange={(value) => setEvidenceType(value as ClaimEvidenceType)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(EVIDENCE_LABEL) as ClaimEvidenceType[]).map((value) => (
                    <SelectItem key={value} value={value}>
                      {EVIDENCE_LABEL[value]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="claim-evidence">{EVIDENCE_LABEL[evidenceType]}</Label>
              <Input
                id="claim-evidence"
                value={evidenceValue}
                onChange={(event) => setEvidenceValue(event.target.value)}
                placeholder={EVIDENCE_HINT[evidenceType]}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="claim-note">补充说明（可选）</Label>
            <Textarea
              id="claim-note"
              rows={2}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="例如：原稿署名与站内用户名不同，说明对应关系。"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button onClick={() => void submit()} disabled={claim.isPending}>
            {claim.isPending ? '提交中…' : '提交认领'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
