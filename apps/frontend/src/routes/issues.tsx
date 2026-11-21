import { createFileRoute, Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { ArrowRight, Layers3, PenLine } from 'lucide-react'
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
        description={`内容按一组一组的合集归档。合集只影响浏览顺序，不代表刊期、等级或发表批次；当前共 ${issues.length} 组、${totalArticles} 条内容。`}
        actions={
          <Button asChild variant="outline">
            <Link to="/catalog">
              自由浏览
              <ArrowRight className="ml-1 h-4 w-4" />
            </Link>
          </Button>
        }
      />

      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-y bg-muted/20 px-4 py-3 text-xs leading-5 text-muted-foreground sm:px-5">
        <p><span className="font-medium text-foreground">合集</span>：一组内容的归档名，方便顺着读。</p>
        <p><span className="font-medium text-foreground">不表示</span>：卷号、刊期、发表批次或内容等级。</p>
        <p><span className="font-medium text-foreground">编号</span>：只用于站内定位，不是 DOI 或正式引用编号。</p>
      </div>

      {issues.length === 0 ? (
        <EmptyState title="还没有合集" description="内容公开后会进入对应合集。" />
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
                    <h2 className="font-serif text-lg font-semibold">合集 {padNo(index + 1)}</h2>
                    <Badge variant="secondary">{issue.article_count} 条</Badge>
                    {(issue.first_year || issue.last_year) && (
                      <span className="text-xs text-muted-foreground">
                        {issue.first_year ?? issue.last_year}
                        {issue.first_year && issue.last_year && issue.first_year !== issue.last_year
                          ? `–${issue.last_year}`
                          : ''}
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">{issueTitle(issue.issue)}</p>
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
                    看这组内容 <ArrowRight className="h-3.5 w-3.5" />
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
            <p className="text-sm font-medium">新内容公开后会自动进入最新合集</p>
            <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
              想单独发一条短讨论，不用等合集：直接去讨论区。
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            <Button asChild size="sm">
              <Link to="/submissions/new">
                <PenLine className="h-3.5 w-3.5" />
                发布作品
              </Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link to="/forum">去讨论</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
