import { useState } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { toast } from 'sonner'
import { useForgotPassword } from '@/hooks/api/use-auth'
import { useCapabilities } from '@/hooks/use-capabilities'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export const Route = createFileRoute('/forgot-password')({
  component: ForgotPasswordPage,
})

function ForgotPasswordPage() {
  const mut = useForgotPassword()
  const capabilities = useCapabilities()
  const emailDelivery = capabilities.data?.email_delivery ?? false
  const noEmailService = capabilities.isFetched && !emailDelivery
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [touched, setTouched] = useState(false)

  const emailValid = EMAIL_RE.test(email.trim())
  const emailHint = !email.trim()
    ? '请输入注册邮箱'
    : emailValid
      ? ''
      : '邮箱格式不正确，请检查后再填'

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setTouched(true)
    if (!emailValid) return
    try {
      await mut.mutateAsync({ email: email.trim() })
      setSent(true)
      // backend 总是返回 200，不暴露账号是否存在
      toast.success('如果该邮箱已注册，重置邮件已发送')
    } catch {
      toast.error('请求失败，请稍后重试')
    }
  }

  return (
    <div className="mx-auto flex min-h-[calc(100svh-4rem)] w-full max-w-md items-start px-4 pb-12 pt-16 sm:items-center sm:px-0 sm:py-0">
      <Card className="w-full">
        <h1 className="sr-only">找回密码</h1>
        <CardHeader>
          <CardTitle className="text-2xl">找回密码</CardTitle>
          <CardDescription>
            {noEmailService
              ? '当前站点没有接通邮件投递，自助重置暂时用不了。'
              : '输入注册邮箱，我们把重置链接发过去。'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {noEmailService ? (
            <div className="space-y-4 text-sm text-muted-foreground">
              <p className="leading-6">
                请直接写信到{' '}
                <a href="mailto:info@rubbishasci.cn" className="text-primary hover:underline">
                  info@rubbishasci.cn
                </a>
                ，写明账号邮箱或用户名；站务会人工核对后帮你重置。
              </p>
              <Button asChild className="w-full">
                <a href="mailto:info@rubbishasci.cn">
                  写信给站务
                </a>
              </Button>
              <p className="text-center">
                <Link to="/login" className="text-primary hover:underline">
                  返回登录
                </Link>
              </p>
            </div>
          ) : sent ? (
            <div className="space-y-4 text-sm text-muted-foreground">
              <p>
                如果该邮箱已注册，重置邮件已发送，请在 30 分钟内点击
                邮件里的链接完成重置。
              </p>
              <p>
                <Link to="/login" className="text-primary hover:underline">
                  返回登录
                </Link>
              </p>
            </div>
          ) : (
            <form onSubmit={onSubmit} className="space-y-4" noValidate>
              <div className="space-y-2">
                <Label htmlFor="email">邮箱</Label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                  aria-invalid={touched && !emailValid}
                  required
                />
                {touched && emailHint ? (
                  <p className="text-xs text-destructive">{emailHint}</p>
                ) : null}
              </div>
              <Button
                type="submit"
                className="w-full"
                disabled={mut.isPending || !emailValid}
              >
                {mut.isPending ? '发送中…' : '发送重置邮件'}
              </Button>
              <p className="text-center text-sm text-muted-foreground">
                <Link to="/login" className="text-primary hover:underline">
                  返回登录
                </Link>
              </p>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
