import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'

export interface ExploreStats {
  resources: number
  topics: number
  members: number
  tags: number
}

export interface ExploreResourceCard {
  id: number
  title: string
  short_title?: string | null
  type: string
  discipline: string
  year: number
  cover_image?: string | null
  cover_theme?: string | null
  author_name: string
  author_username?: string | null
  reads: number
  downloads: number
  saves: number
  score: number
}

export interface ExploreTopicCard {
  id: number
  title: string
  excerpt: string
  reply_count: number
  agree_count: number
  helpful_count: number
  last_reply_at: string | null
  author_name: string
  author_username?: string | null
}

export interface ExploreAuthorCard {
  username: string
  display_name?: string | null
  avatar_url?: string | null
  works: number
  followers: number
  reads: number
  downloads: number
}

export interface ExploreTagCard {
  name: string
  count: number
}

export interface ExploreOverview {
  stats: ExploreStats
  top_resources: ExploreResourceCard[]
  top_topics: ExploreTopicCard[]
  top_authors: ExploreAuthorCard[]
  top_tags: ExploreTagCard[]
  generated_at: string
}

export interface FollowingFeed {
  resources: ExploreResourceCard[]
  topics: ExploreTopicCard[]
  followed_authors: number
  subscribed_disciplines: number
  followed_topics: number
  generated_at: string
}

export function useExploreOverview() {
  return useQuery<ExploreOverview>({
    queryKey: ['explore', 'overview'],
    queryFn: async () => (await api.get<ExploreOverview>('/explore/overview')).data,
    staleTime: 60_000,
  })
}

export function useFollowingFeed(enabled: boolean) {
  return useQuery<FollowingFeed>({
    queryKey: ['explore', 'following'],
    queryFn: async () => (await api.get<FollowingFeed>('/explore/following')).data,
    enabled,
    staleTime: 30_000,
  })
}
