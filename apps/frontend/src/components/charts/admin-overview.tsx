import type { AdminAnalytics } from '@/lib/types'
import { EChart } from './echart'

// 后台看板的三张图：流量趋势、热门页面、来源。
// 数字全部来自 /admin/analytics/summary，不在前端二次估算，
// 也不把“页面访问”冒充成“独立访客”。

function EmptyChart({ text }: { text: string }) {
  return (
    <div className="flex h-[180px] flex-col items-center justify-center gap-2 rounded-lg border border-dashed text-center">
      <span className="text-2xl font-semibold text-muted-foreground">—</span>
      <p className="max-w-[16rem] text-xs leading-relaxed text-muted-foreground">{text}</p>
    </div>
  )
}

export function PageViewTrend({ data }: { data: AdminAnalytics['daily'] }) {
  if (data.length === 0) return <EmptyChart text="暂无页面访问数据。站点有公开访问后，这里会按自然日累计。" />
  const labels = data.map((d) => d.date.slice(5))
  return (
    <EChart
      height={230}
      ariaLabel="近七天页面访问趋势"
      option={{
        grid: { left: 8, right: 16, top: 28, bottom: 8, containLabel: true },
        xAxis: {
          type: 'category',
          data: labels,
          axisLine: { lineStyle: { color: '#dbe5de' } },
          axisTick: { show: false },
          axisLabel: { color: '#5c6b64', fontSize: 10 },
        },
        yAxis: {
          type: 'value',
          splitLine: { lineStyle: { color: '#edf1ee' } },
          axisLabel: { color: '#8a9a92', fontSize: 10 },
        },
        tooltip: { trigger: 'axis', formatter: (p: unknown) => {
          const row = (p as { name?: string; value?: number }[])[0]
          return `${row?.name ?? ''}：${row?.value ?? 0} 次页面访问`
        } },
        series: [
          {
            type: 'bar',
            data: data.map((d) => d.views),
            barWidth: '42%',
            itemStyle: { color: '#2f6b52', borderRadius: [4, 4, 0, 0] },
            label: { show: true, position: 'top', color: '#5c6b64', fontSize: 10 },
          },
        ],
      }}
    />
  )
}

export function TopPathsBar({ data }: { data: AdminAnalytics['paths'] }) {
  const entries = data.slice(0, 8)
  if (entries.length === 0) return <EmptyChart text="暂无热门页面。等公开页面产生访问后，这里会显示路径排行。" />
  return (
    <EChart
      height={280}
      ariaLabel="热门页面访问排行"
      option={{
        grid: { left: 8, right: 48, top: 8, bottom: 8, containLabel: true },
        xAxis: { type: 'value', splitLine: { lineStyle: { color: '#edf1ee' } }, axisLabel: { color: '#8a9a92', fontSize: 10 } },
        yAxis: {
          type: 'category',
          inverse: true,
          data: entries.map((e) => e.path),
          axisLine: { show: false },
          axisTick: { show: false },
          axisLabel: { color: '#5c6b64', fontSize: 10, width: 150, overflow: 'truncate' },
        },
        tooltip: { trigger: 'item', formatter: (p: unknown) => {
          const row = p as { name?: string; value?: number }
          return `${row.name ?? ''}：${row.value ?? 0} 次`
        } },
        series: [
          {
            type: 'bar',
            data: entries.map((e) => e.views),
            barWidth: 14,
            itemStyle: { color: '#5f9e7d', borderRadius: [0, 4, 4, 0] },
            label: { show: true, position: 'right', color: '#5c6b64', fontSize: 10 },
          },
        ],
      }}
    />
  )
}

export function ReferrerBar({ data }: { data: AdminAnalytics['referrers'] }) {
  const entries = data.slice(0, 6).map((e) => ({
    label: e.referrer ? e.referrer.replace(/^https?:\/\//, '').slice(0, 42) : '直接访问',
    views: e.views,
  }))
  if (entries.length === 0) return <EmptyChart text="暂无来源数据。访客从站外链接进入后，这里会显示来源排行。" />
  return (
    <EChart
      height={230}
      ariaLabel="访问来源排行"
      option={{
        grid: { left: 8, right: 40, top: 8, bottom: 8, containLabel: true },
        xAxis: { type: 'value', splitLine: { lineStyle: { color: '#edf1ee' } }, axisLabel: { color: '#8a9a92', fontSize: 10 } },
        yAxis: {
          type: 'category',
          inverse: true,
          data: entries.map((e) => e.label),
          axisLine: { show: false },
          axisTick: { show: false },
          axisLabel: { color: '#5c6b64', fontSize: 10, width: 150, overflow: 'truncate' },
        },
        tooltip: { trigger: 'item', formatter: (p: unknown) => {
          const row = p as { name?: string; value?: number }
          return `${row.name ?? ''}：${row.value ?? 0} 次`
        } },
        series: [
          {
            type: 'bar',
            data: entries.map((e) => e.views),
            barWidth: 14,
            itemStyle: { color: '#c7a24b', borderRadius: [0, 4, 4, 0] },
            label: { show: true, position: 'right', color: '#5c6b64', fontSize: 10 },
          },
        ],
      }}
    />
  )
}


