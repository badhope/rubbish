import { useEffect, type ReactNode } from 'react'
import { X } from 'lucide-react'

/**
 * 移动端底部抽屉。
 *
 * 移动端不用 Radix DropdownMenu：底部固定操作栏里的触发器距离视口下沿
 * 只有几十像素，Radix 计算出的可用高度会把菜单压成一条（实测 10px），
 * 用户点开三个点后什么都看不到。抽屉从底部整宽展开，不依赖定位计算。
 */
export function BottomSheet({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean
  onClose: () => void
  title?: string
  children: ReactNode
}) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = prev
      window.removeEventListener('keydown', onKey)
    }
  }, [open, onClose])

  if (!open) return null
  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label={title ?? '更多'}>
      <button
        type="button"
        aria-label="关闭"
        onClick={onClose}
        className="absolute inset-0 h-full w-full bg-black/50"
      />
      <div className="absolute inset-x-0 bottom-0 max-h-[80vh] overflow-y-auto rounded-t-2xl border-t bg-background p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] shadow-2xl">
        {title && (
          <div className="mb-3 flex items-center justify-between border-b pb-2">
            <p className="text-sm font-medium">{title}</p>
            <button type="button" onClick={onClose} aria-label="关闭" className="text-muted-foreground">
              <X className="h-5 w-5" />
            </button>
          </div>
        )}
        {children}
      </div>
    </div>
  )
}
