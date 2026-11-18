import { createFileRoute, redirect } from '@tanstack/react-router'

// 账号安全已并入「我的 → 设置 → 安全」。
export const Route = createFileRoute('/account/security')({
  beforeLoad: () => {
    throw redirect({ to: '/me', search: { tab: 'settings', section: 'security' } })
  },
})
