/**
 * 返修稿入口口径：内容台列表、进度看板和决定弹层必须共用同一套判断。
 *
 * - 只要当前稿件存在 v2+ 版本，就视为返修稿，便于列表/看板显示版本号；
 * - 但只有状态严格为 under_review 时才允许“返修后直接录用”。补材料重投
 *   会落到 resubmitted，尚未重新进入互评复核，不能跳过本轮闸门。
 */
export function isRevisionSubmission(latestVersion?: number | null): boolean {
  return (latestVersion ?? 1) > 1
}

export function canDirectAcceptRevision(
  status?: string | null,
  latestVersion?: number | null,
): boolean {
  return status === 'under_review' && isRevisionSubmission(latestVersion)
}
