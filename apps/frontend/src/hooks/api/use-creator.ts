import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'

export interface CreatorWork {
  id: number
  title: string
  full_title: string
  cover_image?: string | null
  discipline: string
  published_at: string
  reads: number
  downloads: number
  saves: number
  comments: number
}

export interface CreatorComment {
  id: number
  resource_id: number
  resource_title: string
  body: string
  created_at: string
  author_username: string
  author_display_name?: string | null
}

export interface CreatorOverview {
  published: number
  followers: number
  forum_topics: number
  forum_replies: number
  totals: {
    reads: number
    downloads: number
    saves: number
    comments: number
  }
  page_views: {
    days: number
    total: number
    daily: Array<{ date: string; views: number }>
  }
  works: CreatorWork[]
  recent_comments: CreatorComment[]
}

export function useCreatorOverview() {
  return useQuery<CreatorOverview>({
    queryKey: ['me', 'creator'],
    queryFn: async () => (await api.get<CreatorOverview>('/me/creator')).data,
    staleTime: 60_000,
  })
}
