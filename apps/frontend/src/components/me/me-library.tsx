import { useState, type FormEvent } from 'react'
import { Link } from '@tanstack/react-router'
import { ArrowRight, BookMarked, Globe2, Library, Lock, MoreVertical, Pencil, Plus, Trash2, Users } from 'lucide-react'
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
import { VisibilityChoice } from '@/components/common/visibility-choice'
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
import { MeFollows } from './me-follows'
import { MeReadingHistory } from './me-reading-history'
import { MeRecommendations } from './me-recommendations'
import { MeBookmarks } from './me-bookmarks'
import { shortDate } from './format'

interface ListFormState {
  name: string
  description: string
  visibility: 'public' | 'private'
}

function LibrarySectionNav({ active }: { active: 'library' | 'bookmarks' | 'history' | 'following' | 'recommendations' }) {
  return (
    <div className="grid grid-cols-2 gap-2 border-b pb-3 sm:flex sm:flex-wrap">
      <Button variant={active === 'library' ? 'default' : 'outline'} size="sm" className="w-full sm:w-auto" asChild>
        <Link to="/me" search={{ tab: 'library' }}>
          阅读列表
        </Link>
      </Button>
      <Button variant={active === 'bookmarks' ? 'default' : 'outline'} size="sm" className="w-full sm:w-auto" asChild>
        <Link to="/me" search={{ tab: 'library', section: 'bookmarks' }}>
          帖子收藏
        </Link>
      </Button>
      <Button variant={active === 'history' ? 'default' : 'outline'} size="sm" className="w-full sm:w-auto" asChild>
        <Link to="/me" search={{ tab: 'library', section: 'history' }}>
          最近阅读
        </Link>
      </Button>
      <Button variant={active === 'following' ? 'default' : 'outline'} size="sm" className="w-full sm:w-auto" asChild>
        <Link to="/me" search={{ tab: 'library', section: 'following' }}>
          关注与订阅
        </Link>
      </Button>
      <Button variant={active === 'recommendations' ? 'default' : 'outline'} size="sm" className="w-full sm:w-auto" asChild>
        <Link to="/me" search={{ tab: 'library', section: 'recommendations' }}>
          为你推荐
        </Link>
      </Button>
    </div>
  )
}

export function MeLibrary({ section }: { section?: string }) {
  const isBookmarks = section === 'bookmarks'
  const isHistory = section === 'history'
  const isFollowing = section === 'following'
  const isRecommendations = section === 'recommendations'
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
  const [form, setForm] = useState<ListFormState>({
    name: '',
    description: '',
    visibility: 'private',
  })

  if (isBookmarks) {
    return (
      <div className="space-y-5">
        <LibrarySectionNav active="bookmarks" />
        <MeBookmarks />
      </div>
    )
  }

  if (isHistory) {
    return (
      <div className="space-y-5">
        <LibrarySectionNav active="history" />
        <MeReadingHistory />
      </div>
    )
  }

  if (isFollowing) {
    return (
      <div className="space-y-5">
        <LibrarySectionNav active="following" />
        <MeFollows />
      </div>
    )
  }

  if (isRecommendations) {
    return (
      <div className="space-y-5">
        <LibrarySectionNav active="recommendations" />
        <MeRecommendations />
      </div>
    )
  }

  if (lists.isLoading) return <Loading />
  if (lists.isError) return <ErrorState message="加载收藏失败" onRetry={() => lists.refetch()} />

  const rows = lists.data?.data ?? []

  const openCreate = () => {
    setForm({ name: '', description: '', visibility: 'private' })
    setCreateOpen(true)
  }

  const openEdit = (list: ReadingListResponse) => {
    setEditTarget(list)
    setForm({
      name: list.name,
      description: list.description ?? '',
      visibility: list.visibility === 'public' ? 'public' : 'private',
    })
  }

  const onCreate = async (event: FormEvent) => {
    event.preventDefault()
    try {
      await createMut.mutateAsync({
        name: form.name,
        description: form.description || null,
        visibility: form.visibility,
      })
      toast.success(form.visibility === 'public' ? '已创建并公开' : '已创建')
      setCreateOpen(false)
      setPage(1)
    } catch (error) {
      toast.error(extractError(error, '创建失败'))
    }
  }

  const onEdit = async (event: FormEvent) => {
    event.preventDefault()
    if (!editTarget) return
    const body: ReadingListUpdate = {
      name: form.name,
      description: form.description || null,
      visibility: form.visibility,
    }
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
      <LibrarySectionNav active="library" />
      <section>
        <div className="flex flex-wrap items-end justify-between gap-3 border-b pb-4">
          <div>
            <p className="text-[10px] uppercase tracking-[0.24em] text-muted-foreground">LIBRARY</p>
            <h2 className="mt-1 font-serif text-xl tracking-tight">阅读列表</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              共 {lists.data?.meta.total ?? 0} 个列表 · 可新建、编辑和删除；公开后别人也能连读
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="ghost" asChild>
              <Link to="/library">
                <Globe2 className="h-3.5 w-3.5" />
                公开列表
              </Link>
            </Button>
            <Button size="sm" onClick={openCreate}>
              <Plus className="h-3.5 w-3.5" />
              新建列表
            </Button>
          </div>
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
                    <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                      {list.visibility === 'public' ? (
                        <span className="inline-flex items-center gap-1 text-primary">
                          <Globe2 className="h-3 w-3" />
                          公开
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1">
                          <Lock className="h-3 w-3" />
                          私有
                        </span>
                      )}
                      <span aria-hidden>·</span>
                      <span>{list.item_count} 篇</span>
                      <span aria-hidden>·</span>
                      <span>更新于 {shortDate(list.updated_at)}</span>
                      {list.description ? <span className="truncate">· {list.description}</span> : null}
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
        <div className="flex flex-wrap items-center justify-between gap-3 border-b py-4">
          <div className="flex items-center gap-3">
            <Users className="h-4 w-4 shrink-0 text-muted-foreground" />
            <div>
              <p className="text-[10px] uppercase tracking-[0.24em] text-muted-foreground">
                FOLLOWING
              </p>
              <p className="mt-0.5 text-sm">
                关注与订阅
                <span className="ml-2 text-xs text-muted-foreground">
                  {authors.isLoading ? '加载中…' : `${authors.data?.data.length ?? 0} 位作者`}
                  {' · '}
                  {disciplines.isLoading ? '加载中…' : `${disciplines.data?.data.length ?? 0} 个话题`}
                </span>
              </p>
            </div>
          </div>
          <Button variant="ghost" size="sm" asChild>
            <Link to="/me" search={{ tab: 'library', section: 'following' }}>
              管理关注
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </Button>
        </div>
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
            <VisibilityChoice
              idPrefix="me-list-create"
              value={form.visibility}
              onChange={(visibility) => setForm({ ...form, visibility })}
            />
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
            <VisibilityChoice
              idPrefix="me-list-edit"
              value={form.visibility}
              onChange={(visibility) => setForm({ ...form, visibility })}
            />
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
