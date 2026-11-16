/** Rubbish 五维学术 / 六维荒诞评分与历史报告维度的统一展示口径。 */

export const REVIEW_DIMENSION_LABELS: Record<string, string> = {
  question: '选题与真问题',
  argument: '论证与自洽',
  method: '方法与可复现',
  evidence: '证据与结论',
  integrity: '规范与诚信',
  concept: '荒诞设定与原创',
  coherence: '内部自洽',
  execution: '一本正经的执行',
  material: '材料与梗的可核查',
  voice: '文风与节奏',
  problem: '问题价值',
  novelty: '创新与定位',
  presentation: '表达清晰度',
  // 历史数据兜底：老报告里存的旧四维 key 仍能显示中文
  originality: '原创性（旧）',
  methodology: '方法学（旧）',
  clarity: '清晰度（旧）',
  significance: '重要性（旧）',
}

export type ReviewDimensionView = {
  score?: number
  reason?: string
  evidence?: string
  /** 逐维修改意见：证据右侧独立填写，作者可见。 */
  suggestion?: string
}

/** 兼容 v5 结构（scores.dimensions）与旧报告（scores 直接是数字）。 */
export function reviewDimensionEntries(
  scores: Record<string, unknown>,
): [string, ReviewDimensionView][] {
  const dims = scores?.dimensions
  if (dims && typeof dims === 'object' && !Array.isArray(dims)) {
    return Object.entries(dims as Record<string, ReviewDimensionView>)
  }
  return Object.entries(scores ?? {})
    .filter(([, value]) => typeof value === 'number')
    .map(([key, value]) => [key, { score: value as number }])
}
