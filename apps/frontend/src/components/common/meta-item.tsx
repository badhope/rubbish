import type { ReactNode } from 'react'

/**
 * 详情页元数据的一行（label 左 / value 右）。
 *
 * 布局约束不是装饰，是修复项：label 用 shrink-0 保证不被挤压，
 * value 用 min-w-0 + truncate 保证超长 DOI / 时间戳截断而不是撑破卡片右缘。
 * （flex 子项默认 min-width:auto，没有 min-w-0 时 truncate 完全不生效）
 */
export function MetaItem({ label, value }: { label: string; value?: ReactNode }) {
  // 空值整行不渲染，避免出现只有标签没有内容的空行
  if (!value) return null
  return (
    <div className="flex justify-between gap-4 py-1.5 text-sm">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className="min-w-0 truncate text-right font-medium">{value}</span>
    </div>
  )
}
