import { Fragment, useMemo, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { ChevronRight, Search } from 'lucide-react'
import { useVolumeList } from '@/hooks/api/use-modules'
import { PageHeader } from '@/components/common/page-header'
import { EmptyState, ErrorState, Loading } from '@/components/common/state'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

export default function AdminVolumesPage({ initialVolume }: { initialVolume?: string }) {
  const [query, setQuery] = useState('')
  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set(initialVolume ? [initialVolume] : []),
  )
  const { data, isLoading, isError, refetch } = useVolumeList()
  const volumes = useMemo(() => data?.items ?? [], [data])

  const q = query.trim().toLowerCase()
  const filtered = useMemo(() => {
    if (!q) return volumes
    return volumes.filter(
      (v) =>
        v.volume.toLowerCase().includes(q) ||
        v.issues.some((issue) => issue.issue.toLowerCase().includes(q)),
    )
  }, [volumes, q])

  const toggle = (volume: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(volume)) next.delete(volume)
      else next.add(volume)
      return next
    })
  }

  return (
    <div>
      <PageHeader
        title="卷期"
        description="一卷一行，展开直接看该卷各期；期进入分部与发布。"
        actions={data ? <Badge variant="secondary">{volumes.length} 卷</Badge> : null}
      />

      <div className="mb-4 max-w-sm">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索卷号或期号"
            className="pl-8"
          />
        </div>
      </div>

      {isLoading ? (
        <Loading />
      ) : isError ? (
        <ErrorState message="加载卷期失败" onRetry={() => refetch()} />
      ) : filtered.length === 0 ? (
        <EmptyState
          title="暂无卷期"
          description="资源中尚未设置卷号（volume）字段。请先在资源录入时填写卷号。"
        />
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>卷 / 期</TableHead>
                <TableHead>文章数</TableHead>
                <TableHead>年份范围</TableHead>
                <TableHead className="w-28 text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((v) => {
                const open = expanded.has(v.volume) || Boolean(q)
                return (
                  <Fragment key={v.volume}>
                    <TableRow className="bg-muted/20">
                      <TableCell>
                        <button
                          type="button"
                          onClick={() => toggle(v.volume)}
                          className="inline-flex items-center gap-2 text-left font-medium"
                        >
                          <ChevronRight
                            className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${open ? 'rotate-90' : ''}`}
                          />
                          Vol. {v.volume}
                          <Badge variant="outline" className="font-normal">
                            {v.issueCount} 期
                          </Badge>
                        </button>
                      </TableCell>
                      <TableCell>{v.articleCount} 篇</TableCell>
                      <TableCell className="text-muted-foreground">—</TableCell>
                      <TableCell className="text-right">
                        <button
                          type="button"
                          onClick={() => toggle(v.volume)}
                          className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                        >
                          {open ? '收起' : '展开各期'}
                        </button>
                      </TableCell>
                    </TableRow>
                    {open
                      ? v.issues.map((issue) => (
                          <TableRow key={`${v.volume}-${issue.issue}`}>
                            <TableCell className="pl-10 text-sm">Issue {issue.issue}</TableCell>
                            <TableCell className="text-muted-foreground">
                              {issue.articleCount} 篇
                            </TableCell>
                            <TableCell className="text-muted-foreground">
                              {issue.firstYear === issue.lastYear
                                ? issue.firstYear
                                : `${issue.firstYear} — ${issue.lastYear}`}
                            </TableCell>
                            <TableCell className="text-right">
                              <Link
                                to="/admin/issues/$volume/$issue"
                                params={{ volume: v.volume, issue: issue.issue }}
                                className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                              >
                                分部与发布
                              </Link>
                            </TableCell>
                          </TableRow>
                        ))
                      : null}
                  </Fragment>
                )
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}
