import { createFileRoute, redirect } from '@tanstack/react-router'

// 账号安全已并入「账号设置」中枢（/settings 的「安全」标签页）。
// 旧链接与书签一律转跳并直达安全页，避免双入口分叉。
export const Route = createFileRoute('/account/security')({
  beforeLoad: () => {
    throw redirect({ to: '/settings', search: { tab: 'security' } })
  },
})
