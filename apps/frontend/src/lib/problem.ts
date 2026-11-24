/**
 * Central problem stream for user-facing failures and warnings.
 *
 * The UI should never leave an abnormal state to a transient toast alone:
 * the reader/author needs to see what failed, where, and what can be done next.
 * This module is React-free so API interceptors and event handlers can emit
 * problems without importing UI code.
 */

export type ProblemTone = 'error' | 'warning' | 'info'

export interface ProblemInput {
  tone?: ProblemTone
  title?: string
  message: string
  /** Human-readable likely cause, derived from HTTP status or domain context. */
  cause?: string
  /** One concrete next action the user can take. */
  hint?: string
  /** Structured diagnostics. Do not put credentials or request bodies here. */
  context?: Record<string, string | number | undefined>
  source?: 'api' | 'toast' | 'manual' | 'runtime'
}

export interface Problem extends Required<Pick<ProblemInput, 'tone' | 'title' | 'message'>> {
  id: string
  at: string
  path: string
  cause?: string
  hint?: string
  context: Record<string, string | number | undefined>
  source: NonNullable<ProblemInput['source']>
}

const EVENT = 'rubbish:problem'
const DEDUPE_MS = 1800
const BACKGROUND_REPEAT_MS = 60_000
let lastKey = ''
let lastAt = 0
let lastApiAt = 0
let lastApiPath = ''
let lastPathKey = ''
let lastPathAt = 0

function currentPath(): string {
  if (typeof window === 'undefined') return ''
  return window.location.pathname || '/'
}

function pickTitle(tone: ProblemTone): string {
  if (tone === 'warning') return '需要注意'
  if (tone === 'info') return '提示'
  return '操作没有完成'
}

export function describeHttpCause(status?: number): string | undefined {
  if (!status) {
    return '请求没有到达服务器，通常是网络中断、代理超时或服务暂时不可达。'
  }
  if (status === 400) return '提交内容或当前状态不满足操作条件，后端没有接受这次请求。'
  if (status === 401) return '登录状态已失效，或这次提交的凭据不正确。'
  if (status === 403) return '当前账号没有这项权限，或受地区/角色访问策略限制。'
  if (status === 404) return '目标内容不存在、已删除，或链接已经过期。'
  if (status === 409) return '数据状态已变化，和页面上的旧状态发生了冲突；刷新后再试。'
  if (status === 413) return '上传内容超过大小限制。'
  if (status === 422) return '有字段没有通过服务端校验，请按提示逐项修改。'
  if (status === 429) return '操作太频繁，触发了限流；稍等片刻再试。'
  if (status >= 500) return '服务端处理这次请求时出错；问题不在你的输入。'
  return undefined
}

function dedupeKey(problem: Problem): string {
  return `${problem.tone}|${problem.message}|${problem.path}`
}

/**
 * Emit a problem. API failures win over the toast that follows the same
 * request, so the user sees one diagnostic card instead of two near-duplicates.
 */
export function emitProblem(input: ProblemInput): void {
  if (typeof window === 'undefined') return
  const now = Date.now()
  const tone = input.tone ?? 'error'
  const message = String(input.message || '').trim() || '请求没有完成。'
  const source = input.source ?? 'manual'
  const path = currentPath()

  // Hidden tabs must not throw diagnostic cards nobody can see. The next
  // visible request will surface the failure.
  if (source !== 'manual' && document.visibilityState === 'hidden') return

  // A caller normally catches an API error and immediately raises a toast.
  // The API event already carries status/method diagnostics; suppress the
  // trailing toast event for the same page.
  if (source === 'toast' && now - lastApiAt < 2500 && lastApiPath === path) {
    return
  }

  // Background polling can fail every 30–60 seconds while the server is down.
  // Show one diagnostic card per minute for the same endpoint instead of a
  // endless stream; the user's next explicit action still gets its own card.
  if (source === 'api') {
    const pathKey = `${tone}|${message}|${path}`
    if (pathKey === lastPathKey && now - lastPathAt < BACKGROUND_REPEAT_MS) return
    lastPathKey = pathKey
    lastPathAt = now
  }

  const problem: Problem = {
    id: `${now}-${Math.random().toString(36).slice(2, 8)}`,
    at: new Date(now).toISOString(),
    path,
    tone,
    title: input.title || pickTitle(tone),
    message,
    cause: input.cause,
    hint: input.hint,
    context: input.context ?? {},
    source,
  }
  const key = dedupeKey(problem)
  if (key === lastKey && now - lastAt < DEDUPE_MS) return
  lastKey = key
  lastAt = now
  if (source === 'api') {
    lastApiAt = now
    lastApiPath = path
  }
  window.dispatchEvent(new CustomEvent<Problem>(EVENT, { detail: problem }))
}

export function subscribeProblems(listener: (problem: Problem) => void): () => void {
  if (typeof window === 'undefined') return () => {}
  const handler = (event: Event) => listener((event as CustomEvent<Problem>).detail)
  window.addEventListener(EVENT, handler)
  return () => window.removeEventListener(EVENT, handler)
}
