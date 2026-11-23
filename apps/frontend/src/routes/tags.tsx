import { createFileRoute, Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { Archive, BookOpen, Tags } from 'lucide-react'
import { api } from '@/lib/api'
import { useDisciplines, useCatalogStats } from '@/hooks/api/use-modules'
import type { FacetBucket } from '@/lib/types'
import { PageHeader } from '@/components/common/page-header'
import { ErrorState, Loading } from '@/components/common/state'

export const Route = createFileRoute('/tags')({
  component: TagsPage,
})

interface FacetsResponse {
  years: FacetBucket[]
  tags: FacetBucket[]
}

function FacetCloud({
  buckets,
  to,
  search,
  empty,
}: {
  buckets: FacetBucket[]
  to: '/search' | '/catalog'
  search: (value: string) => Record<string, string | number>
  empty: string
}) {
  if (buckets.length === 0) {
    return <p className="text-sm text-muted-foreground">{empty}</p>
  }
  return (
    <div className="flex flex-wrap gap-2">
      {buckets.map((b) => (
        <Link
          key={b.value}
          to={to}
          search={search(b.value)}
          className="inline-flex max-w-full items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs transition-colors hover:border-primary/40 hover:text-primary"
        >
          <span className="min-w-0 truncate">{b.value}</span>
          <span className="shrink-0 font-mono text-[10px] text-muted-foreground">{b.count}</span>
        </Link>
      ))}
    </div>
  )
}

function TagsPage() {
  const facets = useQuery({
    queryKey: ['catalog', 'facets'] as const,
    queryFn: async () => (await api.get<FacetsResponse>('/catalog/facets')).data,
    staleTime: 5 * 60_000,
  })
  const disciplines = useDisciplines()
  const stats = useCatalogStats()

  if (facets.isPending) return <Loading />
  if (facets.isError) {
    return <ErrorState message="标签与年份没加载出来" onRetry={() => void facets.refetch()} />
  }

  const tags = facets.data?.tags ?? []
  const years = facets.data?.years ?? []
  const disciplineRows = disciplines.data ?? []
  const disciplineCounts = stats.data?.by_discipline ?? {}

  return (
    <div className="mx-auto w-full max-w-[880px] space-y-8">
      <PageHeader
        title="标签与归档"
        description="按标签、话题分区和年份找作品；卷是一条完整的阅读线。"
      />

      <section className="space-y-3">
        <h2 className="flex items-center gap-2 text-base font-medium">
          <Tags className="h-4 w-4 text-primary" />
          标签
        </h2>
        <FacetCloud
          buckets={tags}
          to="/search"
          search={(value) => ({ q: value })}
          empty="还没有标签。作品公开后，标签会出现在这里。"
        />
      </section>

      <section className="space-y-3">
        <h2 className="flex items-center gap-2 text-base font-medium">
          <BookOpen className="h-4 w-4 text-primary" />
          话题分区
        </h2>
        {disciplineRows.length === 0 ? (
          <p className="text-sm text-muted-foreground">还没有分区。</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {disciplineRows.map((d) => (
              <Link
                key={d.slug}
                to="/catalog"
                search={{ discipline: d.name }}
                className="inline-flex max-w-full items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs transition-colors hover:border-primary/40 hover:text-primary"
              >
                <span className="min-w-0 truncate">{d.name}</span>
                {disciplineCounts[d.name] != null ? (
                  <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                    {disciplineCounts[d.name]}
                  </span>
                ) : null}
              </Link>
            ))}
          </div>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="flex items-center gap-2 text-base font-medium">
          <Archive className="h-4 w-4 text-primary" />
          年份归档
        </h2>
        {years.length === 0 ? (
          <p className="text-sm text-muted-foreground">还没有按年份归档的作品。</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {years.map((y) => (
              <Link
                key={y.value}
                to="/catalog"
                search={{ year: Number(y.value) as number }}
                className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs transition-colors hover:border-primary/40 hover:text-primary"
              >
                <span className="font-mono">{y.value}</span>
                <span className="font-mono text-[10px] text-muted-foreground">{y.count}</span>
              </Link>
            ))}
          </div>
        )}
      </section>

      <p className="text-xs leading-relaxed text-muted-foreground">
        卷按题目串起一组阅读顺序，见
        <Link to="/issues" className="mx-1 text-primary hover:underline">
          卷索引
        </Link>
        。
      </p>
    </div>
  )
}
