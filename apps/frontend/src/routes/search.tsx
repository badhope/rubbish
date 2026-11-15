import { createFileRoute, redirect } from '@tanstack/react-router'

/**
 * 旧版/外部链接里的 /search?q=… 从来就不存在，命中后是一条 404。
 * 这里不新增一套搜索页，只做 redirect：目录页的检索已经覆盖
 * 论文 + 副刊两条轨道，再做一个页面等于两套结果口径。
 */
export const Route = createFileRoute('/search')({
  validateSearch: (search: Record<string, unknown>): { q?: string } => ({
    q: typeof search.q === 'string' && search.q.trim() ? search.q.trim() : undefined,
  }),
  beforeLoad: ({ search }) => {
    throw redirect({ to: '/catalog', search: search.q ? { q: search.q } : {} })
  },
})
