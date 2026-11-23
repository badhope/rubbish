import type { ReactNode } from 'react'

interface Props {
  title: string
  description?: string
  actions?: ReactNode
  /** cover：用于目录封面屏，标题和说明比普通内页大一档。 */
  size?: 'default' | 'cover'
  /** 页面内再分一层时用 2，避免同一页出现两个 h1。 */
  headingLevel?: 1 | 2
}

// 页面标题区，所有列表/详情页统一头部
// 窄屏 flex-col：标题在上，actions 在下左对齐；sm+ 横排右对齐
export function PageHeader({
  title,
  description,
  actions,
  size = 'default',
  headingLevel = 1,
}: Props) {
  const titleClass =
    size === 'cover'
      ? 'section-title text-[2rem] font-semibold leading-tight tracking-tight sm:text-[3rem]'
      : headingLevel === 2
        ? 'section-title text-xl font-semibold tracking-tight sm:text-2xl'
        : 'section-title type-page font-semibold'
  const titleNode =
    headingLevel === 2 ? (
      <h2 className={titleClass}>{title}</h2>
    ) : (
      <h1 className={titleClass}>{title}</h1>
    )

  return (
    <div
      className={
        size === 'cover'
          ? 'mb-8 flex flex-col items-center gap-3 text-center'
          : 'mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4'
      }
    >
      <div className={size === 'cover' ? 'mx-auto min-w-0' : 'min-w-0'}>
        {size !== 'cover' && headingLevel === 1 && (
          <span className="page-title-rule" aria-hidden="true" />
        )}
        {titleNode}
        {description && (
          <p
            className={
              size === 'cover'
                ? 'mx-auto mt-2 max-w-3xl text-[15px] leading-7 text-muted-foreground sm:text-base sm:leading-8'
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
