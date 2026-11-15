import { createFileRoute, redirect } from '@tanstack/react-router'
import { useAuthStore } from '@/lib/auth'
import { api } from '@/lib/api'

export const Route = createFileRoute('/auth/oidc/callback')({
  // Extract the token from the URL fragment in beforeLoad so the login
  // page does not flash before we redirect to the dashboard.
  beforeLoad: async () => {
    // The backend puts access_token in the URL fragment (kept out of
    // server logs and the Referer header). The refresh_token is delivered
    // via an httpOnly cookie; the fragment copy is ignored.
    const hash = window.location.hash.replace(/^#/, '')
    const params = new URLSearchParams(hash)
    const accessToken = params.get('access_token')

    // Wipe the fragment as soon as the token is read so it does not
    // linger in browser history.
    if (window.location.hash) {
      window.history.replaceState(
        {},
        '',
        window.location.pathname + window.location.search,
      )
    }

    if (!accessToken) {
      throw redirect({ to: '/login' })
    }

    // Fetch the user profile via /auth/me; the refresh cookie is already set.
    useAuthStore.getState().setAuth(accessToken, { id: 0, username: '', is_admin: false })
    try {
      const { data } = await api.get('/auth/me')
      useAuthStore.getState().setAuth(accessToken, {
        id: data.id,
        username: data.username,
        is_admin: data.is_admin,
      })
    } catch {
      useAuthStore.getState().logout()
      throw redirect({ to: '/login' })
    }

    throw redirect({ to: '/dashboard' })
  },
  component: () => null,
})
