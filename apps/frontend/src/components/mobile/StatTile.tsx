import type { ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import type { LucideIcon } from 'lucide-react'

// 移动端仪表盘数据块：2 列大块、整块可点跳转。与桌面 5 列小卡是完全不同的栅格。
export function StatTile({
  label,
  value,
  to,
  icon: Icon,
}: {
  label: string
  value: ReactNode
  to: string
  icon: LucideIcon
}) {
  return (
    <Link
      to={to}
      className="flex flex-col justify-between rounded-xl border bg-card p-4 transition active:scale-[0.98]"
    >
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">{label}</span>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </div>
      <div className="mt-3 text-2xl font-semibold tabular-nums">{value}</div>
    </Link>
  )
}
