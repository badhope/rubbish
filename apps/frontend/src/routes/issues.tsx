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

function volumeOrdinal(volume: string): string {
  const n = Number(volume)
  return Number.isFinite(n) ? `第 ${n} 卷` : `卷 ${volume}`
}

function CollectionsPage() {
  const collectionsQ = useQuery({
    queryKey: ['catalog', 'volumes'],
    queryFn: async () => (await api.get<VolumeStats>('/catalog/volumes/stats')).data,
  })

  if (collectionsQ.isLoading) return <Loading />
  if (collectionsQ.isError)
    return <ErrorState message="卷加载失败" onRetry={() => collectionsQ.refetch()} />

  const volumes = (collectionsQ.data?.data ?? [])
    .filter((volume) => volume.issues.length > 0)
    .sort((a, b) => Number(a.volume) - Number(b.volume))

  const totalIssues = volumes.reduce((sum, volume) => sum + volume.issues.length, 0)
  const totalArticles = volumes.reduce((sum, volume) => sum + volume.article_count, 0)

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader
        title="卷"
        description={`一卷是一条完整的阅读线，卷里的合集只按主题把文章串起来。现在有 ${volumes.length} 卷、${totalIssues} 个合集、${totalArticles} 篇。`}
      />

      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-y bg-muted/20 px-4 py-3 text-xs leading-5 text-muted-foreground sm:px-5">
        <p><span className="font-medium text-foreground">卷</span>：一组完整的阅读线，不排名，不分高低。</p>
        <p><span className="font-medium text-foreground">合集</span>：卷里的主题组，顺着读就好。</p>
        <p><span className="font-medium text-foreground">编号</span>：只在站内找东西时用。</p>
      </div>

      {volumes.length === 0 ? (
        <EmptyState title="还没有卷" description="作品公开后，会自己落进卷里。" />
      ) : (
        <div className="space-y-4">
          {volumes.map((volume) => (
            <Card key={volume.volume}>
              <CardContent className="p-4 sm:p-5">
                <div className="flex flex-wrap items-center gap-3">
                  <div className="flex h-14 w-14 shrink-0 flex-col items-center justify-center border bg-background">
                    <span className="text-[9px] uppercase tracking-[0.16em] text-muted-foreground">卷</span>
                    <span className="font-mono text-xl font-semibold leading-none">
                      {padNo(volume.volume)}
                    </span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="font-serif text-lg font-semibold">{volumeOrdinal(volume.volume)}</h2>
                      <Badge variant="secondary">{volume.article_count} 篇</Badge>
                      <span className="text-xs text-muted-foreground">
                        {volume.issues.length} 个合集
                      </span>
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">
                      先读卷里的合集，再顺着文章往下走。
                    </p>
                  </div>
                </div>

                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  {volume.issues
                    .slice()
                    .sort((a, b) => Number(a.issue) - Number(b.issue))
                    .map((issue) => (
                      <div
                        key={`${volume.volume}-${issue.issue}`}
                        className="flex min-w-0 items-center gap-3 rounded-md border bg-background px-3 py-2.5"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">{issueTitle(issue.issue)}</p>
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            合集 {padNo(issue.issue)} · {issue.article_count} 篇
                          </p>
                        </div>
                        <Button asChild variant="ghost" size="sm" className="shrink-0">
                          <Link
                            to="/catalog"
                            search={{
                              volume: volume.volume,
                              issue: issue.issue,
                              sort: 'issue',
                              view: 'list',
                            }}
                          >
                            顺着读 <ArrowRight className="h-3.5 w-3.5" />
                          </Link>
                        </Button>
                      </div>
                    ))}
                </div>
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
