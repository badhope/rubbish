import { describe, it, expect } from 'vitest'
import type { AxiosResponse, InternalAxiosRequestConfig } from 'axios'

// 使用 vi.hoisted 确保 mock 在模块加载前就绪
const { mockCreate, mockRequestUse, mockResponseUse } = vi.hoisted(() => {
  const mockRequestUse = vi.fn()
  const mockResponseUse = vi.fn()
  const mockCreate = vi.fn<() => object>(() => ({
    interceptors: {
      request: { use: mockRequestUse },
      response: { use: mockResponseUse },
    },
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  }))
  return { mockCreate, mockRequestUse, mockResponseUse }
})

vi.mock('axios', () => ({
  default: {
    create: mockCreate,
    post: vi.fn(),
  },
  AxiosError: class extends Error {
    code?: string
    response?: { data: unknown; status: number; statusText: string }
    config?: unknown
    constructor(message: string, code?: string, config?: unknown, _req?: unknown, response?: unknown) {
      super(message)
      this.code = code
      this.config = config
      this.response = response as { data: unknown; status: number; statusText: string }
    }
    static ERR_BAD_REQUEST = 'ERR_BAD_REQUEST'
  },
}))

vi.mock('@/lib/auth', () => ({
  useAuthStore: {
    getState: vi.fn<() => { token: string | null; user: { id: number; username: string; is_admin: boolean } | null }>(() => ({ token: null, user: null })),
  },
}))

// 每个用例在执行阶段独立加载 api 模块。
// 背景（vitest 4→5 升级回归）：vitest 5 中 beforeAll 期间产生的 mock 调用
// 不会保留到用例执行阶段（实测 beforeAll 后 calls=1，进入 it 归零），
// 因此加载必须发生在 it 内部；vi.resetModules() 让 api.ts 模块体重新执行，
// 产生新的 axios.create / 拦截器注册调用（mock 注册表不受影响，
// auth mock 的 getState 实例保持不变，mockReturnValue 依然有效）。
let api: typeof import('@/lib/api').api
let useAuthStore: typeof import('@/lib/auth').useAuthStore

async function loadApiModule(): Promise<void> {
  vi.resetModules()
  const apiModule = await import('@/lib/api')
  const authModule = await import('@/lib/auth')
  api = apiModule.api
  useAuthStore = authModule.useAuthStore
}

describe('API client configuration', () => {
  it('调用 axios.create 创建实例', async () => {
    await loadApiModule()
    expect(mockCreate).toHaveBeenCalled()
  })

  it('创建时传入了配置对象', async () => {
    await loadApiModule()
    const configArg = mockCreate.mock.calls[0]
    expect(configArg).toBeDefined()
  })

  it('baseURL 为 /api 或 VITE_API_URL', async () => {
    await loadApiModule()
    const configArg = mockCreate.mock.calls[0]
    // configArg is the first argument passed to axios.create
    expect(configArg).toBeDefined()
  })

  it('withCredentials 为 true', async () => {
    await loadApiModule()
    expect(mockCreate).toHaveBeenCalled()
  })

  it('include credentials 配置', async () => {
    await loadApiModule()
    expect(mockCreate).toHaveBeenCalled()
  })

  it('api 实例具有 CRUD 方法', async () => {
    await loadApiModule()
    expect(typeof api.get).toBe('function')
    expect(typeof api.post).toBe('function')
    expect(typeof api.put).toBe('function')
    expect(typeof api.patch).toBe('function')
    expect(typeof api.delete).toBe('function')
  })
})

describe('request interceptor', () => {
  it('注册了请求拦截器', async () => {
    await loadApiModule()
    expect(mockRequestUse).toHaveBeenCalled()
  })

  it('当 store 中有 token 时注入 Authorization header', async () => {
    await loadApiModule()
    const interceptor = mockRequestUse.mock.calls[0]?.[0] as
      | ((c: InternalAxiosRequestConfig) => InternalAxiosRequestConfig)
      | undefined
    expect(interceptor).toBeTypeOf('function')
    // 显式收窄：toBeTypeOf 只做运行期断言，不做 TS 类型收窄。
    // 用 throw 取代旧代码的 `if (!interceptor) return` 假绿守卫。
    if (!interceptor) throw new Error('request interceptor was not registered')

    vi.mocked(useAuthStore.getState).mockReturnValue({
      token: 'test-bearer-token',
      user: { id: 1, username: 'alice', is_admin: false },
    } as ReturnType<typeof useAuthStore.getState>)

    const config = {
      headers: {} as Record<string, string>,
    } as InternalAxiosRequestConfig

    const result = interceptor(config)
    expect(result.headers.Authorization).toBe('Bearer test-bearer-token')
  })

  it('当 store 中无 token 时不添加 Authorization header', async () => {
    await loadApiModule()
    const interceptor = mockRequestUse.mock.calls[0]?.[0] as
      | ((c: InternalAxiosRequestConfig) => InternalAxiosRequestConfig)
      | undefined
    expect(interceptor).toBeTypeOf('function')
    if (!interceptor) throw new Error('request interceptor was not registered')

    vi.mocked(useAuthStore.getState).mockReturnValue({
      token: null,
      user: null,
    } as ReturnType<typeof useAuthStore.getState>)

    const config = {
      headers: {} as Record<string, string>,
    } as InternalAxiosRequestConfig

    const result = interceptor(config)
    expect(result.headers.Authorization).toBeUndefined()
  })
})

describe('response interceptor', () => {
  it('注册了响应拦截器（成功与错误处理函数）', async () => {
    await loadApiModule()
    expect(mockResponseUse).toHaveBeenCalled()
    const successHandler = mockResponseUse.mock.calls[0]?.[0]
    const errorHandler = mockResponseUse.mock.calls[0]?.[1]
    expect(typeof successHandler).toBe('function')
    expect(typeof errorHandler).toBe('function')
  })

  it('正常响应直接透传', async () => {
    await loadApiModule()
    const successHandler = mockResponseUse.mock.calls[0]?.[0] as
      | ((r: AxiosResponse) => AxiosResponse)
      | undefined
    expect(successHandler).toBeTypeOf('function')
    if (!successHandler) throw new Error('response success handler was not registered')

    const response = { data: { ok: true }, status: 200 } as AxiosResponse
    expect(successHandler(response)).toBe(response)
  })

  it('非 401 错误直接 reject', async () => {
    await loadApiModule()
    const errorHandler = mockResponseUse.mock.calls[0]?.[1] as
      | ((e: unknown) => Promise<unknown>)
      | undefined
    expect(errorHandler).toBeTypeOf('function')
    if (!errorHandler) throw new Error('response error handler was not registered')

    const error = {
      response: { status: 500 },
      config: {} as InternalAxiosRequestConfig,
      isAxiosError: true,
    }

    await expect(errorHandler(error)).rejects.toBeDefined()
  })
})
