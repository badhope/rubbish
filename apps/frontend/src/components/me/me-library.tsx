import { Link } from '@tanstack/react-router'
import { ArrowRight, BookMarked, Library, Users } from 'lucide-react'
import {
  useMyFollowedAuthors,
  useMySubscribedDisciplines,
  useReadingLists,
} from '@/hooks/api/use-modules'
import { Button } from '@/components/ui/button'
import { ErrorState, Loading } from '@/components/common/state'
import { shortDate } from './format'

export function MeLibrary() {
  const lists = useReadingLists(1, 12)
  const authors = useMyFollowedAuthors(1, 12)
  const disciplines = useMySubscribedDisciplines()

  if (lists.isLoading) return <Loading />
  if (lists.isError) return <ErrorState message="加载收藏失败" onRetry={() => lists.refetch()} />

  const rows = lists.data?.data ?? []

  return (
    <div className="space-y-8">
      <section>
        <div className="flex flex-wrap items-end justify-between gap-3 border-b pb-4">
          <div>
            <p className="text-[10px] uppercase tracking-[0.24em] text-muted-foreground">LIBRARY</p>
            <h2 className="mt-1 font-serif text-xl tracking-tight">阅读列表</h2>
            <p className="mt-1 text-xs text-muted-foreground">共 {lists.data?.meta.total ?? 0} 个列表</p>
          </div>
          <Button variant="outline" size="sm" asChild>
            <Link to="/library">
              打开书架
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </Button>
        </div>
        {rows.length === 0 ? (
          <div className="flex items-center gap-3 border-b py-8 text-sm text-muted-foreground">
            <Library className="h-4 w-4" />
            还没有阅读列表。在文章页点收藏即可建立。
          </div>
        ) : (
          <div className="divide-y">
            {rows.map((list) => (
              <Link
                key={list.id}
                to="/library/$listId"
                params={{ listId: String(list.id) }}
                className="group flex items-center gap-3 py-3.5 transition-colors hover:bg-primary/[0.03]"
              >
                <BookMarked className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{list.name}</span>
                  <span className="mt-0.5 block text-[11px] text-muted-foreground">
                    {list.item_count} 篇 · 更新于 {shortDate(list.updated_at)}
                  </span>
                </span>
                <ArrowRight className="h-3.5 w-3.5 text-muted-foreground group-hover:text-primary" />
              </Link>
            ))}
          </div>
        )}
      </section>

      <section>
        <div className="flex flex-wrap items-end justify-between gap-3 border-b pb-4">
          <div>
            <p className="text-[10px] uppercase tracking-[0.24em] text-muted-foreground">FOLLOWING</p>
            <h2 className="mt-1 font-serif text-xl tracking-tight">关注与订阅</h2>
          </div>
          <Button variant="ghost" size="sm" asChild>
            <Link to="/follows">
              管理关注
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </Button>
        </div>

        {authors.isLoading ? <Loading /> : null}
        {!authors.isLoading && (authors.data?.data.length ?? 0) > 0 ? (
          <div className="flex flex-wrap gap-x-5 gap-y-2 border-b py-4 text-sm">
            {authors.data?.data.map((item) => (
              <Link
                key={item.author_name}
                to="/u/$username"
                params={{ username: item.author_name }}
                className="inline-flex items-center gap-1.5 text-muted-foreground hover:text-primary"
              >
                <Users className="h-3.5 w-3.5" />
                {item.author_name}
              </Link>
            ))}
          </div>
        ) : null}
        {!authors.isLoading && (authors.data?.data.length ?? 0) === 0 ? (
          <p className="border-b py-4 text-sm text-muted-foreground">还没有关注作者。</p>
        ) : null}

        {!disciplines.isLoading && (disciplines.data?.data.length ?? 0) > 0 ? (
          <div className="flex flex-wrap gap-2 py-4">
            {disciplines.data?.data.map((discipline) => (
              <span
                key={discipline}
                className="border bg-muted/25 px-2 py-1 text-xs text-muted-foreground"
              >
                {discipline}
              </span>
            ))}
          </div>
        ) : null}
        {!disciplines.isLoading && (disciplines.data?.data.length ?? 0) === 0 ? (
          <p className="py-4 text-sm text-muted-foreground">还没有订阅学科。</p>
        ) : null}
      </section>
    </div>
  )
}
