import { useState } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import { toast } from 'sonner'
import { useAuthStore } from '@/lib/auth'
import { clearRestoreToken, loadRestoreToken } from '@/lib/restore-token'
import { useRestoreMyAccount } from '@/hooks/api/use-auth'
import { extractError } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function RestoreAccountPage() {
  const navigate = useNavigate()
  const token = loadRestoreToken()
  const logout = useAuthStore((s) => s.logout)
  const restore = useRestoreMyAccount()
  const [email, setEmail] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [attempted, setAttempted] = useState(false)

  const emailValid = EMAIL_RE.test(email.trim())
  const usernameValid = username.trim().length >= 3
  const passwordValid = password.length >= 8
  const formValid = emailValid && usernameValid && passwordValid

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!token) return
    setAttempted(true)
    if (!formValid) {
      setError('请先填全新的邮箱、用户名和密码；用户名至少 3 个字符，密码至少 8 位。')
      return
    }
    setError('')
    restore.mutate(
      { token, email: email.trim(), username: username.trim(), new_password: password },
      {
        onSuccess: () => {
          clearRestoreToken()
          logout()
          toast.success('账号已恢复，请用新的邮箱和密码重新登录')
          void navigate({ to: '/login' })
        },
        onError: (err) => setError(extractError(err, '恢复失败；请确认仍在 30 天内且使用的是注销前的浏览器')),
      },
    )
  }

  return (
    <div className="mx-auto flex min-h-[70vh] max-w-lg items-center px-4 py-10">
      <Card className="w-full">
        <CardHeader>
          <CardTitle className="font-serif text-2xl">恢复已注销账号</CardTitle>
          <CardDescription className="leading-relaxed">
            注销后的 30 天内可以撤销。恢复凭证只留在注销前的同一浏览器里，不会通过邮件发送；超过期限后账号会被永久删除。
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!token ? (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                当前浏览器没有注销前的登录凭证，无法在这里恢复。请回到注销时使用的浏览器；如果已经关闭无痕窗口，只能重新注册。
              </p>
              <Button asChild variant="outline" className="w-full">
                <Link to="/login">返回登录</Link>
              </Button>
            </div>
          ) : (
            <form onSubmit={submit} className="space-y-4">
              <div>
                <Label htmlFor="restore-email">新的邮箱</Label>
                <Input
                  id="restore-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  aria-invalid={attempted && !emailValid}
                  required
                />
              </div>
              <div>
                <Label htmlFor="restore-username">新的用户名</Label>
                <Input
                  id="restore-username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="恢复后对外显示的名字"
                  aria-invalid={attempted && !usernameValid}
                  required
                />
              </div>
              <div>
                <Label htmlFor="restore-password">新的密码</Label>
                <Input
                  id="restore-password"
                  type="password"
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="至少 8 位"
                  minLength={8}
                  aria-invalid={attempted && !passwordValid}
                  required
                />
              </div>
              {error ? <p className="text-xs text-destructive">{error}</p> : null}
              <Button
                type="submit"
                className="w-full"
                disabled={restore.isPending || !formValid}
              >
                {restore.isPending ? '恢复中…' : '恢复账号'}
              </Button>
              <p className="text-center text-xs text-muted-foreground">
                恢复后需要重新登录；旧的密码与旧设备会话都已失效。
              </p>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
