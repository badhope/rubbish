import { useAuthStore, type AuthUser } from '@/lib/auth'

/**
 * QA-only bootstrap. Builds with VITE_QA_AUTOLOGIN_TOKEN set are served from
 * a loopback staging clone; the token is validated by the backend QA guard.
 * Production builds leave the variable undefined and this function is inert.
 */
export function installQaAuth(): void {
  const token = import.meta.env.VITE_QA_AUTOLOGIN_TOKEN
  if (!token) return

  const user: AuthUser = {
    id: Number(import.meta.env.VITE_QA_AUTOLOGIN_USER_ID || 89),
    username: import.meta.env.VITE_QA_AUTOLOGIN_USERNAME || 'rubbish_ai_admin',
    is_admin: true,
    roles: ['chief_editor', 'editor', 'editor_in_chief', 'reviewer'],
  }
  useAuthStore.getState().setAuth(token, user)
}
