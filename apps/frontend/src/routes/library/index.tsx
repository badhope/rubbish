import { useState } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { ArrowRight, BookMarked, Globe2, UserRound } from 'lucide-react'
import { usePublicReadingLists } from '@/hooks/api/use-modules'
import { PageHeader } from '@/components/common/page-header'
import { Pagination } from '@/components/common/pagination'
import { EmptyState, ErrorState, Loading } from '@/components/common/state'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'

export const Route = createFileRoute('/library/')({
  component: PublicLibraryPage,
})

function shortDate(value: string): string {
  return new Date(value).toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  })
}

function PublicLibraryPage() {
  const [page, setPage] = useState(1)
  const lists = usePublicReadingLists(page, 12)

  if (lists.isLoading) return <Loading />
  if (lists.isError) {
    return <ErrorState message="公开阅读列表加载失败" onRetry={() => lists.refetch()} />
  }

  const rows = lists.data?.data ?? []
  const total = lists.data?.meta.total ?? 0

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title="公开阅读列表"
        description={`由读者自己整理、主动公开的阅读路径。共 ${total} 个列表；只展示已公开的作品。`}
        actions={
          <Button variant="outline" size="sm" asChild>
            <Link to="/me" search={{ tab: 'library' }}>
              <BookMarked className="h-4 w-4" />
              我的收藏
            </Link>
          </Button>
        }
      />

      {rows.length === 0 ? (
        <EmptyState
          title="还没有人公开阅读列表"
          description="在「我的收藏」里整理一组作品，把可见性改成公开，它会出现在这里。"
          action={
            <Button size="sm" asChild>
              <Link to="/me" search={{ tab: 'library' }}>
                去整理一组
              </Link>
            </Button>
          }
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((list) => {
            const owner = list.owner_display_name || list.owner_username || '一位读者'
            return (
              <Card key={list.id} className="group flex flex-col transition-colors hover:border-primary/35">
                <CardContent className="flex flex-1 flex-col gap-3 p-5">
                  <div className="flex items-start justify-between gap-3">
                    <Badge variant="outline" className="gap-1 border-primary/25 text-primary">
                      <Globe2 className="h-3 w-3" />
                      公开
                    </Badge>
                    <span className="text-[11px] text-muted-foreground">{list.item_count} 篇</span>
                  </div>

                  <div className="min-w-0">
                    <Link
                      to="/library/$listId"
                      params={{ listId: String(list.id) }}
                      className="font-serif text-lg font-semibold leading-snug tracking-tight hover:text-primary"
                    >
                      {list.name}
                    </Link>
                    <p className="mt-1 line-clamp-2 min-h-[2.5rem] text-xs leading-5 text-muted-foreground">
                      {list.description || '这组作品还没有写说明，先读目录。'}
                    </p>
                  </div>

                  {list.preview_items?.length ? (
                    <ol className="space-y-1.5 border-y py-3 text-xs text-muted-foreground">
                      {list.preview_items.map((item, index) => (
                        <li key={item.id} className="flex min-w-0 gap-2">
                          <span className="w-4 shrink-0 tabular-nums text-muted-foreground/70">
                            {index + 1}.
                          </span>
                          <Link
                            to="/catalog/$resourceId"
                            params={{ resourceId: String(item.id) }}
                            className="line-clamp-1 hover:text-primary"
                          >
                            {item.title}
                          </Link>
                        </li>
                      ))}
                    </ol>
                  ) : (
                    <p className="border-y py-3 text-xs text-muted-foreground">
                      列表里暂时没有已公开的作品。
                    </p>
                  )}

                  <div className="mt-auto flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground">
                    <span className="inline-flex min-w-0 items-center gap-1.5">
                      <UserRound className="h-3.5 w-3.5 shrink-0" />
                      {list.owner_username ? (
                        <Link
                          to="/u/$username"
                          params={{ username: list.owner_username }}
                          className="truncate hover:text-primary"
                        >
                          {owner}
                        </Link>
                      ) : (
                        <span className="truncate">{owner}</span>
                      )}
                      <span aria-hidden>·</span>
                      <span className="shrink-0">{shortDate(list.updated_at)}</span>
                    </span>
                    <Link
                      to="/library/$listId"
                      params={{ listId: String(list.id) }}
                      className="inline-flex shrink-0 items-center gap-1 font-medium text-primary hover:underline"
                    >
                      连读
                      <ArrowRight className="h-3 w-3" />
                    </Link>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      {lists.data && lists.data.meta.total_pages > 1 ? (
        <div className="pt-6">
          <Pagination
            page={lists.data.meta.page}
            totalPages={lists.data.meta.total_pages}
            onPageChange={setPage}
          />
        </div>
      ) : null}
    </div>
  )
}
