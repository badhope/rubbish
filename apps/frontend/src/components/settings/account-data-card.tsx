import { Download, FileJson2 } from 'lucide-react'
import { toast } from 'sonner'
import { useExportMyData } from '@/hooks/api/use-auth'
import { Button } from '@/components/ui/button'

function downloadJson(filename: string, payload: unknown) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

/** 把隐私页承诺的“导出全部个人数据”真正交到用户手里。 */
export function AccountDataCard({ username }: { username: string }) {
  const exportData = useExportMyData()

  return (
    <section className="border-y py-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <FileJson2 className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
          <div>
            <h3 className="text-sm font-medium">导出我的数据</h3>
            <p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted-foreground">
              下载一份 JSON：账号资料、投稿与审稿、阅读记录、书单、评论、讨论、申诉、认领、关注、活跃值与通知。
              密码哈希、两步验证密钥和通行密钥材料属于凭据，不会写进导出文件。
            </p>
          </div>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={exportData.isPending}
          onClick={() =>
            exportData.mutate(undefined, {
              onSuccess: (payload) => {
                const stamp = new Date().toISOString().slice(0, 10).replaceAll('-', '')
                downloadJson(`rubbish-${username}-${stamp}.json`, payload)
                toast.success('数据文件已生成，请检查浏览器下载')
              },
              onError: () => toast.error('导出失败，请稍后再试'),
            })
          }
        >
          <Download className="h-3.5 w-3.5" />
          {exportData.isPending ? '生成中…' : '导出我的数据'}
        </Button>
      </div>
    </section>
  )
}
