import { beforeEach, describe, expect, it } from 'vitest'
import axios, { AxiosError, AxiosHeaders } from 'axios'
import type { InternalAxiosRequestConfig, AxiosResponse } from 'axios'
import { api } from '@/lib/api'
import { useAuthStore } from '@/lib/auth'

/**
 * 用「替换 adapter」而非 mock axios 的方式测试：
 * 拦截器是 api.ts 真正的业务逻辑，只有让它在真实 axios 管道里跑，
 * 才能覆盖到「并发 401 共用一次刷新」这类竞态。
 *
 * - `api.defaults.adapter`       → 业务请求
 * - `axios.defaults.adapter`     → /auth/refresh（刷新走的是全局 axios 实例）
 * 两者互不干扰：api 实例在模块加载时就已经拷贝过 axios.defaults。
 */

function makeResponse<T>(
  config: InternalAxiosRequestConfig,
  data: T,
  status = 200,
): AxiosResponse<T> {
  return {
    data,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    headers: new AxiosHeaders(),
    config,
  }
}

function makeError(status: number, config: InternalAxiosRequestConfig) {
  return new AxiosError(
    `Request failed with status code ${status}`,
    status === 401 ? AxiosError.ERR_BAD_REQUEST : AxiosError.ERR_BAD_RESPONSE,
    config,
    undefined,
    {
      data: { detail: 'nope' },
      status,
      statusText: status === 401 ? 'Unauthorized' : 'Server Error',
      headers: new AxiosHeaders(),
      config,
    },
  )
}

/**
 * 让每个响应都跨一个宏任务，确保并发请求真的重叠（而不是串行跑完再断言）。
 * 必须传工厂函数而不是现成的 promise：`Promise.reject(x)` 一旦被求值，
 * 在 setTimeout 回调接管它之前就处于「无处理者」状态，Node 会报 unhandledRejection。
 */
function later<T>(factory: () => T | Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      try {
        resolve(factory())
      } catch (err) {
        reject(err)
      }
    }, 0)
  })
}

let business: (config: InternalAxiosRequestConfig) => Promise<AxiosResponse<unknown>>
let refreshImpl: (config: InternalAxiosRequestConfig) => Promise<AxiosResponse<unknown>>
let refreshCalls = 0
let refreshUrls: string[] = []

beforeEach(() => {
  useAuthStore.setState({ token: null, user: null })
  refreshCalls = 0
  refreshUrls = []

  business = async (config) => later(() => makeResponse(config, { ok: true }))
  refreshImpl = async (config) => {
    refreshCalls += 1
    refreshUrls.push(config.url ?? '')
    return later(() =>
      makeResponse(config, {
        access_token: 'new-token',
        user_id: 7,
        username: 'alice',
        is_admin: false,
      }),
    )
  }

  api.defaults.adapter = (config) => business(config)
  axios.defaults.adapter = (config) => refreshImpl(config)
})

describe('api 请求拦截器', () => {
  it('未登录时不注入 Authorization 头', async () => {
    let seen: InternalAxiosRequestConfig | undefined
    business = async (config) => {
      seen = config
      return makeResponse(config, {})
    }

    await api.get('/catalog')

    expect(seen?.headers.Authorization).toBeUndefined()
  })

  it('已登录时注入 Bearer access_token', async () => {
    useAuthStore.setState({
      token: 'tok-1',
      user: { id: 1, username: 'alice', is_admin: false },
    })

    let seen: InternalAxiosRequestConfig | undefined
    business = async (config) => {
      seen = config
      return makeResponse(config, {})
    }

    await api.get('/catalog')

    expect(seen?.headers.Authorization).toBe('Bearer tok-1')
  })

  it('paramsSerializer 用重复参数风格（FastAPI list[int] 契约）', () => {
    // 默认 axios 会序列化成 discipline_ids[]=1&discipline_ids[]=2，后端解析不到
    const uri = api.getUri({ url: '/catalog', params: { discipline_ids: [1, 2] } })

    expect(uri).toBe('/api/catalog?discipline_ids=1&discipline_ids=2')
  })
})

