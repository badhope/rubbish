import { useState } from 'react'
import {
  BookOpen,
  ClipboardList,
  Download,
  FileUp,
  Gavel,
  MessageSquare,
  MessagesSquare,
  ShieldAlert,
  UserPlus,
  Users,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  exportMonthlyOpsReport,
  useMonthlyOpsReport,
} from '@/hooks/api/use-modules'
import { PageHeader } from '@/components/common/page-header'
import { ErrorState, Loading } from '@/components/common/state'
import { EChart } from '@/components/charts/echart'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { auditActionLabel } from '@/lib/audit-labels'
import { downloadBlob, extractError } from '@/lib/utils'

const MODERATION_LABELS: Record<string, string> = {
  approve: '通过并公开',
  reject: '不通过',
  changes: '要求作者调整',
  feedback: '规则误判反馈',
}

const BACKLOG_ITEMS: Array<{
  key: 'open_reports' | 'manual_review_topics' | 'pending_comments' | 'pending_submissions'
  label: string
  href: string
}> = [
  { key: 'open_reports', label: '待处理举报', href: '/admin/content?section=reports' },
  { key: 'manual_review_topics', label: '待人工核验主题', href: '/admin/content?section=moderation' },
  { key: 'pending_comments', label: '待看评论', href: '/admin/content?section=comments' },
  { key: 'pending_submissions', label: '在审投稿', href: '/submissions/pending' },
]

function currentMonth(): string {
  return new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai' }).slice(0, 7)
}

function fmt(value: number | null | undefined): string {
  return (value ?? 0).toLocaleString('zh-CN')
}

