import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowUpDown, Pencil, Plus, Power, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

import { api } from '@/lib/api'
import { extractError } from '@/lib/utils'
import { PageHeader } from '@/components/common/page-header'
import { EmptyState, ErrorState, Loading } from '@/components/common/state'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'



interface AdminBoard {
  id: number
  parent_id: number | null
  slug: string
  name: string
  description: string | null
  sort_order: number
  is_active: boolean
}

interface BoardForm {
  id?: number
  parent_id: string
  slug: string
  name: string
  description: string
  sort_order: string
  is_active: boolean
}

const EMPTY_FORM: BoardForm = {
  parent_id: 'root',
  slug: '',
  name: '',
  description: '',
  sort_order: '0',
  is_active: true,
}

export default function AdminForumBoardsPage() {
  const qc = useQueryClient()
  const [editing, setEditing] = useState<BoardForm | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<AdminBoard | null>(null)

  const listQ = useQuery({
    queryKey: ['forum', 'admin', 'boards'],
    queryFn: async () => (await api.get('/forum/admin/boards')).data.data as AdminBoard[],
  })

  const rows = useMemo(() => listQ.data ?? [], [listQ.data])
  const withDepth = useMemo(() => {
    const byId = new Map(rows.map((b) => [b.id, b]))
    const depthOf = (b: AdminBoard): number => {
      let depth = 0
      let cursor: AdminBoard | undefined = b
      while (cursor?.parent_id) {
        cursor = byId.get(cursor.parent_id)
        depth += 1
        if (depth > 5) break
      }
      return depth
    }
    return [...rows]
      .sort((a, b) => a.sort_order - b.sort_order || a.id - b.id)
      .map((b) => ({ ...b, depth: depthOf(b) }))
  }, [rows])

  const saveMut = useMutation({
    mutationFn: async (form: BoardForm) => {
      const payload = {
        parent_id: form.parent_id === 'root' ? null : Number(form.parent_id),
        slug: form.slug.trim(),
        name: form.name.trim(),
        description: form.description.trim() || null,
        sort_order: Number(form.sort_order) || 0,
        is_active: form.is_active,
      }
      if (form.id) return (await api.patch(`/forum/admin/boards/${form.id}`, payload)).data
      return (await api.post('/forum/admin/boards', payload)).data
    },
    onSuccess: () => {
      toast.success('分区已保存')
      setEditing(null)
      void qc.invalidateQueries({ queryKey: ['forum'] })
    },
    onError: (err) => toast.error(extractError(err, '保存失败')),
  })

  const toggleMut = useMutation({
    mutationFn: async (board: AdminBoard) =>
      (await api.patch(`/forum/admin/boards/${board.id}`, { is_active: !board.is_active })).data,
    onSuccess: () => {
      toast.success('状态已切换')
      void qc.invalidateQueries({ queryKey: ['forum'] })
    },
    onError: (err) => toast.error(extractError(err, '没能切换分区状态，可再试一次')),
  })

  const deleteMut = useMutation({
    mutationFn: async (board: AdminBoard) => api.delete(`/forum/admin/boards/${board.id}`),
    onSuccess: () => {
      toast.success('空分区已删除')
      setDeleteTarget(null)
      void qc.invalidateQueries({ queryKey: ['forum'] })
    },
    onError: (err) => toast.error(extractError(err, '删除失败')),
  })

  return (
    <div>
      <PageHeader
        title="讨论分区"
        description="树形结构：父分区汇总，子分区承载内容。排序值越小越靠前；有子分区或主题帖的分区不能直接删除。"
        actions={
          <Button onClick={() => setEditing({ ...EMPTY_FORM })}>
            <Plus className="h-4 w-4" />
            新建分区
          </Button>
        }
      />

      {listQ.isLoading ? (
        <Loading />
      ) : listQ.isError ? (
        <ErrorState message="分区加载失败，可重试。" onRetry={() => listQ.refetch()} />
      ) : withDepth.length === 0 ? (
        <EmptyState title="还没有分区" description="先建一个父分区，再往下加子分区。" />
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="hidden grid-cols-[1fr_120px_90px_100px] gap-2 border-b px-4 py-2 text-xs font-medium text-muted-foreground sm:grid">
              <span>分区</span>
              <span>slug</span>
              <span>排序</span>
              <span className="text-right">操作</span>
            </div>
            <div className="divide-y">
              {withDepth.map((board) => (
                <div
                  key={board.id}
                  className="grid gap-2 px-4 py-3 sm:grid-cols-[1fr_120px_90px_100px] sm:items-center"
                >
                  <div style={{ paddingLeft: `${board.depth * 18}px` }}>
                    <div className="flex flex-wrap items-center gap-2">
                      {board.depth > 0 ? <span className="text-muted-foreground">└</span> : null}
                      <span className="font-medium">{board.name}</span>
                      {board.is_active ? (
                        <Badge variant="outline">启用</Badge>
                      ) : (
                        <Badge variant="secondary">停用</Badge>
                      )}
                    </div>
                    {board.description ? (
                      <p className="mt-0.5 text-xs text-muted-foreground">{board.description}</p>
                    ) : null}
                  </div>
                  <code className="text-xs text-muted-foreground">{board.slug}</code>
                  <span className="inline-flex items-center gap-1 text-xs tabular-nums text-muted-foreground">
                    <ArrowUpDown className="h-3 w-3" />
                    {board.sort_order}
                  </span>
                  <div className="flex items-center justify-end gap-1">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={board.is_active ? '停用分区' : '启用分区'}
                      onClick={() => toggleMut.mutate(board)}
                    >
                      <Power className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label="编辑分区"
                      onClick={() =>
                        setEditing({
                          id: board.id,
                          parent_id: board.parent_id ? String(board.parent_id) : 'root',
                          slug: board.slug,
                          name: board.name,
                          description: board.description ?? '',
                          sort_order: String(board.sort_order),
                          is_active: board.is_active,
                        })
                      }
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="text-destructive"
                      aria-label="删除分区"
                      onClick={() => setDeleteTarget(board)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Dialog open={Boolean(editing)} onOpenChange={(v) => !v && setEditing(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing?.id ? '编辑分区' : '新建分区'}</DialogTitle>
            <DialogDescription>
              父分区只做汇总，主题帖发到最具体的子分区；slug 用于 URL，创建后尽量别改。
            </DialogDescription>
          </DialogHeader>
          {editing ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="board-name">名称</Label>
                <Input
                  id="board-name"
                  value={editing.name}
                  onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                  maxLength={60}
                  placeholder="例如：失败复盘"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="board-slug">slug</Label>
                <Input
                  id="board-slug"
                  value={editing.slug}
                  onChange={(e) => setEditing({ ...editing, slug: e.target.value })}
                  maxLength={40}
                  placeholder="paper-reading"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="board-parent">父分区</Label>
                <Select
                  value={editing.parent_id}
                  onValueChange={(v) => setEditing({ ...editing, parent_id: v })}
                >
                  <SelectTrigger id="board-parent">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="root">无（一级分区）</SelectItem>
                    {withDepth
                      .filter((b) => b.id !== editing.id)
                      .map((b) => (
                        <SelectItem key={b.id} value={String(b.id)}>
                          {'　'.repeat(b.depth)}
                          {b.name}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="board-desc">说明</Label>
                <Textarea
                  id="board-desc"
                  value={editing.description}
                  onChange={(e) => setEditing({ ...editing, description: e.target.value })}
                  maxLength={200}
                  rows={2}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="board-sort">排序</Label>
                <Input
                  id="board-sort"
                  type="number"
                  min={0}
                  max={9999}
                  value={editing.sort_order}
                  onChange={(e) => setEditing({ ...editing, sort_order: e.target.value })}
                />
              </div>
              <div className="flex items-end">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={editing.is_active}
                    onChange={(e) => setEditing({ ...editing, is_active: e.target.checked })}
                  />
                  启用
                </label>
              </div>
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>
              取消
            </Button>
            <Button
              onClick={() => editing && saveMut.mutate(editing)}
              disabled={saveMut.isPending || !editing?.name.trim() || !editing?.slug.trim()}
            >
              {saveMut.isPending ? '保存中…' : '保存'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(deleteTarget)} onOpenChange={(v) => !v && setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>删除分区</DialogTitle>
            <DialogDescription>
              只能删除没有子分区、没有主题帖的空分区。确认删除「{deleteTarget?.name}」？
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>
              取消
            </Button>
            <Button
              variant="destructive"
              onClick={() => deleteTarget && deleteMut.mutate(deleteTarget)}
              disabled={deleteMut.isPending}
            >
              删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
