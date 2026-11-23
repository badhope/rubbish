import { useEffect, useState } from 'react'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { AxiosError } from 'axios'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { useRegister } from '@/hooks/api/use-auth'
import { useCapabilities } from '@/hooks/use-capabilities'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export const Route = createFileRoute('/register')({
  component: RegisterPage,
})

export function RegisterPage() {
  const navigate = useNavigate()
  const registerMut = useRegister()
  const capabilities = useCapabilities()
  const emailDelivery = capabilities.data?.email_delivery ?? false
  const emailCodeRequired = capabilities.data?.registration_email_code_required ?? false
  const inviteRequired = capabilities.data?.registration_invite_required ?? false
  // 邮箱验证码本身就是所有权证明；同时弹算术题只会增加无意义的门槛。
  const captchaRequired =
    (capabilities.data?.captcha_required_for_registration ?? true) && !emailCodeRequired
  const [email, setEmail] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [captcha, setCaptcha] = useState<{ token: string; question: string } | null>(null)
  const [captchaAnswer, setCaptchaAnswer] = useState('')
  const [captchaError, setCaptchaError] = useState(false)
  const [captchaAttempt, setCaptchaAttempt] = useState(0)
  const [emailCode, setEmailCode] = useState('')
  const [inviteCode, setInviteCode] = useState('')
  const [codeSent, setCodeSent] = useState(false)
  const [codeSending, setCodeSending] = useState(false)
  const [codeCooldown, setCodeCooldown] = useState(0)
  const [attempted, setAttempted] = useState(false)

  const emailValid = EMAIL_RE.test(email.trim())
  const usernameValid = username.trim().length >= 3
  const passwordValid = password.length >= 8
  const confirmValid = confirm.length >= 8
  const passwordsMatch = password === confirm
  const captchaValid = !captchaRequired || (captcha !== null && captchaAnswer.trim() !== '')
  const emailCodeValid = !emailCodeRequired || /^\d{6}$/.test(emailCode.trim())
  const inviteValid = !inviteRequired || inviteCode.trim().length >= 4
  const formValid =
    emailValid &&
    usernameValid &&
    passwordValid &&
    confirmValid &&
    passwordsMatch &&
    captchaValid &&
    emailCodeValid &&
    inviteValid

  const emailHint = emailValid ? '' : '邮箱格式不正确，请检查后再填'
  const usernameHint = usernameValid ? '' : '用户名至少 3 个字符'
  const passwordHint = passwordValid ? '' : '密码至少 8 位'
  const confirmHint = !confirmValid
    ? '请再次输入密码'
    : passwordsMatch
      ? ''
      : '两次输入的密码不一致'
  const emailCodeHint = !emailCodeRequired
    ? ''
    : emailCode.trim() === ''
      ? '请先获取并填写邮箱验证码'
      : !/^\d{6}$/.test(emailCode.trim())
        ? '邮箱验证码应为 6 位数字'
        : ''
  const inviteHint = !inviteRequired
    ? ''
    : inviteCode.trim() === ''
      ? '请填写读者群里的邀请码'
      : inviteCode.trim().length < 4
        ? '邀请码格式不正确'
        : ''
  const captchaHint = captchaRequired
    ? captchaError
      ? ''
      : captcha === null
        ? '验证码还没加载好，请稍等或刷新页面'
        : captchaAnswer.trim() === ''
          ? '请回答验证码'
          : ''
    : ''

  useEffect(() => {
    if (capabilities.isLoading || !captchaRequired) {
      setCaptcha(null)
      setCaptchaError(false)
      return
    }
    let cancelled = false
    setCaptcha(null)
    setCaptchaError(false)
    void api
      .get<{ token: string; question: string }>('/auth/captcha')
      .then((r) => {
        if (!cancelled) {
          setCaptcha(r.data)
          setCaptchaError(false)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setCaptchaError(true)
          toast.error('验证码加载失败，请刷新页面重试')
        }
      })
    return () => {
      cancelled = true
    }
  }, [capabilities.isLoading, captchaRequired, captchaAttempt])

  useEffect(() => {
    if (codeCooldown <= 0) return
    const timer = window.setInterval(() => setCodeCooldown((v) => (v <= 1 ? 0 : v - 1)), 1000)
    return () => window.clearInterval(timer)
  }, [codeCooldown])

  const sendEmailCode = async () => {
    if (!emailValid || codeSending || codeCooldown > 0) return
    setCodeSending(true)
    try {
      await api.post('/auth/register/email-code/request', { email: email.trim() })
      setCodeSent(true)
      setCodeCooldown(60)
      toast.success('邮箱验证码已发送，请查收（含垃圾邮件箱）')
    } catch (err) {
      const msg =
        err instanceof AxiosError
          ? (err.response?.data as { detail?: string })?.detail ?? '验证码发送失败'
          : '验证码发送失败'
      toast.error(msg)
    } finally {
      setCodeSending(false)
    }
  }

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setAttempted(true)
    if (!formValid) return
    try {
      if (captchaRequired && !captcha) {
        toast.error('验证码还没加载好，请稍等或刷新页面')
        return
      }
      const result = await registerMut.mutateAsync({
        email,
        username,
        password,
        captcha_token: captchaRequired ? captcha?.token : undefined,
        captcha_answer: captchaRequired ? captchaAnswer.trim() : undefined,
        email_code: emailCodeRequired ? emailCode.trim() : undefined,
        invite_code: inviteRequired ? inviteCode.trim() : undefined,
      })
      if (!('access_token' in result) || !result.access_token) {
        // 注册端点对成功与冲突返回同一响应（防枚举），且注册响应不再建立会话：
        // 有邮件投递 → 去验证页；否则 → 去登录页用刚设置的密码登录。
        if (emailCodeRequired) {
          toast.success('注册成功，邮箱已验证，请使用刚设置的密码登录')
          void navigate({ to: '/login' })
        } else if (emailDelivery) {
          toast.success('注册成功，请查收邮件完成验证')
          void navigate({ to: '/verify-email', search: { email } })
        } else {
          toast.success('注册请求已受理，请使用刚设置的密码登录')
          void navigate({ to: '/login' })
        }
        return
      }
      // 兼容旧后端（滚动发布期间仍可能返回 TokenResponse）。
      // 后端默认 console 邮件后端：验证链接只写进服务器日志，不会真的发信。
      // 只有 SMTP 真的接通时才引导用户去收件箱，否则直接进工作台。
      if (emailDelivery) {
        toast.success('注册成功，请查收邮件完成验证')
        void navigate({ to: '/verify-email', search: { email } })
      } else {
        toast.success('注册成功，已自动登录')
        void navigate({ to: '/me' })
      }
    } catch (err) {
      const msg =
        err instanceof AxiosError
          ? (err.response?.data as { detail?: string })?.detail ?? '注册失败'
          : '注册失败'
      toast.error(msg)
    }
  }

  return (
    <div className="mx-auto flex min-h-[calc(100svh-4rem)] w-full max-w-md items-start px-4 pb-12 pt-16 sm:items-center sm:px-0 sm:py-0">
      <h1 className="sr-only">开一个账号</h1>
      <Card className="w-full">
        <CardHeader>
          <CardTitle className="text-2xl">开一个账号</CardTitle>
          <CardDescription>
          {inviteRequired
            ? '注册仅限邀请：先填写邮箱验证码，再填写读者群里的邀请码。'
            : '有了账号，就可以留下句子、发布作品，也能在别处读到更多。'}
          {capabilities.isFetched && !emailDelivery && (
            <span className="mt-2 block text-xs text-muted-foreground">
              当前站点未开通邮件服务：注册后可直接用邮箱和密码登录，邮箱验证与找回密码暂不可用，
              忘记密码请联系站务邮箱 info@rubbishasci.cn。
            </span>
          )}
        </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="space-y-4" noValidate>
            <div className="space-y-2">
              <Label htmlFor="email">邮箱</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                aria-invalid={attempted && !emailValid}
                required
              />
              {attempted && emailHint ? (
                <p className="text-xs text-destructive">{emailHint}</p>
              ) : null}
            </div>
            {emailCodeRequired && (
              <div className="space-y-2">
                <Label htmlFor="email-code">邮箱验证码</Label>
                <div className="flex gap-2">
                  <Input
                    id="email-code"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    value={emailCode}
                    onChange={(e) => setEmailCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    placeholder="6 位数字"
                    aria-invalid={attempted && !emailCodeValid}
                    required
                  />
                  <Button
                    type="button"
                    variant="outline"
                    className="shrink-0"
                    onClick={() => void sendEmailCode()}
                    disabled={!emailValid || codeSending || codeCooldown > 0}
                  >
                    {codeSending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : codeCooldown > 0 ? (
                      `${codeCooldown}s`
                    ) : codeSent ? (
                      '重发'
                    ) : (
                      '发送验证码'
                    )}
                  </Button>
                </div>
                {attempted && emailCodeHint ? (
                  <p className="text-xs text-destructive">{emailCodeHint}</p>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    验证码发到上面的邮箱；注册还需要读者群邀请码。
                  </p>
                )}
              </div>
            )}
            {inviteRequired && (
              <div className="space-y-2">
                <Label htmlFor="invite-code">邀请码</Label>
                <Input
                  id="invite-code"
                  value={inviteCode}
                  onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
                  placeholder="例如 RUBBISH-READER-XXXX-XXXX"
                  autoCapitalize="characters"
                  autoCorrect="off"
                  spellCheck={false}
                  aria-invalid={attempted && !inviteValid}
                  required
                />
                {attempted && inviteHint ? (
                  <p className="text-xs text-destructive">{inviteHint}</p>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    邀请码在读者群公告里；进群才能看到。
                  </p>
                )}
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="username">用户名</Label>
              <Input
                id="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username"
                minLength={3}
                aria-invalid={attempted && !usernameValid}
                required
              />
              {attempted && usernameHint ? (
                <p className="text-xs text-destructive">{usernameHint}</p>
              ) : null}
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">密码</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
                minLength={8}
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
                autoComplete="new-password"
                minLength={8}
                aria-invalid={attempted && !confirmValid}
                required
              />
              {attempted && confirmHint ? (
                <p className="text-xs text-destructive">{confirmHint}</p>
              ) : null}
            </div>
            {captchaRequired && (
              <div className="space-y-2">
                <Label htmlFor="captcha">
                  验证码：{captcha?.question ?? (captchaError ? '暂时不可用' : '加载中…')}
                </Label>
                <Input
                  id="captcha"
                  inputMode="numeric"
                  autoComplete="off"
                  value={captchaAnswer}
                  onChange={(e) => setCaptchaAnswer(e.target.value)}
                  placeholder="填计算结果，防批量注册"
                  aria-invalid={attempted && !captchaValid}
                />
                {captchaError ? (
                  <p className="text-xs text-destructive">
                    验证码没加载出来。
                    <button
                      type="button"
                      className="ml-1 underline underline-offset-2 hover:text-foreground"
                      onClick={() => setCaptchaAttempt((n) => n + 1)}
                    >
                      重试
                    </button>
                  </p>
                ) : null}
                {attempted && captchaHint ? (
                  <p className="text-xs text-destructive">{captchaHint}</p>
                ) : null}
                <p className="text-xs text-muted-foreground">一道自建的算术题：不接第三方验证，也不产生费用。</p>
              </div>
            )}
            <Button
              type="submit"
              className="w-full"
              disabled={registerMut.isPending || !formValid}
            >
              {registerMut.isPending ? '注册中…' : '注册'}
            </Button>
          </form>
          <p className="mt-3 text-center text-xs leading-5 text-muted-foreground">
            注册即表示你已阅读并同意
            <Link to="/guide" search={{ tab: 'policies' }} className="mx-1 text-primary hover:underline">边界与处理</Link>
            和
            <Link to="/privacy" className="mx-1 text-primary hover:underline">隐私政策</Link>。
          </p>
          <p className="mt-3 text-center text-sm text-muted-foreground">
            已有账号？{' '}
            <Link to="/login" className="text-primary hover:underline">
              登录
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
