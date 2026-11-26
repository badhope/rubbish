import { useEffect, useState } from 'react'
import { Activity, AlertTriangle, CheckCircle2, KeyRound, Mail, RefreshCw, XCircle } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { PageHeader } from '@/components/common/page-header'
import { ConfirmDialog } from '@/components/common/confirm-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'


type Check = {
  key: string
  label: string
  status: 'ok' | 'warn' | 'fail'
  detail: string
}

type SecurityStatus = {
  signing_key_count: number
  previous_key_count: number
  signing_key_kid: string | null
  rotation_window_open: boolean
  auth_wall_enabled?: boolean
  mainland_gate_enabled?: boolean
  region_access_enabled?: boolean
  registration_invite_required?: boolean
  registration_email_code_required?: boolean
  require_2fa_for_admin?: boolean
  admin_total?: number
  admin_without_2fa?: number
}

type EmailStatus = {
  configured: boolean
  reachable: boolean
  detail: string
  backend: string
  outbound_enabled: boolean
  from_address: string
  accounts: { from_address: string; host: string; port: number }[]
  pool?: {
    from_address: string
    host: string
    inflight: number
    max_inflight: number
    failures: number
    cooldown_seconds: number
    available: boolean
  }[]
  guard: Record<string, unknown>
}

type Health = {
  status: 'ok' | 'warn' | 'fail'
  version: string
  db_revision: string | null
  code_revision: string | null
  db_latency_ms: number | null
  counts: Record<string, number>
  disk_free_gb: number | null
  disk_used_pct: number | null
  load_1m: number | null
  checks: Check[]
}

function StatusIcon({ status }: { status: Check['status'] }) {
  if (status === 'ok') return <CheckCircle2 className="h-4 w-4 text-emerald-600" />
  if (status === 'warn') return <AlertTriangle className="h-4 w-4 text-amber-600" />
  return <XCircle className="h-4 w-4 text-destructive" />
}

