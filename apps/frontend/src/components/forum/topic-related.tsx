import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { ArrowRight, BookOpen, MessagesSquare } from 'lucide-react'
import { api } from '@/lib/api'
import { typeLabel } from '@/lib/resource-labels'
import { formatDateTime } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'

export interface TopicLinkedWork {
  id: number
  title: string
  short_title?: string | null
  preview: string
  type: string
  discipline: string
  year: number
  authors: string[]
  reason?: string | null
}

interface RelatedTopic {
  id: number
  title: string
  board_name?: string | null
  board_path?: string | null
  reply_count: number
  last_reply_at?: string | null
  reason: string
}

interface TopicRelatedData {
  paper: TopicLinkedWork | null
  topics: RelatedTopic[]
  works: TopicLinkedWork[]
}

/**
 * The missing other half of `ForumTopic.paper_id`: show readers which work a
 * discussion belongs to, then keep them inside the site with sibling threads
 * and adjacent works. The endpoint applies the same visibility rules as the
 * topic detail page, so a pending topic cannot leak through this block.
 */
export function TopicRelated({ topicId }: { topicId: number }) {
  const { data } = useQuery<TopicRelatedData>({
    queryKey: ['forum', 'topic', topicId, 'related'],
    queryFn: async () => (await api.get<TopicRelatedData>(`/forum/topics/${topicId}/related`)).data,
    enabled: topicId > 0,
  })

  if (!data || (!data.paper && data.topics.length === 0 && data.works.length === 0)) {
    return null
  }

  return (
    <section className="rounded-xl border bg-card" aria-label="关联与延伸">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <h2 className="font-serif text-base font-semibold tracking-tight">关联与延伸</h2>
        <span className="text-[11px] text-muted-foreground">从这条讨论继续读</span>
      </div>

      {data.paper ? (
        <div className="border-b p-4">
          <div className="mb-2 flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <BookOpen className="h-3.5 w-3.5" />
            这条讨论关联的作品
          </div>
          <Link
            to="/catalog/$resourceId"
            params={{ resourceId: String(data.paper.id) }}
            className="group block rounded-lg border bg-muted/20 p-3 transition-colors hover:border-primary/35 hover:bg-muted/30"
          >
            <div className="flex flex-wrap items-center gap-0.5 text-[11px] text-muted-foreground">
              <span className="rounded-full bg-primary/10 px-2 py-0.5 text-primary">
                {data.paper.discipline}
              </span>
              <span aria-hidden>·</span>
              <span>{typeLabel(data.paper.type)}</span>
              {data.paper.year ? (
                <>
                  <span aria-hidden>·</span>
                  <span>{data.paper.year}</span>
                </>
              ) : null}
            </div>
            <div className="mt-1.5 flex items-start justify-between gap-3">
              <p className="font-serif text-[15px] font-semibold leading-snug group-hover:text-primary">
                {data.paper.short_title?.trim() || data.paper.title}
              </p>
              <ArrowRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground group-hover:text-primary" />
            </div>
            {data.paper.authors.length ? (
              <p className="mt-1 line-clamp-1 text-[11px] text-muted-foreground">
                {data.paper.authors.join('、')}
              </p>
            ) : null}
            {data.paper.preview ? (
              <p className="mt-1.5 line-clamp-2 text-xs leading-5 text-muted-foreground">
                {data.paper.preview}
              </p>
            ) : null}
          </Link>
        </div>
      ) : null}

      {data.topics.length ? (
        <div className="border-b p-4">
          <div className="mb-2 flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <MessagesSquare className="h-3.5 w-3.5" />
            相关讨论
          </div>
          <div className="space-y-1">
            {data.topics.map((topic) => (
              <Link
                key={topic.id}
                to="/forum/$topicId"
                params={{ topicId: String(topic.id) }}
                className="group flex items-start gap-2 rounded-md px-1.5 py-2 transition-colors hover:bg-muted/40"
              >
                <span className="mt-0.5 shrink-0">
                  <Badge variant="outline" className="h-5 px-1.5 text-[10px]">
                    {topic.reason}
                  </Badge>
                </span>
                <span className="min-w-0 flex-1">
                  <span className="line-clamp-1 text-sm font-medium group-hover:text-primary">
                    {topic.title}
                  </span>
                  <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                    {topic.board_name ? <span>{topic.board_name}</span> : null}
                    <span>{topic.reply_count} 回应</span>
                    {topic.last_reply_at ? (
                      <span>最后回应 {formatDateTime(topic.last_reply_at)}</span>
                    ) : null}
                  </span>
                </span>
                <ArrowRight className="mt-1 h-3.5 w-3.5 shrink-0 text-muted-foreground/60 group-hover:text-primary" />
              </Link>
            ))}
          </div>
        </div>
      ) : null}

      {data.works.length ? (
        <div className="p-4">
          <div className="mb-2 flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <BookOpen className="h-3.5 w-3.5" />
            同一方向的延伸阅读
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            {data.works.map((work) => (
              <Link
                key={work.id}
                to="/catalog/$resourceId"
                params={{ resourceId: String(work.id) }}
                className="group rounded-lg border p-3 transition-colors hover:border-primary/35 hover:bg-muted/20"
              >
                <div className="flex flex-wrap items-center gap-1 text-[10px] text-muted-foreground">
                  {work.reason ? (
                    <span className="rounded-full bg-muted px-1.5 py-0.5 text-foreground/70">
                      {work.reason}
                    </span>
                  ) : null}
                  <span>{work.year}</span>
                </div>
                <p className="mt-1.5 line-clamp-2 text-sm font-medium leading-5 group-hover:text-primary">
                  {work.short_title?.trim() || work.title}
                </p>
                {work.authors.length ? (
                  <p className="mt-1 line-clamp-1 text-[11px] text-muted-foreground">
                    {work.authors.join('、')}
                  </p>
                ) : null}
              </Link>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  )
}
