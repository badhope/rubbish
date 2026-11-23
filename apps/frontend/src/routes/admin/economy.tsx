import { createFileRoute } from '@tanstack/react-router'
import { requireShopManagerGuard } from '@/lib/route-guards'
import PointsPage from '@/components/admin/pages/economy/points'

// 经验只作社区贡献值：后台只剩发放口径与规则，不再维护商店/账本。
export const Route = createFileRoute('/admin/economy')({
  beforeLoad: () => requireShopManagerGuard(),
  component: PointsPage,
})
