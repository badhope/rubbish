import { createFileRoute } from '@tanstack/react-router'
import { Info } from 'lucide-react'
import { requireAdminGuard } from '@/lib/route-guards'
import { useJournalSettings } from '@/hooks/api/use-modules'
import { PageHeader } from '@/components/common/page-header'
import { ErrorState, Loading } from '@/components/common/state'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export const Route = createFileRoute('/admin/journal')({
  beforeLoad: () => {
    requireAdminGuard()
  },
  component: AdminJournalPage,
})

function AdminJournalPage() {
  const { data, isLoading, isError, refetch } = useJournalSettings()

  return (
    <div>
      <PageHeader
        title="期刊信息"
        description="查看当前期刊的基本元数据。这些信息从资源记录中汇总提取。"
      />

      {isLoading ? (
        <Loading />
      ) : isError ? (
        <ErrorState message="加载期刊信息失败" onRetry={() => refetch()} />
      ) : (
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">期刊标识</CardTitle>
              <CardDescription>
                期刊层面的元数据，用于学术引用和数据库索引。
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="issn">ISSN</Label>
                <Input
                  id="issn"
                  value={data?.issn ?? ''}
                  readOnly
                  placeholder="未设置"
                  className="max-w-sm bg-muted/50"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="publisher">出版商</Label>
                <Input
                  id="publisher"
                  value={data?.publisher ?? ''}
                  readOnly
                  placeholder="未设置"
                  className="max-w-sm bg-muted/50"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="short_container_title">简称</Label>
                <Input
                  id="short_container_title"
                  value={data?.short_container_title ?? ''}
                  readOnly
                  placeholder="未设置"
                  className="max-w-sm bg-muted/50"
                />
              </div>
            </CardContent>
          </Card>

          <p className="flex items-start gap-2 rounded-md bg-muted p-3 text-xs text-muted-foreground">
            <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            <span>
              期刊元数据从已收录资源中自动提取。如需修改，请通过资源编辑页面
              更新各篇文章的 ISSN、出版商和简称字段，系统将自动反映最新值。
            </span>
          </p>
        </div>
      )}
    </div>
  )
}
