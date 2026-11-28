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
  subject_disciplines?: string[] | null
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

export function useUnifiedSearch(
  kind: SearchKind,
  q: string | undefined,
  page: number,
  discipline?: string,
  pageSize = 20,
) {
  return useQuery<UnifiedSearchResponse>({
    queryKey: ['search', 'unified', q, kind, page, discipline, pageSize] as const,
    queryFn: async () =>
      (
        await api.get<UnifiedSearchResponse>('/search', {
          params: {
            q,
            ...(discipline ? { discipline } : {}),
            type: kind,
            page,
            page_size: kind === 'all' ? 6 : pageSize,
          },
        })
      ).data,
    enabled: Boolean(q) || Boolean(discipline),
    placeholderData: (prev) => prev,
  })
}
