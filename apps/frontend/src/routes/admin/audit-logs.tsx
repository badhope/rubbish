import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { requireAdminGuard } from '@/lib/route-guards'
import { useAdminAuditLogs } from '@/hooks/api/use-modules'
import { PageHeader } from '@/components/common/page-header'
import { Pagination } from '@/components/common/pagination'
import { EmptyState, ErrorState, Loading } from '@/components/common/state'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { inferTotalPagesFromFullPage } from '@/lib/utils'

const PAGE_SIZE = 50

export const Route = createFileRoute('/admin/audit-logs')({
  beforeLoad: () => {
    requireAdminGuard()
  },
  component: AuditLogsPage,
})

function AuditLogsPage() {
  const [page, setPage] = useState(1)
  const offset = (page - 1) * PAGE_SIZE
  const { data, isLoading, isError, refetch } = useAdminAuditLogs(
    PAGE_SIZE,
    offset,
  )

  // 后端返回裸数组无 meta，totalPages 用「当前页是否满页」推断（与用户管理页共用）。
  const totalPages = inferTotalPagesFromFullPage(data ?? [], PAGE_SIZE, page)

  return (
    <div>
      <PageHeader title="审计日志" description="记录管理员操作与关键事件。" />

      {isLoading ? (
        <Loading />
      ) : isError ? (
        <ErrorState message="加载审计日志失败" onRetry={() => refetch()} />
      ) : !data || data.length === 0 ? (
        <EmptyState title="暂无审计日志" />
      ) : (
        <div className="space-y-3">
          {data.map((log) => (
            <Card key={log.id} className="py-4">
              <CardContent className="space-y-2">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <Badge variant="secondary">{log.action}</Badge>
                  {log.target_type && (
                    <span className="text-muted-foreground">
                      {log.target_type}
                      {log.target_id ? `#${log.target_id}` : ''}
                    </span>
                  )}
                  {log.actor_user_id !== null && (
                    <span className="text-muted-foreground">
                      操作者 #{log.actor_user_id}
                    </span>
                  )}
                  <span className="ml-auto text-muted-foreground">
                    {new Date(log.created_at).toLocaleString()}
                  </span>
                </div>
                {log.tenant_id && (
                  <div className="text-xs text-muted-foreground">
                    tenant: {log.tenant_id}
                  </div>
                )}
                {log.payload && (
                  <pre className="max-h-48 overflow-auto rounded-md bg-muted p-3 text-xs">
                    {JSON.stringify(log.payload, null, 2)}
                  </pre>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {data && (
        <Pagination
          page={page}
          totalPages={totalPages}
          onPageChange={setPage}
        />
      )}
    </div>
  )
}