describe('api 401 刷新拦截器', () => {
  it('401 时刷新一次并重试原请求', async () => {
    useAuthStore.setState({
      token: 'old-token',
      user: { id: 1, username: 'alice', is_admin: false },
    })

    // 重试时 axios 会 mergeConfig 出一个新 config 对象，唯一可靠的「这是第几次」标记是 _retried
    business = async (config) => {
      if ((config as { _retried?: boolean })._retried) {
        return later(() => makeResponse(config, { ok: 'retried' }))
      }
      return later(() => Promise.reject<AxiosResponse>(makeError(401, config)))
    }

    const res = await api.get('/library')

    expect(refreshCalls).toBe(1)
    expect(refreshUrls).toEqual(['/api/auth/refresh'])
    expect(res.data).toEqual({ ok: 'retried' })
    // 刷新要把新 token 与新用户写回 store，否则重试仍然带着过期 token
    expect(useAuthStore.getState().token).toBe('new-token')
    expect(useAuthStore.getState().user).toEqual({
      id: 7,
      username: 'alice',
      is_admin: false,
    })
  })

  it('并发 401 共用同一次刷新，不会打出多个 /auth/refresh', async () => {
    useAuthStore.setState({
      token: 'old-token',
      user: { id: 1, username: 'alice', is_admin: false },
    })

    business = async (config) => {
      if ((config as { _retried?: boolean })._retried) {
        return later(() => makeResponse(config, { ok: true }))
      }
      return later(() => Promise.reject<AxiosResponse>(makeError(401, config)))
    }

    await Promise.all([api.get('/a'), api.get('/b'), api.get('/c')])

    // 三个请求同时 401，若每人各刷一次会互相把对方的 refresh cookie 顶掉
    expect(refreshCalls).toBe(1)
  })

  it('刷新成功但重试仍 401 时不再重试，直接抛出', async () => {
    useAuthStore.setState({
      token: 'old-token',
      user: { id: 1, username: 'alice', is_admin: false },
    })
    business = async (config) =>
      later(() => Promise.reject<AxiosResponse>(makeError(401, config)))

    await expect(api.get('/library')).rejects.toMatchObject({ response: { status: 401 } })
    expect(refreshCalls).toBe(1)
  })

  it('刷新接口自身 401 时清空登录态且不重试', async () => {
    useAuthStore.setState({
      token: 'old-token',
      user: { id: 1, username: 'alice', is_admin: false },
    })
    business = async (config) =>
      later(() => Promise.reject<AxiosResponse>(makeError(401, config)))

    await expect(api.post('/auth/refresh', {})).rejects.toMatchObject({
      response: { status: 401 },
    })

    // refresh_token 也死了 → 不能再拿它去换 token，直接登出由路由守卫弹回 /login
    expect(refreshCalls).toBe(0)
    expect(useAuthStore.getState().token).toBeNull()
    expect(useAuthStore.getState().user).toBeNull()
  })

  it('刷新失败（网络错误）时清空登录态', async () => {
    useAuthStore.setState({
      token: 'old-token',
      user: { id: 1, username: 'alice', is_admin: false },
    })
    business = async (config) =>
      later(() => Promise.reject<AxiosResponse>(makeError(401, config)))
    refreshImpl = async () => later(() => Promise.reject(new Error('Network Error')))

    await expect(api.get('/library')).rejects.toThrow('Network Error')
    expect(useAuthStore.getState().token).toBeNull()
  })

  it('非 401 错误直接透传，不触发刷新', async () => {
    business = async (config) =>
      later(() => Promise.reject<AxiosResponse>(makeError(500, config)))

    await expect(api.get('/library')).rejects.toMatchObject({ response: { status: 500 } })
    expect(refreshCalls).toBe(0)
  })
})
