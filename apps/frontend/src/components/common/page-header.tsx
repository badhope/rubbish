import type { ReactNode } from 'react'

interface Props {
  title: string
  description?: string
  actions?: ReactNode
  /** cover：用于目录封面屏，标题和说明比普通内页大一档。 */
  size?: 'default' | 'cover'
}

// 页面标题区，所有列表/详情页统一头部
// 窄屏 flex-col：标题在上，actions 在下左对齐；sm+ 横排右对齐
export function PageHeader({ title, description, actions, size = 'default' }: Props) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
      <div className="min-w-0">
        <span className="page-title-rule" aria-hidden="true" />
        <h1
          className={
            size === 'cover'
              ? 'section-title text-[2rem] font-semibold leading-tight tracking-tight sm:text-[2.65rem]'
              : 'section-title type-page font-semibold'
          }
        >
          {title}
        </h1>
        {description && (
          <p
            className={
              size === 'cover'
                ? 'mt-2 max-w-2xl text-[15px] leading-7 text-muted-foreground sm:text-base sm:leading-8'
                : 'mt-1 text-sm text-muted-foreground'
            }
          >
            {description}
          </p>
        )}
      </div>
      {actions && (
        <div className="flex items-center gap-2 sm:shrink-0">{actions}</div>
      )}
    </div>
  )
}
