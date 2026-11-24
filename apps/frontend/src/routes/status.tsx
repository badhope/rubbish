import { useCallback, useEffect, useState } from 'react'
import { Link, createFileRoute } from '@tanstack/react-router'
import { AlertTriangle, CheckCircle2, CircleDashed, RefreshCw, XCircle } from 'lucide-react'
import { api } from '@/lib/api'
import { PageHeader } from '@/components/common/page-header'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'

type ProbeState = 'ok' | 'fail' | 'unknown'

interface HealthBody {
  status: string
  version?: string
}

interface ReadyBody {
  status: string
  database: 'connected' | 'unavailable'
}

function ProbeRow({
  label,
  detail,
  state,
}: {
  label: string
  detail: string
  state: ProbeState
}) {
  const Icon =
    state === 'ok' ? CheckCircle2 : state === 'fail' ? XCircle : CircleDashed
  const tone =
    state === 'ok'
      ? 'text-emerald-600'
      : state === 'fail'
        ? 'text-destructive'
        : 'text-muted-foreground'
  return (
    <div className="flex items-center gap-3 border-t py-4 first:border-t-0">
      <Icon className={`h-5 w-5 shrink-0 ${tone}`} />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{label}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">{detail}</p>
      </div>
    </div>
  )
}

function StatusPage() {
  const [service, setService] = useState<ProbeState>('unknown')
  const [database, setDatabase] = useState<ProbeState>('unknown')
  const [version, setVersion] = useState('')
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    const [serviceRes, readyRes] = await Promise.allSettled([
      api.get<HealthBody>('/health'),
      api.get<ReadyBody>('/health/ready'),
    ])

    if (serviceRes.status === 'fulfilled' && serviceRes.value.data.status === 'ok') {
      setService('ok')
      setVersion(serviceRes.value.data.version ?? '')
    } else {
      setService('fail')
    }

    if (readyRes.status === 'fulfilled' && readyRes.value.data.database === 'connected') {
      setDatabase('ok')
    } else {
      setDatabase('fail')
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const overall: ProbeState =
    service === 'fail' || database === 'fail' ? 'fail' : service === 'ok' && database === 'ok' ? 'ok' : 'unknown'

  return (
    <div className="mx-auto w-full max-w-2xl space-y-6">
      <PageHeader
        title="站点状态"
        description="只反映服务是否在线；内容审核、互评进度不在本页展示。"
        actions={
          <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
            <RefreshCw className="h-3.5 w-3.5" />
            重新检查
          </Button>
        }
      />

      <Card>
        <CardContent className="space-y-0">
          <div className="flex items-center gap-2 pb-4">
            {overall === 'ok' ? (
              <>
                <CheckCircle2 className="h-5 w-5 text-emerald-600" />
                <span className="text-sm font-medium">服务正常</span>
              </>
            ) : overall === 'fail' ? (
              <>
                <AlertTriangle className="h-5 w-5 text-destructive" />
                <span className="text-sm font-medium">部分服务不可用</span>
              </>
            ) : (
              <>
                <CircleDashed className="h-5 w-5 text-muted-foreground" />
                <span className="text-sm font-medium">正在检查</span>
              </>
            )}
            {version ? (
              <span className="ml-auto font-mono text-xs text-muted-foreground">v{version}</span>
            ) : null}
          </div>
          <ProbeRow
            label="站点服务"
            detail={
              service === 'ok'
                ? '进程响应正常。'
                : service === 'fail'
                  ? '没有收到响应，可能正在维护或网络不通。'
                  : '等待检查结果。'
            }
            state={service}
          />
          <ProbeRow
            label="数据库连通"
            detail={
              database === 'ok'
                ? '数据库可以连接。'
                : database === 'fail'
                  ? '数据库暂时不可达；读到的内容可能不是最新。'
                  : '等待检查结果。'
            }
            state={database}
          />
        </CardContent>
      </Card>

      <p className="text-xs leading-relaxed text-muted-foreground">
        页面打不开时可以先刷新一次。持续异常，可在
        <Link to="/forum" search={{ view: 'feedback' }} className="mx-1 text-primary hover:underline">
          反馈墙
        </Link>{' '}
        留言，或写信到 info@rubbishasci.cn。
      </p>
    </div>
  )
}

export const Route = createFileRoute('/status')({
  component: StatusPage,
})
