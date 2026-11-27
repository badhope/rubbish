import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'

export interface RelatedResource {
  id: number
  title: string
  short_title?: string | null
  type: string
  discipline: string
  year: number
  cover_image?: string | null
  author_name: string
  excerpt: string
  reason: string
}

export function useRelatedResources(resourceId: number, enabled = true) {
  return useQuery<{ data: RelatedResource[] }>({
    queryKey: ['catalog', 'related', resourceId] as const,
    queryFn: async () =>
      (await api.get<{ data: RelatedResource[] }>(`/catalog/${resourceId}/related`)).data,
    enabled: enabled && Number.isFinite(resourceId),
    staleTime: 5 * 60_000,
  })
}
