import { Badge } from '@/components/ui/badge'
import type { AssignmentStatus, SubmissionStatus } from '@/lib/types'

const SUBMISSION_LABEL: Record<string, string> = {
  pending: '等基础检查',
  under_review: '互评中',
  major_revision: '需要大改',
  minor_revision: '小改一下',
  resubmitted: '已重新提交',
  accepted: '通过了',
  approved: '已公开',
  rejected: '没有通过',
  rework_requested: '待补充',
  materials: '待补充',
}

export function SubmissionStatusBadge({ status }: { status: SubmissionStatus }) {
  const label = SUBMISSION_LABEL[status] ?? status
  if (status === 'under_review') {
    return <Badge className="rounded-none bg-primary/15 text-primary">{label}</Badge>
  }
  if (status === 'major_revision') {
    return <Badge className="rounded-none bg-amber-500/15 text-amber-700 dark:text-amber-400">{label}</Badge>
  }
  if (status === 'minor_revision') {
    return <Badge className="rounded-none bg-yellow-500/15 text-yellow-700 dark:text-yellow-400">{label}</Badge>
  }
  if (status === 'accepted' || status === 'approved') {
    return <Badge className="rounded-none bg-emerald-500/15 text-emerald-700 dark:text-emerald-400">{label}</Badge>
  }
  if (status === 'rejected') {
    return <Badge variant="destructive" className="rounded-none">{label}</Badge>
  }
  return <Badge variant="outline" className="rounded-none">{label}</Badge>
}

const ASSIGNMENT_LABEL: Record<AssignmentStatus, string> = {
  pending: '待回应',
  accepted: '进行中',
  completed: '已完成',
  declined: '已拒绝',
  cancelled: '已取消',
}

export function AssignmentStatusBadge({ status }: { status: AssignmentStatus }) {
  if (status === 'accepted') {
    return <Badge className="rounded-none bg-primary/15 text-primary">{ASSIGNMENT_LABEL[status]}</Badge>
  }
  if (status === 'completed') {
    return <Badge className="rounded-none bg-emerald-500/15 text-emerald-700 dark:text-emerald-400">{ASSIGNMENT_LABEL[status]}</Badge>
  }
  if (status === 'pending') {
    return <Badge variant="outline" className="rounded-none">{ASSIGNMENT_LABEL[status]}</Badge>
  }
  return <Badge variant="secondary" className="rounded-none">{ASSIGNMENT_LABEL[status] ?? status}</Badge>
}
