import { createFileRoute, redirect } from '@tanstack/react-router'

/**
 * 兼容旧分享链接：论文列表卡片历史上曾出现 /papers/{id}。
 * 真正的详情节是 /catalog/{id}；这里只做 301 式前端跳转，避免用户打开
 * 一个看似合理的短链接却得到 404。
 */
export const Route = createFileRoute('/papers/$resourceId')({
  beforeLoad: ({ params }) => {
    throw redirect({
      to: '/catalog/$resourceId',
      params: { resourceId: params.resourceId },
    })
  },
  component: () => null,
})
