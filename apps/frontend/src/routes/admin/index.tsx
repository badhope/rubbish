import { lazy, Suspense } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import {
  Activity,
  ArrowRight,
  Coins,
  FileSignature,
  Gavel,
  Layers,
  MessageSquare,
  ShieldAlert,
  Users,
} from 'lucide-react'

import { requireAdminGuard } from '@/lib/route-guards'
import { useAuth } from '@/hooks/use-auth'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { usePendingClaimsCount } from '@/hooks/api/use-modules'
import { useAdminCommentCounts } from '@/hooks/api/use-comments'
import { PageHeader } from '@/components/common/page-header'
import { Badge } from '@/components/ui/badge'

const AdminAnalyticsPanel = lazy(() =>
  import('@/components/admin/analytics-panel').then((m) => ({ default: m.AdminAnalyticsPanel })),
)

export const Route = createFileRoute('/admin/')({
  beforeLoad: () => {
    requireAdminGuard()
  },
  component: AdminDashboard,
})

// 总览只回答两件事：社区现在有什么要处理、管理域分别在哪。
// 具体表单和子段留在各域页，不在这里复制一遍入口卡片墙。
const PENDING_QUEUE: {
  title: string
  desc: string
  to: string
  search?: Record<string, string>
  icon: typeof Gavel
  count?: 'claims' | 'comments' | 'reports'
}[] = [
  {
    title: '认领审批',
    desc: '作者认领存量文章',
    to: '/admin/people',
    search: { section: 'claims' },
    icon: FileSignature,
    count: 'claims',
  },
  {
    title: '评论审核',
    desc: '待看、通过、不通过',
    to: '/admin/content',
    search: { section: 'comments' },
    icon: MessageSquare,
    count: 'comments',
  },
  {
    title: '举报处理',
    desc: '讨论、评论与发布举报',
    to: '/admin/content',
    search: { section: 'reports' },
    icon: ShieldAlert,
    count: 'reports',
  },
]

const DOMAINS: {
  title: string
  desc: string
  to: string
  icon: typeof Gavel
}[] = [
  {
    title: '内容与讨论',
    desc: '公告、分区、评论审核、举报',
    to: '/admin/content',
    icon: Layers,
  },
  {
    title: '成员与权限',
    desc: '成员、角色、认领与封禁',
    to: '/admin/people',
    icon: Users,
  },
  {
    title: '积分规则',
    desc: '发放口径、每个动作的积分',
    to: '/admin/economy',
    icon: Coins,
  },
  {
    title: '系统与安全',
    desc: '健康检查、审计日志、迁移',
    to: '/admin/system',
    icon: Activity,
  },
]

function AdminDashboard() {
  const { user, isAuthenticated } = useAuth()
  const { data: claimsCount } = usePendingClaimsCount(isAuthenticated)
  const pendingClaims = claimsCount?.count ?? 0
  const { data: commentCounts } = useAdminCommentCounts(isAuthenticated)
  const pendingComments = commentCounts?.pending ?? 0
  const { data: openReports } = useQuery({
    queryKey: ['admin', 'reports', 'open', 'count'],
    queryFn: async () =>
      (await api.get('/forum/reports', { params: { status_filter: 'open' } })).data as unknown[],
    enabled: isAuthenticated,
    staleTime: 60_000,
  })
  const pendingReports = openReports?.length ?? 0
  const pendingTotal = pendingClaims + pendingComments + pendingReports

  return (
    <div className="w-full max-w-6xl space-y-8">
      <PageHeader
        title="站点总览"
        description={`${user?.username ?? '站务'}，先看要处理的，再进各域。`}
      />

      <Suspense
        fallback={
          <div
            className="h-[430px] animate-pulse rounded-lg border bg-muted/20"
            aria-label="正在加载站点数据"
          />
        }
      >
        <AdminAnalyticsPanel />
      </Suspense>

      <section>
        <div className="mb-3 flex items-end justify-between gap-3">
          <div>
            <p className="text-[10px] uppercase tracking-[0.24em] text-muted-foreground">
              TO DO
            </p>
            <h2 className="mt-1 font-serif text-xl tracking-tight">待处理</h2>
          </div>
          <span className="font-mono text-xs text-muted-foreground">
            {pendingTotal > 0 ? `共 ${pendingTotal} 项待处理` : '暂无待处理'}
          </span>
        </div>
        <div className="divide-y border-y">
          {PENDING_QUEUE.map((item) => {
            const count =
              item.count === 'claims'
                ? pendingClaims
                : item.count === 'comments'
                  ? pendingComments
                  : item.count === 'reports'
                    ? pendingReports
                    : null
            return (
              <Link
                key={item.title}
                to={item.to}
                search={item.search}
                className="group flex items-center gap-3 py-3.5 transition-colors hover:bg-primary/[0.03]"
              >
                <item.icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">{item.title}</span>
                  <span className="mt-0.5 block text-[11px] text-muted-foreground">
                    {item.desc}
                  </span>
                </span>
                {count !== null && count > 0 ? (
                  <Badge variant="destructive">{count}</Badge>
                ) : null}
                <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
              </Link>
            )
          })}
        </div>
      </section>

      <section>
        <div className="mb-3">
          <p className="text-[10px] uppercase tracking-[0.24em] text-muted-foreground">
            DOMAINS
          </p>
          <h2 className="mt-1 font-serif text-xl tracking-tight">四个管理域</h2>
        </div>
        <div className="divide-y border-y">
          {DOMAINS.map((item) => (
            <Link
              key={item.title}
              to={item.to}
              className="group flex items-center gap-3 py-4 transition-colors hover:bg-primary/[0.03]"
            >
              <item.icon className="h-4 w-4 shrink-0 text-primary" />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium">{item.title}</span>
                <span className="mt-0.5 block text-[11px] text-muted-foreground">
                  {item.desc}
                </span>
              </span>
              <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
            </Link>
          ))}
        </div>
      </section>
    </div>
  )
}
