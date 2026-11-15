import axios, { type AxiosError, type InternalAxiosRequestConfig } from 'axios'
import { useAuthStore } from './auth'

// In production, fall back to same-origin /api when VITE_API_URL is not
// injected (avoids shipping a hard-coded localhost URL in the bundle).
// A global timeout keeps a stalled refresh / /auth/me from piling up requests.
const baseURL = import.meta.env.VITE_API_URL ?? '/api'

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
  return config
})

let refreshing: Promise<void> | null = null

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
        { withCredentials: true, timeout: 5_000 }, // shorter timeout for refresh
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
      return Promise.reject(error)
    }

    // If /auth/refresh itself returns 401, the refresh_token is also dead —
    // clear auth state so the route guard bounces to /login.
    if (original.url?.includes('/auth/refresh')) {
      useAuthStore.getState().logout()
      return Promise.reject(error)
    }

    try {
      await refreshOnce()
      original._retried = true
      return api(original)
    } catch (refreshError) {
      useAuthStore.getState().logout()
      return Promise.reject(refreshError)
    }
  },
)
