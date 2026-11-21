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
  component: IssuesPage,
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

const NEXT_ISSUE = 7

function issueNo(value: string): string {
  return String(Number(value)).padStart(2, '0')
}

function IssuesPage() {
  const volumesQ = useQuery({
    queryKey: ['catalog', 'volumes'],
    queryFn: async () => (await api.get<VolumeStats>('/catalog/volumes/stats')).data,
  })

  if (volumesQ.isLoading) return <Loading />
  if (volumesQ.isError)
    return <ErrorState message="卷期加载失败" onRetry={() => volumesQ.refetch()} />

  const issues = (volumesQ.data?.data ?? [])
    .flatMap((volume) =>
      volume.issues.map((issue) => ({
        ...issue,
        volume: volume.volume,
      })),
    )
    .sort((a, b) => Number(a.volume) - Number(b.volume) || Number(a.issue) - Number(b.issue))

  const totalArticles = issues.reduce((sum, issue) => sum + issue.article_count, 0)
  const hasNextIssue = !issues.some((issue) => Number(issue.issue) === NEXT_ISSUE)

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader
        title="文章卷期"
        description={`文章按卷、期归档：卷是大归档，期是卷内发布批次。当前共 ${issues.length} 期、${totalArticles} 篇文章。`}
      />

      <div className="grid gap-2 border-y bg-muted/20 px-4 py-3 text-xs leading-5 text-muted-foreground sm:grid-cols-3 sm:px-5">
        <p>
          <span className="font-medium text-foreground">卷</span>
          ：文章的大归档；当前是第 1 卷。
        </p>
        <p>
          <span className="font-medium text-foreground">期</span>
          ：卷内发布批次；第 01 期最早，数字越大越新。
        </p>
        <p>
          <span className="font-medium text-foreground">说明</span>
          ：卷、期只表示文章归档在哪一档。
        </p>
      </div>

      {issues.length === 0 ? (
        <EmptyState title="还没有文章卷期" description="文章发布后会进入对应卷、期。" />
      ) : (
        <div className="space-y-3">
          {issues.map((issue) => (
            <Card key={`${issue.volume}-${issue.issue}`}>
              <CardContent className="flex flex-wrap items-center gap-4 p-4 sm:flex-nowrap sm:p-5">
                <div className="flex h-14 w-14 shrink-0 flex-col items-center justify-center border bg-background">
                  <span className="text-[9px] uppercase tracking-[0.18em] text-muted-foreground">
                    第 {issueNo(issue.issue)} 期
                  </span>
                  <span className="font-mono text-xl font-semibold leading-none">
                    {Number(issue.issue)}
                  </span>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="font-serif text-lg font-semibold">
                      第 {Number(issue.volume)} 卷 · 第 {issueNo(issue.issue)} 期
                    </h2>
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
                    查看文章 <ArrowRight className="h-3.5 w-3.5" />
                  </Link>
                </Button>
              </CardContent>
            </Card>
          ))}

          {hasNextIssue && (
            <Card className="border-dashed bg-primary/[0.03]">
              <CardContent className="flex flex-wrap items-center gap-4 p-4 sm:flex-nowrap sm:p-5">
                <div className="flex h-14 w-14 shrink-0 flex-col items-center justify-center border border-primary/30 bg-primary/5 text-primary">
                  <span className="text-[9px] uppercase tracking-[0.18em]">NEXT</span>
                  <span className="font-mono text-xl font-semibold leading-none">{NEXT_ISSUE}</span>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="font-serif text-lg font-semibold">
                      下一期 · 第 {issueNo(String(NEXT_ISSUE))} 期
                    </h2>
                    <Badge variant="outline" className="border-primary/30 text-primary">
                      收作品中
                    </Badge>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {issueTitle(issueNo(String(NEXT_ISSUE)))} · 新录用的文章会自动归入这一期。
                  </p>
                </div>
                <Button asChild size="sm" className="shrink-0">
                  <Link to="/submissions/new">
                    <PenLine className="h-3.5 w-3.5" />
                    提交作品
                  </Link>
                </Button>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      <p className="flex items-start gap-2 text-xs leading-5 text-muted-foreground">
        <Layers3 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
        卷、期只表示文章放在哪一档，不代表文章水平高低。研究文章、荒诞研究、自由创作仍按内容类型在文章目录中区分。
      </p>
    </div>
  )
}
