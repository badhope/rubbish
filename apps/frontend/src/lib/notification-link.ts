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

  if (type === 'claim.created') {
    return id
      ? { to: '/admin/people', search: { section: 'claims', claim: id }, label: '去审批' }
      : { to: '/admin/people', search: { section: 'claims' }, label: '去审批' }
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
  if (type === 'submission.decision' || type === 'submission.rework_requested') {
    return id
      ? { to: '/submissions', search: { submission: id }, label: '看结果' }
      : { to: '/submissions', label: '我的作品' }
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
        : { to: '/forum', label: '去讨论区' }
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
      return { to: '/issues', label: '看合集' }
    case 'triage_queue':
      return { to: '/submissions/pending', label: '去内容台' }
    case 'role_application':
    case 'site':
      return { to: '/me', label: '查看' }
    default:
      return null
  }
}
