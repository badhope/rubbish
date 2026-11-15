import { useMutation, useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import type { TwoFactorSetupResponse, TwoFactorStatusResponse } from '@/lib/types'

// All 2FA endpoints require a logged-in user (except /authenticate which
// consumes the 2fa_pending token). The hooks live in their own file so
// the auth.ts hook module stays focused on credentials.

export const TWO_FACTOR_KEY = ['two-factor'] as const

export function useTwoFactorStatus() {
  return useQuery<TwoFactorStatusResponse>({
    queryKey: [...TWO_FACTOR_KEY, 'status'],
    queryFn: async () => (await api.get<TwoFactorStatusResponse>('/auth/2fa/status')).data,
    staleTime: 30_000,
  })
}

// Setup is a 2-step dance: POST /setup returns secret + otpauth + 10
// backup codes. The user scans the QR and confirms with a code via
// /verify-setup. We surface both calls as one mutation so the UI can
// chain them in a single ``mutateAsync`` call.
export function useSetupTwoFactor() {
  return useMutation<TwoFactorSetupResponse, Error, void>({
    mutationFn: async () =>
      (await api.post<TwoFactorSetupResponse>('/auth/2fa/setup')).data,
  })
}

export function useVerifyTwoFactorSetup() {
  return useMutation<{ enabled: boolean }, Error, { code: string }>({
    mutationFn: async ({ code }) =>
      (await api.post<{ enabled: boolean }>('/auth/2fa/verify-setup', { code })).data,
  })
}

export function useAuthenticateTwoFactor() {
  return useMutation<
    import('@/lib/types').TokenResponse,
    Error,
    { two_factor_token: string; code?: string; backup_code?: string }
  >({
    mutationFn: async (body) => {
      const resp = await api.post<import('@/lib/types').TokenResponse>(
        '/auth/2fa/authenticate',
        body,
      )
      return resp.data
    },
  })
}

export function useDisableTwoFactor() {
  return useMutation<
    { enabled: false },
    Error,
    { password: string; code?: string; backup_code?: string }
  >({
    mutationFn: async (body) =>
      (await api.post<{ enabled: false }>('/auth/2fa/disable', body)).data,
  })
}

export function useRegenerateBackupCodes() {
  return useMutation<TwoFactorSetupResponse, Error, void>({
    mutationFn: async () =>
      (await api.post<TwoFactorSetupResponse>('/auth/2fa/backup-codes/regenerate')).data,
  })
}
