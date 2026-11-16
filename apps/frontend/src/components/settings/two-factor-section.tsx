import { useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { toast } from 'sonner'
import { extractError } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import {
  useDisableTwoFactor,
  useRegenerateBackupCodes,
  useSetupTwoFactor,
  useTwoFactorStatus,
  useVerifyTwoFactorSetup,
} from '@/hooks/api/use-two-factor'
import type { TwoFactorSetupResponse } from '@/lib/types'

type Phase =
  | { kind: 'off' }
  | { kind: 'setup-pending'; data: TwoFactorSetupResponse }
  | { kind: 'enabled' }
  | { kind: 'disable-pending' }
  | { kind: 'regenerate-pending' }
  | { kind: 'regenerate-done'; codes: string[] }


export function TwoFactorSection() {
  const status = useTwoFactorStatus()
  const setup = useSetupTwoFactor()
  const verifySetup = useVerifyTwoFactorSetup()
  const disable = useDisableTwoFactor()
  const regenerate = useRegenerateBackupCodes()

  const [phase, setPhase] = useState<Phase>({ kind: 'off' })
  const [confirmCode, setConfirmCode] = useState('')
  const [reauthCode, setReauthCode] = useState('')
  const [reauthBackup, setReauthBackup] = useState('')
  const [reauthPassword, setReauthPassword] = useState('')

  const clearReauth = () => {
    setReauthCode('')
    setReauthBackup('')
    setReauthPassword('')
  }

  // Initial phase derived from the server status - if 2FA is already on,
  // jump straight to the enabled state. Avoids a one-frame flash of "off".
  const serverEnabled = status.data?.enabled ?? false
  const effectivePhase: Phase =
    phase.kind === 'off' && serverEnabled ? { kind: 'enabled' } : phase

  const beginSetup = async () => {
    try {
      const data = await setup.mutateAsync()
      setPhase({ kind: 'setup-pending', data })
      setConfirmCode('')
    } catch (err) {
      toast.error(extractError(err, '无法生成 2FA 密钥'))
    }
  }

  const confirmSetup = async () => {
    if (effectivePhase.kind !== 'setup-pending') return
    try {
      await verifySetup.mutateAsync({ code: confirmCode })
      toast.success('两步验证已启用')
      setPhase({ kind: 'enabled' })
      void status.refetch()
    } catch (err) {
      toast.error(extractError(err, '验证码无效'))
    }
  }

  const cancelSetup = () => {
    setPhase({ kind: 'off' })
    setConfirmCode('')
  }

  const runDisable = async () => {
    try {
      await disable.mutateAsync({
        password: reauthPassword,
        code: reauthCode || undefined,
        backup_code: reauthBackup || undefined,
      })
      toast.success('两步验证已关闭')
      setPhase({ kind: 'off' })
      clearReauth()
      void status.refetch()
    } catch (err) {
      toast.error(extractError(err, '关闭失败'))
    }
  }

  const runRegenerate = async () => {
    try {
      const data = await regenerate.mutateAsync({
        password: reauthPassword,
        code: reauthCode || undefined,
        backup_code: reauthBackup || undefined,
      })
      toast.success('备用码已刷新')
      setPhase({ kind: 'regenerate-done', codes: data.backup_codes })
      clearReauth()
      void status.refetch()
    } catch (err) {
      toast.error(extractError(err, '刷新失败'))
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>两步验证（2FA）</CardTitle>
        <CardDescription>
          启用后登录时除密码外还需要一次性验证码。推荐使用 Google Authenticator、
          1Password 或 Authy。
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {status.isLoading && (
          <p className="text-sm text-muted-foreground">读取状态中…</p>
        )}

        {effectivePhase.kind === 'off' && !status.isLoading && (
          <div className="space-y-2">
            <p className="text-sm">两步验证当前未启用。</p>
            <Button
              data-testid="start-2fa-setup"
              onClick={beginSetup}
              disabled={setup.isPending}
            >
              {setup.isPending ? '生成中…' : '启用两步验证'}
            </Button>
          </div>
        )}

        {effectivePhase.kind === 'setup-pending' && (
          <SetupForm
            data={effectivePhase.data}
            confirmCode={confirmCode}
            setConfirmCode={setConfirmCode}
            onConfirm={confirmSetup}
            onCancel={cancelSetup}
            pending={verifySetup.isPending}
          />
        )}

        {effectivePhase.kind === 'enabled' && (
          <EnabledPanel
            remaining={status.data?.backup_codes_remaining ?? 0}
            onDisable={() => setPhase({ kind: 'disable-pending' })}
            onRegenerate={() => setPhase({ kind: 'regenerate-pending' })}
          />
        )}

        {phase.kind === 'disable-pending' && (
          <ReauthForm
            title="关闭两步验证"
            description="出于安全考虑，关闭时除密码外还需要一个一次性验证码或备用码。关闭后所有当前会话将自动失效。"
            submitLabel="确认关闭"
            submitTestId="confirm-disable-2fa"
            codeTestId="disable-code"
            backupTestId="disable-backup"
            destructive
            password={reauthPassword}
            setPassword={setReauthPassword}
            code={reauthCode}
            setCode={setReauthCode}
            backup={reauthBackup}
            setBackup={setReauthBackup}
            onSubmit={runDisable}
            onCancel={() => {
              setPhase({ kind: 'enabled' })
              clearReauth()
            }}
            pending={disable.isPending}
          />
        )}

        {phase.kind === 'regenerate-pending' && (
          <ReauthForm
            title="刷新备用码"
            description="出于安全考虑，刷新备用码前需要重新验证密码和一个一次性验证码或备用码。旧备用码将立即失效。"
            submitLabel="确认刷新"
            submitTestId="confirm-regenerate-2fa"
            codeTestId="regenerate-code"
            backupTestId="regenerate-backup"
            password={reauthPassword}
            setPassword={setReauthPassword}
            code={reauthCode}
            setCode={setReauthCode}
            backup={reauthBackup}
            setBackup={setReauthBackup}
            onSubmit={runRegenerate}
            onCancel={() => {
              setPhase({ kind: 'enabled' })
              clearReauth()
            }}
            pending={regenerate.isPending}
          />
        )}

        {phase.kind === 'regenerate-done' && (
          <BackupCodesPanel
            codes={phase.codes}
            onDone={() => setPhase({ kind: 'enabled' })}
          />
        )}
      </CardContent>
    </Card>
  )
}

interface SetupFormProps {
  data: TwoFactorSetupResponse
  confirmCode: string
  setConfirmCode: (v: string) => void
  onConfirm: () => void
  onCancel: () => void
  pending: boolean
}

function SetupForm({
  data,
  confirmCode,
  setConfirmCode,
  onConfirm,
  onCancel,
  pending,
}: SetupFormProps) {
  return (
    <div className="space-y-4">
      <p className="text-sm font-medium">使用身份验证器扫描下方二维码：</p>
      <div className="rounded-md border bg-muted/30 p-3">
        <OtpauthQR dataUri={data.otpauth_uri} />
        <p className="mt-2 break-all text-xs text-muted-foreground">
          {data.otpauth_uri}
        </p>
      </div>
      <p className="text-sm text-muted-foreground">
        或手动输入密钥：
        <code data-testid="2fa-secret" className="ml-2 rounded bg-muted px-2 py-1 text-xs">
          {data.secret}
        </code>
      </p>

      <Separator />

      <p className="text-sm font-medium">备用恢复码（每个一次性使用，请妥善保存）：</p>
      <ul
        data-testid="recovery-codes"
        className="grid grid-cols-2 gap-1 rounded-md border bg-muted/30 p-3 font-mono text-xs"
      >
        {data.backup_codes.map((code) => (
          <li key={code} className="select-all">
            {code}
          </li>
        ))}
      </ul>

      <div className="space-y-2">
        <Label htmlFor="confirm-code">输入身份验证器中的 6 位代码</Label>
        <Input
          id="confirm-code"
          data-testid="2fa-code-input"
          inputMode="numeric"
          pattern="\d{6}"
          maxLength={6}
          value={confirmCode}
          onChange={(e) => setConfirmCode(e.target.value.replace(/\D/g, ''))}
          autoComplete="one-time-code"
          autoFocus
        />
      </div>
      <div className="flex gap-2">
        <Button
          data-testid="confirm-enable-2fa"
          onClick={onConfirm}
          disabled={pending || confirmCode.length !== 6}
        >
          {pending ? '验证中…' : '确认并启用'}
        </Button>
        <Button variant="outline" onClick={onCancel} disabled={pending}>
          取消
        </Button>
      </div>
    </div>
  )
}

interface EnabledPanelProps {
  remaining: number
  onDisable: () => void
  onRegenerate: () => void
}

function EnabledPanel({ remaining, onDisable, onRegenerate }: EnabledPanelProps) {
  return (
    <div className="space-y-4">
      <div className="rounded-md border border-green-500/40 bg-green-500/5 p-3 text-sm">
        两步验证已启用。剩余 <b>{remaining}</b> 个备用码。
      </div>
      <div className="flex flex-wrap gap-2">
        <Button data-testid="open-regenerate-2fa" variant="outline" onClick={onRegenerate}>
          刷新备用码
        </Button>
        <Button data-testid="open-disable-2fa" variant="destructive" onClick={onDisable}>
          关闭两步验证
        </Button>
      </div>
    </div>
  )
}

interface ReauthFormProps {
  title: string
  description: string
  submitLabel: string
  submitTestId: string
  codeTestId: string
  backupTestId: string
  destructive?: boolean
  password: string
  setPassword: (v: string) => void
  code: string
  setCode: (v: string) => void
  backup: string
  setBackup: (v: string) => void
  onSubmit: () => void
  onCancel: () => void
  pending: boolean
}

function ReauthForm(props: ReauthFormProps) {
  const submitDisabled =
    props.pending ||
    !props.password ||
    (!props.code && !props.backup)
  const frame = props.destructive
    ? 'border-destructive/40 bg-destructive/5'
    : 'border-border bg-muted/30'
  return (
    <div className={`space-y-3 rounded-md border p-3 ${frame}`}>
      <p className="text-sm font-medium">{props.title}</p>
      <p className="text-xs text-muted-foreground">{props.description}</p>
      <div className="space-y-2">
        <Label htmlFor="reauth-password">当前密码</Label>
        <Input
          id="reauth-password"
          data-testid="reauth-password"
          type="password"
          autoComplete="current-password"
          value={props.password}
          onChange={(e) => props.setPassword(e.target.value)}
        />
      </div>
      <div className="grid gap-2 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="reauth-code">验证码（6 位）</Label>
          <Input
            id="reauth-code"
            data-testid={props.codeTestId}
            inputMode="numeric"
            pattern="\d{6}"
            maxLength={6}
            value={props.code}
            onChange={(e) => props.setCode(e.target.value.replace(/\D/g, ''))}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="reauth-backup">或备用码</Label>
          <Input
            id="reauth-backup"
            data-testid={props.backupTestId}
            value={props.backup}
            onChange={(e) => props.setBackup(e.target.value)}
          />
        </div>
      </div>
      <div className="flex gap-2">
        <Button
          data-testid={props.submitTestId}
          variant={props.destructive ? 'destructive' : 'default'}
          onClick={props.onSubmit}
          disabled={submitDisabled}
        >
          {props.pending ? '处理中…' : props.submitLabel}
        </Button>
        <Button variant="outline" onClick={props.onCancel} disabled={props.pending}>
          取消
        </Button>
      </div>
    </div>
  )
}

function BackupCodesPanel({ codes, onDone }: { codes: string[]; onDone: () => void }) {
  return (
    <div className="space-y-3">
      <p className="text-sm font-medium">新的备用恢复码（每个一次性使用，请妥善保存）：</p>
      <ul
        data-testid="regenerated-codes"
        className="grid grid-cols-2 gap-1 rounded-md border bg-muted/30 p-3 font-mono text-xs"
      >
        {codes.map((code) => (
          <li key={code} className="select-all">
            {code}
          </li>
        ))}
      </ul>
      <Button data-testid="regenerate-done" onClick={onDone}>
        我已保存，返回
      </Button>
    </div>
  )
}

/**
 * 本地渲染 otpauth:// 二维码。
 *
 * 绝不要把 URI 交给第三方图片服务：URI 里带 TOTP secret，等于把第二
 * 因子的密钥明文发给外部站点；离线或受限网络下开启流程还会直接失败。
 * qrcode.react 已是项目依赖（账号安全页在用），这里复用它。
 */
function OtpauthQR({ dataUri }: { dataUri: string }) {
  return (
    <div className="flex justify-center rounded-md border bg-white p-3">
      <QRCodeSVG value={dataUri} size={180} level="M" />
    </div>
  )
}
