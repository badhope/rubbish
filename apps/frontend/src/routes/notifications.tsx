import { createFileRoute, redirect } from '@tanstack/react-router'

// 通知已合并进「我的」的最近通知与弹窗；旧地址直接打开通知面板，
// 不再维护第二套分类、分页和已读操作。
export const Route = createFileRoute('/notifications')({
  beforeLoad: () => {
    throw redirect({ to: '/me', search: { tab: 'overview', notifications: true } })
  },
})
