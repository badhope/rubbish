import { useEffect, useState } from 'react'
import { MoreHorizontal, Plus, Search } from 'lucide-react'
import { toast } from 'sonner'
import {
  useAdminUsers,
  useAssignRole,
  useCreateAdminUser,
  useGrantUserXp,
  useRevokeRole,
  useSetUserActive,
  useSetUserAdmin,
  useUpdateUserAreas,
} from '@/hooks/api/use-modules'
import { useAuth } from '@/hooks/use-auth'
import type { AssignableRole, UserResponse } from '@/lib/types'
import { extractError, formatDateTime, inferTotalPagesFromFullPage } from '@/lib/utils'
import { roleLabel } from '@/lib/role-labels'
import { DisciplinePicker } from '@/components/settings/discipline-picker'
import { PageHeader } from '@/components/common/page-header'
import { ConfirmDialog } from '@/components/common/confirm-dialog'
import { Pagination } from '@/components/common/pagination'
import { EmptyState, ErrorState, Loading } from '@/components/common/state'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

const PAGE_SIZE = 50

// 与后端 ASSIGNABLE_ROLES 一致；admin 角色由 is_admin 控制，不在此处。
// 作者/读者是"身份"不是"角色"：读者=注册即得、作者=确认《作品规范》
// 即得，不由管理员手工分配（2026-11 收窄口径，授权只管内容整理线）。
const ASSIGNABLE_ROLES: AssignableRole[] = [
  'chief_editor',
  'deputy_editor',
  'board_editor',
  'reviewer',
  'senior_reviewer',
  'editor',
  'section_editor',
  'shop_manager',
]




