import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'

export interface CoinConfig {
  policy: { daily_earn_cap: number; monthly_issue_cap: number }
  rules: Array<{ reason: string; label: string; amount: number; daily_cap: number; is_active: boolean }>
  monthly_issued: number
}

export function useCoinConfig() {
  return useQuery({
    queryKey: ['coin', 'admin', 'config'],
    queryFn: async () => (await api.get<CoinConfig>('/gamification/admin/coin/config')).data,
  })
}

export function useUpdateCoinRule() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ reason, ...payload }: { reason: string; amount: number; daily_cap: number; is_active: boolean }) =>
      (await api.patch(`/gamification/admin/coin/rules/${reason}`, payload)).data,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['coin', 'admin', 'config'] })
      void qc.invalidateQueries({ queryKey: ['gamification', 'wallet'] })
    },
  })
}

export function useUpdateCoinPolicy() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (payload: { daily_earn_cap: number; monthly_issue_cap: number }) =>
      (await api.patch('/gamification/admin/coin/policy', payload)).data,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['coin', 'admin', 'config'] })
      void qc.invalidateQueries({ queryKey: ['gamification', 'wallet'] })
    },
  })
}
