import { toast as sonnerToast } from 'sonner'
import { emitProblem } from '@/lib/problem'

let installed = false

function messageText(message: unknown): string {
  if (typeof message === 'string') return message
  if (typeof message === 'number') return String(message)
  if (message instanceof Error) return message.message
  return '操作没有完成，请查看页面提示。'
}

/**
 * Sonner is excellent for lightweight confirmations, but a 4-second toast in
 * the corner is not enough to explain a failed submission, a rejected upload,
 * or a rate-limited mail request. Patch only error/warning toasts so every
 * existing call site immediately gains the diagnostic card without a
 * mechanical rewrite of 190 call sites.
 */
export function installProblemToasts(): void {
  if (installed || typeof window === 'undefined') return
  installed = true

  const originalError = sonnerToast.error.bind(sonnerToast)
  sonnerToast.error = ((message: unknown, data?: unknown) => {
    emitProblem({
      source: 'toast',
      tone: 'error',
      title: '操作没有完成',
      message: messageText(message),
    })
    return originalError(message as never, data as never)
  }) as typeof sonnerToast.error

  const originalWarning = sonnerToast.warning.bind(sonnerToast)
  sonnerToast.warning = ((message: unknown, data?: unknown) => {
    emitProblem({
      source: 'toast',
      tone: 'warning',
      title: '需要注意',
      message: messageText(message),
    })
    return originalWarning(message as never, data as never)
  }) as typeof sonnerToast.warning
}
