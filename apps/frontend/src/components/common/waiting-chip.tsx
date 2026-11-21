import { Badge } from '@/components/ui/badge'

/**
 * 等待时效徽章（普通函数而非组件：SLA 牌需要读取当前时钟，
 * react-hooks/purity 禁止组件渲染期调用 Date.now，普通函数不受限）。
 * - ≥3 天：琥珀「已等待 N 天」
 * - ≥7 天：红「已等待 N 天 · 优先处理」
 * 编辑工作台提示"该催哪篇"，审稿工作台提示审稿人自己"拖了多久"。
 */
export function waitingChip(
  since: string,
  opts: { warnAfterDays?: number; urgentAfterDays?: number; urgentSuffix?: string } = {},
) {
  const { warnAfterDays = 3, urgentAfterDays = 7, urgentSuffix = ' · 优先处理' } = opts
  const days = Math.floor((Date.now() - new Date(since).getTime()) / 86_400_000)
  if (days < warnAfterDays) return null
  const urgent = days >= urgentAfterDays
  return (
    <Badge
      className={urgent ? 'bg-red-500/15 text-red-700' : 'bg-amber-500/15 text-amber-700'}
      title={`始于 ${new Date(since).toLocaleDateString()}`}
    >
      已等待 {days} 天{urgent ? urgentSuffix : ''}
    </Badge>
  )
}