export default function OpsReportPage() {
  const [month, setMonth] = useState(currentMonth)
  const [exporting, setExporting] = useState(false)
  const activeMonth = month || currentMonth()
  const { data, isLoading, isError, refetch } = useMonthlyOpsReport(activeMonth)

  const handleExport = async () => {
    setExporting(true)
    try {
      const { blob, disposition } = await exportMonthlyOpsReport(activeMonth)
      downloadBlob(blob, disposition, `运营月报-${activeMonth}.csv`)
      toast.success('月报已导出')
    } catch (err) {
      toast.error(extractError(err, '导出失败，可重试。'))
    } finally {
      setExporting(false)
    }
  }

  const pendingTotal = data
    ? data.backlog.open_reports +
      data.backlog.manual_review_topics +
      data.backlog.pending_comments +
      data.backlog.pending_submissions
    : 0

  const decisionTotal = data
    ? Object.values(data.moderation_breakdown).reduce((sum, value) => sum + value, 0)
    : 0

  const cards = data
    ? [
        { label: '新增成员', value: data.totals.new_users, icon: UserPlus, sub: '本月注册' },
        { label: '新增投稿', value: data.totals.submissions, icon: FileUp, sub: '含重投新版本' },
        { label: '新增作品', value: data.totals.resources, icon: BookOpen, sub: '进入内容库的记录' },
        { label: '新增主题帖', value: data.totals.forum_topics, icon: MessageSquare, sub: '不含已删除' },
        { label: '新增回帖', value: data.totals.forum_replies, icon: MessagesSquare, sub: '不含已删除' },
        { label: '新增评论', value: data.totals.comments, icon: ClipboardList, sub: '作品页读者评论' },
        { label: '新增举报', value: data.totals.reports, icon: ShieldAlert, sub: '讨论与评论举报' },
        { label: '后台动作', value: data.totals.admin_actions, icon: Gavel, sub: '审计日志条数' },
      ]
    : []

  return (
    <div>
      <PageHeader
        title="运营月报"
        description="按中国时区自然月汇总成员、内容、讨论、举报与后台处置。数字来自各自的源表，不手工填；导出会带上同一份汇总和逐日明细。"
        actions={
          <Button variant="outline" size="sm" onClick={handleExport} disabled={exporting || !data}>
            <Download className="mr-1.5 h-4 w-4" />
            {exporting ? '导出中…' : '导出 CSV'}
          </Button>
        }
      />

      <div className="mb-5 flex flex-wrap items-center gap-3">
        <label htmlFor="ops-month" className="text-sm text-muted-foreground">
          统计月份
        </label>
        <Input
          id="ops-month"
          type="month"
          value={month}
          onChange={(event) => setMonth(event.target.value || currentMonth())}
          className="h-9 w-[180px]"
        />
        <span className="text-xs text-muted-foreground">切换月份会重新拉取，不缓存旧月报。</span>
      </div>

      {isLoading ? (
        <Loading />
      ) : isError || !data ? (
        <ErrorState message="运营月报加载失败，可重试。" onRetry={() => refetch()} />
      ) : (
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {cards.map(({ label, value, icon: Icon, sub }) => (
              <Card key={label}>
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <p className="text-xs text-muted-foreground">{label}</p>
                    <Icon className="h-4 w-4 text-primary" />
                  </div>
                  <p className="mt-2 font-serif text-3xl font-semibold tabular-nums">{fmt(value)}</p>
                  <p className="mt-1 text-[11px] text-muted-foreground">{sub}</p>
                </CardContent>
              </Card>
            ))}
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader className="pb-1">
                <CardTitle className="text-sm">逐日活动</CardTitle>
              </CardHeader>
              <CardContent className="pt-2">
                <EChart
                  height={280}
                  ariaLabel={`${month} 逐日运营活动`}
                  option={{
                    grid: { left: 8, right: 16, top: 44, bottom: 8, containLabel: true },
                    legend: {
                      top: 0,
                      left: 0,
                      itemWidth: 12,
                      itemHeight: 8,
                      textStyle: { fontSize: 10, color: '#5c6b64' },
                    },
                    xAxis: {
                      type: 'category',
                      data: data.daily.map((row) => row.date.slice(5)),
                      axisTick: { show: false },
                      axisLabel: { color: '#8a9a92', fontSize: 9 },
                    },
                    yAxis: {
                      type: 'value',
                      minInterval: 1,
                      splitLine: { lineStyle: { color: '#edf1ee' } },
                      axisLabel: { color: '#8a9a92', fontSize: 10 },
                    },
                    tooltip: { trigger: 'axis', confine: true },
                    series: [
                      {
                        name: '主题帖',
                        type: 'line',
                        smooth: true,
                        symbol: 'none',
                        data: data.daily.map((row) => row.forum_topics),
                      },
                      {
                        name: '回帖',
                        type: 'line',
                        smooth: true,
                        symbol: 'none',
                        data: data.daily.map((row) => row.forum_replies),
                      },
                      {
                        name: '评论',
                        type: 'line',
                        smooth: true,
                        symbol: 'none',
                        data: data.daily.map((row) => row.comments),
                      },
                      {
                        name: '后台动作',
                        type: 'line',
                        smooth: true,
                        symbol: 'none',
                        data: data.daily.map((row) => row.admin_actions),
                      },
                    ],
                  }}
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">待办余量</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2.5">
                <p className="text-xs text-muted-foreground">
                  截止查看时，四个队列合计 <b className="text-foreground">{fmt(pendingTotal)}</b> 条。
                </p>
                {BACKLOG_ITEMS.map((item) => (
                  <a
                    key={item.key}
                    href={item.href}
                    className="flex items-center justify-between rounded-md border px-2.5 py-2 text-xs transition-colors hover:bg-muted/40"
                  >
                    <span>{item.label}</span>
                    <Badge variant={data.backlog[item.key] > 0 ? 'secondary' : 'outline'}>
                      {fmt(data.backlog[item.key])}
                    </Badge>
                  </a>
                ))}
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">处置结果</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {Object.entries(MODERATION_LABELS).map(([key, label]) => (
                  <div key={key} className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">{label}</span>
                    <b className="tabular-nums">{fmt(data.moderation_breakdown[key])}</b>
                  </div>
                ))}
                <div className="mt-3 border-t pt-3 text-xs text-muted-foreground">
                  本月处置事件 <b className="text-foreground">{fmt(data.totals.moderation_events)}</b> 条，
                  其中四类核验结果 <b className="text-foreground">{fmt(decisionTotal)}</b> 条，
                  其余为反馈、重提、批量撤销等过程事件；活跃版主{' '}
                  <b className="text-foreground">{fmt(data.totals.active_moderators)}</b> 人。
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">后台高频动作</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {data.top_actions.length === 0 ? (
                  <p className="text-xs text-muted-foreground">本月没有后台审计动作。</p>
                ) : (
                  data.top_actions.map((item) => (
                    <div key={item.action} className="flex items-center justify-between gap-3 text-xs">
                      <span className="min-w-0 truncate text-muted-foreground">
                        {auditActionLabel(item.action)}
                      </span>
                      <b className="shrink-0 tabular-nums">{fmt(item.count)}</b>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">处置最多的人</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {data.top_moderators.length === 0 ? (
                  <p className="text-xs text-muted-foreground">本月没有人工核验处置。</p>
                ) : (
                  data.top_moderators.map((item) => (
                    <div key={item.user_id} className="flex items-center justify-between gap-3 text-xs">
                      <span className="inline-flex min-w-0 items-center gap-1.5 text-muted-foreground">
                        <Users className="h-3.5 w-3.5" />
                        <span className="truncate">{item.name}</span>
                      </span>
                      <b className="shrink-0 tabular-nums">{fmt(item.count)}</b>
                    </div>
                  ))
                )}
                <div className="mt-3 border-t pt-3 text-xs text-muted-foreground">
                  活跃管理员 <b className="text-foreground">{fmt(data.totals.active_admins)}</b> 人。
                </div>
              </CardContent>
            </Card>
          </div>

          <p className="text-[11px] leading-relaxed text-muted-foreground">
            口径：月份按 Asia/Shanghai 的自然月切分；新增作品按资源入库时间统计，新增投稿按首次提交时间统计；
            “后台动作”来自审计日志，“处置结果”只统计论坛人工核验事件。已软删除的帖子与回帖不计入新增。
          </p>
        </div>
      )}
    </div>
  )
}