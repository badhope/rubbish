import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import type { CapabilitiesResponse } from '@/lib/types'

/**
 * Which operator-level integrations are live (email delivery, SSO).
 *
 * Copy that promises an email must be gated on this: the default backend
 * writes messages to the server log, so "check your inbox" would be a lie.
 */
export function useCapabilities() {
  return useQuery<CapabilitiesResponse>({
    queryKey: ['capabilities'],
    queryFn: async () => (await api.get<CapabilitiesResponse>('/capabilities')).data,
    staleTime: 5 * 60_000,
  })
}
