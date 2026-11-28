import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import type { MarginTopic, Passage } from '@/lib/margins'

/**
 * Every forum thread linked to one work, newest activity first. The key sits
 * under ['forum', ...] so the forum's own invalidations (replies, edits,
 * deletes) refresh the margins too.
 */
export function useWorkMargins(resourceId: number, enabled: boolean) {
  return useQuery<MarginTopic[]>({
    queryKey: ['forum', 'margins', resourceId],
    queryFn: async () =>
      (
        await api.get<{ data: MarginTopic[] }>('/forum/topics', {
          params: { paper_id: resourceId, page_size: 100, sort: 'latest' },
        })
      ).data.data,
    enabled: enabled && resourceId > 0,
    staleTime: 30_000,
  })
}

export interface MarginDraft {
  resourceId: number
  title: string
  body: string
  passage: Passage | null
}

/** Publish a margin note as an ordinary forum topic linked to the work. */
export function useCreateMarginTopic() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (draft: MarginDraft) => {
      const payload = {
        title: draft.title.trim(),
        body: draft.body.trim(),
        paper_id: draft.resourceId,
        passage: draft.passage,
        board_slug: 'discussion',
      }
      try {
        return (await api.post<MarginTopic>('/forum/topics', payload)).data
      } catch (err) {
        // A site that renamed or closed the writing board still accepts the
        // note: the forum then files it by content, as the main composer does.
        const status = (err as { response?: { status?: number } })?.response?.status
        if (status !== 404 && status !== 409) throw err
        const { board_slug: _ignored, ...rest } = payload
        return (await api.post<MarginTopic>('/forum/topics', rest)).data
      }
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['forum'] })
    },
  })
}
