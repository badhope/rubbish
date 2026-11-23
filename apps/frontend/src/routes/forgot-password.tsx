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
    <div className="mx-auto flex min-h-[80vh] max-w-md items-center">
      <Card className="w-full">
        <CardHeader>
          <CardTitle className="text-2xl">找回密码</CardTitle>
          <CardDescription>
            输入注册邮箱，我们把重置链接发过去。
            {capabilities.isFetched && !emailDelivery && (
              <span className="mt-2 block text-xs text-muted-foreground">
                当前站点未开通邮件服务，自助重置暂不可用；请直接联系站务邮箱 info@rubbishasci.cn
                info@rubbishasci.cn 重置密码。
              </span>
            )}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {sent ? (
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
