import { useEffect, useRef, useState } from 'react'
import { createFileRoute, Link, useNavigate, useSearch } from '@tanstack/react-router'
import { AxiosError } from 'axios'
import { CheckCircle2, MailWarning, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { useResendVerification, useVerifyEmail } from '@/hooks/api/use-auth'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export const Route = createFileRoute('/verify-email')({
  component: VerifyEmailPage,
})

type Phase = 'form' | 'verifying' | 'success' | 'error'

function VerifyEmailPage() {
  const navigate = useNavigate()
  const search = useSearch({ strict: false }) as { token?: string; email?: string }
  const verifyMut = useVerifyEmail()
  const resendMut = useResendVerification()
  const [token, setToken] = useState(search.token ?? '')
  const [email, setEmail] = useState(search.email ?? '')
  const [phase, setPhase] = useState<Phase>('form')
  const [failReason, setFailReason] = useState('')
  // ref guard：自动验证只跑一次（StrictMode 下 effect 会跑两遍）
  const autoRanRef = useRef(false)

  // Strip the token query param from the URL as soon as it is read, so it
  // does not linger in browser history or get captured in screenshots.
  useEffect(() => {
    if (search.token && window.location.search) {
      window.history.replaceState({}, '', window.location.pathname)
    }
  }, [search.token])

  const runVerify = async (t: string) => {
    setPhase('verifying')
    try {
      await verifyMut.mutateAsync({ token: t })
      setPhase('success')
      toast.success('邮箱验证成功，请登录')
    } catch (err) {
      const raw =
        err instanceof AxiosError
          ? (err.response?.data as { detail?: string })?.detail ?? '验证失败'
          : '验证失败'
      // 后端 detail 是英文：把常见原因映射为中文，其余原样透出
      const msg = /invalid or expired/i.test(raw)
        ? '链接已过期或无效'
        : /already verified/i.test(raw)
          ? '该邮箱此前已完成验证，直接登录即可'
          : raw
      setFailReason(msg)
      setPhase('error')
    }
  }

  // 邮件链接自带 token：直接自动验证，不让用户再手点一次「验证」。
  // 失败不弹 toast 走临时提示，而是停在结果卡上给出下一步指引。
  useEffect(() => {
    if (search.token && !autoRanRef.current) {
      autoRanRef.current = true
      void runVerify(search.token)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search.token])

  const onVerify = async (e: React.FormEvent) => {
    e.preventDefault()
    await runVerify(token)
  }

  const onResend = async () => {
    if (!email) {
      toast.error('请填写邮箱')
      return
    }
    try {
      await resendMut.mutateAsync({ email })
      toast.success('如果该邮箱已注册，验证邮件已重新发送')
    } catch {
      toast.error('发送失败，请稍后重试')
    }
  }

  if (phase === 'verifying') {
    return (
      <div className="mx-auto flex min-h-[80vh] max-w-md items-center">
        <Card className="w-full">
          <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
            <RefreshCw className="h-8 w-8 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">正在验证邮箱，请稍候…</p>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (phase === 'success') {
    return (
      <div className="mx-auto flex min-h-[80vh] max-w-md items-center">
        <Card className="w-full">
          <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
            <CheckCircle2 className="h-12 w-12 text-emerald-600" />
            <CardTitle className="text-xl">验证成功</CardTitle>
            <CardDescription>邮箱验证完成，现在可以登录了。</CardDescription>
            <Button className="mt-2 w-full" onClick={() => void navigate({ to: '/login' })}>
              前往登录
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (phase === 'error') {
    return (
      <div className="mx-auto flex min-h-[80vh] max-w-md items-center">
        <Card className="w-full border-destructive/30">
          <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
            <MailWarning className="h-12 w-12 text-destructive" />
            <CardTitle className="text-xl">验证未通过</CardTitle>
            <CardDescription>
              {failReason}。链接可能已过期或已被使用——可以在下方重新发送验证邮件。
            </CardDescription>
            <div className="mt-2 flex w-full gap-2">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => {
                  setPhase('form')
                  setToken('')
                }}
              >
                手动输入 Token
              </Button>
              <Button className="flex-1" onClick={() => void navigate({ to: '/login' })}>
                前往登录
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="mx-auto flex min-h-[80vh] max-w-md items-center">
      <Card className="w-full">
        <CardHeader>
          <CardTitle className="text-2xl">验证邮箱</CardTitle>
          <CardDescription>
            输入邮件中的验证 token，或重新发送验证邮件。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <form onSubmit={onVerify} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="token">验证 Token</Label>
              <Input
                id="token"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="邮件链接里的 token 参数"
                required
              />
            </div>
            <Button type="submit" className="w-full" disabled={verifyMut.isPending}>
              {verifyMut.isPending ? '验证中…' : '验证'}
            </Button>
          </form>
          <div className="space-y-2 border-t pt-4">
            <Label htmlFor="email">没收到邮件？重新发送</Label>
            <div className="flex gap-2">
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="你的注册邮箱"
              />
              <Button
                type="button"
                variant="outline"
                onClick={onResend}
                disabled={resendMut.isPending}
              >
                {resendMut.isPending ? '发送中…' : '发送'}
              </Button>
            </div>
          </div>
          <p className="text-center text-sm text-muted-foreground">
            <Link to="/login" className="text-primary hover:underline">
              返回登录
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