export default function AdminUsersPage() {
  const [page, setPage] = useState(1)
  const [query, setQuery] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [createForm, setCreateForm] = useState({
    email: '',
    username: '',
    role: 'reviewer' as AssignableRole,
    note: '',
  })
  const [createError, setCreateError] = useState('')
  // 受控的「当前展开的那行菜单」。Radix 默认在 onSelect 时立即卸载菜单，
  // 而列表 mutation 又会 invalidate 重拉数据；键盘 Enter/Space 的 keyup
  // 常落在菜单卸载之后，Playwright 判定元素 detached 反复重试（E2E 稳定
  // 复现）。菜单改为动作完成后再关，键盘用户也不会在请求途中失去焦点。
  const [openUserId, setOpenUserId] = useState<number | null>(null)
  const [pendingUserAction, setPendingUserAction] = useState<{
    user: UserResponse
    action: 'active' | 'admin'
  } | null>(null)
  const [pendingRoleAction, setPendingRoleAction] = useState<{
    user: UserResponse
    role: AssignableRole
    has: boolean
  } | null>(null)
  // 300ms 防抖：输入每个字母都打一次 /admin/users 会造成请求风暴，
  // 且乱序返回可能让列表"倒退"。防抖后 keystroke 只更新输入框值。
  const [debouncedQuery, setDebouncedQuery] = useState('')
  useEffect(() => {
    const t = window.setTimeout(() => {
      setDebouncedQuery(query.trim())
      setPage(1)
    }, 300)
    return () => window.clearTimeout(t)
  }, [query])
  const offset = (page - 1) * PAGE_SIZE
  // 服务端过滤：本地过滤只能看到当前这一页，用户超过 50 个后搜不到老账号。
  const { data, isLoading, isError, refetch } = useAdminUsers(PAGE_SIZE, offset, debouncedQuery)
  const setActiveMut = useSetUserActive()
  const setAdminMut = useSetUserAdmin()
  const assignRoleMut = useAssignRole()
  const revokeRoleMut = useRevokeRole()
  const createUserMut = useCreateAdminUser()
  const grantXpMut = useGrantUserXp()
  const updateAreasMut = useUpdateUserAreas()
  const [grantTarget, setGrantTarget] = useState<UserResponse | null>(null)
  const [grantPoints, setGrantPoints] = useState('100')
  const [grantNote, setGrantNote] = useState('')
  const [grantError, setGrantError] = useState('')
  const [areasTarget, setAreasTarget] = useState<UserResponse | null>(null)
  const [areasSubjects, setAreasSubjects] = useState<string[]>([])
  const [areasReviewer, setAreasReviewer] = useState<string[]>([])
  const [areasTags, setAreasTags] = useState('')
  const [areasError, setAreasError] = useState('')
  const { user } = useAuth()

  // 后端返回裸数组无 meta，totalPages 用「当前页是否满页」推断（与审计日志页共用）。
  const totalPages = inferTotalPagesFromFullPage(data ?? [], PAGE_SIZE, page)

  // 搜索由服务端完成（分页前过滤）；这里不再二次过滤，
  // 否则「搜到了但被本地条件筛掉」会把结果又变空。
  const filtered = data ?? []

  const onToggleActive = async (u: UserResponse) => {
    try {
      await setActiveMut.mutateAsync({ userId: u.id, isActive: !u.is_active })
      toast.success(u.is_active ? '已禁用' : '已启用')
    } catch (err) {
      toast.error(extractError(err, '没能更改账号状态，可再试一次'))
    }
  }

  const onToggleAdmin = async (u: UserResponse) => {
    try {
      await setAdminMut.mutateAsync({ userId: u.id, isAdmin: !u.is_admin })
      toast.success(u.is_admin ? '已取消管理员' : '已设为平台管理员')
    } catch (err) {
      toast.error(extractError(err, '没能更改管理员状态，可再试一次'))
    }
  }

  // 角色勾选先进入确认弹窗，确认后才撤销/分配。
  const onToggleRole = async (
    u: UserResponse,
    role: AssignableRole,
    has: boolean,
  ) => {
    try {
      if (has) {
        await revokeRoleMut.mutateAsync({ userId: u.id, role })
        toast.success(`已撤销 ${roleLabel(role)} 角色`)
      } else {
        await assignRoleMut.mutateAsync({ userId: u.id, role })
        toast.success(`已分配 ${roleLabel(role)} 角色`)
      }
    } catch (err) {
      toast.error(extractError(err, '没能更改角色分配，可再试一次'))
    }
  }

  const openAreas = (u: UserResponse) => {
    setAreasTarget(u)
    setAreasSubjects(u.subject_disciplines ?? [])
    setAreasReviewer(u.reviewer_disciplines ?? [])
    setAreasTags((u.reviewer_tags ?? []).join('、'))
    setAreasError('')
    setOpenUserId(null)
  }

  return (
    <div>
      <PageHeader
        title="成员管理"
        description="管理用户、启用状态与社区角色分配；科目与审稿领域可从行末菜单代改。读者身份=注册即得，作者身份=确认《边界与处理》即得，均不在此分配。"
        actions={
          <div className="flex items-center gap-2">
            {data ? <Badge variant="secondary">本页 {data.length} 人</Badge> : null}
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              <Plus className="mr-1 h-4 w-4" />
              新增成员
            </Button>
          </div>
        }
      />

      <div className="mb-4 max-w-sm">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索用户名或邮箱"
            className="pl-8"
          />
        </div>
      </div>

      {isLoading ? (
        <Loading />
      ) : isError ? (
        <ErrorState message="用户列表加载失败，可重试。" onRetry={() => refetch()} />
      ) : filtered.length === 0 ? (
        <EmptyState title="暂无用户" />
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>用户名</TableHead>
                <TableHead>邮箱</TableHead>
                <TableHead>角色</TableHead>
                <TableHead>平台管理</TableHead>
                <TableHead>状态</TableHead>
                <TableHead>邮箱验证</TableHead>
                <TableHead>注册时间</TableHead>
                <TableHead className="w-12 text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((u) => {
                // 后端会拒绝自助改 active，前端直接禁用当前 admin 自己那行
                const isSelf = user?.id === u.id
                const roles = u.roles ?? []
                return (
                  <TableRow key={u.id}>
                    <TableCell className="font-medium">
                      <span>{u.username}</span>
                      <span className="ml-2 text-[11px] font-normal text-muted-foreground">
                        活跃 Lv {u.level ?? 1}
                      </span>
                      <span className="mt-0.5 block text-[11px] font-normal text-muted-foreground">
                        {(u.subject_disciplines ?? []).length > 0 || (u.reviewer_disciplines ?? []).length > 0
                          ? [
                              (u.subject_disciplines ?? []).length > 0
                                ? `科目 ${(u.subject_disciplines ?? []).length}`
                                : null,
                              (u.reviewer_disciplines ?? []).length > 0
                                ? `审稿 ${(u.reviewer_disciplines ?? []).length}`
                                : null,
                            ]
                              .filter(Boolean)
                              .join(' · ')
                          : '未填领域'}
                      </span>
                    </TableCell>
                    <TableCell className="max-w-[220px] truncate text-muted-foreground" title={u.email}>
                      {u.email}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {roles.length === 0 ? (
                          <span className="text-xs text-muted-foreground">—</span>
                        ) : (
                          roles.map((r) => (
                            <Badge key={r} variant="outline" className="text-xs">
                              {roleLabel(r)}
                            </Badge>
                          ))
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={u.is_admin ? 'default' : 'secondary'}>
                        {u.is_admin ? '是' : '否'}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant={u.is_active ? 'default' : 'destructive'}>
                        {u.is_active ? '启用' : '禁用'}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant={u.is_email_verified ? 'default' : 'outline'}>
                        {u.is_email_verified ? '已验证' : '未验证'}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatDateTime(u.created_at)}
                    </TableCell>
                    <TableCell>
                      <DropdownMenu
                        open={openUserId === u.id}
                        onOpenChange={(open) => setOpenUserId(open ? u.id : null)}
                      >
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon-sm" disabled={isSelf} aria-label="用户操作">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-48">
                          <DropdownMenuLabel>用户操作</DropdownMenuLabel>
                          <DropdownMenuItem onSelect={(e) => { e.preventDefault(); openAreas(u) }}>
                            领域资料
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            onSelect={(e) => {
                              e.preventDefault()
                              setPendingUserAction({ user: u, action: 'active' })
                              setOpenUserId(null)
                            }}
                            disabled={setActiveMut.isPending}
                          >
                            {u.is_active ? '禁用账号' : '启用账号'}
                          </DropdownMenuItem>
                          {/* 平台管理员提权：此前只能改数据库，界面上无路可走 */}
                          <DropdownMenuItem
                            onSelect={(e) => {
                              e.preventDefault()
                              setPendingUserAction({ user: u, action: 'admin' })
                              setOpenUserId(null)
                            }}
                            disabled={setAdminMut.isPending}
                            className={u.is_admin ? 'text-destructive' : ''}
                          >
                            {u.is_admin ? '取消平台管理员' : '设为平台管理员'}
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuLabel>经验</DropdownMenuLabel>
                          <DropdownMenuItem
                            onSelect={(e) => {
                              e.preventDefault()
                              setGrantTarget(u)
                              setGrantPoints('100')
                              setGrantNote('')
                              setGrantError('')
                              setOpenUserId(null)
                            }}
                          >
                            发放经验
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuLabel>内容整理线角色分配</DropdownMenuLabel>
                          {ASSIGNABLE_ROLES.map((role) => {
                            const checked = roles.includes(role)
                            const pending =
                              (assignRoleMut.isPending && assignRoleMut.variables?.userId === u.id && assignRoleMut.variables?.role === role) ||
                              (revokeRoleMut.isPending && revokeRoleMut.variables?.userId === u.id && revokeRoleMut.variables?.role === role)
                            return (
                              <DropdownMenuCheckboxItem
                                key={role}
                                checked={checked}
                                disabled={pending}
                                onSelect={(e) => {
                                  e.preventDefault()
                                  setPendingRoleAction({ user: u, role, has: checked })
                                  setOpenUserId(null)
                                }}
                              >
                                {roleLabel(role)}
                              </DropdownMenuCheckboxItem>
                            )
                          })}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {data && (
        <Pagination
          page={page}
          totalPages={totalPages}
          onPageChange={setPage}
        />
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>新增成员</DialogTitle>
            <DialogDescription>
              直接创建内容整理账号并指派角色；对方无需注册，用邮箱验证码登录后即可开始工作。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="create-email">邮箱</Label>
              <Input
                id="create-email"
                type="email"
                value={createForm.email}
                onChange={(e) => setCreateForm((v) => ({ ...v, email: e.target.value }))}
                placeholder="name@example.com"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="create-username">用户名</Label>
              <Input
                id="create-username"
                value={createForm.username}
                onChange={(e) => setCreateForm((v) => ({ ...v, username: e.target.value }))}
                placeholder="用于登录与署名"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="create-role">角色</Label>
              <select
                id="create-role"
                value={createForm.role}
                onChange={(e) =>
                  setCreateForm((v) => ({ ...v, role: e.target.value as AssignableRole }))
                }
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                {ASSIGNABLE_ROLES.map((role) => (
                  <option key={role} value={role}>
                    {roleLabel(role)}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="create-note">邀请留言（可选）</Label>
              <Textarea
                id="create-note"
                rows={3}
                maxLength={300}
                value={createForm.note}
                onChange={(e) => setCreateForm((v) => ({ ...v, note: e.target.value }))}
                placeholder="例：请负责本组合方法学作品的互评。"
              />
            </div>
            {createError && <p className="text-sm text-destructive">{createError}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              取消
            </Button>
            <Button
              disabled={createUserMut.isPending}
              onClick={async () => {
                setCreateError('')
                if (!createForm.email.trim() || !createForm.username.trim()) {
                  setCreateError('邮箱和用户名都必须填写')
                  return
                }
                try {
                  const res = await createUserMut.mutateAsync({
                    email: createForm.email.trim(),
                    username: createForm.username.trim(),
                    role: createForm.role,
                    note: createForm.note.trim(),
                  })
                  if (res.invite_sent) {
                    toast.success('账号已创建，邀请邮件已发送')
                  } else {
                    toast.warning(
                      `账号已创建，但邀请邮件发送失败：${res.invite_error || '请稍后让对方用邮箱验证码登录'}`,
                    )
                  }
                  setCreateOpen(false)
                  setCreateForm({ email: '', username: '', role: 'reviewer', note: '' })
                } catch (err) {
                  setCreateError(extractError(err, '创建失败'))
                }
              }}
            >
              {createUserMut.isPending ? '创建中…' : '创建并邀请'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={grantTarget !== null} onOpenChange={(open) => { if (!open) setGrantTarget(null) }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>发放经验</DialogTitle>
            <DialogDescription>
              给 {grantTarget?.username ?? '该成员'}（活跃 Lv {grantTarget?.level ?? 1}）手动发放经验。
              用于内容整理贡献、活动奖励；备注会写进经验记录与审计日志。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="grant-points">经验</Label>
              <Input
                id="grant-points"
                type="number"
                min={1}
                max={10000}
                step={1}
                value={grantPoints}
                onChange={(e) => setGrantPoints(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">1–10000，按整数发放。</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="grant-note">备注</Label>
              <Textarea
                id="grant-note"
                rows={3}
                maxLength={200}
                value={grantNote}
                onChange={(e) => setGrantNote(e.target.value)}
                placeholder="例：本组合方法学合集内容整理贡献。"
              />
              <p className="text-right text-xs text-muted-foreground">{grantNote.length}/200</p>
            </div>
            {grantError && <p className="text-sm text-destructive">{grantError}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setGrantTarget(null)}>取消</Button>
            <Button
              disabled={grantXpMut.isPending}
              onClick={async () => {
                setGrantError('')
                if (!grantTarget) return
                const points = Number(grantPoints)
                if (!Number.isInteger(points) || points < 1 || points > 10000) {
                  setGrantError('经验必须是 1–10000 的整数')
                  return
                }
                const note = grantNote.trim()
                if (!note) {
                  setGrantError('请填写备注，方便之后核对')
                  return
                }
                try {
                  await grantXpMut.mutateAsync({ userId: grantTarget.id, points, note })
                  toast.success(`已给 ${grantTarget.username} 发放 ${points} 经验`)
                  setGrantTarget(null)
                } catch (err) {
                  setGrantError(extractError(err, '发放失败'))
                }
              }}
            >
              {grantXpMut.isPending ? '发放中…' : '确认发放'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={areasTarget !== null}
        onOpenChange={(open) => {
          if (!open) setAreasTarget(null)
        }}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>领域资料</DialogTitle>
            <DialogDescription>
              代 {areasTarget?.username ?? '该成员'} 补齐科目领域与审稿领域。科目领域会展示在公开主页；
              审稿领域与能力标签只用于互评匹配和站务审阅。改动会写审计日志。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <DisciplinePicker
                label="科目领域"
                value={areasSubjects}
                onChange={setAreasSubjects}
                max={6}
                helper="公开主页可见，最多 6 个。"
              />
              <DisciplinePicker
                label="审稿人领域"
                value={areasReviewer}
                onChange={setAreasReviewer}
                max={10}
                helper="只进互评匹配，最多 10 个。"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="admin-area-tags">审稿能力标签</Label>
              <Input
                id="admin-area-tags"
                value={areasTags}
                maxLength={300}
                placeholder="如：质性研究、田野调查、统计分析、代码复现"
                onChange={(e) => setAreasTags(e.target.value)}
              />
              <p className="text-[11px] text-muted-foreground">
                用顿号、逗号或分号分隔，最多 20 个；不会出现在公开主页。
              </p>
            </div>
            {areasError ? <p className="text-sm text-destructive">{areasError}</p> : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAreasTarget(null)}>
              取消
            </Button>
            <Button
              disabled={updateAreasMut.isPending}
              onClick={async () => {
                if (!areasTarget) return
                setAreasError('')
                try {
                  await updateAreasMut.mutateAsync({
                    userId: areasTarget.id,
                    subject_disciplines: areasSubjects,
                    reviewer_disciplines: areasReviewer,
                    reviewer_tags: areasTags
                      .split(/[,，;；、\n]/)
                      .map((tag) => tag.trim())
                      .filter(Boolean)
                      .slice(0, 20),
                  })
                  toast.success(`已更新 ${areasTarget.username} 的领域资料`)
                  setAreasTarget(null)
                } catch (err) {
                  setAreasError(extractError(err, '领域保存失败，可再试一次'))
                }
              }}
            >
              {updateAreasMut.isPending ? '保存中…' : '保存领域'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={pendingUserAction !== null}
        title={
          pendingUserAction?.action === 'admin'
            ? pendingUserAction.user.is_admin
              ? '取消这个账号的平台管理员权限？'
              : '设为平台管理员？'
            : pendingUserAction?.user.is_active
              ? '禁用这个账号？'
              : '启用这个账号？'
        }
        description={
          pendingUserAction
            ? pendingUserAction.action === 'admin'
              ? `账号「${pendingUserAction.user.username}」的平台管理员权限会立即${pendingUserAction.user.is_admin ? '取消' : '生效'}。`
              : pendingUserAction.user.is_active
                ? `账号「${pendingUserAction.user.username}」禁用后将无法登录和提交内容。`
                : `账号「${pendingUserAction.user.username}」会恢复登录和提交权限。`
            : undefined
        }
        confirmText={pendingUserAction?.action === 'admin' ? (pendingUserAction.user.is_admin ? '取消管理员' : '设为管理员') : pendingUserAction?.user.is_active ? '禁用账号' : '启用账号'}
        destructive={Boolean(
          (pendingUserAction?.action === 'admin' && pendingUserAction.user.is_admin) ||
            (pendingUserAction?.action === 'active' && pendingUserAction.user.is_active),
        )}
        onConfirm={() => {
          const target = pendingUserAction
          if (!target) return
          setPendingUserAction(null)
          if (target.action === 'admin') void onToggleAdmin(target.user)
          else void onToggleActive(target.user)
        }}
        onOpenChange={(open) => !open && setPendingUserAction(null)}
      />

      <ConfirmDialog
        open={pendingRoleAction !== null}
        title={
          pendingRoleAction?.has
            ? `撤销「${roleLabel(pendingRoleAction.role)}」角色？`
            : `分配「${pendingRoleAction ? roleLabel(pendingRoleAction.role) : ''}」角色？`
        }
        description={
          pendingRoleAction
            ? pendingRoleAction.has
              ? `账号「${pendingRoleAction.user.username}」会立即失去「${roleLabel(pendingRoleAction.role)}」的角色权限。`
              : `账号「${pendingRoleAction.user.username}」会立即获得「${roleLabel(pendingRoleAction.role)}」的角色权限。`
            : undefined
        }
        confirmText={pendingRoleAction?.has ? '撤销角色' : '分配角色'}
        destructive={Boolean(pendingRoleAction?.has)}
        onConfirm={() => {
          const target = pendingRoleAction
          if (!target) return
          setPendingRoleAction(null)
          void onToggleRole(target.user, target.role, target.has)
        }}
        onOpenChange={(open) => !open && setPendingRoleAction(null)}
      />
    </div>
  )
}
