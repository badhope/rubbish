import { describe, it, expect, beforeEach } from 'vitest'
import { useAuthStore, getAuthState, type AuthUser } from '@/lib/auth'

// 每个测试前重置 store 状态
beforeEach(() => {
  useAuthStore.setState({ token: null, user: null })
})

describe('useAuthStore', () => {
  const mockUser: AuthUser = { id: 1, username: 'alice', is_admin: false }
  const mockAdmin: AuthUser = { id: 2, username: 'admin', is_admin: true }

  describe('初始状态', () => {
    it('token 和 user 默认为 null', () => {
      const state = useAuthStore.getState()
      expect(state.token).toBeNull()
      expect(state.user).toBeNull()
    })
  })

  describe('setAuth', () => {
    it('同时设置 token 和 user', () => {
      useAuthStore.getState().setAuth('my-token', mockUser)
      const state = useAuthStore.getState()
      expect(state.token).toBe('my-token')
      expect(state.user).toEqual(mockUser)
    })

    it('传入空 token 时清空 token 和 user', () => {
      // 先设置有效状态
      useAuthStore.getState().setAuth('my-token', mockUser)
      // 再清空
      useAuthStore.getState().setAuth('', mockUser)
      const state = useAuthStore.getState()
      expect(state.token).toBeNull()
      expect(state.user).toBeNull()
    })

    it('支持 admin 用户', () => {
      useAuthStore.getState().setAuth('admin-token', mockAdmin)
      const state = useAuthStore.getState()
      expect(state.token).toBe('admin-token')
      expect(state.user?.is_admin).toBe(true)
    })
  })

  describe('setUser', () => {
    it('仅更新 user，保留 token', () => {
      useAuthStore.getState().setAuth('my-token', mockUser)
      useAuthStore.getState().setUser({ id: 1, username: 'alice_new', is_admin: false })
      const state = useAuthStore.getState()
      expect(state.token).toBe('my-token')
      expect(state.user?.username).toBe('alice_new')
    })
  })

  describe('logout', () => {
    it('清空 token 和 user', () => {
      useAuthStore.getState().setAuth('my-token', mockUser)
      expect(useAuthStore.getState().token).not.toBeNull()

      useAuthStore.getState().logout()
      const state = useAuthStore.getState()
      expect(state.token).toBeNull()
      expect(state.user).toBeNull()
    })

    it('重复 logout 不抛错', () => {
      useAuthStore.getState().logout()
      expect(() => useAuthStore.getState().logout()).not.toThrow()
    })
  })
})

describe('getAuthState', () => {
  it('未登录时返回 isAuthenticated: false', () => {
    const state = getAuthState()
    expect(state.token).toBeNull()
    expect(state.user).toBeNull()
    expect(state.isAuthenticated).toBe(false)
    expect(state.isAdmin).toBe(false)
  })

  it('登录后返回 isAuthenticated: true', () => {
    useAuthStore.getState().setAuth('tok', { id: 1, username: 'alice', is_admin: false })
    const state = getAuthState()
    expect(state.isAuthenticated).toBe(true)
    expect(state.isAdmin).toBe(false)
  })

  it('admin 用户返回 isAdmin: true', () => {
    useAuthStore.getState().setAuth('tok', { id: 2, username: 'admin', is_admin: true })
    const state = getAuthState()
    expect(state.isAdmin).toBe(true)
  })
})
