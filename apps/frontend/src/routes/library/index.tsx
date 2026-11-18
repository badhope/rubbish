import { createFileRoute, redirect } from '@tanstack/react-router'

// 阅读列表索引已合并进「我的 → 收藏」；单本列表的详情页仍保留
// 在 /library/$listId，供收藏 tab 继续打开具体列表。
export const Route = createFileRoute('/library/')({
  beforeLoad: () => {
    throw redirect({ to: '/me', search: { tab: 'library' } })
  },
})
