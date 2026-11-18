import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { ArrowRight, FilePlus2, FileText } from 'lucide-react'
import { useMySubmissions } from '@/hooks/api/use-modules'
import { Button } from '@/components/ui/button'
import { EmptyState, ErrorState, Loading } from '@/components/common/state'
import { Pagination } from '@/components/common/pagination'
import { SubmissionStatusBadge } from './me-status'
import { shortDate } from './format'
import { typeLabel } from '@/lib/resource-labels'

export function MeSubmissions() {
  const [page, setPage] = useState(1)
  const submissions = useMySubmissions(undefined, page, 10)

  if (submissions.isLoading) return <Loading />
  if (submissions.isError) {
    return <ErrorState message="加载投稿记录失败" onRetry={() => submissions.refetch()} />
  }

  const rows = submissions.data?.data ?? []
  const total = submissions.data?.meta.total ?? 0

  return (
    <section>
      <div className="flex flex-wrap items-end justify-between gap-3 border-b pb-4">
        <div>
          <p className="text-[10px] uppercase tracking-[0.24em] text-muted-foreground">SUBMISSIONS</p>
          <h2 className="mt-1 font-serif text-xl tracking-tight">我的投稿</h2>
          <p className="mt-1 text-xs text-muted-foreground">共 {total} 篇 · 状态与返修都在这里跟进</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" asChild>
            <Link to="/submissions">
              管理全部
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </Button>
          <Button size="sm" asChild>
            <Link to="/submissions/new">
              <FilePlus2 className="h-3.5 w-3.5" />
              新建投稿
            </Link>
          </Button>
        </div>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          title="还没有投稿"
          description="从新建投稿开始；也可以从文献或文件导入后进入投稿向导。"
        />
      ) : (
        <div className="divide-y">
          {rows.map((item) => (
            <div key={item.id} className="flex flex-col gap-2 py-4 sm:flex-row sm:items-center sm:gap-4">
              <FileText className="hidden h-4 w-4 shrink-0 text-muted-foreground sm:block" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{item.title}</p>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  {typeLabel(item.type)} · {item.discipline || '未填学科'} · 投稿于 {shortDate(item.submitted_at)}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                <SubmissionStatusBadge status={item.status} />
                <Button variant="ghost" size="sm" asChild>
                  <Link to="/submissions">
                    打开
                    <ArrowRight className="h-3.5 w-3.5" />
                  </Link>
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {submissions.data ? (
        <Pagination
          page={page}
          totalPages={submissions.data.meta.total_pages}
          onPageChange={setPage}
        />
      ) : null}
    </section>
  )
}
