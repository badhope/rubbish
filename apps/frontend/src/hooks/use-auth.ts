import { useAuthStore, type AuthUser } from '@/lib/auth'

export function useAuth() {
  const token = useAuthStore((s) => s.token)
  const user = useAuthStore((s) => s.user)
  const setAuth = useAuthStore((s) => s.setAuth)
  const setUser = useAuthStore((s) => s.setUser)
  const logout = useAuthStore((s) => s.logout)

  return {
    token,
    user,
    isAuthenticated: !!token,
    isAdmin: user?.is_admin ?? false,
    setAuth,
    setUser: (user: AuthUser) => setUser(user),
    logout,
  }
}
