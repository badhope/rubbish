import { AlertTriangle, CheckCircle2, XCircle } from 'lucide-react'
import type { AdminPreflightResponse } from '@/lib/types'

/** 保存前检查的只读结果。调用方负责发请求与拦截 fail。 */
export function PreflightResults({ result }: { result: AdminPreflightResponse | null }) {
  if (!result) return null
  return (
    <div className="space-y-2.5">
      <p className="text-xs font-medium">{result.summary}</p>
      {result.items.map((item) => {
        const Icon =
          item.status === 'ok' ? CheckCircle2 : item.status === 'warn' ? AlertTriangle : XCircle
        const tone =
          item.status === 'ok'
            ? 'text-emerald-700'
            : item.status === 'warn'
              ? 'text-amber-700'
              : 'text-destructive'
        return (
          <div key={item.key} className="flex items-start gap-2 rounded-lg border px-3 py-2">
            <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${tone}`} />
            <div className="min-w-0">
              <p className="text-xs font-medium">{item.label}</p>
              <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
                {item.detail}
              </p>
            </div>
          </div>
        )
      })}
    </div>
  )
}
