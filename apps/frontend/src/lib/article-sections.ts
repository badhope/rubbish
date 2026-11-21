// Nature 式栏目 / 分部：与后端 catalog.SECTIONS 的 part slug 对齐。
// 投稿向导与后台新建资源共用同一份选项，避免两个入口的栏目名漂移。
export const ARTICLE_SECTION_OPTIONS = [
  { value: 'editorial', label: '本周社论' },
  { value: 'world-view', label: '世界观 · 观点' },
  { value: 'research-highlights', label: '研究亮点' },
  { value: 'news', label: '新闻 · 焦点' },
  { value: 'features', label: '特写' },
  { value: 'book-review', label: '书评' },
  { value: 'arts-review', label: '文艺评论' },
  { value: 'comment', label: '评论 · 观点' },
  { value: 'correspondence', label: '读者来信' },
  { value: 'work-feature', label: '工作特写' },
  { value: 'technology-feature', label: '技术特写' },
  { value: 'news-views', label: '新闻与观点' },
  { value: 'reviews', label: '综述' },
  { value: 'articles', label: '研究文章' },
  { value: 'amendments-corrections', label: '更正与撤稿' },
  { value: 'collections', label: '专题合集' },
] as const
