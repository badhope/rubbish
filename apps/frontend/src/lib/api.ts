import axios, { type AxiosError, type InternalAxiosRequestConfig } from 'axios'
import { useAuthStore } from './auth'
import { describeHttpCause, emitProblem } from './problem'
import { translateBackendError } from './utils'

// In production, fall back to same-origin /api when VITE_API_URL is not
// injected (avoids shipping a hard-coded localhost URL in the bundle).
// A global timeout keeps a stalled refresh / /auth/me from piling up requests.
export const API_BASE_URL = import.meta.env.VITE_API_URL ?? '/api'
const baseURL = API_BASE_URL

export const api = axios.create({
  baseURL,
  withCredentials: true, // refresh_token lives in an httpOnly cookie; credentials are required
  headers: { 'Content-Type': 'application/json' },
  timeout: 10_000, // global guard against stalled requests piling up
  // 默认 axios 把数组参数序列化成 ids[]=1&ids[]=2（PHP/Rails 风格），
  // 但 FastAPI 的 list[int] = Query() 期望 ids=1&ids=2（重复参数风格）。
  // indexes:null 让 axios 用重复参数风格，与后端约定一致。
  paramsSerializer: { indexes: null },
})

// Inject access_token from the zustand store (read directly, no React coupling).
api.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const token = useAuthStore.getState().token
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  Object.assign(config.headers, csrfHeaders())
  return config
})

// Double-submit CSRF：后端中间件开启时，cookie 认证端点（refresh/logout/
// revoke-all）要求 X-CSRF-Token 与 csrf cookie 一致。cookie 非 httpOnly，
// 这里读出来回显；未下发 cookie 时返回空头，开发环境零影响。
export function csrfHeaders(): Record<string, string> {
  if (typeof document === 'undefined') return {}
  const match = /(?:^|;\s*)csrf=([^;]+)/.exec(document.cookie)
  return match ? { 'X-CSRF-Token': decodeURIComponent(match[1]) } : {}
}

let refreshing: Promise<void> | null = null

function reportApiProblem(error: AxiosError, title?: string): void {
  if (axios.isCancel(error) || error.code === 'ERR_CANCELED') return
  const status = error.response?.status
  const rawUrl = error.config?.url ?? ''
  // 文章页把 /manuscript 的 404/409 当作“没有在线正文”处理，会自己退化到
  // PDF/下载视图；这里再弹全局诊断只会让正常缺省状态看起来像故障。
  if (
    (status === 404 || status === 409) &&
    (/\/catalog\/[^/]+\/manuscript(?:\?|$)/.test(rawUrl) ||
      /\/submissions\/[^/]+\/download-ticket(?:\?|$)/.test(rawUrl))
  ) {
    return
  }
  const data = error.response?.data as { detail?: unknown } | undefined
  let message = ''
  if (typeof data?.detail === 'string') message = translateBackendError(data.detail)
  else if (data?.detail && typeof data.detail === 'object') {
    const detail = data.detail as { message?: unknown }
    if (typeof detail.message === 'string') message = detail.message
  }
  if (!message) {
    if (error.code === 'ECONNABORTED') message = '请求超时，服务没有在预期时间内响应。'
    else if (!status) message = '无法连接到服务，请检查网络后重试。'
    else if (status >= 500) message = `服务端返回 ${status}，这次请求没有完成。`
    else message = `请求没有完成（HTTP ${status}）。`
  }
  const method = (error.config?.method ?? 'get').toUpperCase()
  const url = rawUrl.split('?')[0]
  const requestId =
    (error.response?.headers?.['x-request-id'] as string | undefined) ||
    (error.response?.headers?.['x-trace-id'] as string | undefined)
  emitProblem({
    source: 'api',
    tone: status && status < 500 ? 'warning' : 'error',
    title: title || '请求没有完成',
    message,
    cause: describeHttpCause(status),
    hint:
      status === 401
        ? '重新登录后再操作；如果刚改过密码，请用新密码登录。'
        : status === 429
          ? '等待 1–2 分钟再试；不要连续点击提交。'
          : status === 422
            ? '按提示逐项修正字段后再提交。'
            : status && status >= 500
              ? '复制诊断信息发给站务，并附上操作时间。'
              : !status
                ? '检查网络；若其他页面正常，可到状态页确认服务是否在线。'
                : undefined,
    context: {
      method,
      path: url,
      status,
      request_id: requestId,
    },
  })
}

// Single-retry 401 handler: exchange the httpOnly refresh_token cookie for a
// new access_token. Concurrent 401s share the same refresh promise so we never
// fire multiple /auth/refresh calls in parallel (which would invalidate each
// other's cookies).
async function refreshOnce(): Promise<void> {
  if (refreshing) return refreshing
  refreshing = (async () => {
    try {
      const { data } = await axios.post(
        `${baseURL}/auth/refresh`,
        {},
        { withCredentials: true, timeout: 5_000, headers: csrfHeaders() }, // shorter timeout for refresh
      )
      useAuthStore.getState().setAuth(data.access_token, {
        id: data.user_id,
        username: data.username,
        is_admin: data.is_admin,
      })
    } finally {
      refreshing = null
    }
  })()
  return refreshing
}

api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const original = error.config as InternalAxiosRequestConfig & {
      _retried?: boolean
    }

    // Non-401 or already retried: rethrow.
    if (error.response?.status !== 401 || original._retried) {
      reportApiProblem(error, original._retried ? '登录后重试仍然失败' : undefined)
      return Promise.reject(error)
    }

    // 公开认证端点的 401 含义是「这次提交的凭据不对」，不是「token 过期」：
    // 打 refresh 没有意义（白多一次请求），而且 refresh 失败会把错误对象
    // 换成 refresh 的 error —— 登录页就再也看不到后端的 "Invalid credentials"。
    const PUBLIC_AUTH = [
      '/auth/login',
      '/auth/register',
      '/auth/forgot-password',
      '/auth/reset-password',
      '/auth/verify-email',
    ]
    if (PUBLIC_AUTH.some((p) => original.url?.includes(p))) {
      reportApiProblem(error, '登录没有完成')
      return Promise.reject(error)
    }

    // If /auth/refresh itself returns 401, the refresh_token is also dead —
    // clear auth state so the route guard bounces to /login. 主动退出后仍可能有
    // 在途请求带着旧 token 回来，此时 token 已清空，不再把“已退出”报成故障。
    if (original.url?.includes('/auth/refresh')) {
      const hadSession = Boolean(useAuthStore.getState().token)
      useAuthStore.getState().logout()
      if (hadSession) reportApiProblem(error, '登录状态已失效')
      return Promise.reject(error)
    }

    // 已退出登录（或本来就没有会话）的页面不该为了后台请求再打一次 refresh，
    // 否则登录页会收到一条并不属于用户的“登录状态已失效”诊断。
    if (!useAuthStore.getState().token) {
      return Promise.reject(error)
    }

    try {
      await refreshOnce()
      original._retried = true
      return api(original)
    } catch (refreshError) {
      useAuthStore.getState().logout()
      reportApiProblem(
        refreshError as AxiosError,
        '登录状态已失效，需要重新登录',
      )
      // 会话过期后，页面本身通常还停在原地；仅清 store 会留下一个所有请求
      // 都 401 的死页面。把用户送回登录，并带上当前地址，登录后原地恢复。
      if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/login')) {
        const next = `${window.location.pathname}${window.location.search}`
        window.location.assign(`/login?redirect=${encodeURIComponent(next)}`)
      }
      return Promise.reject(refreshError)
    }
  },
)
