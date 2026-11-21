// 各合集主题名：合集页与内容库按组筛选共用同一份口径。
export const ISSUE_TITLES: Record<string, string> = {
  '01': '从这里读起',
  '02': '方法与材料',
  '03': '日常观察',
  '04': '语言与人',
  '05': '游戏与规则',
  '06': '游戏、语言与身体',
  '07': '持续更新 · 不限主题',
  '08': '阅读与媒介',
  '09': '身体与日常',
  '10': '一年之后',
}

export function issueTitle(issue: string): string {
  return ISSUE_TITLES[issue] ?? '当前批次'
}
