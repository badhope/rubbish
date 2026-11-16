import { createFileRoute, redirect } from '@tanstack/react-router'

// 历史/外部链接使用 /catalog/track/essay 这种两段式路径；正式目录只有
// /catalog?track=essay。这里保留 301 语义的前端重定向，避免直接 404。
//
// 旧版还有 /catalog/track/serious 与 /catalog/track/absurd：它们不是
// 内容轨道，而是论文子类。不能把 serious/absurd 都塞成 essay，否则旧
// 链接会把学术论文/荒诞论文整体导到副刊。
export const Route = createFileRoute('/catalog/track/$track')({
  beforeLoad: ({ params }) => {
    if (params.track === 'serious' || params.track === 'absurd') {
      throw redirect({
        to: '/papers',
        search: { kind: params.track },
      })
    }
    const track = params.track === 'paper' ? 'paper' : 'essay'
    throw redirect({ to: '/catalog', search: { track } })
  },
})
