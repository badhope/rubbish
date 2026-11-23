import { useEffect, useState } from 'react'
import { createFileRoute, Link, useLocation, useNavigate } from '@tanstack/react-router'
import { ChevronLeft, ChevronRight, Pencil, Plus, Search, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { getAuthState } from '@/lib/auth'
import {
  useAddReadingListItem,
  useReadingList,
  useRemoveReadingListItem,
  useResources,
  useUpdateReadingList,
} from '@/hooks/api/use-modules'
import type { ReadingListUpdate } from '@/lib/types'
import { typeLabel } from '@/lib/resource-labels'
import { extractError } from '@/lib/utils'
import { PageHeader } from '@/components/common/page-header'
import { ConfirmDialog } from '@/components/common/confirm-dialog'
import { EmptyState, ErrorState, Loading } from '@/components/common/state'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

export const Route = createFileRoute('/library/$listId')({
  // 不在路由层一刀切跳登录：公开合集允许游客直接读；只有私有列表（或未授权）
  // 才在组件内按可见性判断跳登录，并带上当前深链作为回跳目的地。
  component: LibraryListDetailPage,
})

function LibraryListDetailPage() {
  const { listId } = Route.useParams()
  const id = Number(listId)
  const navigate = useNavigate()
  const location = useLocation()
  const auth = getAuthState()

  const { data, isLoading, isError, error, refetch } = useReadingList(id)
  const updateMut = useUpdateReadingList()
  const removeMut = useRemoveReadingListItem()
  const addMut = useAddReadingListItem()

  const [editOpen, setEditOpen] = useState(false)
  const [form, setForm] = useState({ name: '', description: '' })
  const [removeResourceId, setRemoveResourceId] = useState<number | null>(null)
  const [addOpen, setAddOpen] = useState(false)

  // 私有列表且当前访客不是本人 → 回登录页，登录后回到这条深链。
  const isPrivate = Boolean(data && data.is_owner === false && data.visibility !== 'public')

  useEffect(() => {
    if (isPrivate) {
      void navigate({ to: '/login', search: { redirect: location.pathname } })
    }
  }, [isPrivate, navigate, location.pathname])

  // 未授权（401/403）：后端暂未透出公开态时，游客访问私有列表会落到这里，同样带回跳。
  useEffect(() => {
    if (isError && !auth.isAuthenticated) {
      const status = (error as { response?: { status?: number } } | null)?.response?.status
      if (status === 401 || status === 403) {
        void navigate({ to: '/login', search: { redirect: location.pathname } })
      }
    }
  }, [isError, error, auth.isAuthenticated, navigate, location.pathname])

  // 仅本人可编辑；后端未透出归属字段时默认按本人处理（旧行为）。
  const canEdit = data?.is_owner !== false

  const openEdit = () => {
    if (!data) return
    setForm({ name: data.name, description: data.description ?? '' })
    setEditOpen(true)
  }

  const onEdit = async (e: React.FormEvent) => {
    e.preventDefault()
    const body: ReadingListUpdate = {
      name: form.name,
      description: form.description || null,
    }
    try {
      await updateMut.mutateAsync({ id, body })
      toast.success('已更新')
      setEditOpen(false)
    } catch (err) {
      toast.error(extractError(err, '更新失败'))
    }
  }

  const onConfirmRemove = async () => {
    if (removeResourceId === null) return
    const resourceId = removeResourceId
    setRemoveResourceId(null)
    try {
      await removeMut.mutateAsync({ listId: id, resourceId })
      toast.success('已移除')
    } catch (err) {
      toast.error(extractError(err, '移除失败'))
    }
  }

  if (isLoading) return <Loading />
  if (isError || !data) {
    return (
      <ErrorState
        message="加载列表失败"
        onRetry={() => refetch()}
      />
    )
  }

  return (
    <div>
      <Link
        to="/me" search={{ tab: 'library' }}
        className="mb-4 inline-flex items-center text-sm text-muted-foreground hover:text-primary"
      >
        <ChevronLeft className="mr-1 h-4 w-4" />
        返回列表
      </Link>

      <PageHeader
        title={data.name}
        description={data.description ?? undefined}
        actions={
          canEdit ? (
            <>
              <Button variant="outline" onClick={openEdit}>
                <Pencil className="h-4 w-4" />
                编辑
              </Button>
              <Button onClick={() => setAddOpen(true)}>
                <Plus className="h-4 w-4" />
                添加作品
              </Button>
            </>
          ) : null
        }
      />

      {data.items.length === 0 ? (
        <EmptyState
          title="列表为空"
          description="点上方“添加作品”，收录第一条内容。"
        />
      ) : null}

      {data.items.length > 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          {data.items.length > 1 ? (
            <>
              <span className="text-xs text-muted-foreground">按上面的顺序连读，共 {data.items.length} 篇。</span>
              <div className="flex items-center gap-2">
                <Button
                  asChild
                  variant="outline"
                  size="sm"
                  className="disabled:pointer-events-none disabled:opacity-40"
                >
                  <Link
                    to="/catalog/$resourceId"
                    params={{ resourceId: String(data.items[0].resource_id) }}
                  >
                    <ChevronLeft className="h-3.5 w-3.5" />
                    第一篇
                  </Link>
                </Button>
                <Button
                  asChild
                  variant="outline"
                  size="sm"
                  className="disabled:pointer-events-none disabled:opacity-40"
                >
                  <Link
                    to="/catalog/$resourceId"
                    params={{ resourceId: String(data.items[data.items.length - 1].resource_id) }}
                  >
                    最后一篇
                    <ChevronRight className="h-3.5 w-3.5" />
                  </Link>
                </Button>
              </div>
            </>
          ) : (
            <span className="text-xs text-muted-foreground">共 {data.items.length} 篇。</span>
          )}
        </div>
      ) : null}

      {data.items.length > 0 ? (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12">顺序</TableHead>
                  <TableHead>标题</TableHead>
                  <TableHead className="w-20">类型</TableHead>
                  <TableHead>作者</TableHead>
                  <TableHead className="w-16">年份</TableHead>
                  <TableHead className="w-32">添加时间</TableHead>
                  <TableHead className="w-20">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.items.map((item, index) => (
                  <TableRow key={item.id}>
                    <TableCell className="tabular-nums text-muted-foreground">{index + 1}</TableCell>
                    <TableCell>
                      <Link
                        to="/catalog/$resourceId"
                        params={{ resourceId: String(item.resource_id) }}
                        className="break-words font-medium hover:text-primary"
                      >
                        {item.resource.title}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{typeLabel(item.resource.type)}</Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {item.resource.authors.join(', ')}
                    </TableCell>
                    <TableCell>{item.resource.year}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {new Date(item.added_at).toLocaleDateString()}
                    </TableCell>
                    <TableCell>
                      {canEdit ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setRemoveResourceId(item.resource_id)}
                        >
                          <Trash2 className="h-4 w-4" />
                          移除
                        </Button>
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ) : null}

      {/* 编辑列表 Dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>编辑列表</DialogTitle>
          </DialogHeader>
          <form onSubmit={onEdit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="edit-name">名称</Label>
              <Input
                id="edit-name"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-desc">描述</Label>
              <Textarea
                id="edit-desc"
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
              />
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setEditOpen(false)}
              >
                取消
              </Button>
              <Button type="submit" disabled={updateMut.isPending}>
                {updateMut.isPending ? '保存中…' : '保存'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* 添加资源 Dialog：内嵌迷你搜索 */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>把作品加入列表</DialogTitle>
          </DialogHeader>
          <AddResourceDialogBody
            existingIds={new Set(data.items.map((i) => i.resource_id))}
            addPending={addMut.isPending}
            onAdd={async (resourceId) => {
              try {
                await addMut.mutateAsync({ listId: id, body: { resource_id: resourceId } })
                toast.success('已添加')
              } catch (err) {
                toast.error(extractError(err, '添加失败'))
              }
            }}
            onDone={() => setAddOpen(false)}
          />
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={removeResourceId !== null}
        title="移除作品"
        description="确定从列表中移除这篇作品吗？"
        confirmText="移除"
        destructive
        onConfirm={onConfirmRemove}
        onOpenChange={(o) => !o && setRemoveResourceId(null)}
      />
    </div>
  )
}

interface AddResourceDialogBodyProps {
  existingIds: Set<number>
  addPending: boolean
  onAdd: (resourceId: number) => Promise<void>
  onDone: () => void
}

function AddResourceDialogBody({
  existingIds,
  addPending,
  onAdd,
  onDone,
}: AddResourceDialogBodyProps) {
  const [q, setQ] = useState('')
  const [committedQ, setCommittedQ] = useState('')
  const [manualId, setManualId] = useState('')
  const { data, isLoading, isError } = useResources({
    q: committedQ || undefined,
    page_size: 10,
  })

  const onSearch = (e: React.FormEvent) => {
    e.preventDefault()
    setCommittedQ(q.trim())
  }

  const onAddManual = async (e: React.FormEvent) => {
    e.preventDefault()
    const resourceId = Number(manualId)
    if (!resourceId || Number.isNaN(resourceId)) {
      toast.error('请输入有效的作品编号')
      return
    }
    await onAdd(resourceId)
    setManualId('')
  }

  const onPick = async (resourceId: number) => {
    await onAdd(resourceId)
  }

  return (
    <div className="space-y-4">
      <form onSubmit={onSearch} className="flex gap-2">
        <Input
          placeholder="标题/作者/开头"
          aria-label="在合集内搜索作品"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <Button type="submit" variant="outline" size="sm">
          <Search className="h-4 w-4" />
          搜索
        </Button>
      </form>

      {committedQ && (
        <div className="max-h-64 space-y-2 overflow-y-auto rounded-md border p-2">
          {isLoading ? (
            <Loading />
          ) : isError ? (
            <p className="text-sm text-destructive">搜索失败</p>
          ) : !data || data.data.length === 0 ? (
            <p className="text-sm text-muted-foreground">无匹配结果</p>
          ) : (
            data.data.map((r) => {
              const added = existingIds.has(r.id)
              return (
                <div
                  key={r.id}
                  className="flex items-center justify-between gap-2 rounded-sm px-2 py-1.5 hover:bg-accent"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{r.title}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {r.authors.join(', ')} · {r.year}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant={added ? 'secondary' : 'outline'}
                    disabled={added || addPending}
                    onClick={() => onPick(r.id)}
                  >
                    {added ? '已添加' : '添加'}
                  </Button>
                </div>
              )
            })
          )}
        </div>
      )}

      <div className="border-t pt-4">
        <p className="mb-2 text-xs text-muted-foreground">或直接输入作品编号</p>
        <form onSubmit={onAddManual} className="flex gap-2">
          <Input
            type="number"
            placeholder="作品编号"
            aria-label="输入作品编号添加到合集"
            value={manualId}
            onChange={(e) => setManualId(e.target.value)}
          />
          <Button type="submit" size="sm" disabled={addPending}>
            添加
          </Button>
        </form>
      </div>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>
          完成
        </Button>
      </DialogFooter>
    </div>
  )
}
