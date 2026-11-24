import { useState } from 'react'
import { ExternalLink } from 'lucide-react'
import { useAdminAuditLogs } from '@/hooks/api/use-modules'
import { PageHeader } from '@/components/common/page-header'
import { Pagination } from '@/components/common/pagination'
import { EmptyState, ErrorState, Loading } from '@/components/common/state'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { auditActionLabel, auditTarget } from '@/lib/audit-labels'
import { inferTotalPagesFromFullPage } from '@/lib/utils'

const PAGE_SIZE = 50

export default function AuditLogsPage() {
  const [page, setPage] = useState(1)
  const offset = (page - 1) * PAGE_SIZE
  const { data, isLoading, isError, refetch } = useAdminAuditLogs(PAGE_SIZE, offset)

  // 后端返回裸数组无 meta，totalPages 用「当前页是否满页」推断（与用户管理页共用）。
  const totalPages = inferTotalPagesFromFullPage(data ?? [], PAGE_SIZE, page)

  return (
    <div>
      <PageHeader
        title="审计日志"
        description="记录后台操作与关键事件。操作者显示姓名，目标尽量给跳转；原始 payload 收进折叠区。"
      />

      {isLoading ? (
        <Loading />
      ) : isError ? (
        <ErrorState message="审计日志加载失败，可重试。" onRetry={() => refetch()} />
      ) : !data || data.length === 0 ? (
        <EmptyState title="暂无审计日志" />
      ) : (
        <div className="space-y-2.5">
          {data.map((log) => {
            const target = auditTarget(log)
            const actor = log.actor_name || (log.actor_user_id ? `成员 #${log.actor_user_id}` : '系统')
            return (
              <Card key={log.id} className="py-3.5">
                <CardContent className="space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="secondary" className="font-normal">
                      {auditActionLabel(log.action)}
                    </Badge>
                    {target ? (
                      target.href ? (
                        <a
                          href={target.href}
                          className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                        >
                          {target.label}
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      ) : (
                        <span className="text-xs text-muted-foreground">{target.label}</span>
                      )
                    ) : null}
                    <span className="ml-auto text-xs tabular-nums text-muted-foreground">
                      {new Date(log.created_at).toLocaleString('zh-CN', { hour12: false })}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    操作者：{actor}
                  </p>
                  {log.payload ? (
                    <details className="rounded-md border bg-muted/20 px-2.5 py-2 text-xs">
                      <summary className="cursor-pointer select-none text-muted-foreground">
                        查看原始记录
                      </summary>
                      <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words bg-transparent p-0 text-[11px] leading-relaxed">
                        {JSON.stringify(log.payload, null, 2)}
                      </pre>
                    </details>
                  ) : null}
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      {data && data.length > 0 ? (
        <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
      ) : null}
    </div>
  )
}