export default function SystemHealthPage() {
  const [data, setData] = useState<Health | null>(null)
  const [security, setSecurity] = useState<SecurityStatus | null>(null)
  const [email, setEmail] = useState<EmailStatus | null>(null)
  const [opsBusy, setOpsBusy] = useState(false)
  const [reloadOpen, setReloadOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const [securityLoading, setSecurityLoading] = useState(true)
  const [emailLoading, setEmailLoading] = useState(true)
  const [showWarningsOnly, setShowWarningsOnly] = useState(false)

  async function load() {
    setLoading(true)
    try {
      const res = await api.get<Health>('/admin/system/health')
      setData(res.data)
    } catch {
      toast.error('系统健康数据加载失败，可重试。')
    } finally {
      setLoading(false)
    }
  }

  async function loadSecurity() {
    setSecurityLoading(true)
    try {
      const res = await api.get<SecurityStatus>('/admin/security/status')
      setSecurity(res.data)
    } catch {
      toast.error('安全状态读取失败')
    } finally {
      setSecurityLoading(false)
    }
  }

  async function loadEmail() {
    setEmailLoading(true)
    try {
      const res = await api.get<EmailStatus>('/admin/maintenance/email-status')
      setEmail(res.data)
    } catch {
      toast.error('邮件通道状态读取失败')
    } finally {
      setEmailLoading(false)
    }
  }

  async function reloadSecurity() {
    setOpsBusy(true)
    try {
      await api.post('/admin/security/reload')
      toast.success('已重新加载安全配置')
      await loadSecurity()
    } catch {
      toast.error('安全配置重载失败')
    } finally {
      setOpsBusy(false)
    }
  }

  // 健康接口只检查 SMTP 配置存在，不逐个账号建连；邮件状态接口才会暴露
  // 535 之类的认证失败。两处口径要合起来，否则“总体正常”和下面的红字互相打脸。
  const emailProblem = Boolean(email && email.configured && email.detail.includes('失败'))
  const checks = (data?.checks ?? []).map((check) =>
    check.key === 'email' && emailProblem
      ? { ...check, status: 'warn' as const, detail: '主账号认证失败，备用发件账号可用' }
      : check,
  )
  const attentions = checks.filter((check) => check.status !== 'ok')
  const hasFail = attentions.some((check) => check.status === 'fail')

  useEffect(() => {
    void load()
    // 邮件状态会逐个 SMTP 服务器建连，可能十几秒；拆开请求，别拖住安全卡。
    void loadSecurity()
    void loadEmail()
  }, [])

  return (
    <div>
      <PageHeader
        title="系统健康"
        description="看看站点还稳不稳：数据库、迁移、磁盘、待处理内容、邮件通道。只读，不露连接串和密钥。"
        actions={
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className="mr-1.5 h-4 w-4" />
            刷新
          </Button>
        }
      />

      {!data ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            {loading ? '加载中…' : '暂无运行数据'}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Card>
              <CardHeader className="pb-1">
                <CardTitle className="text-xs text-muted-foreground">总体状态</CardTitle>
              </CardHeader>
              <CardContent>
                <Badge variant={hasFail ? 'destructive' : attentions.length ? 'outline' : 'secondary'}>
                  {hasFail ? '出问题了' : attentions.length ? `${attentions.length} 项需留意` : '正常'}
                </Badge>
                <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
                  {attentions.length
                    ? attentions.slice(0, 2).map((c) => c.label).join('、') +
                      (attentions.length > 2 ? ` 等 ${attentions.length} 项` : '')
                    : '所有检查项通过'}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-1">
                <CardTitle className="text-xs text-muted-foreground">数据库延迟</CardTitle>
              </CardHeader>
              <CardContent className="text-2xl font-semibold tabular-nums">
                {data.db_latency_ms ?? '—'} <span className="text-xs font-normal">ms</span>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-1">
                <CardTitle className="text-xs text-muted-foreground">磁盘剩余</CardTitle>
              </CardHeader>
              <CardContent className="text-2xl font-semibold tabular-nums">
                {data.disk_free_gb ?? '—'} <span className="text-xs font-normal">GB</span>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-1">
                <CardTitle className="text-xs text-muted-foreground">版本</CardTitle>
              </CardHeader>
              <CardContent className="text-sm font-medium">{data.version}</CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader className="flex-row items-center justify-between gap-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <Activity className="h-4 w-4" />
                检查项
              </CardTitle>
              {attentions.length > 0 ? (
                <button
                  type="button"
                  onClick={() => setShowWarningsOnly((v) => !v)}
                  className="rounded-md border px-2 py-1 text-xs text-muted-foreground transition-colors hover:border-primary hover:text-primary"
                >
                  {showWarningsOnly ? '显示全部' : `只看需留意（${attentions.length}）`}
                </button>
              ) : null}
            </CardHeader>
            <CardContent className="grid gap-2 md:grid-cols-2">
              {(showWarningsOnly ? attentions : checks).map((c) => (
                <div key={c.key} className="flex items-start gap-3 rounded-md border p-3">
                  <StatusIcon status={c.status} />
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{c.label}</p>
                    <p className="mt-0.5 break-words text-xs text-muted-foreground">{c.detail}</p>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">数据与迁移</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 text-sm sm:grid-cols-3">
              <div>
                <p className="text-xs text-muted-foreground">用户</p>
                <p className="font-medium tabular-nums">{data.counts.users ?? '—'}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">资源</p>
                <p className="font-medium tabular-nums">{data.counts.resources ?? '—'}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">24h 新用户</p>
                <p className="font-medium tabular-nums">{data.counts.new_users_24h ?? '—'}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">24h 发放经验</p>
                <p className="font-medium tabular-nums">{data.counts.coin_issued_24h ?? '—'}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">库迁移版本</p>
                <p className="font-medium">{data.db_revision ?? '—'}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">代码迁移版本</p>
                <p className="font-medium">{data.code_revision ?? '—'}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">负载（1m）</p>
                <p className="font-medium tabular-nums">{data.load_1m ?? '—'}</p>
              </div>
            </CardContent>
          </Card>

          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <KeyRound className="h-4 w-4" />
                  安全与密钥
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                {securityLoading && !security ? (
                  <p className="text-muted-foreground">正在读取安全状态…</p>
                ) : security ? (
                  <>
                    <p className="text-muted-foreground">
                      当前签名密钥 {security.signing_key_count} 把，历史密钥{' '}
                      {security.previous_key_count} 把；轮换窗口{' '}
                      {security.rotation_window_open ? '开启' : '关闭'}。
                    </p>
                    <p className="break-all font-mono text-xs text-muted-foreground">
                      kid={security.signing_key_kid ?? '—'}
                    </p>
                    <p className="text-muted-foreground">
                      访问控制：{security.auth_wall_enabled ? '全站登录墙已开启' : '站点公开访问'}；
                      {security.mainland_gate_enabled ? '大陆密码闸门开启' : '大陆密码闸门已关闭'}。
                    </p>
                    <p className="text-muted-foreground">
                      地区策略：{security.region_access_enabled ? '大陆/港澳台匿名只看封面，海外匿名只读文章与论坛' : '未启用'}；
                      注册：{security.registration_invite_required ? '仅邀请码' : '未设邀请码'}，
                      {security.registration_email_code_required ? '需邮箱验证码' : '不需邮箱验证码'}。
                    </p>
                    <p className={security.admin_without_2fa && security.admin_without_2fa > 0 ? 'text-amber-700' : 'text-muted-foreground'}>
                      管理员 2FA：{security.require_2fa_for_admin ? '已强制' : '未强制'}；
                      {security.admin_total === -1
                        ? '统计失败'
                        : `${security.admin_total ?? 0} 个管理员，${security.admin_without_2fa ?? 0} 个未绑定`}
                      {(security.admin_without_2fa ?? 0) > 0 ? (
                        <>
                          。先到{' '}
                          <a className="underline underline-offset-2" href="/me?tab=settings&section=security">
                            个人设置
                          </a>{' '}
                          绑定，全部绑完再打开强制开关，避免把管理员锁在后台外。
                        </>
                      ) : null}
                    </p>
                  </>
                ) : (
                  <p className="text-muted-foreground">安全状态读取失败，可重试。</p>
                )}
                <Button variant="outline" size="sm" onClick={() => setReloadOpen(true)} disabled={opsBusy || securityLoading}>
                  <RefreshCw className="mr-1.5 h-4 w-4" />
                  重载安全配置
                </Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Mail className="h-4 w-4" />
                  邮件通道
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                {emailLoading && !email ? (
                  <p className="text-muted-foreground">正在连接邮件服务器…（首次可能要十几秒）</p>
                ) : email ? (
                  <>
                    <p className="text-muted-foreground">
                      后端 {email.backend}；配置{' '}
                      {email.configured ? '已开启' : '未开启'}；连通{' '}
                      {email.reachable ? '正常' : '失败'}；发件 {email.from_address || '—'}
                    </p>
                    <p className="break-words text-xs text-muted-foreground">{email.detail}</p>
                    {email.pool && email.pool.length > 1 ? (
                      <div className="space-y-1 rounded-md border bg-muted/30 p-2 text-xs">
                        <p className="font-medium">
                          发件池：主账号 1 个，备用 {email.pool.length - 1} 个
                          {email.pool.filter((a, i) => i > 0 && a.available).length > 0
                            ? '，当前有备用账号待命'
                            : '，备用账号均在冷却'}
                        </p>
                        {email.pool.map((a, i) => (
                          <p key={`${a.from_address}-${i}`} className="text-muted-foreground">
                            {i === 0 ? '主' : '备'} {a.from_address} · 在途 {a.inflight}/
                            {a.max_inflight}
                            {a.failures > 0 ? ` · 连续失败 ${a.failures}` : ''}
                            {a.cooldown_seconds > 0 ? ` · 冷却 ${a.cooldown_seconds}s` : ' · 可用'}
                          </p>
                        ))}
                      </div>
                    ) : null}
                  </>
                ) : (
                  <p className="text-muted-foreground">邮件状态读取失败，可重试。</p>
                )}
                {email && email.detail.includes('失败') ? (
                  <p className="text-xs text-amber-700">备用发件账号仍可用，主账号认证失败会影响该地址发出的信。</p>
                ) : null}
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={reloadOpen}
        title="重新读取安全配置？"
        description="会重新加载 Rubbish 的签名密钥与访问策略；正在签发的令牌仍按旧密钥校验。"
        confirmText="重新读取"
        onConfirm={() => {
          setReloadOpen(false)
          void reloadSecurity()
        }}
        onOpenChange={setReloadOpen}
      />
    </div>
  )
}
