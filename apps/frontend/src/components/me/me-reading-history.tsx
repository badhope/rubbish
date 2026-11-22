import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { ArrowRight, BookOpen, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { useReadingHistory, useRemoveFromHistory } from '@/hooks/api/use-modules'
import { extractError } from '@/lib/utils'
import { Pagination } from '@/components/common/pagination'
import { Button } from '@/components/ui/button'
import { EmptyState, ErrorState, Loading } from '@/components/common/state'
import { shortDate } from './format'

function progressText(percent: number | null | undefined, completed: boolean) {
  if (completed) return '已读完'
  if (percent == null || percent <= 0) return '刚开始'
  return `读到 ${Math.round(percent)}%`
}

export function MeReadingHistory() {
  const [page, setPage] = useState(1)
  const history = useReadingHistory(page, 12)
  const remove = useRemoveFromHistory()
  const [removingId, setRemovingId] = useState<number | null>(null)

  const onRemove = async (resourceId: number, title: string) => {
    setRemovingId(resourceId)
    try {
      await remove.mutateAsync(resourceId)
      toast.success(`已从阅读记录移除「${title}」`)
      const remaining = history.data?.data.length ?? 0
      if (remaining === 1 && page > 1) setPage((value) => value - 1)
    } catch (error) {
      toast.error(extractError(error, '移除失败'))
    } finally {
      setRemovingId(null)
    }
  }

  return (
    <section>
      <div className="flex flex-wrap items-end justify-between gap-3 border-b pb-4">
        <div>
          <p className="text-[10px] uppercase tracking-[0.24em] text-muted-foreground">READING</p>
          <h2 className="mt-1 font-serif text-xl tracking-tight">最近阅读</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            只记你读到哪、读过几次，用于继续阅读和推荐；可以逐条移除。
          </p>
        </div>
        <span className="font-mono text-xs text-muted-foreground">
          共 {history.data?.meta.total ?? 0} 条
        </span>
      </div>

      {history.isLoading ? <Loading /> : null}
      {history.isError ? (
        <ErrorState message="加载阅读记录失败" onRetry={() => void history.refetch()} />
      ) : null}
      {!history.isLoading && !history.isError && (history.data?.data.length ?? 0) === 0 ? (
        <EmptyState
          title="还没有阅读记录"
          description="打开一篇作品读几段，这里就会出现「继续阅读」。"
        />
      ) : null}

      {(history.data?.data.length ?? 0) > 0 ? (
        <div className="divide-y">
          {history.data?.data.map((item) => {
            const title = item.title || `作品 #${item.resource_id}`
            const authors = item.authors?.length ? item.authors.join('、') : '作者未署名'
            return (
              <div key={item.resource_id} className="group flex items-start gap-3 py-4">
                <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-md border bg-muted/25 text-muted-foreground">
                  <BookOpen className="h-4 w-4" />
                </span>
                <Link
                  to="/catalog/$resourceId"
                  params={{ resourceId: String(item.resource_id) }}
                  className="min-w-0 flex-1 transition-colors hover:text-primary"
                >
                  <span className="block text-sm font-medium">{title}</span>
                  <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
                    <span>{authors}</span>
                    <span>·</span>
                    <span>{progressText(item.progress_percent, item.completed)}</span>
                    <span>·</span>
                    <span>{shortDate(item.last_read_at || item.viewed_at)}</span>
                  </span>
                </Link>
                <div className="flex shrink-0 items-center gap-1">
                  <Button variant="ghost" size="sm" className="h-8 gap-1 px-2 text-xs" asChild>
                    <Link
                      to="/catalog/$resourceId"
                      params={{ resourceId: String(item.resource_id) }}
                    >
                      {item.completed ? '再读' : '继续'}
                      <ArrowRight className="h-3 w-3" />
                    </Link>
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 w-8 p-0 text-muted-foreground opacity-70 hover:text-destructive group-hover:opacity-100"
                    aria-label={`从阅读记录移除：${title}`}
                    disabled={removingId === item.resource_id}
                    onClick={() => void onRemove(item.resource_id, title)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            )
          })}
        </div>
      ) : null}

      {history.data && history.data.meta.total_pages > 1 ? (
        <div className="border-t pt-3">
          <Pagination
            page={history.data.meta.page}
            totalPages={history.data.meta.total_pages}
            onPageChange={setPage}
          />
        </div>
      ) : null}
    </section>
  )
}
