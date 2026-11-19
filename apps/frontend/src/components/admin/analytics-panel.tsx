import { BarChart3, BookOpen, Download, Eye, Route } from 'lucide-react'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useAdminAnalytics, useCatalogStats } from '@/hooks/api/use-modules'
import {
  PageViewTrend,
  ReferrerBar,
  TopPathsBar,
} from '@/components/charts/admin-overview'

function fmt(n: number | null | undefined) {
  return (n ?? 0).toLocaleString('zh-CN')
}

export function AdminAnalyticsPanel() {
  const { data: stats, isLoading: statsLoading } = useCatalogStats()
  const { data: analytics, isLoading: analyticsLoading } = useAdminAnalytics(7)

  const records = stats?.total ?? 0
  const reads = stats?.reads_total ?? 0
  const downloads = stats?.downloads_total ?? 0
  const views = analytics?.total ?? 0
  const paths = analytics?.unique_paths ?? 0

  const cards = [
    {
      label: '档案条目',
      value: fmt(records),
      sub: '已公开的研究记录与自由创作',
      icon: BookOpen,
    },
    {
      label: '总阅读次数',
      value: fmt(reads),
      sub: records > 0 ? `每条平均 ${(reads / records).toFixed(1)} 次` : '暂无公开内容',
      icon: Eye,
    },
    {
      label: '总下载次数',
      value: fmt(downloads),
      sub: records > 0 ? `每条平均 ${(downloads / records).toFixed(1)} 次` : '暂无下载',
      icon: Download,
    },
    {
      label: '近 7 天页面访问',
      value: fmt(views),
      sub: `${fmt(paths)} 个页面有访问 · 按会话去重`,
      icon: Route,
    },
  ]

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-medium">
            <BarChart3 className="h-5 w-5 text-primary" />
            站点数据总览
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            档案、阅读、下载与页面访问都来自运行数据；页面访问只记路径与来源，不采 IP / UA / 用户 ID，因此不称 UV。
          </p>
        </div>
        <p className="text-[11px] text-muted-foreground">
          {statsLoading || analyticsLoading ? '数据加载中…' : '每 60 秒自动刷新'}
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map(({ label, value, sub, icon: Icon }) => (
          <Card key={label}>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <p className="text-xs text-muted-foreground">{label}</p>
                <Icon className="h-4 w-4 text-primary" />
              </div>
              <p className="mt-2 font-serif text-3xl font-semibold tabular-nums">{value}</p>
              <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{sub}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader className="pb-1">
          <CardTitle className="text-sm">近 7 天页面访问趋势</CardTitle>
        </CardHeader>
        <CardContent className="pt-2">
          <PageViewTrend data={analytics?.daily ?? []} />
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-1">
            <CardTitle className="text-sm">热门页面 Top 8</CardTitle>
          </CardHeader>
          <CardContent className="pt-2">
            <TopPathsBar data={analytics?.paths ?? []} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-1">
            <CardTitle className="text-sm">访问来源 Top 6</CardTitle>
          </CardHeader>
          <CardContent className="pt-2">
            <ReferrerBar data={analytics?.referrers ?? []} />
          </CardContent>
        </Card>
      </div>

      <p className="text-[11px] leading-relaxed text-muted-foreground">
        口径：阅读/下载为站内累计；页面访问为同一会话内同一路径只记一次，近 7 天按中国时区自然日切分。
      </p>
    </section>
  )
}
