import type { NotificationResponse } from '@/lib/types'

export interface NotificationDestination {
  to: string
  params?: Record<string, string>
  search?: Record<string, string | number | boolean | undefined>
  /** 按钮/行尾提示，告诉用户点下去会发生什么。 */
  label: string
}

function positiveId(value: string | null | undefined): number | null {
  if (!value) return null
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null
}

/**
 * 通知不是一条公告，而是一张写着“接下来去哪”的便签。
 * 优先看事件类型（同一种 related_type 可能发给作者，也可能发给内容整理），
 * 再看 related_type 兜底。拿不到可靠目的地时返回 null，不猜页面。
 */
export function notificationDestination(
  item: NotificationResponse,
): NotificationDestination | null {
  const id = positiveId(item.related_id)
  const type = item.type || ''

  // 同一事件发给两种人：管理员收到“去审批”，申请人收到“看结果”。
  if (item.related_type === 'role_application_admin') {
    return id
      ? { to: '/admin/people', search: { section: 'roles', application: id }, label: '去审批' }
      : { to: '/admin/people', search: { section: 'roles' }, label: '去审批' }
  }
  if (type === 'gamification.role_application' || item.related_type === 'role_application') {
    return id
      ? { to: '/levels', search: { application: id }, label: '看申请' }
      : { to: '/levels', label: '看身份' }
  }

  if (type === 'claim.created') {
    // 新通知 related_type=author_claim，带的是认领 id；旧通知只带 resource id，
    // 不能拿作品 id 当认领 id，否则会定位到一条无关甚至不存在的申请。
    if (item.related_type === 'author_claim' && id) {
      return { to: '/admin/people', search: { section: 'claims', claim: id }, label: '去审批' }
    }
    return { to: '/admin/people', search: { section: 'claims' }, label: '去审批' }
  }
  if (type === 'claim.decision') {
    // 认领结果指向被认领的那篇作品；没有资源 id 时退到认领列表。
    return id
      ? { to: '/catalog/$resourceId', params: { resourceId: String(id) }, label: '看认领结果' }
      : { to: '/me', label: '看认领记录' }
  }
  if (type === 'release.scheduled_failed') {
    // related_id 是后端 manifest 的 "卷/期" 文本，直接带到对应期，不再让用户自己找。
    const parts = item.related_id?.split('/') ?? []
    if (parts.length === 2 && parts[0] && parts[1]) {
      return {
        to: '/editor/issue-plan',
        search: { volume: parts[0], issue: parts[1] },
        label: '去重新排期',
      }
    }
    return { to: '/editor/issue-plan', label: '去重新排期' }
  }
  if (type === 'appeal.created') {
    return id
      ? { to: '/admin/content', search: { section: 'appeals', appeal: id }, label: '去处理申诉' }
      : { to: '/admin/content', search: { section: 'appeals' }, label: '去申诉队列' }
  }
  if (type === 'appeal.decision') {
    return id
      ? { to: '/me', search: { tab: 'overview', appeal: id }, label: '看申诉结果' }
      : { to: '/me', search: { tab: 'overview' }, label: '我的申诉' }
  }
  if (type === 'site.feedback') {
    return id
      ? { to: '/forum', search: { view: 'feedback', feedback: id }, label: '去反馈墙' }
      : { to: '/forum', search: { view: 'feedback' }, label: '去反馈墙' }
  }
  if (type === 'review.interest') {
    return id
      ? { to: '/submissions/pending', search: { submission: id }, label: '去内容台' }
      : { to: '/submissions/pending', label: '去内容台' }
  }
  if (type === 'review.submitted') {
    // 新通知直接指向作品；旧数据只有 assignment id，退到内容台总表。
    if (item.related_type === 'submission' && id) {
      return { to: '/submissions/pending', search: { submission: id }, label: '去处理' }
    }
    return { to: '/submissions/pending', label: '去内容台' }
  }
  if (type === 'review.accepted' || type === 'review.declined') {
    return id && item.related_type === 'submission'
      ? { to: '/submissions/pending', search: { submission: id }, label: '去处理' }
      : { to: '/submissions/pending', label: '去内容台' }
  }
  if (type === 'review.invited' || type === 'review.reminder') {
    return id
      ? { to: '/review', search: { tab: 'assignments', assignment: id }, label: '去互评' }
      : { to: '/review', search: { tab: 'assignments' }, label: '去互评台' }
  }
  if (type === 'review.adjudicator_invited') {
    return id
      ? { to: '/review', search: { tab: 'assignments', assignment: id }, label: '去裁决' }
      : { to: '/review', search: { tab: 'assignments' }, label: '去互评台' }
  }
  if (type === 'submission.triage_overdue') {
    return id
      ? { to: '/submissions/pending', search: { submission: id }, label: '去处理' }
      : { to: '/submissions/pending', label: '去内容台' }
  }
  if (type === 'submission.resubmitted') {
    return id
      ? { to: '/submissions/pending', search: { submission: id }, label: '看修改版' }
      : { to: '/submissions/pending', label: '去内容台' }
  }
  if (type === 'submission.decision') {
    // 通过时后端指向公开目录条目，不指向 submission；点开应该直接读成稿。
    if (item.related_type === 'resource' && id) {
      return {
        to: '/catalog/$resourceId',
        params: { resourceId: String(id) },
        label: '读成稿',
      }
    }
    return id
      ? { to: '/submissions', search: { submission: id }, label: '看结果' }
      : { to: '/submissions', label: '我的作品' }
  }
  if (type === 'submission.rework_requested') {
    return id
      ? { to: '/submissions', search: { submission: id }, label: '去修改' }
      : { to: '/submissions', label: '我的作品' }
  }
  if (type === 'submission.triage_rework') {
    return id
      ? { to: '/submissions', search: { submission: id }, label: '去修改' }
      : { to: '/submissions', label: '我的作品' }
  }
  if (type === 'submission.triage_materials') {
    return id
      ? { to: '/submissions', search: { submission: id }, label: '去补材料' }
      : { to: '/submissions', label: '我的作品' }
  }
  if (type === 'submission.triage_rejected') {
    return id
      ? { to: '/submissions', search: { submission: id }, label: '看结果' }
      : { to: '/submissions', label: '我的作品' }
  }
  if (type === 'review.assignment_cancelled') {
    return id
      ? { to: '/submissions', search: { submission: id }, label: '看作品' }
      : { to: '/review', label: '去互评台' }
  }
  if (type === 'review.rework_needs_assignment') {
    return id
      ? { to: '/submissions/pending', search: { submission: id }, label: '去指派' }
      : { to: '/submissions/pending', label: '去内容台' }
  }
  if (type === 'review.rework_requested') {
    // 新通知带的是具体互评指派，点开直接落在该稿的补审表单；
    // 旧数据只有作品 id，退回互评台，不把作品 id 当作指派 id。
    return id && item.related_type === 'review_assignment'
      ? { to: '/review', search: { tab: 'assignments', assignment: id }, label: '去补意见' }
      : { to: '/review', search: { tab: 'assignments' }, label: '去互评台' }
  }

  switch (item.related_type) {
    case 'resource':
      return id
        ? { to: '/catalog/$resourceId', params: { resourceId: String(id) }, label: '读作品' }
        : { to: '/catalog', label: '去内容库' }
    case 'submission':
      return id
        ? { to: '/submissions', search: { submission: id }, label: '打开作品' }
        : { to: '/submissions', label: '我的作品' }
    case 'forum_topic':
      return id
        ? { to: '/forum/$topicId', params: { topicId: String(id) }, label: '看回复' }
        : { to: '/forum', label: '去主题论坛' }
    case 'review_assignment':
      return id
        ? { to: '/review', search: { tab: 'assignments', assignment: id }, label: '去互评' }
        : { to: '/review', search: { tab: 'assignments' }, label: '去互评台' }
    case 'author_claim':
      return id
        ? { to: '/admin/people', search: { section: 'claims', claim: id }, label: '去审批' }
        : { to: '/admin/people', search: { section: 'claims' }, label: '去审批' }
    case 'feedback':
      return id
        ? { to: '/forum', search: { view: 'feedback', feedback: id }, label: '去反馈墙' }
        : { to: '/forum', search: { view: 'feedback' }, label: '去反馈墙' }
    case 'issue':
      return { to: '/issues', label: '看卷' }
    case 'triage_queue':
      return { to: '/submissions/pending', label: '去内容台' }
    case 'site':
      // 站点级通知没有更具体的目的地，点击只关闭弹窗，不假装跳转。
      return null
    default:
      return null
  }
}
