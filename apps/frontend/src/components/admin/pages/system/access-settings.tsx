import { useEffect, useState } from 'react'
import {
  BookOpen,
  Copy,
  Globe2,
  KeyRound,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  UserPlus,
} from 'lucide-react'
import { toast } from 'sonner'
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

export default function AccessSettingsPage() {
  const query = useSiteSettings()
  const update = useUpdateSiteSettings()
  const generate = useGenerateSiteInviteCode()
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const [inviteCode, setInviteCode] = useState('')
  const settings = query.data

  useEffect(() => {
    if (settings?.registration_invite_code) setInviteCode(settings.registration_invite_code)
  }, [settings?.registration_invite_code])

  async function toggle(key: FlagKey, next: boolean) {
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

  async function saveInviteCode() {
    setBusyKey('registration_invite_code')
    try {
      const data = await update.mutateAsync({
        registration_invite_code: inviteCode,
      } as Partial<SiteSettingsResponse>)
      setInviteCode(data.registration_invite_code)
      toast.success(data.registration_invite_code ? '邀请码已保存' : '邀请码已清空')
    } catch {
      toast.error('邀请码保存失败')
    } finally {
      setBusyKey(null)
    }
  }

  async function createInviteCode() {
    try {
      const data = await generate.mutateAsync()
      setInviteCode(data.registration_invite_code)
      toast.success('已生成新的注册邀请码')
    } catch {
      toast.error('生成失败，请重试')
    }
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

  const open = settings
    ? !settings.auth_wall_enabled &&
      !settings.region_access_enabled &&
      !settings.mainland_gate_enabled &&
      !settings.registration_invite_required
    : false

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
          <Card className={open ? 'border-emerald-200 bg-emerald-50/50' : 'border-amber-200 bg-amber-50/40'}>
            <CardContent className="flex flex-col gap-2 py-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-3">
                {open ? (
                  <Globe2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-700" />
                ) : (
                  <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" />
                )}
                <div>
                  <p className="text-sm font-medium">
                    {open ? '当前对外：公开浏览、开放注册、地区不限' : '当前仍有访问限制在生效'}
                  </p>
                  <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                    {open
                      ? '国内和海外访客走同一套规则；新用户不需要邀请码。'
                      : '按下面的开关逐项调整；关闭登录墙和地区限制后，访客可以直接看内容。'}
                  </p>
                </div>
              </div>
              <Badge variant={open ? 'secondary' : 'outline'} className="w-fit">
                {open ? '全站开放' : '部分受限'}
              </Badge>
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
                <FlagList rows={ACCESS_FLAGS} settings={settings} busyKey={busyKey} onToggle={toggle} />
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
                <FlagList rows={REGISTRATION_FLAGS} settings={settings} busyKey={busyKey} onToggle={toggle} />
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <KeyRound className="h-4 w-4" />
                注册邀请码
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-col gap-2 sm:flex-row">
                <Input
                  value={inviteCode}
                  onChange={(event) => setInviteCode(event.target.value.toUpperCase())}
                  placeholder="没有邀请码时，点右侧生成一枚"
                  className="font-mono tracking-wider"
                  maxLength={64}
                  aria-label="注册邀请码"
                />
                <div className="flex shrink-0 gap-2">
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
                    onClick={() => void createInviteCode()}
                    disabled={generate.isPending}
                  >
                    <Sparkles className="mr-1.5 h-4 w-4" />
                    {generate.isPending ? '生成中…' : '生成新码'}
                  </Button>
                  <Button
                    onClick={() => void saveInviteCode()}
                    disabled={busyKey === 'registration_invite_code' || !inviteCode.trim()}
                  >
                    保存
                  </Button>
                </div>
              </div>
              <p className="text-xs leading-relaxed text-muted-foreground">
                邀请码开关关闭时，码会保留下来但不校验；重新打开就能继续用。打开开关时如果还没有码，系统会自动生成一枚。
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
              <FlagList rows={PUBLISHING_FLAGS} settings={settings} busyKey={busyKey} onToggle={toggle} />
            </CardContent>
          </Card>

          <p className="text-xs leading-relaxed text-muted-foreground">
            这些开关存在站点数据库里，不走环境变量；换机器部署时会跟着数据库走。只有站务管理员能改，
            每次改动都会写审计日志。
          </p>
        </div>
      )}
    </div>
  )
}
