import { useState } from 'react'
import { toast } from 'sonner'
import {
  useAddReadingListItem,
  useCreateReadingList,
  useReadingLists,
} from '@/hooks/api/use-modules'
import { extractError } from '@/lib/utils'
import { Button } from '@/components/ui/button'
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
import { EmptyState, ErrorState, Loading } from '@/components/common/state'

/**
 * 把资源加入阅读列表：选已有列表或现场新建一个。
 *
 * 之前详情页与推荐页的「加入阅读列表」是禁用/占位按钮——后端
 * POST /reading-lists/{id}/items 早已可用，只是没有入口。这里补上入口，
 * 避免再出现"按钮点了没有任何反应"的假功能。
 */
export function AddToListDialog({
  resourceId,
  open,
  onOpenChange,
}: {
  resourceId: number
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const lists = useReadingLists(1, 50)
  const addMut = useAddReadingListItem()
  const createMut = useCreateReadingList()
  const [newName, setNewName] = useState('')
  const [creating, setCreating] = useState(false)

  const addTo = async (listId: number, listName: string) => {
    try {
      await addMut.mutateAsync({ listId, body: { resource_id: resourceId } })
      toast.success(`已加入「${listName}」`)
      onOpenChange(false)
    } catch (err) {
      toast.error(extractError(err, '加入失败'))
    }
  }

  const createAndAdd = async (e: React.FormEvent) => {
    e.preventDefault()
    const name = newName.trim()
    if (!name) return
    try {
      const created = await createMut.mutateAsync({ name })
      await addMut.mutateAsync({ listId: created.id, body: { resource_id: resourceId } })
      toast.success(`已新建「${name}」并加入`)
      setNewName('')
      setCreating(false)
      onOpenChange(false)
    } catch (err) {
      toast.error(extractError(err, '创建列表失败'))
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>加入阅读列表</DialogTitle>
          <DialogDescription>选择一个列表，或新建一个列表。</DialogDescription>
        </DialogHeader>

        {lists.isLoading ? (
          <Loading />
        ) : lists.isError ? (
          <ErrorState message="加载阅读列表失败" onRetry={() => lists.refetch()} />
        ) : !lists.data || lists.data.data.length === 0 ? (
          <div className="space-y-3">
            <EmptyState title="还没有阅读列表" description="新建一个列表来收藏这篇文献。" />
            <Button className="w-full" onClick={() => setCreating(true)}>
              新建列表
            </Button>
          </div>
        ) : (
          <ul className="max-h-64 space-y-2 overflow-y-auto">
            {lists.data.data.map((list) => (
              <li key={list.id}>
                <button
                  type="button"
                  onClick={() => void addTo(list.id, list.name)}
                  disabled={addMut.isPending}
                  className="flex w-full items-center justify-between rounded-md border px-3 py-2 text-left text-sm transition-colors hover:bg-muted disabled:opacity-60"
                >
                  <span className="truncate font-medium">{list.name}</span>
                  <span className="ml-3 shrink-0 text-xs text-muted-foreground">
                    {list.item_count} 篇
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}

        {creating ? (
          <form onSubmit={createAndAdd} className="space-y-3 border-t pt-3">
            <div className="space-y-2">
              <Label htmlFor="new-list-name">新列表名称</Label>
              <Input
                id="new-list-name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                maxLength={100}
                required
                autoFocus
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setCreating(false)}>
                取消
              </Button>
              <Button type="submit" disabled={createMut.isPending || addMut.isPending}>
                创建并加入
              </Button>
            </DialogFooter>
          </form>
        ) : (
          lists.data &&
          lists.data.data.length > 0 && (
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setCreating(true)}>
                新建列表
              </Button>
            </DialogFooter>
          )
        )}
      </DialogContent>
    </Dialog>
  )
}
