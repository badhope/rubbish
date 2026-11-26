import { useEffect, useMemo, useState } from 'react'
import { Bot, Check, Copy, KeyRound, RefreshCw, ShieldCheck, Trash2, Wrench } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  useAiCapabilities,
  useAiTokens,
  useCreateAiToken,
  useRevokeAiToken,
  useUpdateAiToken,
  type ApiTokenRow,
  type CreateApiTokenResponse,
} from '@/hooks/api/use-ai-access'
import { extractError, formatDateTime, cn } from '@/lib/utils'

const ROLE_LABEL: Record<string, string> = {
  user: '作者',
  reviewer: '互评成员',
  editor: '编辑',
  editor_in_chief: '执行编辑 / 主编',
}

function ScopeChips({ scopes, labels }: { scopes: string[]; labels: Record<string, string> }) {
  if (!scopes.length) return <span className="text-xs text-muted-foreground">无作用域</span>
  return (
    <div className="flex flex-wrap gap-1">
      {scopes.map((scope) => (
        <Badge key={scope} variant="outline" title={labels[scope] ?? scope}>
          {labels[scope] ?? scope}
        </Badge>
      ))}
    </div>
  )
}

function SecretPanel({ created, remoteUrl }: { created: CreateApiTokenResponse; remoteUrl: string }) {
  const [copied, setCopied] = useState<'token' | 'config' | null>(null)
  const config = useMemo(
    () =>
      JSON.stringify(
        {
          mcpServers: {
            rubbish: {
              type: 'http',
              url: remoteUrl,
              headers: { Authorization: `Bearer ${created.token}` },
            },
          },
        },
        null,
        2,
      ),
    [created.token, remoteUrl],
  )

  const copy = async (kind: 'token' | 'config', value: string) => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(kind)
      toast.success(kind === 'token' ? 'Token 已复制' : 'MCP 配置已复制')
    } catch {
      toast.error('浏览器拒绝访问剪贴板，请手动选中复制。')
    }
  }

  return (
    <div className="rounded-lg border border-primary/30 bg-primary/5 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-medium">
          <KeyRound className="h-4 w-4 text-primary" />
          新 Token 只显示这一次
        </div>
        <Badge variant="secondary">{created.prefix}…</Badge>
      </div>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
        服务端只保存 SHA-256。关掉这块之后无法再取回明文，请现在复制到你的 MCP 客户端。
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <code className="min-w-0 flex-1 break-all rounded-md border bg-background px-3 py-2 font-mono text-xs">
          {created.token}
        </code>
        <Button type="button" size="sm" variant="outline" onClick={() => copy('token', created.token)}>
          {copied === 'token' ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          复制
        </Button>
      </div>
      <div className="mt-3">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">远程 MCP 配置</p>
          <Button type="button" size="sm" variant="ghost" onClick={() => copy('config', config)}>
            {copied === 'config' ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            复制配置
          </Button>
        </div>
        <pre className="mt-1 max-h-56 overflow-auto rounded-md border bg-background p-3 text-xs leading-relaxed">
          {config}
        </pre>
      </div>
      <p className="mt-2 text-[11px] text-muted-foreground">
        这是 HTTP 远程接入；本地 stdio 也支持，见仓库 <span className="font-mono">tools/rubbish-mcp/README.md</span>。
      </p>
    </div>
  )
}

function TokenRow({
  token,
  labels,
  allowedScopes,
  onSaveScopes,
  onRevoke,
  saving,
}: {
  token: ApiTokenRow
  labels: Record<string, string>
  allowedScopes: string[]
  onSaveScopes: (id: number, scopes: string[]) => void
  onRevoke: (id: number) => void
  saving: boolean
}) {
  const [editing, setEditing] = useState(false)
  const [selected, setSelected] = useState<string[]>(token.scopes)

  useEffect(() => {
    setSelected(token.scopes)
  }, [token.scopes])

  const toggle = (scope: string) => {
    setSelected((current) =>
      current.includes(scope) ? current.filter((item) => item !== scope) : [...current, scope],
    )
  }

  const statusVariant = token.status === 'active' ? 'secondary' : 'outline'

  return (
    <div className="rounded-lg border p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-medium">{token.name}</p>
            <Badge variant={statusVariant}>{token.status === 'active' ? '使用中' : token.status}</Badge>
          </div>
          <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">
            {token.prefix}… · 创建 {formatDateTime(token.created_at)}
            {token.last_used_at ? ` · 最近 ${formatDateTime(token.last_used_at)}` : ' · 尚未使用'}
            {token.expires_at ? ` · 到期 ${formatDateTime(token.expires_at)}` : ''}
          </p>
        </div>
        {token.status === 'active' ? (
          <div className="flex shrink-0 gap-1">
            <Button type="button" size="sm" variant="ghost" onClick={() => setEditing((value) => !value)}>
              调整权限
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="text-destructive hover:text-destructive"
              disabled={saving}
              onClick={() => {
                if (window.confirm(`撤销 Token「${token.name}」？使用它的 MCP 客户端会立刻失效。`)) {
                  onRevoke(token.id)
                }
              }}
            >
              <Trash2 className="h-3.5 w-3.5" />
              撤销
            </Button>
          </div>
        ) : null}
      </div>

      {!editing ? (
        <div className="mt-2">
          <ScopeChips scopes={token.scopes} labels={labels} />
        </div>
      ) : (
        <div className="mt-3 rounded-md border bg-muted/20 p-3">
          <p className="text-xs text-muted-foreground">
            只能勾选当前身份允许的作用域。保存后旧明文继续有效，但权限会立刻变化。
          </p>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {allowedScopes.map((scope) => (
              <label key={scope} className="flex items-start gap-2 text-xs">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={selected.includes(scope)}
                  onChange={() => toggle(scope)}
                />
                <span>
                  <span className="font-medium">{labels[scope] ?? scope}</span>
                  <span className="ml-1 font-mono text-[10px] text-muted-foreground">{scope}</span>
                </span>
              </label>
            ))}
          </div>
          <div className="mt-3 flex gap-2">
            <Button
              type="button"
              size="sm"
              disabled={saving || !selected.length}
              onClick={() => {
                onSaveScopes(token.id, selected)
                setEditing(false)
              }}
            >
              保存权限
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)}>
              取消
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

export function AiAccessCard() {
  const capabilities = useAiCapabilities()
  const tokens = useAiTokens()
  const createToken = useCreateAiToken()
  const updateToken = useUpdateAiToken()
  const revokeToken = useRevokeAiToken()

  const [name, setName] = useState('我的 AI 助手')
  const [expiresDays, setExpiresDays] = useState(90)
  const [selected, setSelected] = useState<string[]>([])
  const [created, setCreated] = useState<CreateApiTokenResponse | null>(null)

  const caps = capabilities.data
  const allowedScopes = caps?.allowed_scopes.map((item) => item.scope) ?? []
  const labels = useMemo(
    () => Object.fromEntries((caps?.all_scopes ?? []).map((item) => [item.scope, item.label])),
    [caps?.all_scopes],
  )

  useEffect(() => {
    if (!caps) return
    setSelected((current) =>
      current.length ? current.filter((scope) => caps.allowed_scopes.some((item) => item.scope === scope)) : caps.allowed_scopes.map((item) => item.scope),
    )
  }, [caps])

  if (capabilities.isLoading || tokens.isLoading) {
    return (
      <div className="rounded-lg border p-4 text-sm text-muted-foreground">
        正在读取 AI 接入配置…
      </div>
    )
  }

  if (capabilities.isError || !caps) {
    return (
      <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm">
        <p className="font-medium">AI 接入配置暂时无法读取</p>
        <p className="mt-1 text-xs text-muted-foreground">
          请刷新页面重试；如果一直失败，检查登录状态与站点 API 是否可达。
        </p>
        <Button className="mt-3" size="sm" variant="outline" onClick={() => capabilities.refetch()}>
          <RefreshCw className="h-3.5 w-3.5" />
          重试
        </Button>
      </div>
    )
  }

  const role = caps.permission_role
  const tokenRows = tokens.data?.data ?? []

  return (
    <div className="space-y-5">
      <div className="rounded-lg border bg-muted/20 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Bot className="h-4 w-4 text-primary" />
            <h3 className="text-sm font-medium">AI 接入 / MCP</h3>
          </div>
          <Badge variant="outline">当前身份：{ROLE_LABEL[role] ?? role}</Badge>
        </div>
        <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
          AI 用个人 Token 代你投稿、改稿、审稿和做编辑决定。它和网页端走同一套权限与审核规则：
          规范确认、敏感词、站内相似度、五维评分、终审角色与版本防陈旧都不会被绕过。
          当前身份可使用 {caps.tools_count} 个工具。
        </p>
        <div className="mt-3 grid gap-2 text-[11px] text-muted-foreground sm:grid-cols-3">
          <div className="flex items-center gap-1.5">
            <ShieldCheck className="h-3.5 w-3.5" />
            角色是权限上限，Token 只能更窄
          </div>
          <div className="flex items-center gap-1.5">
            <Wrench className="h-3.5 w-3.5" />
            每次写操作都要求显式 confirm
          </div>
          <div className="flex items-center gap-1.5">
            <RefreshCw className="h-3.5 w-3.5" />
            决定必须带状态与版本
          </div>
        </div>
        <div className="mt-3 rounded-md border bg-background p-2.5 text-[11px]">
          <p className="text-muted-foreground">远程 MCP 地址</p>
          <code className="mt-0.5 block break-all font-mono text-xs">{caps.remote_mcp_url}</code>
          <p className="mt-1 text-muted-foreground">
            认证头：<span className="font-mono">{caps.auth}</span> · 协议 {caps.protocol_version}
          </p>
        </div>
      </div>

      {created ? (
        <SecretPanel
          created={created}
          remoteUrl={caps.remote_mcp_url}
        />
      ) : null}

      <div className="rounded-lg border p-4">
        <h3 className="text-sm font-medium">新建 Token</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          为每个客户端单独建 Token；出问题只撤销一个，不影响其他。默认只选当前身份可用的全部作用域，你可以收紧。
        </p>
        <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_140px]">
          <label className="block text-xs">
            <span className="text-muted-foreground">名称</span>
            <Input
              className="mt-1"
              value={name}
              maxLength={60}
              onChange={(event) => setName(event.target.value)}
              placeholder="例如：Claude Desktop / 投稿助手"
            />
          </label>
          <label className="block text-xs">
            <span className="text-muted-foreground">有效期</span>
            <select
              className="mt-1 h-9 w-full rounded-md border bg-background px-3 text-sm"
              value={expiresDays}
              onChange={(event) => setExpiresDays(Number(event.target.value))}
            >
              <option value={30}>30 天</option>
              <option value={90}>90 天</option>
              <option value={180}>180 天</option>
              <option value={365}>365 天</option>
            </select>
          </label>
        </div>
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2">
          {caps.allowed_scopes.map((item) => (
            <label
              key={item.scope}
              className={cn(
                'flex items-start gap-2 rounded-md border px-2.5 py-2 text-xs',
                selected.includes(item.scope) ? 'border-primary/40 bg-primary/5' : 'bg-background',
              )}
            >
              <input
                type="checkbox"
                className="mt-0.5"
                checked={selected.includes(item.scope)}
                onChange={() =>
                  setSelected((current) =>
                    current.includes(item.scope)
                      ? current.filter((scope) => scope !== item.scope)
                      : [...current, item.scope],
                  )
                }
              />
              <span>
                <span className="font-medium">{item.label}</span>
                <span className="ml-1 font-mono text-[10px] text-muted-foreground">{item.scope}</span>
              </span>
            </label>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button
            type="button"
            disabled={createToken.isPending || !name.trim() || !selected.length}
            onClick={() => {
              createToken.mutate(
                { name: name.trim(), scopes: selected, expires_days: expiresDays },
                {
                  onSuccess: (data) => {
                    setCreated(data)
                    setName('我的 AI 助手')
                    toast.success('Token 已创建，请立刻复制明文。')
                  },
                  onError: (error) => toast.error(extractError(error, 'Token 创建失败')),
                },
              )
            }}
          >
            <KeyRound className="h-3.5 w-3.5" />
            {createToken.isPending ? '创建中…' : '创建 Token'}
          </Button>
          <span className="text-[11px] text-muted-foreground">
            明文只返回一次；建议 90 天轮换。
          </span>
        </div>
        {createToken.isError ? (
          <p className="mt-2 text-xs text-destructive">{extractError(createToken.error, 'Token 创建失败')}</p>
        ) : null}
      </div>

      <div className="rounded-lg border p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-medium">已有 Token</h3>
          <span className="text-[11px] text-muted-foreground">{tokenRows.length} 个使用中</span>
        </div>
        {!tokenRows.length ? (
          <p className="mt-3 text-xs text-muted-foreground">还没有 Token。先建一个，再把配置粘进 MCP 客户端。</p>
        ) : (
          <div className="mt-3 space-y-3">
            {tokenRows.map((token) => (
              <TokenRow
                key={token.id}
                token={token}
                labels={labels}
                allowedScopes={allowedScopes}
                saving={updateToken.isPending}
                onSaveScopes={(id, scopes) =>
                  updateToken.mutate(
                    { id, scopes },
                    {
                      onSuccess: () => toast.success('Token 权限已更新'),
                      onError: (error) => toast.error(extractError(error, '权限更新失败')),
                    },
                  )
                }
                onRevoke={(id) =>
                  revokeToken.mutate(id, {
                    onSuccess: () => toast.success('Token 已撤销'),
                    onError: (error) => toast.error(extractError(error, '撤销失败')),
                  })
                }
              />
            ))}
          </div>
        )}
        <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
          旧 Token 如果只有“读取投稿 / 投稿”作用域，仍可继续投稿；要做审稿或内容台，点“调整权限”加上对应作用域，
          或撤销后重建。调整权限不会更换明文。
        </p>
      </div>
    </div>
  )
}
