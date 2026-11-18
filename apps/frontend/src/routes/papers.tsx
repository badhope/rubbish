import { createFileRoute } from '@tanstack/react-router'
import { CatalogListPage } from './catalog/index'

// 论文入口不再固定成单一学术轨：先进入总目录，读者在目录页内选择
// 学术 / 荒诞 / 副刊。副刊从独立一级入口退成目录内的一个分区。
export const Route = createFileRoute('/papers')({
  component: () => <CatalogListPage />,
})
