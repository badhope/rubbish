import { useState, type FormEvent } from 'react'
import { Link } from '@tanstack/react-router'
import { ArrowRight, BookMarked, Library, MoreVertical, Pencil, Plus, Trash2, Users } from 'lucide-react'
import { toast } from 'sonner'
import {
  useCreateReadingList,
  useDeleteReadingList,
  useMyFollowedAuthors,
  useMySubscribedDisciplines,
  useReadingLists,
  useUpdateReadingList,
} from '@/hooks/api/use-modules'
import type { ReadingListResponse, ReadingListUpdate } from '@/lib/types'
import { extractError } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Pagination } from '@/components/common/pagination'
import { ConfirmDialog } from '@/components/common/confirm-dialog'
import { ErrorState, Loading } from '@/components/common/state'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { shortDate } from './format'

interface ListFormState {
  name: string
  description: string
}

export function MeLibrary() {
  const [page, setPage] = useState(1)
  const lists = useReadingLists(page, 12)
  const authors = useMyFollowedAuthors(1, 12)
  const disciplines = useMySubscribedDisciplines()
  const createMut = useCreateReadingList()
  const updateMut = useUpdateReadingList()
  const deleteMut = useDeleteReadingList()

  const [createOpen, setCreateOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<ReadingListResponse | null>(null)
  const [deleteId, setDeleteId] = useState<number | null>(null)
  const [form, setForm] = useState<ListFormState>({ name: '', description: '' })

  if (lists.isLoading) return <Loading />
  if (lists.isError) return <ErrorState message="加载收藏失败" onRetry={() => lists.refetch()} />

  const rows = lists.data?.data ?? []

  const openCreate = () => {
    setForm({ name: '', description: '' })
    setCreateOpen(true)
  }

  const openEdit = (list: ReadingListResponse) => {
    setEditTarget(list)
    setForm({ name: list.name, description: list.description ?? '' })
  }

  const onCreate = async (event: FormEvent) => {
    event.preventDefault()
    try {
      await createMut.mutateAsync({ name: form.name, description: form.description || null })
      toast.success('已创建')
      setCreateOpen(false)
      setPage(1)
    } catch (error) {
      toast.error(extractError(error, '创建失败'))
    }
  }

  const onEdit = async (event: FormEvent) => {
    event.preventDefault()
    if (!editTarget) return
    const body: ReadingListUpdate = { name: form.name, description: form.description || null }
    try {
      await updateMut.mutateAsync({ id: editTarget.id, body })
      toast.success('已更新')
      setEditTarget(null)
    } catch (error) {
      toast.error(extractError(error, '更新失败'))
    }
  }

  const onConfirmDelete = async () => {
    if (deleteId === null) return
    const target = deleteId
    setDeleteId(null)
    try {
      await deleteMut.mutateAsync(target)
      toast.success('已删除')
    } catch (error) {
      toast.error(extractError(error, '删除失败'))
    }
  }

  return (
    <div className="space-y-8">
      <section>
        <div className="flex flex-wrap items-end justify-between gap-3 border-b pb-4">
          <div>
            <p className="text-[10px] uppercase tracking-[0.24em] text-muted-foreground">LIBRARY</p>
            <h2 className="mt-1 font-serif text-xl tracking-tight">阅读列表</h2>
            <p className="mt-1 text-xs text-muted-foreground">共 {lists.data?.meta.total ?? 0} 个列表 · 可新建、编辑和删除</p>
          </div>
          <Button size="sm" onClick={openCreate}>
            <Plus className="h-3.5 w-3.5" />
            新建列表
          </Button>
        </div>

        {rows.length === 0 ? (
          <div className="flex flex-col items-start gap-3 border-b py-8 text-sm text-muted-foreground">
            <span className="flex items-center gap-2">
              <Library className="h-4 w-4" />
              暂无阅读列表
            </span>
            <Button size="sm" variant="outline" onClick={openCreate}>
              新建第一个列表
            </Button>
          </div>
        ) : (
          <div className="divide-y">
            {rows.map((list) => (
              <div key={list.id} className="group flex items-center gap-3 py-3.5">
                <Link
                  to="/library/$listId"
                  params={{ listId: String(list.id) }}
                  className="flex min-w-0 flex-1 items-center gap-3 transition-colors hover:text-primary"
                >
                  <BookMarked className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{list.name}</span>
                    <span className="mt-0.5 block text-[11px] text-muted-foreground">
                      {list.item_count} 篇 · 更新于 {shortDate(list.updated_at)}
                      {list.description ? ` · ${list.description}` : ''}
                    </span>
                  </span>
                  <ArrowRight className="h-3.5 w-3.5 text-muted-foreground group-hover:text-primary" />
                </Link>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="sm" className="h-7 w-7 shrink-0 p-0" aria-label={`列表操作：${list.name}`}>
                      <MoreVertical className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => openEdit(list)}>
                      <Pencil className="h-4 w-4" />
                      编辑
                    </DropdownMenuItem>
                    <DropdownMenuItem className="text-destructive" onClick={() => setDeleteId(list.id)}>
                      <Trash2 className="h-4 w-4" />
                      删除
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            ))}
          </div>
        )}

        {lists.data && lists.data.meta.total_pages > 1 ? (
          <div className="pt-4">
            <Pagination page={lists.data.meta.page} totalPages={lists.data.meta.total_pages} onPageChange={setPage} />
          </div>
        ) : null}
      </section>

      <section>
        <div className="flex flex-wrap items-end justify-between gap-3 border-b pb-4">
          <div>
            <p className="text-[10px] uppercase tracking-[0.24em] text-muted-foreground">FOLLOWING</p>
            <h2 className="mt-1 font-serif text-xl tracking-tight">关注与订阅</h2>
          </div>
          <Button variant="ghost" size="sm" asChild>
            <Link to="/follows">
              管理关注
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </Button>
        </div>

        {authors.isLoading ? <Loading /> : null}
        {!authors.isLoading && (authors.data?.data.length ?? 0) > 0 ? (
          <div className="flex flex-wrap gap-x-5 gap-y-2 border-b py-4 text-sm">
            {authors.data?.data.map((item) => (
              <Link
                key={item.author_name}
                to="/u/$username"
                params={{ username: item.author_name }}
                className="inline-flex items-center gap-1.5 text-muted-foreground hover:text-primary"
              >
                <Users className="h-3.5 w-3.5" />
                {item.author_name}
              </Link>
            ))}
          </div>
        ) : null}
        {!authors.isLoading && (authors.data?.data.length ?? 0) === 0 ? (
          <p className="border-b py-4 text-sm text-muted-foreground">还没有关注作者。</p>
        ) : null}

        {!disciplines.isLoading && (disciplines.data?.data.length ?? 0) > 0 ? (
          <div className="flex flex-wrap gap-2 py-4">
            {disciplines.data?.data.map((discipline) => (
              <span key={discipline} className="border bg-muted/25 px-2 py-1 text-xs text-muted-foreground">
                {discipline}
              </span>
            ))}
          </div>
        ) : null}
        {!disciplines.isLoading && (disciplines.data?.data.length ?? 0) === 0 ? (
          <p className="py-4 text-sm text-muted-foreground">还没有订阅学科。</p>
        ) : null}
      </section>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>新建列表</DialogTitle>
          </DialogHeader>
          <form onSubmit={onCreate} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="me-list-name">名称</Label>
              <Input
                id="me-list-name"
                value={form.name}
                onChange={(event) => setForm({ ...form, name: event.target.value })}
                placeholder="如：深度学习必读"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="me-list-desc">描述（选填）</Label>
              <Textarea
                id="me-list-desc"
                value={form.description}
                onChange={(event) => setForm({ ...form, description: event.target.value })}
                placeholder="这个列表用于…"
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>
                取消
              </Button>
              <Button type="submit" disabled={createMut.isPending}>
                {createMut.isPending ? '创建中…' : '创建'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(editTarget)} onOpenChange={(open) => !open && setEditTarget(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>编辑列表</DialogTitle>
          </DialogHeader>
          <form onSubmit={onEdit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="me-edit-list-name">名称</Label>
              <Input
                id="me-edit-list-name"
                value={form.name}
                onChange={(event) => setForm({ ...form, name: event.target.value })}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="me-edit-list-desc">描述</Label>
              <Textarea
                id="me-edit-list-desc"
                value={form.description}
                onChange={(event) => setForm({ ...form, description: event.target.value })}
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setEditTarget(null)}>
                取消
              </Button>
              <Button type="submit" disabled={updateMut.isPending}>
                {updateMut.isPending ? '保存中…' : '保存'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={deleteId !== null}
        title="删除列表"
        description="确定删除这个阅读列表吗？此操作不可撤销。"
        confirmText="删除"
        destructive
        onConfirm={onConfirmDelete}
        onOpenChange={(open) => !open && setDeleteId(null)}
      />
    </div>
  )
}
