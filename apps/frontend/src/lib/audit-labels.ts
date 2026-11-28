import type { AuditLogEntry } from '@/lib/types'

/** 审计动作的中文标签。未知动作仍会按 scope/verb 逐段翻译，避免直接露 raw code。 */
const ACTION_LABELS: Record<string, string> = {
  'admin.maintenance.review_reminders': '维护 · 批量互评提醒',
  'admin.settings.review_mode': '设置 · 互评模式',
  'ai.submission.create': '投稿 · AI 代建',
  'auth.password_reset_by_admin': '账号 · 管理员重置密码',
  'catalog.claim.decision': '作品 · 认领裁决',
  'catalog.issue_schedule': '作品 · 合集编排',
  'catalog.issues_rebalanced': '作品 · 合集重排',
  'catalog.submission.authors_edit': '作品 · 作者署名调整',
  'content.unpublish_cleanup': '内容 · 下架清理',
  'feedback.bug': '反馈 · Bug',
  'feedback.content': '反馈 · 内容',
  'feedback.other': '反馈 · 其他',
  'feedback.submission': '反馈 · 投稿',
  'feedback.suggestion': '反馈 · 建议',
  'forum.delete': '讨论 · 删除',
  'forum.edit': '讨论 · 编辑',
  'forum.moderate': '讨论 · 处置',
  'gamification.author_onboarding': '经验 · 作者入驻',
  'gamification.role_application.create': '角色 · 申请提交',
  'gamification.role_application.decision': '角色 · 申请裁决',
  'quality.batch_rescore': '质量 · 批量重评',
  'release.approve': '发布 · 批准',
  'release.check': '发布 · 检查',
  'release.publish': '发布 · 上线',
  'review.batch_assign': '互评 · 批量指派',
  'review.interest': '互评 · 意向',
  'review.regrade_objective': '互评 · 客观项重评',
  'review.reminder_manual': '互评 · 手动提醒',
  'review.reminder_sent': '互评 · 提醒已发',
  'reviewer.coi_declaration': '互评 · 利益冲突声明',
  'role.editorial_admin_promotion': '角色 · 编辑管理员晋升',
  'submission.assign_reviewer': '投稿 · 指派互评',
  'submission.bulk_accepted': '投稿 · 批量通过',
  'submission.bulk_rework': '投稿 · 批量退回修改',
  'submission.cancel_reviewer': '投稿 · 取消互评',
  'submission.decision': '投稿 · 裁决',
  'submission.rework_requested': '投稿 · 要求返修',
  'submission.triage': '投稿 · 分诊',
  'user.admin_create': '成员 · 新建管理员',
  'user.assign_role': '成员 · 授予角色',
  'user.deleted': '成员 · 删除',
  'user.password_reset_by_editor': '成员 · 编辑重置密码',
  'user.revoke_role': '成员 · 撤销角色',
  'announcement.create': '公告 · 新建',
  'announcement.update': '公告 · 更新',
  'announcement.delete': '公告 · 删除',
  'catalog.resource.delete': '作品 · 删除',
  'catalog.resource.publish': '作品 · 公开',
  'catalog.resource.update': '作品 · 更新',
  'catalog.resource.restore': '作品 · 恢复',
  'submission.bulk_delete_test_cleanup': '投稿 · 测试数据清理',
  'submission.create': '投稿 · 新建',
  'submission.update': '投稿 · 更新',
  'submission.delete': '投稿 · 删除',
  'submission.approve': '投稿 · 通过',
  'submission.reject': '投稿 · 不通过',
  'user.create': '成员 · 新增',
  'user.set_active': '成员 · 启用/禁用',
  'user.set_admin': '成员 · 平台管理',
  'user.update_areas': '成员 · 领域资料',
  'user.role.assign': '成员 · 授予角色',
  'user.role.revoke': '成员 · 撤销角色',
  'shop.item.create': '经验货品 · 新增',
  'shop.item.update': '经验货品 · 更新',
  'shop.item.delete': '经验货品 · 删除',
  'feedback.create': '反馈 · 新建',
  'feedback.resolve': '反馈 · 处理',
  'forum.topic.pin': '主题帖 · 置顶',
  'forum.topic.lock': '主题帖 · 锁定',
  'forum.topic.delete': '主题帖 · 删除',
  'comment.approve': '评论 · 通过',
  'comment.reject': '评论 · 不通过',
  'report.resolve': '举报 · 处理',
}

const SCOPE_LABELS: Record<string, string> = {
  admin: '后台',
  ai: 'AI',
  announcement: '公告',
  catalog: '作品',
  submission: '投稿',
  user: '成员',
  shop: '经验货品',
  feedback: '反馈',
  forum: '讨论',
  comment: '评论',
  report: '举报',
  quality: '质量',
  release: '发布',
  gamification: '经验',
  content: '内容',
  review: '互评',
  auth: '账号',
  site: '站点',
  tenant: '站点',
  role: '角色',
  issue: '合集',
}

const VERB_LABELS: Record<string, string> = {
  create: '新建',
  update: '更新',
  delete: '删除',
  publish: '公开',
  restore: '恢复',
  approve: '通过',
  reject: '不通过',
  resolve: '处理',
  assign: '授予',
  revoke: '撤销',
  pin: '置顶',
  lock: '锁定',
  unlock: '解锁',
}

function humanizeSegment(segment: string): string {
  return VERB_LABELS[segment] ?? segment.replace(/_/g, ' ')
}

export function auditActionLabel(action: string): string {
  if (ACTION_LABELS[action]) return ACTION_LABELS[action]
  const [scope, ...rest] = action.split('.')
  const scopeLabel = SCOPE_LABELS[scope] ?? scope
  const tail = rest.map(humanizeSegment).join(' · ')
  return tail ? `${scopeLabel} · ${tail}` : scopeLabel
}

export interface AuditTarget {
  label: string
  href?: string
}

const SECTION_TARGETS: Record<string, { label: string; href: string }> = {
  announcement: { label: '公告', href: '/admin/content?section=announcements' },
  user: { label: '成员', href: '/admin/people' },
  submission: { label: '投稿', href: '/submissions/pending' },
  submission_batch: { label: '投稿批次', href: '/submissions/pending' },
  shop_item: { label: '经验货品', href: '/admin/economy' },
  comment: { label: '评论', href: '/admin/content?section=comments' },
  report: { label: '举报', href: '/admin/content?section=reports' },
  feedback: { label: '反馈', href: '/forum' },
  review_assignment: { label: '互评指派', href: '/review' },
  author_claim: { label: '作者认领', href: '/admin/people' },
  role_application: { label: '角色申请', href: '/admin/people' },
  site: { label: '站点设置', href: '/admin/system' },
  tenant: { label: '站点', href: '/admin/system' },
  issue: { label: '合集', href: '/editor/issue-plan' },
  catalog: { label: '内容库', href: '/catalog' },
}

export function auditTarget(log: AuditLogEntry): AuditTarget | null {
  if (!log.target_type) return null
  const id = log.target_id ? ` #${log.target_id}` : ''
  if (log.target_type === 'resource' && log.target_id) {
    return { label: `作品${id}`, href: `/catalog/${log.target_id}` }
  }
  if (log.target_type === 'forum_topic' && log.target_id) {
    return { label: `主题帖${id}`, href: `/forum/${log.target_id}` }
  }
  const section = SECTION_TARGETS[log.target_type]
  if (section) {
    return { label: `${section.label}${id}`, href: section.href }
  }
  return { label: `${log.target_type}${id}` }
}
