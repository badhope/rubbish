import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import type { ExploreResourceCard, ExploreTopicCard } from './use-explore'

export type SearchKind = 'all' | 'resources' | 'topics' | 'people' | 'tags'

export interface SearchPersonCard {
  username: string
  display_name?: string | null
  avatar_url?: string | null
  bio?: string | null
  affiliation?: string | null
  works: number
  followers: number
}

export interface SearchTagCard {
  name: string
  count: number
}

export interface UnifiedSearchResponse {
  resources: ExploreResourceCard[]
  topics: ExploreTopicCard[]
  people: SearchPersonCard[]
  tags: SearchTagCard[]
  meta: {
    query: string
    kind: SearchKind
    page: number
    page_size: number
    totals: {
      resources: number
      topics: number
      people: number
      tags: number
    }
  }
}

export function useUnifiedSearch(kind: SearchKind, q: string | undefined, page: number) {
  return useQuery<UnifiedSearchResponse>({
    queryKey: ['search', 'unified', q, kind, page] as const,
    queryFn: async () =>
      (
        await api.get<UnifiedSearchResponse>('/search', {
          params: {
            q,
            type: kind,
            page,
            page_size: kind === 'all' ? 6 : 20,
          },
        })
      ).data,
    enabled: Boolean(q),
    placeholderData: (prev) => prev,
  })
}
