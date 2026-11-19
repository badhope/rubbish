export const ME_TABS = [
  { key: 'overview', label: '概览' },
  { key: 'library', label: '收藏' },
  { key: 'points', label: '积分' },
  { key: 'settings', label: '设置' },
] as const

export type MeTabKey = (typeof ME_TABS)[number]['key']

export const ME_TAB_KEYS = ME_TABS.map((tab) => tab.key)

export function isMeTab(value: unknown): value is MeTabKey {
  return typeof value === 'string' && ME_TAB_KEYS.includes(value as MeTabKey)
}
