import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'

export type AiScopeInfo = { scope: string; label: string }

export interface AiCapabilities {
  permission_role: 'user' | 'reviewer' | 'editor' | 'editor_in_chief'
  allowed_scopes: AiScopeInfo[]
  all_scopes: AiScopeInfo[]
  remote_mcp_url: string
  transport: string
  protocol_version: string
  auth: string
  tools_count: number
}

export interface ApiTokenRow {
  id: number
  name: string
  prefix: string
  scopes: string[]
  created_at: string
  last_used_at: string | null
  expires_at: string | null
  revoked_at: string | null
  status: 'active' | 'expired' | 'revoked'
  request_count: number
}

export interface CreateApiTokenBody {
  name: string
  scopes: string[]
  expires_days: number
}

export interface CreateApiTokenResponse extends ApiTokenRow {
  token: string
  warning: string
  allowed_scopes: string[]
}

export interface UpdateApiTokenBody {
  id: number
  name?: string
  scopes?: string[]
}

export const AI_ACCESS_KEY = ['ai-access'] as const

export function useAiCapabilities() {
  return useQuery<AiCapabilities>({
    queryKey: [...AI_ACCESS_KEY, 'capabilities'],
    queryFn: async () => (await api.get<AiCapabilities>('/ai/capabilities')).data,
  })
}

export function useAiTokens() {
  return useQuery<{ data: ApiTokenRow[]; count: number }>({
    queryKey: [...AI_ACCESS_KEY, 'tokens'],
    queryFn: async () => (await api.get<{ data: ApiTokenRow[]; count: number }>('/ai/tokens')).data,
  })
}

export function useCreateAiToken() {
  const qc = useQueryClient()
  return useMutation<CreateApiTokenResponse, Error, CreateApiTokenBody>({
    mutationFn: async (body) =>
      (await api.post<CreateApiTokenResponse>('/ai/tokens', body)).data,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: [...AI_ACCESS_KEY, 'tokens'] })
    },
  })
}

export function useUpdateAiToken() {
  const qc = useQueryClient()
  return useMutation<ApiTokenRow, Error, UpdateApiTokenBody>({
    mutationFn: async ({ id, ...body }) =>
      (await api.patch<ApiTokenRow>(`/ai/tokens/${id}`, body)).data,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: [...AI_ACCESS_KEY, 'tokens'] })
    },
  })
}

export function useRevokeAiToken() {
  const qc = useQueryClient()
  return useMutation<{ id: number; revoked: boolean }, Error, number>({
    mutationFn: async (id) => (await api.delete<{ id: number; revoked: boolean }>(`/ai/tokens/${id}`)).data,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: [...AI_ACCESS_KEY, 'tokens'] })
    },
  })
}
