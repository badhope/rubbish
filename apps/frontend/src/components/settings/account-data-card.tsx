import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { Download, FileJson2, ShieldAlert, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { useAuthStore } from '@/lib/auth'
import { saveRestoreToken } from '@/lib/restore-token'
import { useDeleteMyAccount, useExportMyData } from '@/hooks/api/use-auth'
import { extractError } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

function downloadJson(filename: string, payload: unknown) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

/** 把隐私页承诺的“导出全部个人数据”真正交到用户手里，并给出注销入口。 */
export function AccountDataCard({ username }: { username: string }) {
  const exportData = useExportMyData()
  const [deleteOpen, setDeleteOpen] = useState(false)

  return (
    <section className="border-y py-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <FileJson2 className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
          <div>
            <h3 className="text-sm font-medium">导出我的数据</h3>
            <p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted-foreground">
              下载一份 JSON：账号资料、作品与互评、阅读记录、书单、评论、讨论、申诉、认领、关注、活跃值与通知。
              密码哈希、两步验证密钥和通行密钥材料属于凭据，不会写进导出文件。
            </p>
          </div>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={exportData.isPending}
          onClick={() =>
            exportData.mutate(undefined, {
              onSuccess: (payload) => {
                const stamp = new Date().toISOString().slice(0, 10).replaceAll('-', '')
                downloadJson(`rubbish-${username}-${stamp}.json`, payload)
                toast.success('数据文件已生成，请检查浏览器下载')
              },
              onError: () => toast.error('数据导出失败，可再试一次。'),
            })
          }
        >
          <Download className="h-3.5 w-3.5" />
          {exportData.isPending ? '生成中…' : '导出我的数据'}
        </Button>
      </div>

      <div className="mt-4 flex flex-wrap items-start justify-between gap-4 border-t pt-4">
        <div className="flex min-w-0 items-start gap-3">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
          <div>
            <h3 className="text-sm font-medium">注销账号</h3>
            <p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted-foreground">
              注销会立即退出所有设备并匿名化个人资料，保留文章与历史记录。30 天内可在注销前的同一浏览器恢复；逾期永久删除。
              建议先导出上面的数据。
            </p>
          </div>
        </div>
        <Button type="button" variant="destructive" size="sm" onClick={() => setDeleteOpen(true)}>
          <Trash2 className="h-3.5 w-3.5" />
          注销账号
        </Button>
      </div>

      <DeleteAccountDialog open={deleteOpen} onOpenChange={setDeleteOpen} />
    </section>
  )
}

function DeleteAccountDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const navigate = useNavigate()
  const remove = useDeleteMyAccount()
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [error, setError] = useState('')

  const valid = password.length > 0 && confirmation.trim().toUpperCase() === 'DELETE MY ACCOUNT'

  const close = (next: boolean) => {
    if (remove.isPending) return
    if (!next) {
      setPassword('')
      setConfirmation('')
      setError('')
    }
    onOpenChange(next)
  }

  const submit = () => {
    if (!valid) {
      setError('请输入当前密码，并完整输入 DELETE MY ACCOUNT。')
      return
    }
    setError('')
    remove.mutate(
      { password, confirmation: confirmation.trim().toUpperCase() },
      {
        onSuccess: () => {
          onOpenChange(false)
          const token = useAuthStore.getState().token
          if (token) saveRestoreToken(token)
          // 注销后普通接口已经拒绝这个 token；把它从 auth store 摘走，
          // 只保留在 recover token 里，避免后台 401 触发 refresh 失败后
          // 把唯一凭证清掉。
          useAuthStore.getState().logout()
          toast.success('账号已注销。30 天内可用当前浏览器恢复；逾期将永久删除。')
          void navigate({ to: '/restore-account' })
        },
        onError: (err) => setError(extractError(err, '注销失败，请检查密码后重试')),
      },
    )
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>确定注销账号？</DialogTitle>
          <DialogDescription>
            这一步会立即退出所有设备，并把邮箱、用户名与个人资料匿名化。作品、互评和讨论仍然保留，但作者会显示为已注销账号；30 天内可以在本页恢复。
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label htmlFor="delete-password">当前密码</Label>
            <Input
              id="delete-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="用于确认是本人操作"
            />
          </div>
          <div>
            <Label htmlFor="delete-confirmation">输入「DELETE MY ACCOUNT」</Label>
            <Input
              id="delete-confirmation"
              value={confirmation}
              onChange={(e) => setConfirmation(e.target.value)}
              placeholder="DELETE MY ACCOUNT"
              autoComplete="off"
            />
          </div>
          {error ? <p className="text-xs text-destructive">{error}</p> : null}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" disabled={remove.isPending} onClick={() => close(false)}>
            先不注销
          </Button>
          <Button type="button" variant="destructive" disabled={remove.isPending || !valid} onClick={submit}>
            {remove.isPending ? '注销中…' : '确认注销'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
