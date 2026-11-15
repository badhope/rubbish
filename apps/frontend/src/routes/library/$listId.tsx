import { useState } from 'react'
import { createFileRoute, Link, redirect } from '@tanstack/react-router'
import { ChevronLeft, Pencil, Plus, Search, Trash2 } from 'lucide-react'
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
  beforeLoad: () => {
    if (!getAuthState().isAuthenticated) throw redirect({ to: '/login' })
  },
  component: LibraryListDetailPage,
})

function LibraryListDetailPage() {
  const { listId } = Route.useParams()
  const id = Number(listId)

  const { data, isLoading, isError, refetch } = useReadingList(id)
  const updateMut = useUpdateReadingList()
  const removeMut = useRemoveReadingListItem()
  const addMut = useAddReadingListItem()

  const [editOpen, setEditOpen] = useState(false)
  const [form, setForm] = useState({ name: '', description: '' })
  const [removeResourceId, setRemoveResourceId] = useState<number | null>(null)
  const [addOpen, setAddOpen] = useState(false)

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
        to="/library"
        className="mb-4 inline-flex items-center text-sm text-muted-foreground hover:text-primary"
      >
        <ChevronLeft className="mr-1 h-4 w-4" />
        返回列表
      </Link>

      <PageHeader
        title={data.name}
        description={data.description ?? undefined}
        actions={
          <>
            <Button variant="outline" onClick={openEdit}>
              <Pencil className="h-4 w-4" />
              编辑
            </Button>
            <Button onClick={() => setAddOpen(true)}>
              <Plus className="h-4 w-4" />
              添加资源
            </Button>
          </>
        }
      />

      {data.items.length === 0 ? (
        <EmptyState
          title="列表为空"
          description="点上方“添加资源”来收藏第一条内容。"
        />
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>标题</TableHead>
                  <TableHead className="w-20">类型</TableHead>
                  <TableHead>作者</TableHead>
                  <TableHead className="w-16">年份</TableHead>
                  <TableHead className="w-32">添加时间</TableHead>
                  <TableHead className="w-20">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.items.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell>
                      <Link
                        to="/catalog/$resourceId"
                        params={{ resourceId: String(item.resource_id) }}
                        className="font-medium hover:text-primary"
                      >
                        {item.resource.title}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{item.resource.type}</Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {item.resource.authors.join(', ')}
                    </TableCell>
                    <TableCell>{item.resource.year}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {new Date(item.added_at).toLocaleDateString()}
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setRemoveResourceId(item.resource_id)}
                      >
                        <Trash2 className="h-4 w-4" />
                        移除
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

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
            <DialogTitle>添加资源到列表</DialogTitle>
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
        title="移除资源"
        description="确定从列表中移除该资源吗？"
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
      toast.error('请输入有效的 resource_id')
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
          placeholder="搜索标题/作者/摘要"
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
        <p className="mb-2 text-xs text-muted-foreground">或直接输入 resource_id</p>
        <form onSubmit={onAddManual} className="flex gap-2">
          <Input
            type="number"
            placeholder="resource_id"
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
