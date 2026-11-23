import { createFileRoute, Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { ArrowRight, Layers3 } from 'lucide-react'
import { api } from '@/lib/api'
import { PageHeader } from '@/components/common/page-header'
import { EmptyState, ErrorState, Loading } from '@/components/common/state'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { issueTitle } from '@/lib/issue-meta'

export const Route = createFileRoute('/issues')({
  component: CollectionsPage,
})

interface IssueSummary {
  issue: string
  article_count: number
  first_year: number | null
  last_year: number | null
}

interface VolumeSummary {
  volume: string
  issue_count: number
  article_count: number
  issues: IssueSummary[]
}

interface VolumeStats {
  data: VolumeSummary[]
}

function padNo(value: string | number): string {
  return String(Number(value)).padStart(2, '0')
}

function CollectionsPage() {
  const collectionsQ = useQuery({
    queryKey: ['catalog', 'volumes'],
    queryFn: async () => (await api.get<VolumeStats>('/catalog/volumes/stats')).data,
  })

  if (collectionsQ.isLoading) return <Loading />
  if (collectionsQ.isError)
    return <ErrorState message="合集加载失败" onRetry={() => collectionsQ.refetch()} />

  const issues = (collectionsQ.data?.data ?? [])
    .flatMap((volume) => volume.issues.map((issue) => ({ ...issue, volume: volume.volume })))
    .sort((a, b) => Number(a.volume) - Number(b.volume) || Number(a.issue) - Number(b.issue))

  const totalArticles = issues.reduce((sum, issue) => sum + issue.article_count, 0)

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader
        title="合集"
        description={`有些东西适合放在一起读。合集就是那条线：不排名，不分高低，只按一个题目把内容串起来。现在有 ${issues.length} 组、${totalArticles} 篇。`}
      />

      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-y bg-muted/20 px-4 py-3 text-xs leading-5 text-muted-foreground sm:px-5">
        <p><span className="font-medium text-foreground">合集</span>：一条阅读线，顺着走就好。</p>
        <p><span className="font-medium text-foreground">顺序</span>：先来后到，或者按主题。不是热度，也不排名。</p>
        <p><span className="font-medium text-foreground">编号</span>：只在站内找东西时用。</p>
      </div>

      {issues.length === 0 ? (
        <EmptyState title="还没有合集" description="作品公开后，会自己落进合集。" />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {issues.map((issue, index) => (
            <Card key={`${issue.volume}-${issue.issue}`}>
              <CardContent className="flex flex-wrap items-center gap-3 p-3.5 sm:p-4">
                <div className="flex h-14 w-14 shrink-0 flex-col items-center justify-center border bg-background">
                  <span className="text-[9px] uppercase tracking-[0.16em] text-muted-foreground">合集</span>
                  <span className="font-mono text-xl font-semibold leading-none">{padNo(index + 1)}</span>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="font-serif text-lg font-semibold">{issueTitle(issue.issue)}</h2>
                    <Badge variant="secondary">{issue.article_count} 篇</Badge>
                    {(issue.first_year || issue.last_year) && (
                      <span className="text-xs text-muted-foreground">
                        {issue.first_year ?? issue.last_year}
                        {issue.first_year && issue.last_year && issue.first_year !== issue.last_year
                          ? `–${issue.last_year}`
                          : ''}
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    按主题放在一起，方便顺着读
                  </p>
                </div>
                <Button asChild variant="ghost" size="sm" className="shrink-0">
                  <Link
                    to="/catalog"
                    search={{
                      volume: issue.volume,
                      issue: issue.issue,
                      sort: 'issue',
                      view: 'list',
                    }}
                  >
                    顺着读 <ArrowRight className="h-3.5 w-3.5" />
                  </Link>
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Card className="border-dashed bg-primary/[0.03]">
        <CardContent className="flex flex-wrap items-center gap-3 p-3.5 sm:p-4">
          <Layers3 className="h-5 w-5 shrink-0 text-primary" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">刚放上桌的作品，会先落进最新合集</p>
            <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
              只有一句话，不必等合集，直接去讨论区。
            </p>
          </div>
          <Button asChild variant="outline" size="sm">
            <Link to="/forum">去讨论区</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
