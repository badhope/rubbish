import { useEffect, useState } from 'react'
import {
  BookOpen,
  Copy,
  Eye,
  EyeOff,
  Globe2,
  KeyRound,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  UserPlus,
} from 'lucide-react'
import { toast } from 'sonner'
import { ConfirmDialog } from '@/components/common/confirm-dialog'
import { PageHeader } from '@/components/common/page-header'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
  useGenerateSiteInviteCode,
  useSiteSettings,
  useUpdateSiteSettings,
} from '@/hooks/api/use-modules'
import type { SiteSettingsResponse } from '@/lib/types'

type FlagKey =
  | 'auth_wall_enabled'
  | 'region_access_enabled'
  | 'mainland_gate_enabled'
  | 'registration_invite_required'
  | 'registration_email_code_required'
  | 'captcha_required_for_registration'
  | 'doi_author_entry_enabled'

type FlagRow = {
  key: FlagKey
  label: string
  desc: string
  onText: string
  offText: string
}

type PendingAction = {
  kind: 'toggle' | 'generate'
  key?: FlagKey
  next?: boolean
  title: string
  description: string
  confirmText: string
  destructive?: boolean
}

const ACCESS_FLAGS: FlagRow[] = [
  {
    key: 'auth_wall_enabled',
    label: '全站登录墙',
    desc: '关闭后，访客可以直接浏览文章、论坛和作品库；登录、投稿、评论仍然需要账号。',
    onText: '需登录',
    offText: '公开浏览',
  },
  {
    key: 'region_access_enabled',
    label: '地区访问限制',
    desc: '开启后，中国大陆、港澳台与海外访客看到的范围和权限不同。做统一对外时关掉。',
    onText: '按地区分流',
    offText: '全球同规则',
  },
  {
    key: 'mainland_gate_enabled',
    label: '国内入口密码门',
    desc: '旧的应急入口密码页，只在需要临时挡住大陆直连时打开。',
    onText: '密码门开启',
    offText: '不拦截',
  },
]

const REGISTRATION_FLAGS: FlagRow[] = [
  {
    key: 'registration_invite_required',
    label: '注册邀请码',
    desc: '打开后，新用户必须填写有效邀请码才能注册。适合内测；对外拉新时关掉。',
    onText: '仅凭邀请码',
    offText: '开放注册',
  },
  {
    key: 'registration_email_code_required',
    label: '注册邮箱验证码',
    desc: '注册时向邮箱发一次性验证码，能挡住批量假邮箱，也会多一步操作。',
    onText: '需验证邮箱',
    offText: '不验证邮箱',
  },
  {
    key: 'captcha_required_for_registration',
    label: '注册算术验证码',
    desc: '邮箱验证码已经开启时，这条会自动让路，不会重复弹两项。',
    onText: '需答题',
    offText: '不答题',
  },
]

const PUBLISHING_FLAGS: FlagRow[] = [
  {
    key: 'doi_author_entry_enabled',
    label: '作者填写 DOI',
    desc: '投稿表单是否允许作者自己填官方 DOI；关闭后由编辑在发布前补。',
    onText: '作者可填',
    offText: '编辑补录',
  },
]

