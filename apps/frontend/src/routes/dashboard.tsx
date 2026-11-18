import { createFileRoute, redirect } from '@tanstack/react-router'

// 「站点总览」已合并进「我的」概览。旧地址只保留一次跳转，
// 不再维护第二套统计、签到和推荐入口。
export const Route = createFileRoute('/dashboard')({
  beforeLoad: () => {
    throw redirect({ to: '/me' })
  },
})
