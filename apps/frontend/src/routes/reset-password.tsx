import { useEffect, useState } from 'react'
import { createFileRoute, Link, useNavigate, useSearch } from '@tanstack/react-router'
import { toast } from 'sonner'
import { useResetPassword } from '@/hooks/api/use-auth'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { extractError } from '@/lib/utils'

export const Route = createFileRoute('/reset-password')({
  component: ResetPasswordPage,
})

function ResetPasswordPage() {
  const navigate = useNavigate()
  const search = useSearch({ strict: false }) as { token?: string }
  const mut = useResetPassword()
  const [token, setToken] = useState(search.token ?? '')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [attempted, setAttempted] = useState(false)

  const tokenValid = token.trim().length > 0
  const passwordValid = password.length >= 8
  const confirmValid = confirm.length >= 8
  const passwordsMatch = password === confirm
  const formValid = tokenValid && passwordValid && confirmValid && passwordsMatch

  const passwordHint = passwordValid ? '' : '密码至少 8 位'
  const confirmHint = !confirmValid
    ? '请再次输入密码'
    : passwordsMatch
      ? ''
      : '两次输入的密码不一致'

  // Strip the token query param from the URL as soon as it is read, so it
  // does not linger in browser history or get captured in screenshots.
  useEffect(() => {
    if (search.token && window.location.search) {
      window.history.replaceState({}, '', window.location.pathname)
    }
  }, [search.token])

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setAttempted(true)
    if (!formValid) return
    try {
      await mut.mutateAsync({ token, new_password: password })
      toast.success('密码已重置，请使用新密码登录')
      void navigate({ to: '/login' })
    } catch (err) {
      toast.error(extractError(err, '重置失败'))
    }
  }

  return (
    <div className="mx-auto flex min-h-[calc(100svh-4rem)] w-full max-w-md items-start px-4 pb-12 pt-16 sm:items-center sm:px-0 sm:py-0">
      <Card className="w-full">
        <h1 className="sr-only">重置密码</h1>
        <CardHeader>
          <CardTitle className="text-2xl">重置密码</CardTitle>
          <CardDescription>输入邮件中的令牌和新密码。</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="space-y-4" noValidate>
            <div className="space-y-2">
              <Label htmlFor="token">重置令牌</Label>
              <Input
                id="token"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                aria-invalid={attempted && !tokenValid}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">新密码</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                minLength={8}
                autoComplete="new-password"
                aria-invalid={attempted && !passwordValid}
                required
              />
              {attempted && passwordHint ? (
                <p className="text-xs text-destructive">{passwordHint}</p>
              ) : null}
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirm">确认密码</Label>
              <Input
                id="confirm"
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                minLength={8}
                autoComplete="new-password"
                aria-invalid={attempted && !confirmValid}
                required
              />
              {attempted && confirmHint ? (
                <p className="text-xs text-destructive">{confirmHint}</p>
              ) : null}
            </div>
            <Button
              type="submit"
              className="w-full"
              disabled={mut.isPending || !formValid}
            >
              {mut.isPending ? '重置中…' : '重置密码'}
            </Button>
          </form>
          <p className="mt-4 text-center text-sm text-muted-foreground">
            <Link to="/login" className="text-primary hover:underline">
              返回登录
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
