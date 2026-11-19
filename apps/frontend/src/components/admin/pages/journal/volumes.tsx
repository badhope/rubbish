import { useMemo, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { CalendarDays, ChevronDown, ChevronRight, FilePlus2, Pencil, Plus, Search } from 'lucide-react'
import {
  useCreateIssue,
  useDeleteIssue,
  useCreateVolume,
  useJournalVolumes,
  usePublishIssueContainer,
  useUpdateIssue,
  useUpdateVolume,
} from '@/hooks/api/use-modules'
import { PageHeader } from '@/components/common/page-header'
import { EmptyState, ErrorState, Loading } from '@/components/common/state'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
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
import type { JournalIssue, JournalVolume } from '@/lib/types'
import { toast } from 'sonner'

const STATUS_LABEL: Record<string, string> = {
  draft: '草稿',
  scheduled: '已排期',
  live: '已上线',
  archived: '已归档',
}

function statusVariant(status: string) {
  if (status === 'live') return 'default' as const
  if (status === 'scheduled') return 'secondary' as const
  return 'outline' as const
}

function formatDate(value: string | null) {
  if (!value) return '未设置'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString('zh-CN')
}

interface VolumeForm {
  number: string
  title: string
  year: string
  description: string
  coverImage: string
}

interface IssueForm {
  number: string
  title: string
  intro: string
  coverImage: string
  status: JournalIssue['status']
  publishAt: string
}

const EMPTY_VOLUME: VolumeForm = { number: '', title: '', year: '', description: '', coverImage: '' }
const EMPTY_ISSUE: IssueForm = { number: '', title: '', intro: '', coverImage: '', status: 'draft', publishAt: '' }

export default function AdminVolumesPage({ initialVolume }: { initialVolume?: string }) {
  const [query, setQuery] = useState('')
  const [expanded, setExpanded] = useState<Set<number>>(() => new Set())
  const [volumeDialog, setVolumeDialog] = useState<{ mode: 'create' | 'edit'; volume?: JournalVolume } | null>(null)
  const [volumeForm, setVolumeForm] = useState<VolumeForm>(EMPTY_VOLUME)
  const [issueDialog, setIssueDialog] = useState<{ mode: 'create' | 'edit'; volume: JournalVolume; issue?: JournalIssue } | null>(null)
  const [issueForm, setIssueForm] = useState<IssueForm>(EMPTY_ISSUE)

  const { data: volumes = [], isLoading, isError, refetch } = useJournalVolumes()
  const createVolume = useCreateVolume()
  const updateVolume = useUpdateVolume()
  const createIssue = useCreateIssue()
  const updateIssue = useUpdateIssue()
  const publishIssue = usePublishIssueContainer()
  const deleteIssue = useDeleteIssue()

  const q = query.trim().toLowerCase()
  const filtered = useMemo(() => {
    if (!q) return volumes
    return volumes.filter(
      (volume) =>
        volume.number.toLowerCase().includes(q) ||
        (volume.title ?? '').toLowerCase().includes(q) ||
        volume.issues.some(
          (issue) =>
            issue.number.toLowerCase().includes(q) || (issue.title ?? '').toLowerCase().includes(q),
        ),
    )
  }, [volumes, q])

  const toggle = (id: number) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const openCreateVolume = () => {
    setVolumeForm(EMPTY_VOLUME)
    setVolumeDialog({ mode: 'create' })
  }

  const openEditVolume = (volume: JournalVolume) => {
    setVolumeForm({
      number: volume.number,
      title: volume.title ?? '',
      year: volume.year ? String(volume.year) : '',
      description: volume.description ?? '',
      coverImage: volume.coverImage ?? '',
    })
    setVolumeDialog({ mode: 'edit', volume })
  }

  const openCreateIssue = (volume: JournalVolume) => {
    setIssueForm(EMPTY_ISSUE)
    setIssueDialog({ mode: 'create', volume })
  }

  const openEditIssue = (volume: JournalVolume, issue: JournalIssue) => {
    setIssueForm({
      number: issue.number,
      title: issue.title ?? '',
      intro: issue.intro ?? '',
      coverImage: issue.coverImage ?? '',
      status: issue.status,
      publishAt: issue.publishAt ? issue.publishAt.slice(0, 16) : '',
    })
    setIssueDialog({ mode: 'edit', volume, issue })
  }

  const submitVolume = async () => {
    const number = volumeForm.number.trim()
    if (!number) {
      toast.error('请填写卷号')
      return
    }
    const payload = {
      number,
      title: volumeForm.title.trim() || null,
      year: volumeForm.year.trim() ? Number(volumeForm.year) : null,
      description: volumeForm.description.trim() || null,
      cover_image: volumeForm.coverImage.trim() || null,
    }
    try {
      if (volumeDialog?.mode === 'edit' && volumeDialog.volume) {
        await updateVolume.mutateAsync({ id: volumeDialog.volume.id, ...payload })
        toast.success('卷信息已更新')
      } else {
        await createVolume.mutateAsync(payload)
        toast.success('卷已创建，可以继续新建期')
      }
      setVolumeDialog(null)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '保存失败')
    }
  }

  const submitIssue = async () => {
    if (!issueDialog) return
    const number = issueForm.number.trim()
    if (!number) {
      toast.error('请填写期号')
      return
    }
    if (issueForm.status === 'scheduled' && !issueForm.publishAt) {
      toast.error('排期期必须填写上线时间')
      return
    }
    const payload = {
      number,
      title: issueForm.title.trim() || null,
      intro: issueForm.intro.trim() || null,
      cover_image: issueForm.coverImage.trim() || null,
      status: issueForm.status,
      publish_at: issueForm.publishAt ? new Date(issueForm.publishAt).toISOString() : null,
    }
    try {
      if (issueDialog.mode === 'edit' && issueDialog.issue) {
        await updateIssue.mutateAsync({ id: issueDialog.issue.id, ...payload })
        toast.success('期信息已更新')
      } else {
        await createIssue.mutateAsync({ volumeId: issueDialog.volume.id, ...payload })
        toast.success('期已创建，可以开始移入文章')
      }
      setIssueDialog(null)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '保存失败')
    }
  }

  const deleteEmpty = async (issue: JournalIssue) => {
    if (!window.confirm(`删除第 ${issue.number} 期？只有空期可以删除，期号和期信息会一并移除。`)) return
    try {
      await deleteIssue.mutateAsync(issue.id)
      toast.success('空期已删除')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '删除失败')
    }
  }

  const publish = async (issue: JournalIssue) => {
    if (
      !window.confirm(
        `将「${issue.title || `第 ${issue.number} 期`}」标记为已上线？只会改变期容器状态，不会自动通过任何未录用的文章。`,
      )
    ) {
      return
    }
    try {
      await publishIssue.mutateAsync(issue.id)
      toast.success('期已标记为上线')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '发布失败')
    }
  }

  return (
    <div>
      <PageHeader
        title="卷期"
        description="先建卷，再建期。期可以先空着，文章随后移入；期状态只管容器，不代替论文录用与发布门禁。"
        actions={
          <Button onClick={openCreateVolume} size="sm">
            <Plus className="mr-1 h-4 w-4" />
            新建卷
          </Button>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1 sm:max-w-sm">
          <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索卷号、卷名、期号"
            className="pl-8"
          />
        </div>
        <Badge variant="secondary">{volumes.length} 卷</Badge>
        <Badge variant="outline">
          {volumes.reduce((sum, volume) => sum + volume.issueCount, 0)} 期
        </Badge>
      </div>

      {isLoading ? (
        <Loading />
      ) : isError ? (
        <ErrorState message="加载卷期失败" onRetry={() => refetch()} />
      ) : filtered.length === 0 ? (
        <EmptyState
          title="还没有卷"
          description="新建一卷后，再为它建期。空期也可以先建，文章可以从资源录入或期详情里移入。"
          action={
            <Button onClick={openCreateVolume} size="sm">
              <Plus className="mr-1 h-4 w-4" />
              新建第一卷
            </Button>
          }
        />
      ) : (
        <div className="space-y-3">
          {filtered.map((volume) => {
            const open = expanded.has(volume.id) || Boolean(q) || initialVolume === volume.number
            return (
              <Card key={volume.id} className="overflow-hidden">
                <CardHeader className="cursor-pointer select-none pb-3" onClick={() => toggle(volume.id)}>
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                        {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                        <span>第 {volume.number} 卷</span>
                        {volume.title ? (
                          <span className="truncate text-sm font-normal text-muted-foreground">
                            {volume.title}
                          </span>
                        ) : null}
                        {volume.year ? <Badge variant="outline">{volume.year}</Badge> : null}
                      </CardTitle>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {volume.issueCount} 期 · {volume.articleCount} 篇文章
                        {volume.description ? ` · ${volume.description}` : ''}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-wrap items-center gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={(event) => {
                          event.stopPropagation()
                          openEditVolume(volume)
                        }}
                      >
                        <Pencil className="mr-1 h-3.5 w-3.5" />
                        编辑卷
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={(event) => {
                          event.stopPropagation()
                          openCreateIssue(volume)
                        }}
                      >
                        <FilePlus2 className="mr-1 h-3.5 w-3.5" />
                        新建期
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                {open ? (
                  <CardContent className="pt-0">
                    {volume.issues.length === 0 ? (
                      <div className="rounded-md border border-dashed px-3 py-6 text-center text-sm text-muted-foreground">
                        这一卷还没有期。先建一个空期，再把文章移进来。
                      </div>
                    ) : (
                      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                        {volume.issues.map((issue) => (
                          <div
                            key={issue.id}
                            className="flex min-w-0 flex-col rounded-lg border bg-muted/20 p-3"
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <p className="truncate text-sm font-medium">
                                  第 {volume.number} 卷第 {issue.number} 期
                                </p>
                                <p className="mt-0.5 truncate text-xs text-muted-foreground">
                                  {issue.title || '未命名期'}
                                </p>
                              </div>
                              <Badge variant={statusVariant(issue.status)} className="shrink-0">
                                {STATUS_LABEL[issue.status] ?? issue.status}
                              </Badge>
                            </div>
                            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                              <span>{issue.articleCount} 篇</span>
                              <span className="inline-flex items-center gap-1">
                                <CalendarDays className="h-3.5 w-3.5" />
                                {issue.status === 'scheduled' ? formatDate(issue.publishAt) : formatDate(issue.publishedAt)}
                              </span>
                            </div>
                            <div className="mt-3 flex flex-wrap items-center gap-1">
                              <Button variant="ghost" size="sm" onClick={() => openEditIssue(volume, issue)}>
                                <Pencil className="mr-1 h-3.5 w-3.5" />
                                编辑
                              </Button>
                              <Button variant="ghost" size="sm" asChild>
                                <Link
                                  to="/admin/issues/$volume/$issue"
                                  params={{ volume: volume.number, issue: issue.number }}
                                >
                                  文章与分部
                                </Link>
                              </Button>
                              {issue.status !== 'live' ? (
                                <Button variant="ghost" size="sm" onClick={() => void publish(issue)}>
                                  标记上线
                                </Button>
                              ) : null}
                              {issue.articleCount === 0 ? (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => void deleteEmpty(issue)}
                                  disabled={deleteIssue.isPending}
                                >
                                  删除空期
                                </Button>
                              ) : null}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                ) : null}
              </Card>
            )
          })}
        </div>
      )}

      <Dialog open={Boolean(volumeDialog)} onOpenChange={(open) => !open && setVolumeDialog(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{volumeDialog?.mode === 'edit' ? '编辑卷' : '新建卷'}</DialogTitle>
            <DialogDescription>卷是期的上级；先有卷，才能建期。</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="volume-number">卷号</Label>
              <Input
                id="volume-number"
                value={volumeForm.number}
                onChange={(event) => setVolumeForm((prev) => ({ ...prev, number: event.target.value }))}
                placeholder="如 10、S1"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="volume-title">卷名（可选）</Label>
              <Input
                id="volume-title"
                value={volumeForm.title}
                onChange={(event) => setVolumeForm((prev) => ({ ...prev, title: event.target.value }))}
                placeholder="如 2026 年秋季卷"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="volume-year">年份（可选）</Label>
              <Input
                id="volume-year"
                inputMode="numeric"
                value={volumeForm.year}
                onChange={(event) => setVolumeForm((prev) => ({ ...prev, year: event.target.value }))}
                placeholder="2026"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="volume-description">卷导语（可选）</Label>
              <Textarea
                id="volume-description"
                value={volumeForm.description}
                onChange={(event) => setVolumeForm((prev) => ({ ...prev, description: event.target.value }))}
                rows={3}
                placeholder="一句话说明这一卷的主题"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="volume-cover">封面图地址（可选）</Label>
              <Input
                id="volume-cover"
                value={volumeForm.coverImage}
                onChange={(event) => setVolumeForm((prev) => ({ ...prev, coverImage: event.target.value }))}
                placeholder="https://… 或 /uploads/…"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setVolumeDialog(null)}>
              取消
            </Button>
            <Button onClick={() => void submitVolume()} disabled={createVolume.isPending || updateVolume.isPending}>
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(issueDialog)} onOpenChange={(open) => !open && setIssueDialog(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{issueDialog?.mode === 'edit' ? '编辑期' : '新建期'}</DialogTitle>
            <DialogDescription>
              {issueDialog ? `第 ${issueDialog.volume.number} 卷` : ''} · 期可以先空着，文章稍后移入。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="issue-number">期号</Label>
                <Input
                  id="issue-number"
                  value={issueForm.number}
                  onChange={(event) => setIssueForm((prev) => ({ ...prev, number: event.target.value }))}
                  placeholder="如 2"
                />
              </div>
              <div className="space-y-1.5">
                <Label>状态</Label>
                <Select
                  value={issueForm.status}
                  onValueChange={(value) =>
                    setIssueForm((prev) => ({ ...prev, status: value as JournalIssue['status'] }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="draft">草稿</SelectItem>
                    <SelectItem value="scheduled">已排期</SelectItem>
                    <SelectItem value="live">已上线</SelectItem>
                    <SelectItem value="archived">已归档</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="issue-title">期名（可选）</Label>
              <Input
                id="issue-title"
                value={issueForm.title}
                onChange={(event) => setIssueForm((prev) => ({ ...prev, title: event.target.value }))}
                placeholder="如 荒诞特刊"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="issue-intro">期导语（可选）</Label>
              <Textarea
                id="issue-intro"
                value={issueForm.intro}
                onChange={(event) => setIssueForm((prev) => ({ ...prev, intro: event.target.value }))}
                rows={3}
                placeholder="这一期的主题、选文说明"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="issue-cover">封面图地址（可选）</Label>
              <Input
                id="issue-cover"
                value={issueForm.coverImage}
                onChange={(event) => setIssueForm((prev) => ({ ...prev, coverImage: event.target.value }))}
                placeholder="https://… 或 /uploads/…"
              />
            </div>
            {issueForm.status === 'scheduled' || issueForm.status === 'live' ? (
              <div className="space-y-1.5">
                <Label htmlFor="issue-publish-at">
                  {issueForm.status === 'scheduled' ? '上线时间' : '上线时间（可选）'}
                </Label>
                <Input
                  id="issue-publish-at"
                  type="datetime-local"
                  value={issueForm.publishAt}
                  onChange={(event) => setIssueForm((prev) => ({ ...prev, publishAt: event.target.value }))}
                />
              </div>
            ) : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIssueDialog(null)}>
              取消
            </Button>
            <Button onClick={() => void submitIssue()} disabled={createIssue.isPending || updateIssue.isPending}>
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
