/** 论坛场景专用表述。页面不再散落“帖子/评论”这类通用平台词。 */
export const FORUM_COPY = {
  topic: '主题帖',
  topics: '主题帖',
  newTopic: '发布主题帖',
  reply: '楼层互动',
  replies: '楼层互动',
  replyAction: '回复本层',
  topicList: '主题列表',
  relatedTopic: '关联主题帖',
  draftSaved: '主题帖草稿已自动保存在本机',
  moderationPending: '内容已进入运营人工核验环节',
  moderationPublic: '已公开',
  moderationChanges: '需要调整',
  moderationRejected: '未通过核验',
} as const

export const MODERATION_STATUS_LABEL: Record<string, string> = {
  published: '已公开',
  auto_approved: '已公开',
  approved: '已公开',
  manual_review: '人工核验中',
  changes_requested: '待修改',
  rejected: '未通过核验',
  pending: '待核验',
}

export const MODERATION_STATUS_TONE: Record<string, string> = {
  published: 'border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  auto_approved: 'border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  approved: 'border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  manual_review: 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300',
  changes_requested: 'border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300',
  rejected: 'border-destructive/30 bg-destructive/10 text-destructive',
  pending: 'border-muted-foreground/25 bg-muted text-muted-foreground',
}
