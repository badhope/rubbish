import { createFileRoute, redirect } from '@tanstack/react-router'

// 账号设置已合并进「我的 → 设置」。旧地址把原来的子页签映射到
// 新的 settings section，避免旧书签落到设置首页。
type LegacySettingsTab = 'profile' | 'security' | 'notifications' | 'ai'

export const Route = createFileRoute('/settings')({
  validateSearch: (search: Record<string, unknown>): { tab?: LegacySettingsTab } => {
    const tab =
      search.tab === 'security' || search.tab === 'notifications' || search.tab === 'ai' || search.tab === 'profile'
        ? search.tab
        : undefined
    return tab ? { tab } : {}
  },
  beforeLoad: ({ search }) => {
    const section: LegacySettingsTab = search.tab ?? 'profile'
    throw redirect({ to: '/me', search: { tab: 'settings', section } })
  },
})
