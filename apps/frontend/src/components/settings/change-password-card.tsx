import { useState } from 'react'
import { AxiosError } from 'axios'
import { KeyRound } from 'lucide-react'
import { toast } from 'sonner'
import { useChangePassword } from '@/hooks/api/use-auth'
import { extractError } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

/** 修改密码卡片：从 /account/security 迁入，供「账号设置」中枢复用。 */
export function ChangePasswordCard() {
  const changeMut = useChangePassword()
  const [oldPassword, setOldPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (newPassword !== confirmPassword) {
      toast.error('两次输入的新密码不一致')
      return
    }
    try {
      await changeMut.mutateAsync({ oldPassword, newPassword })
      setOldPassword('')
      setNewPassword('')
      setConfirmPassword('')
      // 改密会 bump token_version：所有设备（含本设备）的旧 token 失效，
      // 提示用户重新登录而不是等下一个请求 401。
      toast.success('密码已修改，请重新登录')
    } catch (err) {
      const status = err instanceof AxiosError ? err.response?.status : undefined
      toast.error(status === 401 ? '当前密码不正确' : extractError(err, '修改失败'))
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <KeyRound className="h-5 w-5" />
          修改密码
        </CardTitle>
        <CardDescription>修改后所有设备都需要重新登录。新密码至少 8 位。</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="old-password">当前密码</Label>
            <Input
              id="old-password"
              type="password"
              value={oldPassword}
              onChange={(e) => setOldPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="new-password">新密码</Label>
            <Input
              id="new-password"
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              autoComplete="new-password"
              required
              minLength={8}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="confirm-new-password">确认新密码</Label>
            <Input
              id="confirm-new-password"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              autoComplete="new-password"
              required
              minLength={8}
            />
          </div>
          <Button type="submit" disabled={changeMut.isPending}>
            {changeMut.isPending ? '修改中…' : '修改密码'}
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}