function Toggle({
  checked,
  disabled,
  onChange,
  label,
}: {
  checked: boolean
  disabled?: boolean
  onChange: (next: boolean) => void
  label: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors ${
        checked ? 'border-primary bg-primary' : 'border-border bg-muted'
      } disabled:cursor-not-allowed disabled:opacity-50`}
    >
      <span
        className={`inline-block h-4 w-4 rounded-full bg-background shadow-sm transition-transform ${
          checked ? 'translate-x-6' : 'translate-x-1'
        }`}
      />
    </button>
  )
}

function FlagList({
  rows,
  settings,
  busyKey,
  onToggle,
}: {
  rows: FlagRow[]
  settings: SiteSettingsResponse
  busyKey: string | null
  onToggle: (key: FlagKey, next: boolean) => void
}) {
  return (
    <div className="divide-y">
      {rows.map((row) => {
        const checked = Boolean(settings[row.key])
        return (
          <div key={row.key} className="flex items-start justify-between gap-4 py-3.5 first:pt-0 last:pb-0">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <p className="text-sm font-medium">{row.label}</p>
                <Badge variant={checked ? 'outline' : 'secondary'} className="text-[10px]">
                  {checked ? row.onText : row.offText}
                </Badge>
              </div>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{row.desc}</p>
            </div>
            <div className="pt-0.5">
              {busyKey === row.key ? (
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              ) : (
                <Toggle
                  checked={checked}
                  disabled={busyKey !== null}
                  label={row.label}
                  onChange={(next) => onToggle(row.key, next)}
                />
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

/**
 * 会把站点“收紧”或降低防刷强度的动作，先让运营确认一次。
 * 放开访问不拦，避免每次开站都要多点一步。
 */
function warningFor(
  key: FlagKey,
  next: boolean,
  settings: SiteSettingsResponse,
): PendingAction | null {
  if (key === 'auth_wall_enabled' && next) {
    return {
      kind: 'toggle',
      key,
      next,
      title: '打开全站登录墙？',
      description:
        '打开后，未登录访客会被挡在文章、论坛和作品库外，只能看到登录与注册入口。已经登录的成员不受影响。',
      confirmText: '打开登录墙',
    }
  }
  if (key === 'region_access_enabled' && next) {
    return {
      kind: 'toggle',
      key,
      next,
      title: '按地区分流访问？',
      description:
        '打开后，中国大陆、港澳台与海外访客会按地区看到不同范围和权限。面对全球统一对外时不要开。',
      confirmText: '打开地区限制',
    }
  }
  if (key === 'mainland_gate_enabled' && next) {
    return {
      kind: 'toggle',
      key,
      next,
      title: '打开国内入口密码门？',
      description:
        '打开后，中国大陆直连会先看到密码页。服务器必须已配置至少 7 位入口密码，否则保存会失败。',
      confirmText: '打开密码门',
    }
  }
  if (key === 'registration_invite_required' && next) {
    return {
      kind: 'toggle',
      key,
      next,
      title: '改成邀请制注册？',
      description:
        '打开后，没有邀请码的新用户无法注册。库里没有可用码时，系统会自动生成一枚，不会把注册入口锁死。',
      confirmText: '打开邀请码',
    }
  }
  if (key === 'registration_email_code_required' && !next) {
    return {
      kind: 'toggle',
      key,
      next,
      title: '关闭注册邮箱验证？',
      description:
        '关掉后注册不再发一次性邮箱验证码，批量假邮箱更容易进来。邀请码和算术验证码仍按各自开关执行。',
      confirmText: '仍然关闭',
      destructive: true,
    }
  }
  if (key === 'captcha_required_for_registration' && !next && !settings.registration_email_code_required) {
    return {
      kind: 'toggle',
      key,
      next,
      title: '两道注册防刷都关掉？',
      description:
        '邮箱验证码已经是关闭状态。再关算术验证码，注册口只剩字段校验，可能被脚本批量灌入。',
      confirmText: '全部关闭',
      destructive: true,
    }
  }
  return null
}

export default function AccessSettingsPage() {
  const query = useSiteSettings()
  const update = useUpdateSiteSettings()
  const generate = useGenerateSiteInviteCode()
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const [inviteCode, setInviteCode] = useState('')
  const [showInviteCode, setShowInviteCode] = useState(false)
  const [pending, setPending] = useState<PendingAction | null>(null)
  const settings = query.data
  const serverInviteCode = settings?.registration_invite_code ?? ''

  useEffect(() => {
    setInviteCode(serverInviteCode)
  }, [serverInviteCode])

  async function applyToggle(key: FlagKey, next: boolean) {
    setBusyKey(key)
    try {
      const data = await update.mutateAsync({ [key]: next } as Partial<SiteSettingsResponse>)
      if (key === 'registration_invite_required' && next) {
        toast.success(
          data.registration_invite_code
            ? '注册邀请码已打开，当前邀请码已更新'
            : '注册邀请码已打开',
        )
      } else {
        toast.success('已保存，立即生效')
      }
    } catch {
      toast.error('保存失败，设置没有改变')
    } finally {
      setBusyKey(null)
    }
  }

  function requestToggle(key: FlagKey, next: boolean) {
    if (!settings) return
    const warning = warningFor(key, next, settings)
    if (warning) {
      setPending(warning)
      return
    }
    void applyToggle(key, next)
  }

  async function saveInviteCode() {
    setBusyKey('registration_invite_code')
    try {
      const data = await update.mutateAsync({
        registration_invite_code: inviteCode.trim().toUpperCase(),
      } as Partial<SiteSettingsResponse>)
      setInviteCode(data.registration_invite_code)
      toast.success(data.registration_invite_code ? '邀请码已保存' : '邀请码已清空')
    } catch {
      toast.error('邀请码保存失败，请检查后重试')
    } finally {
      setBusyKey(null)
    }
  }

  async function createInviteCode() {
    setBusyKey('registration_invite_code')
    try {
      const data = await generate.mutateAsync()
      setInviteCode(data.registration_invite_code)
      toast.success('已生成新的注册邀请码')
    } catch {
      toast.error('生成失败，请重试')
    } finally {
      setBusyKey(null)
    }
  }

  function requestGenerate() {
    if (!settings) return
    if (!settings.registration_invite_code) {
      void createInviteCode()
      return
    }
    setPending({
      kind: 'generate',
      title: '生成新的邀请码？',
      description:
        '新码一旦生成，旧码立即失效；已经发出去的邀请信息需要重新发送。邀请码开关本身不会被改动。',
      confirmText: '生成新码',
      destructive: true,
    })
  }

  async function copyInviteCode() {
    if (!inviteCode) return
    try {
      await navigator.clipboard.writeText(inviteCode)
      toast.success('已复制到剪贴板')
    } catch {
      toast.error('复制失败，请手动选中')
    }
  }

  const accessOpen = settings
    ? !settings.auth_wall_enabled &&
      !settings.region_access_enabled &&
      !settings.mainland_gate_enabled &&
      !settings.registration_invite_required
    : false
  const antiAbuseLabel = settings
    ? settings.registration_email_code_required
      ? '邮箱验证'
      : settings.captcha_required_for_registration
        ? '算术验证'
        : '全关'
    : ''
  const antiAbuseNote = settings
    ? settings.registration_email_code_required
      ? settings.captcha_required_for_registration
        ? '注册防刷：邮箱验证；算术题已开，但邮箱验证期间自动让路。只挡机器注册，不影响公开浏览。'
        : '注册防刷：邮箱验证。只挡机器注册，不影响公开浏览。'
      : settings.captcha_required_for_registration
        ? '注册防刷：算术验证。只挡机器注册，不影响公开浏览。'
        : '注册防刷全关，建议留意批量注册。'
    : ''
  const antiAbuseOn = Boolean(
    settings?.registration_email_code_required || settings?.captcha_required_for_registration,
  )
  const inviteDirty = settings
    ? inviteCode.trim().toUpperCase() !== settings.registration_invite_code
    : false
  const inviteSaveDisabled =
    busyKey === 'registration_invite_code' ||
    !inviteDirty ||
    Boolean(settings?.registration_invite_required && !inviteCode.trim())

  return (
    <div>
      <PageHeader
        title="访问设置"
        description="站点的门开多大、谁来注册，都在这里改。保存后立即生效，重启后仍然保留。"
        actions={
          <Button variant="outline" size="sm" onClick={() => void query.refetch()} disabled={query.isFetching}>
            <RefreshCw className="mr-1.5 h-4 w-4" />
            刷新
          </Button>
        }
      />

      {!settings ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            {query.isLoading ? '正在读取访问设置…' : '访问设置读取失败，可点右上角刷新重试。'}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          <Card className={accessOpen ? 'border-emerald-200 bg-emerald-50/50' : 'border-amber-200 bg-amber-50/40'}>
            <CardContent className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-3">
                {accessOpen ? (
                  <Globe2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-700" />
                ) : (
                  <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" />
                )}
                <div>
                  <p className="text-sm font-medium">
                    {accessOpen ? '当前对外：公开浏览、开放注册、地区不限' : '当前仍有访问限制在生效'}
                  </p>
                  <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                    {accessOpen
                      ? '国内和海外访客走同一套规则；新用户不需要邀请码。'
                      : '按下面的开关逐项调整；关闭登录墙和地区限制后，访客可以直接看内容。'}
                  </p>
                  <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                    {antiAbuseNote}
                  </p>
                </div>
              </div>
              <div className="flex shrink-0 flex-col items-start gap-1.5 sm:items-end">
                <Badge variant={accessOpen ? 'secondary' : 'outline'}>
                  {accessOpen ? '全站开放' : '部分受限'}
                </Badge>
                <Badge
                  variant="outline"
                  className={
                    antiAbuseOn
                      ? 'text-[10px] font-normal'
                      : 'border-amber-300 text-[10px] font-normal text-amber-800'
                  }
                >
                  防刷：{antiAbuseLabel}
                </Badge>
              </div>
            </CardContent>
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Globe2 className="h-4 w-4" />
                  谁能进来
                </CardTitle>
              </CardHeader>
              <CardContent>
                <FlagList
                  rows={ACCESS_FLAGS}
                  settings={settings}
                  busyKey={busyKey}
                  onToggle={requestToggle}
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <UserPlus className="h-4 w-4" />
                  谁能注册
                </CardTitle>
              </CardHeader>
              <CardContent>
                <FlagList
                  rows={REGISTRATION_FLAGS}
                  settings={settings}
                  busyKey={busyKey}
                  onToggle={requestToggle}
                />
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                <KeyRound className="h-4 w-4" />
                注册邀请码
                <Badge variant="outline" className="text-[10px] font-normal">
                  {inviteDirty
                    ? '有未保存修改'
                    : settings.registration_invite_required
                      ? '校验中'
                      : '开关关闭'}
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-col gap-2 sm:flex-row">
                <div className="relative min-w-0 flex-1">
                  <Input
                    value={inviteCode}
                    onChange={(event) => setInviteCode(event.target.value.toUpperCase())}
                    onFocus={() => setShowInviteCode(true)}
                    type={showInviteCode ? 'text' : 'password'}
                    placeholder="没有码时点「生成新码」"
                    className="pr-10 font-mono tracking-wider"
                    maxLength={64}
                    autoComplete="off"
                    spellCheck={false}
                    aria-label="注册邀请码"
                  />
                  <button
                    type="button"
                    onClick={() => setShowInviteCode((visible) => !visible)}
                    aria-label={showInviteCode ? '隐藏邀请码' : '显示邀请码'}
                    className="absolute right-1 top-1/2 inline-flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {showInviteCode ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                <div className="grid w-full shrink-0 grid-cols-3 gap-2 sm:flex sm:w-auto">
                  <Button
                    variant="outline"
                    onClick={() => void copyInviteCode()}
                    disabled={!inviteCode}
                  >
                    <Copy className="mr-1.5 h-4 w-4" />
                    复制
                  </Button>
                  <Button
                    variant="outline"
                    onClick={requestGenerate}
                    disabled={busyKey === 'registration_invite_code'}
                  >
                    <Sparkles className="mr-1.5 h-4 w-4" />
                    生成新码
                  </Button>
                  <Button onClick={() => void saveInviteCode()} disabled={inviteSaveDisabled}>
                    保存
                  </Button>
                </div>
              </div>
              <p className="text-xs leading-relaxed text-muted-foreground">
                邀请码开关关闭时，码会保留下来但不校验；重新打开就能继续用。打开开关时如果还没有码，系统会自动生成一枚。
                生成新码会让旧码立即失效，适合在旧码外泄后重发。
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <BookOpen className="h-4 w-4" />
                发布选项
              </CardTitle>
            </CardHeader>
            <CardContent>
              <FlagList
                rows={PUBLISHING_FLAGS}
                settings={settings}
                busyKey={busyKey}
                onToggle={requestToggle}
              />
            </CardContent>
          </Card>

          <p className="text-xs leading-relaxed text-muted-foreground">
            这些开关存在站点数据库里，不走环境变量；换机器部署时会跟着数据库走。站务管理员和编辑都能改，
            每次改动都会写审计日志，记录操作账号。
          </p>
        </div>
      )}

      <ConfirmDialog
        open={pending !== null}
        title={pending?.title ?? ''}
        description={pending?.description}
        confirmText={pending?.confirmText ?? '确认'}
        cancelText="取消"
        destructive={pending?.destructive}
        onOpenChange={(open) => {
          if (!open) setPending(null)
        }}
        onConfirm={() => {
          const action = pending
          setPending(null)
          if (!action) return
          if (action.kind === 'generate') {
            void createInviteCode()
          } else if (action.key && action.next !== undefined) {
            void applyToggle(action.key, action.next)
          }
        }}
      />
    </div>
  )
}
