import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { downloadBlob, extractError } from '@/lib/utils'
import { toast } from 'sonner'
import type {
  AdminAnalytics,
  AdminUserCreateResponse,
  Announcement,
  AssignableRole,
  AssignmentCreate,
  AssignmentListResponse,
  AppealItem,
  AppealKind,
  AppealListResponse,
  AppealStatus,
  AssignmentResponse,
  AuditLogEntry,
  AuthorFollowListResponse,
  DisciplineOption,
  DisciplineSubscriptionListResponse,
  FetchRequest,
  FollowStatusResponse,
  GamificationProfile,
  IngestResource,
  LadderResponse,
  LevelSnapshot,
  MessageResponse,
  MonthlyOpsReport,
  NotificationListResponse,
  NotificationResponse,
  ParseRequest,
  ParseResponse,
  PublicExpertiseResponse,
  PublicReviewResponse,
  ReleaseIssueSummary,
  ReleaseManifest,
  QualityRubric,
  ReadingListCreate,
  ReadingListDetailResponse,
  ReadingListItemCreate,
  ReadingListListResponse,
  ReadingListUpdate,
  ReadingProgressResponse,
  ReadingProgressUpdate,
  ReadingHistoryListResponse,
  RecommendationListResponse,
  ResourceCreate,
  ResourceListParams,
  ResourceListResponse,
  ResourceResponse,
  ResourceStats,
  ResourceUpdate,
  ResourceAnalytics,
  ReviewMatrixResponse,
  SiteSettingsResponse,
  ReviewDraftResponse,
  ReviewReportResponse,
  ReviewSubmit,
  SubmissionTimelineResponse,
  EditorReportSearchResponse,
  SubmissionBatchCreate,
  SubmissionBatchResponse,
  SubmissionCreate,
  SubmissionDecision,
  SubmissionListResponse,
  SubmissionOverview,
  SubmissionResponse,
  SubmissionUpdate,
  SubmissionVersionDiff,
  SubmissionVersionListResponse,
  SubmissionVersionResponse,
  SubscriptionStatusResponse,
  UnreadCountResponse,
  UserResponse,
  QualityForm,
  DimensionScoreInput,
  QualityScoreResult,
  AdminClaimDecideRequest,
  AdminClaimListResponse,
  AssignOwnerRequest,
  AuthorEditInput,
  ClaimStatusResponse,
  ClaimSubmitRequest,
  ClaimSubmitResponse,
} from '@/lib/types'

// query key 工厂，避免散落字符串
export const keys = {
  catalog: {
    list: (params: ResourceListParams) => ['catalog', 'list', params] as const,
    detail: (id: number) => ['catalog', 'detail', id] as const,
    stats: () => ['catalog', 'stats'] as const,
  },
  reader: {
    progress: (id: number) => ['reader', 'progress', id] as const,
    history: (page = 1) => ['reader', 'history', page] as const,
  },
  submission: {
    // page 必须进 key：queryFn 用了它，key 里没有就会出现「翻页后 60 秒内
    // 仍显示上一页」（staleTime 内命中同一 key 不会 refetch）。
    mine: (status?: string, page = 1, pageSize = 20) =>
      ['submissions', 'mine', status ?? 'all', page, pageSize] as const,
    all: (status?: string, page = 1, pageSize = 20) =>
      ['submissions', 'all', status ?? 'all', page, pageSize] as const,
    pending: (page = 1, pageSize = 20) =>
      ['submissions', 'pending', page, pageSize] as const,
    detail: (id: number) => ['submissions', 'detail', id] as const,
    assignments: (id: number) => ['submissions', id, 'assignments'] as const,
    reports: (id: number) => ['submissions', id, 'reports'] as const,
    versions: (id: number) => ['submissions', id, 'versions'] as const,
  },
  review: {
    myAssignments: (status?: string, page = 1, pageSize = 20) =>
      ['review', 'my-assignments', status ?? 'all', page, pageSize] as const,
    assignment: (id: number) => ['review', 'assignment', id] as const,
    // 审稿人查看分配稿件的完整内容
    submission: (assignmentId: number) =>
      ['review', 'assignment', assignmentId, 'submission'] as const,
  },
  library: {
    list: (page = 1) => ['library', 'list', page] as const,
    public: (page = 1) => ['library', 'public', page] as const,
    detail: (id: number) => ['library', 'detail', id] as const,
  },
  forum: {
    starter: () => ['forum', 'starter'] as const,
    credit: () => ['forum', 'credit'] as const,
  },
  notifications: {
    // pageSize 也要进 key：仪表盘取 (1,5)、通知页取 (1,20)，
    // 只带 page 会让两者共用一个缓存条目、互相污染数据。
    list: (page = 1, pageSize = 20) =>
      ['notifications', 'list', page, pageSize] as const,
    unread: () => ['notifications', 'unread'] as const,
  },
  recommendations: {
    me: (limit = 10) => ['recommendations', 'me', limit] as const,
  },
  admin: {
    users: (limit = 50, offset = 0) => ['admin', 'users', limit, offset] as const,
    usersSearch: (limit = 50, offset = 0, query = '') =>
      ['admin', 'users', limit, offset, query] as const,
    audit: (limit = 50, offset = 0) => ['admin', 'audit', limit, offset] as const,
    siteSettings: () => ['admin', 'site-settings'] as const,
    claims: (status: string) => ['admin', 'claims', status] as const,
    releaseIssues: () => ['admin', 'release-issues'] as const,
    releaseManifests: (volume: string, issue: string) =>
      ['admin', 'release-manifests', volume, issue] as const,
  },
  claims: {
    status: (resourceId: number) => ['claims', 'status', resourceId] as const,
  },
  follows: {
    author: (name: string) => ['follows', 'author', name] as const,
    discipline: (slug: string) => ['follows', 'discipline', slug] as const,
    myAuthors: (page = 1) => ['follows', 'my-authors', page] as const,
    myDisciplines: () => ['follows', 'my-disciplines'] as const,
  },
  gamification: {
    profile: () => ['gamification', 'profile'] as const,
    ladder: () => ['gamification', 'ladder'] as const,
  },
  announcements: {
    active: () => ['announcements', 'active'] as const,
    all: () => ['announcements', 'all'] as const,
  },
  quality: {
    rubric: () => ['quality', 'rubric'] as const,
  },
  issuePlan: () => ['catalog', 'issue-plan'] as const,
} as const

// --- Catalog ---
export function useResources(params: ResourceListParams = {}, enabled = true) {
  return useQuery<ResourceListResponse>({
    queryKey: keys.catalog.list(params),
    queryFn: async () => (await api.get<ResourceListResponse>('/catalog', { params })).data,
    enabled,
    placeholderData: (prev) => prev,
    // 目录会随刊出变化：30 秒内视为新鲜，切回页面时自动刷新。
    staleTime: 30_000,
    // 公开目录里的阅读数、下载数、篇数都是库里的实时值；列表页停留时
    // 每分钟静默重取一次，避免数字停在打开页面那一刻。
    refetchInterval: 60_000,
  })
}

export function useResource(id: number) {
  return useQuery<ResourceResponse>({
    queryKey: keys.catalog.detail(id),
    queryFn: async () => (await api.get<ResourceResponse>(`/catalog/${id}`)).data,
    enabled: id > 0,
    staleTime: 30_000,
    // 阅读/下载/收藏计数由服务端实时累计：文章页停留时每 60 秒轻量刷新，
    // 不要求用户手动刷新页面才能看到最新数字。
    refetchInterval: 60_000,
  })
}

export function usePublicReviews(id: number, enabled = true) {
  return useQuery<PublicReviewResponse>({
    queryKey: ['catalog', 'reviews', id],
    queryFn: async () => (await api.get<PublicReviewResponse>(`/catalog/${id}/reviews`)).data,
    enabled: id > 0 && enabled,
    staleTime: 60_000,
  })
}

export function useAdminAnalytics(days = 7) {
  return useQuery<AdminAnalytics>({
    queryKey: ['admin', 'analytics', days],
    queryFn: async () =>
      (await api.get<AdminAnalytics>('/admin/analytics/summary', { params: { days } })).data,
    staleTime: 60_000,
    refetchInterval: 60_000,
  })
}

export function useCatalogStats(track?: 'paper' | 'essay') {
  return useQuery<ResourceStats>({
    queryKey: [...keys.catalog.stats(), track ?? 'all'],
    queryFn: async () => (await api.get<ResourceStats>('/catalog/stats', { params: track ? { track } : undefined })).data,
    staleTime: 30_000,
    // 首页、/papers、/fun 的计数都从这个接口来；30 秒轮询保证不写死、
    // 也不会因为缓存把「刚刊出」的文章数压住。
    refetchInterval: 30_000,
  })
}

export function useEditorialPicks(limit = 10) {
  return useQuery<ResourceListResponse>({
    queryKey: ['catalog', 'editorial', limit] as const,
    queryFn: async () =>
      (await api.get<ResourceListResponse>('/catalog/editorial', { params: { limit } })).data,
    staleTime: 60_000,
  })
}

export function useCreateResource() {
  const qc = useQueryClient()
  return useMutation<ResourceResponse, Error, ResourceCreate>({
    mutationFn: async (body) => (await api.post<ResourceResponse>('/catalog', body)).data,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['catalog'] })
    },
  })
}

export function useUpdateResource() {
  const qc = useQueryClient()
  return useMutation<
    ResourceResponse,
    Error,
    { id: number; body: ResourceUpdate }
  >({
    mutationFn: async ({ id, body }) =>
      (await api.patch<ResourceResponse>(`/catalog/${id}`, body)).data,
    onSuccess: (data, { id }) => {
      qc.setQueryData(keys.catalog.detail(id), data)
      void qc.invalidateQueries({ queryKey: ['catalog'] })
    },
  })
}

export function useDeleteResource() {
  const qc = useQueryClient()
  return useMutation<void, Error, number>({
    mutationFn: async (id) => {
      await api.delete(`/catalog/${id}`)
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['catalog'] })
    },
  })
}

export type CitationExportFormat = 'bibtex' | 'ris' | 'csv' | 'json' | 'jats'
export type DocumentExportFormat = 'pdf' | 'docx' | 'zip'
export type AnyExportFormat = CitationExportFormat | DocumentExportFormat

export interface ExportPreflightWarning {
  resource_id: number | string
  title: string
  code: 'missing_title' | 'missing_authors' | 'missing_year' | 'missing_doi' | string
  message: string
}

export interface ExportPreflightResponse {
  requested_count: number
  resolved_count: number
  missing_ids: number[]
  warnings: ExportPreflightWarning[]
  can_export: boolean
}

// 导出前先查字段完整性：缺标题/作者/年份/DOI 时由页面弹窗确认，
// 不静默生成空字段的引用文件。
export async function exportPreflight(ids: number[]): Promise<ExportPreflightResponse> {
  const res = await api.get<ExportPreflightResponse>('/export/preflight', { params: { ids } })
  return res.data
}

export async function exportDocuments(ids: number[], format: DocumentExportFormat) {
  const res = await api.get('/export/documents', {
    params: { ids, format },
    responseType: 'blob',
    timeout: 200000,
  })
  const fallback = `rubbish-collection.${format}`
  downloadBlob(res.data, res.headers['content-disposition'] ?? '', fallback)
}

// Export 走 blob，触发浏览器下载
export async function exportResources(ids: number[], format: CitationExportFormat) {
  const res = await api.get('/export', {
    params: { ids, format },
    responseType: 'blob',
  })
  downloadBlob(res.data, res.headers['content-disposition'] ?? '', `export.${format}`)
}

// --- Reader ---
export function useReadingProgress(
  resourceId: number,
  options?: { enabled?: boolean },
) {
  return useQuery<ReadingProgressResponse | null>({
    queryKey: keys.reader.progress(resourceId),
    queryFn: async () => {
      try {
        return (await api.get<ReadingProgressResponse>(`/reader/history/${resourceId}/progress`))
          .data
      } catch (err) {
        // 404 = 这个用户还没读过这篇，是正常状态而不是错误。
        // 之前它会走重试并往控制台打红字，看起来像坏页面。
        const status = (err as { response?: { status?: number } }).response?.status
        if (status === 404) return null
        throw err
      }
    },
    // 访客不发请求：阅读进度接口需要登录，未登录时只会得到 401。
    enabled: resourceId > 0 && (options?.enabled ?? true),
  })
}

export function useRecordView() {
  const qc = useQueryClient()
  return useMutation<MessageResponse, Error, number>({
    mutationFn: async (resourceId) =>
      (await api.post<MessageResponse>(`/reader/history/${resourceId}`)).data,
    onSuccess: () => {
      // Without this, the reading-history list never sees the new entry.
      void qc.invalidateQueries({ queryKey: ['reader'] })
    },
  })
}

// 阅读历史（继续阅读卡数据源）：带资源元信息，一次请求即可渲染。
export function useReadingHistory(page = 1, pageSize = 5) {
  return useQuery<ReadingHistoryListResponse>({
    queryKey: keys.reader.history(page),
    queryFn: async () =>
      (await api.get<ReadingHistoryListResponse>('/reader/history', {
        params: { page, page_size: pageSize },
      })).data,
    staleTime: 30_000,
  })
}

export function useUpdateProgress() {
  const qc = useQueryClient()
  return useMutation<
    ReadingProgressResponse,
    Error,
    { resourceId: number; body: ReadingProgressUpdate }
  >({
    mutationFn: async ({ resourceId, body }) =>
      (await api.put<ReadingProgressResponse>(`/reader/history/${resourceId}/progress`, body)).data,
    onSuccess: (data, { resourceId }) => {
      qc.setQueryData(keys.reader.progress(resourceId), data)
    },
  })
}

export function useRemoveFromHistory() {
  const qc = useQueryClient()
  return useMutation<MessageResponse, Error, number>({
    mutationFn: async (resourceId) =>
      (await api.delete<MessageResponse>(`/reader/history/${resourceId}`)).data,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['reader'] })
    },
  })
}

// --- Submission ---
export interface SubmissionDraft {
  payload: Record<string, unknown>
  body: string
  updated_at: string
}

interface SubmissionDraftState {
  draft: SubmissionDraft | null
}

export function useSubmissionDraft(enabled = true) {
  return useQuery<SubmissionDraftState>({
    queryKey: ['submissions', 'draft'],
    queryFn: async () =>
      (await api.get<SubmissionDraftState>('/submissions/draft')).data,
    enabled,
  })
}

export function useSaveSubmissionDraft() {
  const qc = useQueryClient()
  return useMutation<
    SubmissionDraftState,
    Error,
    { payload: Record<string, unknown>; body: string }
  >({
    mutationFn: async (body) =>
      (await api.put<SubmissionDraftState>('/submissions/draft', body)).data,
    onSuccess: (data) => {
      qc.setQueryData(['submissions', 'draft'], data)
    },
  })
}

export function useDeleteSubmissionDraft() {
  const qc = useQueryClient()
  return useMutation<MessageResponse, Error, void>({
    mutationFn: async () =>
      (await api.delete<MessageResponse>('/submissions/draft')).data,
    onSuccess: () => {
      qc.setQueryData(['submissions', 'draft'], { draft: null })
    },
  })
}

export function useCreateSubmission() {
  const qc = useQueryClient()
  return useMutation<SubmissionResponse, Error, SubmissionCreate>({
    mutationFn: async (body) =>
      (await api.post<SubmissionResponse>('/submissions', body)).data,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['submissions'] })
    },
  })
}

export function useCreateSubmissionsBatch() {
  const qc = useQueryClient()
  return useMutation<SubmissionBatchResponse, Error, SubmissionBatchCreate>({
    mutationFn: async (body) =>
      (await api.post<SubmissionBatchResponse>('/submissions/batch', body)).data,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['submissions'] })
    },
  })
}

export function useMySubmissions(
  status?: string,
  page = 1,
  pageSize = 20,
  options?: { enabled?: boolean },
) {
  return useQuery<SubmissionListResponse>({
    queryKey: keys.submission.mine(status, page, pageSize),
    queryFn: async () =>
      (await api.get<SubmissionListResponse>('/submissions/me', {
        params: { status, page, page_size: pageSize },
      })).data,
    enabled: options?.enabled ?? true,
  })
}

export function useSubmissionOverview() {
  return useQuery<SubmissionOverview>({
    queryKey: ['submissions', 'overview'] as const,
    queryFn: async () => (await api.get<SubmissionOverview>('/submissions/overview')).data,
  })
}

export function useAllSubmissions(status?: string, page = 1, pageSize = 20) {
  return useQuery<SubmissionListResponse>({
    queryKey: keys.submission.all(status, page, pageSize),
    queryFn: async () =>
      (await api.get<SubmissionListResponse>('/submissions', {
        params: { status, page, page_size: pageSize },
      })).data,
  })
}

export interface ReviewerCandidate {
  id: number
  username: string
  email: string
  /** 可解释匹配分；未传 submissionId 时为 0。 */
  score?: number
  active_assignments?: number
  completed_reviews?: number
  matched_keywords?: string[]
  match_reasons?: string[]
  /** P1-7：审稿人自填能力标签。 */
  reviewer_tags?: string[]
  /** 受控学科标签（Discipline.slug 数组），与稿件学科精确匹配。 */
  reviewer_disciplines?: string[]
  /** P1-8：是否已提交当前年度利益冲突声明。 */
  coi_declared?: boolean
  coi_year?: number
  /** 声明命中作者姓名/通讯邮箱时为 true；分派接口会 409。 */
  conflict?: boolean
  conflict_reasons?: string[]
}

export interface CoiDeclaration {
  year: number
  declared: boolean
  conflicts: string[]
  notes?: string | null
  declared_at?: string | null
  updated_at?: string | null
}

export interface CoiDeclarationInput {
  conflicts: string[]
  notes?: string | null
}

export function useMyCoiDeclaration() {
  return useQuery<CoiDeclaration>({
    queryKey: ['review', 'coi', 'me'] as const,
    queryFn: async () => (await api.get<CoiDeclaration>('/review/conflicts/me')).data,
  })
}

export function useSaveMyCoiDeclaration() {
  const queryClient = useQueryClient()
  return useMutation<CoiDeclaration, Error, CoiDeclarationInput>({
    mutationFn: async (input) =>
      (await api.put<CoiDeclaration>('/review/conflicts/me', input)).data,
    onSuccess: (data) => {
      queryClient.setQueryData(['review', 'coi', 'me'], data)
      queryClient.invalidateQueries({ queryKey: ['submissions', 'reviewer-candidates'] })
      toast.success(`${data.year} 年度利益冲突声明已保存`)
    },
    onError: (error) => toast.error(extractError(error, '声明保存失败')),
  })
}

export function useReviewerCandidates(
  limit = 200,
  submissionId?: number,
  discipline?: string,
) {
  return useQuery<ReviewerCandidate[]>({
    queryKey: ['submissions', 'reviewer-candidates', limit, submissionId, discipline] as const,
    queryFn: async () =>
      (
        await api.get<{ data: ReviewerCandidate[] }>('/submissions/reviewer-candidates', {
          params: {
            limit,
            ...(submissionId ? { submission_id: submissionId } : {}),
            ...(discipline ? { discipline } : {}),
          },
        })
      ).data.data,
    staleTime: 60_000,
  })
}

/** 学科词表（公开）：审稿人自选学科标签 / 指派筛选用。 */
export function useDisciplines() {
  return useQuery<DisciplineOption[]>({
    queryKey: ['catalog', 'disciplines'] as const,
    queryFn: async () => (await api.get<DisciplineOption[]>('/catalog/disciplines')).data,
    staleTime: 5 * 60_000,
  })
}

/** 审稿团队匿名专长画像（公开，无身份信息）：投稿页展示。 */
export function usePublicExpertise() {
  return useQuery<PublicExpertiseResponse>({
    queryKey: ['review', 'public-expertise'] as const,
    queryFn: async () =>
      (await api.get<PublicExpertiseResponse>('/review/public-expertise')).data,
    staleTime: 5 * 60_000,
  })
}

export interface ReviewerWorkload {
  reviewer_id: number
  username: string
  active_count: number
  completed_count: number
  overdue_count: number
  total_count: number
}

export function useReviewerWorkload() {
  return useQuery<ReviewerWorkload[]>({
    queryKey: ['editor', 'reviewer-workload'] as const,
    queryFn: async () =>
      (
        await api.get<{ items: ReviewerWorkload[] }>('/editor/workbench/reviewers')
      ).data.items,
    staleTime: 60_000,
  })
}

export interface CalibrationReviewerRow {
  reviewer_id: number
  username: string
  completed_reviews: number
  avg_score: number | null
  avg_deviation: number | null
  avg_abs_deviation: number | null
  accept_rate: number | null
  flags: string[]
}

export interface CalibrationResponse {
  year: number
  quarter: number
  period_start: string
  period_end: string
  submission_count: number
  reviewers: CalibrationReviewerRow[]
  generated_at: string
}

export function useReviewerCalibration(year?: number, quarter?: number) {
  return useQuery<CalibrationResponse>({
    queryKey: ['review', 'calibration', year ?? 'current', quarter ?? 'current'] as const,
    queryFn: async () =>
      (
        await api.get<CalibrationResponse>('/review/calibration', {
          params: { ...(year ? { year } : {}), ...(quarter ? { quarter } : {}) },
        })
      ).data,
  })
}



export interface CalibrationSampleScore {
  label: string
  score: number
  recommendation: string
}

export interface CalibrationSample {
  id: number
  year: number
  quarter: number
  submission_id: number
  title: string
  abstract: string
  discipline: string
  reviewer_scores: CalibrationSampleScore[]
  consensus_score: number | null
  score_spread: number | null
  review_count: number
  created_at: string
}

export interface CalibrationSampleListResponse {
  year: number
  quarter: number
  period_start: string
  period_end: string
  samples: CalibrationSample[]
}

export function useCalibrationSamples(year?: number, quarter?: number) {
  return useQuery<CalibrationSampleListResponse>({
    queryKey: ['review', 'calibration-samples', year ?? 'current', quarter ?? 'current'] as const,
    queryFn: async () =>
      (
        await api.get<CalibrationSampleListResponse>('/review/calibration/samples', {
          params: { ...(year ? { year } : {}), ...(quarter ? { quarter } : {}) },
        })
      ).data,
  })
}

export function useCreateCalibrationSamples() {
  const qc = useQueryClient()
  return useMutation<CalibrationSampleListResponse, Error, { year: number; quarter: number }>({
    mutationFn: async ({ year, quarter }) =>
      (await api.post<CalibrationSampleListResponse>('/review/calibration/samples', { year, quarter })).data,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['review', 'calibration-samples'] })
    },
  })
}

export interface TriageDecisionInput {
  id: number
  decision: 'send_to_review' | 'return_for_revision' | 'desk_reject' | 'request_materials'
  note?: string
}

export function useTriageQueue(page = 1, pageSize = 20, options?: { enabled?: boolean }) {
  return useQuery<SubmissionListResponse>({
    queryKey: ['submissions', 'triage', page, pageSize] as const,
    queryFn: async () =>
      (await api.get<SubmissionListResponse>('/submissions/triage', {
        params: { page, page_size: pageSize },
      })).data,
    enabled: options?.enabled ?? true,
  })
}

export function useTriageSubmission() {
  const queryClient = useQueryClient()
  return useMutation<SubmissionResponse, Error, TriageDecisionInput>({
    mutationFn: async ({ id, decision, note }) =>
      (
        await api.post<SubmissionResponse>(`/submissions/${id}/triage`, {
          decision,
          note: note ?? '',
        })
      ).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['submissions'] })
    },
    onError: (error) => toast.error(extractError(error, '初筛失败')),
  })
}

export function usePendingSubmissions(
  page = 1,
  pageSize = 20,
  options?: { enabled?: boolean },
) {
  return useQuery<SubmissionListResponse>({
    queryKey: keys.submission.pending(page, pageSize),
    queryFn: async () =>
      (await api.get<SubmissionListResponse>('/submissions/pending', {
        params: { page, page_size: pageSize },
      })).data,
    // 待审队列是编辑接口（require_editor）：不校权就发请求，普通用户
    // 只会拿到 403 噪音，控制台和日志都不干净。
    enabled: options?.enabled ?? true,
  })
}

export function useDeleteSubmission() {
  const qc = useQueryClient()
  return useMutation<MessageResponse, Error, number>({
    mutationFn: async (id) => (await api.delete<MessageResponse>(`/submissions/${id}`)).data,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['submissions'] })
    },
  })
}

export function useSubmission(id: number) {
  return useQuery<SubmissionResponse>({
    queryKey: keys.submission.detail(id),
    queryFn: async () =>
      (await api.get<SubmissionResponse>(`/submissions/${id}`)).data,
    enabled: id > 0,
  })
}

// 编辑分配审稿人（单选旧端点，保留兼容）
export function useAssignReviewer() {
  const qc = useQueryClient()
  return useMutation<AssignmentResponse, Error, { id: number; body: AssignmentCreate }>({
    mutationFn: async ({ id, body }) =>
      (await api.post<AssignmentResponse>(`/submissions/${id}/assignments`, body)).data,
    onSuccess: (_, { id }) => {
      void qc.invalidateQueries({ queryKey: keys.submission.assignments(id) })
      void qc.invalidateQueries({ queryKey: ['submissions', id, 'matrix'] })
      void qc.invalidateQueries({ queryKey: ['submissions'] })
    },
  })
}

// 编辑批量指派审稿人（多选一次指派 slot 1/2/3，后端 e623556 已支持）
export function useAssignReviewersBulk() {
  const qc = useQueryClient()
  return useMutation<
    { assigned: number; submission_id: number },
    Error,
    {
      id: number
      body: {
        reviewer_ids: number[]
        due_days?: number
        is_external?: boolean
        external_affiliation?: string
      }
    }
  >({
    mutationFn: async ({ id, body }) =>
      (await api.post<{ assigned: number; submission_id: number }>(
        `/review/submissions/${id}/assign`,
        body,
      )).data,
    onSuccess: (_, { id }) => {
      void qc.invalidateQueries({ queryKey: keys.submission.assignments(id) })
      void qc.invalidateQueries({ queryKey: ['submissions', id, 'matrix'] })
      void qc.invalidateQueries({ queryKey: ['submissions'] })
    },
  })
}

export function useReviewMatrix(id: number) {
  return useQuery({
    queryKey: ['submissions', id, 'matrix'],
    queryFn: async () =>
      (await api.get<ReviewMatrixResponse>(`/review/submissions/${id}/matrix`)).data,
    enabled: id > 0,
  })
}

export function useAssignAdjudicator() {
  const qc = useQueryClient()
  return useMutation<
    { submission_id: number; assignment_id: number; reviewer_id: number },
    Error,
    { id: number; reviewer_id: number; due_days?: number; reason?: string }
  >({
    mutationFn: async ({ id, ...body }) =>
      (await api.post(`/review/submissions/${id}/adjudicate`, body)).data,
    onSuccess: (_d, v) => {
      void qc.invalidateQueries({ queryKey: ['submissions', v.id, 'matrix'] })
      void qc.invalidateQueries({ queryKey: ['submissions', v.id, 'assignments'] })
      void qc.invalidateQueries({ queryKey: ['review', 'my-assignments'] })
    },
  })
}

export function useSubmissionAssignments(id: number) {
  return useQuery<AssignmentListResponse>({
    queryKey: keys.submission.assignments(id),
    queryFn: async () =>
      (await api.get<AssignmentListResponse>(`/submissions/${id}/assignments`)).data,
    enabled: id > 0,
  })
}

export function useCancelAssignment() {
  const qc = useQueryClient()
  return useMutation<MessageResponse, Error, { submissionId: number; assignmentId: number }>({
    mutationFn: async ({ submissionId, assignmentId }) =>
      (await api.delete<MessageResponse>(
        `/submissions/${submissionId}/assignments/${assignmentId}`,
      )).data,
    onSuccess: (_, { submissionId }) => {
      void qc.invalidateQueries({ queryKey: keys.submission.assignments(submissionId) })
      // 主编工作台的「在审」栏也必须立刻刷新，否则取消后仍挂着旧审稿人。
      void qc.invalidateQueries({ queryKey: ['workbench'] })
    },
  })
}

// 免评审录用：desk accept 的前置声明，理由必填（≥10 字）
export function useWaiveReview() {
  const qc = useQueryClient()
  return useMutation<SubmissionResponse, Error, { id: number; reason: string }>({
    mutationFn: async ({ id, reason }) =>
      (await api.post<SubmissionResponse>(`/submissions/${id}/waive-review`, { reason })).data,
    onSuccess: (data, { id }) => {
      qc.setQueryData(keys.submission.detail(id), data)
      void qc.invalidateQueries({ queryKey: ['workbench'] })
      void qc.invalidateQueries({ queryKey: ['submissions'] })
    },
  })
}

// 编辑 4-元决定
export function useEditorDecision() {
  const qc = useQueryClient()
  return useMutation<SubmissionResponse, Error, { id: number; body: SubmissionDecision }>({
    mutationFn: async ({ id, body }) =>
      (await api.patch<SubmissionResponse>(`/submissions/${id}/decision`, body)).data,
    onSuccess: (_, { id }) => {
      qc.setQueryData(keys.submission.detail(id), _)
      void qc.invalidateQueries({ queryKey: ['submissions'] })
    },
  })
}

// 作者重投（note 可选：给编辑的修改说明，随新版本存档）
export function useResubmitSubmission() {
  const qc = useQueryClient()
  return useMutation<SubmissionResponse, Error, { id: number; note?: string }>({
    mutationFn: async ({ id, note }) =>
      (
        await api.post<SubmissionResponse>(
          `/submissions/${id}/resubmit`,
          note ? { note } : {},
        )
      ).data,
    onSuccess: (data, { id }) => {
      qc.setQueryData(keys.submission.detail(id), data)
      void qc.invalidateQueries({ queryKey: ['submissions'] })
      // 后端把重投快照成新版本，版本历史必须跟着失效，否则详情弹窗
      // 里的「版本历史」永远停在重投前。
      void qc.invalidateQueries({ queryKey: keys.submission.versions(id) })
    },
  })
}

// 作者修改稿件内容（pending / major_revision / minor_revision 状态限定）
export function useUpdateSubmission() {
  const qc = useQueryClient()
  return useMutation<SubmissionResponse, Error, { id: number; body: SubmissionUpdate }>({
    mutationFn: async ({ id, body }) =>
      (await api.patch<SubmissionResponse>(`/submissions/${id}`, body)).data,
    onSuccess: (data, { id }) => {
      qc.setQueryData(keys.submission.detail(id), data)
      void qc.invalidateQueries({ queryKey: ['submissions'] })
    },
  })
}

// 编辑设置 / 清除双盲匿名稿外链（传 null 清除，仅编辑可写）
export function useSetAnonymizedFile() {
  const qc = useQueryClient()
  return useMutation<SubmissionResponse, Error, { id: number; url: string | null }>({
    mutationFn: async ({ id, url }) =>
      (
        await api.put<SubmissionResponse>(`/submissions/${id}/anonymized-file`, {
          anonymized_file_url: url,
        })
      ).data,
    onSuccess: (data, { id }) => {
      qc.setQueryData(keys.submission.detail(id), data)
      void qc.invalidateQueries({ queryKey: ['submissions'] })
    },
  })
}

// 稿件版本历史（作者 + 编辑可见）
export function useSubmissionVersions(id: number, enabled = true) {
  return useQuery<SubmissionVersionResponse[]>({
    queryKey: keys.submission.versions(id),
    queryFn: async () =>
      (
        await api.get<SubmissionVersionListResponse>(
          `/submissions/${id}/versions`,
        )
      ).data.data,
    enabled: enabled && id > 0,
  })
}

// 作者本人单篇阅读趋势（聚合，不含访客身份）
export function useResourceAnalytics(resourceId: number, enabled = true) {
  return useQuery<ResourceAnalytics>({
    queryKey: ['me', 'resources', resourceId, 'analytics'],
    queryFn: async () =>
      (await api.get<ResourceAnalytics>(`/me/resources/${resourceId}/analytics`)).data,
    enabled: enabled && resourceId > 0,
  })
}

// 指定版本与上一版的正文/题录 diff
export function useSubmissionVersionDiff(id: number, version: number, enabled = true) {
  return useQuery<SubmissionVersionDiff>({
    queryKey: ['submissions', 'version-diff', id, version],
    queryFn: async () =>
      (
        await api.get<SubmissionVersionDiff>(
          `/submissions/${id}/versions/${version}/diff`,
        )
      ).data,
    enabled: enabled && id > 0 && version > 0,
  })
}

export function useSaveReworkResponse() {
  const qc = useQueryClient()
  return useMutation<
    SubmissionResponse,
    Error,
    { id: number; items: Array<{ requirement_id: string; status: string; note: string }> }
  >({
    mutationFn: async ({ id, items }) =>
      (await api.put<SubmissionResponse>(`/submissions/${id}/rework-response`, { items })).data,
    onSuccess: (data, { id }) => {
      qc.setQueryData(keys.submission.detail(id), data)
      void qc.invalidateQueries({ queryKey: ['submissions'] })
    },
  })
}

export function useWithdrawSubmission() {
  const qc = useQueryClient()
  return useMutation<SubmissionResponse, Error, { id: number; reason: string }>({
    mutationFn: async ({ id, reason }) =>
      (await api.post<SubmissionResponse>(`/submissions/${id}/withdraw`, { reason })).data,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['submissions'] })
      void qc.invalidateQueries({ queryKey: ['notifications'] })
    },
  })
}

// 在线正文（2.0）：读取/保存在线 Markdown 正文（作者可编辑状态 / 编辑部）
export function useSubmissionMarkdown(id: number, enabled: boolean) {
  return useQuery<{ content: string }>({
    queryKey: ['submissions', 'markdown', id],
    queryFn: async () =>
      (await api.get<{ content: string }>(`/submissions/${id}/markdown`)).data,
    enabled: enabled && id > 0,
  })
}

export function useSaveSubmissionMarkdown() {
  const qc = useQueryClient()
  return useMutation<SubmissionResponse, Error, { id: number; content: string }>({
    mutationFn: async ({ id, content }) =>
      (
        await api.put<SubmissionResponse>(`/submissions/${id}/markdown`, { content })
      ).data,
    onSuccess: (data, { id }) => {
      qc.setQueryData(keys.submission.detail(id), data)
      void qc.invalidateQueries({ queryKey: ['submissions'] })
      void qc.invalidateQueries({ queryKey: ['submissions', 'markdown', id] })
    },
  })
}

// 作者上传稿件文件
export function useUploadSubmissionFile() {  const qc = useQueryClient()
  return useMutation<SubmissionResponse, Error, { id: number; file: File }>({
    mutationFn: async ({ id, file }) => {
      const form = new FormData()
      form.append('file', file)
      // 显式给的 multipart/form-data 没有 boundary，axios 检测到 FormData
      // 后会丢弃这个头、由浏览器自己补 boundary —— 行为正确，注释按实情写。
      const { data } = await api.post<SubmissionResponse>(
        `/submissions/${id}/files`,
        form,
        { headers: { 'Content-Type': 'multipart/form-data' }, timeout: 120_000 },
      )
      return data
    },
    onSuccess: (data, { id }) => {
      qc.setQueryData(keys.submission.detail(id), data)
      void qc.invalidateQueries({ queryKey: ['submissions'] })
    },
  })
}

export interface ConvertSubmissionPreviewResult {
  markdown: string
  warnings: string[]
  actual_format: string
  extension_mismatch: boolean
  needs_docx: boolean
  reason: string | null
}

// 提交前识别 Word/PDF：选文件当下就返回 Markdown，填进编辑器。
export function useConvertSubmissionPreview() {
  return useMutation<ConvertSubmissionPreviewResult, Error, File>({
    mutationFn: async (file) => {
      const form = new FormData()
      form.append('file', file)
      const { data } = await api.post<ConvertSubmissionPreviewResult>(
        '/submissions/convert-preview',
        form,
        { headers: { 'Content-Type': 'multipart/form-data' } },
      )
      return data
    },
  })
}

// 原件预览：后端把原件按页渲染成 PNG，前端逐页加载，不再引入 pdf.js。
export async function previewUploadedSource(file: File): Promise<Blob> {
  const form = new FormData()
  form.append('file', file)
  const { data } = await api.post<Blob>('/submissions/source-preview', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
    responseType: 'blob',
    timeout: 180_000,
  })
  return data
}

// 原件预览（分页 PNG）：后端落一份 PDF 并返回 token/页数，图片按页取。
export async function previewUploadedSourcePages(
  file: File,
): Promise<{ token: string; pages: number }> {
  const form = new FormData()
  form.append('file', file)
  const { data } = await api.post<{ token: string; pages: number }>(
    '/submissions/source-preview/pages',
    form,
    {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 180_000,
    },
  )
  return data
}

// 下载稿件文件（作者/编辑/被指派审稿人）。用 blob + programmatic <a>
// 而不是裸 <a href>：请求必须带 Authorization 头，纯链接带不上。
/** 提前换好的短时直链：移动端用原生 <a> 同步跳转，避免 WebView
 *  拦截“await 完再 location.assign”的异步导航。 */
export function useSubmissionDownloadTicket(
  id: number,
  format: 'docx' | 'pdf',
  enabled = true,
) {
  return useQuery<string>({
    queryKey: ['submission', id, 'download-ticket', format],
    queryFn: async () => {
      const { data } = await api.post<{ url: string }>(
        `/submissions/${id}/download-ticket`,
        null,
        { params: { format, inline: true } },
      )
      return data.url
    },
    enabled: enabled && id > 0,
    staleTime: 4 * 60_000,
    gcTime: 10 * 60_000,
    refetchInterval: 6 * 60_000,
    refetchOnWindowFocus: false,
  })
}

export async function downloadSubmissionFile(
  id: number,
  format: 'docx' | 'pdf' = 'docx',
): Promise<void> {
  const isMobile = /Android|iPhone|iPad|iPod|HarmonyOS|Mobile/i.test(
    navigator.userAgent,
  )
  try {
    // 移动端（含微信内置浏览器）不靠 XHR + blob：系统下载器拿不到
    // Authorization 头，blob URL 也常被 WebView 拦截。改为换取 10 分钟
    // 有效的签名直链，交给系统浏览器/阅读器直接打开或保存。
    if (isMobile) {
      const { data } = await api.post<{ url: string }>(
        `/submissions/${id}/download-ticket`,
        null,
        { params: { format, inline: true } },
      )
      // 用带 download 的临时链接触发保存，而不是 location.assign：
      // 后者会把 PDF 当页面打开，手机浏览器不落盘；异步等待后
      // location 跳转也容易被部分浏览器拦掉。
      const a = document.createElement('a')
      a.href = new URL(data.url, window.location.origin).toString()
      a.download = ''
      a.rel = 'noopener'
      document.body.appendChild(a)
      a.click()
      a.remove()
      return
    }
    const { data, headers } = await api.get<Blob>(`/submissions/${id}/files`, {
      params: { format },
      responseType: 'blob',
    })
    downloadBlob(
      data,
      (headers['content-disposition'] as string | undefined) ?? '',
      `submission-${id}.${format}`,
    )
  } catch (err) {
    // 移动端失败时过去是静默 unhandled rejection，用户只看到“点了没反应”。
    toast.error(extractError(err, '下载失败，请检查网络后重试'))
  }
}


/** 下载某一历史版本的原件（v1 = 初次提交，之后为重投版本）。 */
export async function downloadSubmissionVersion(
  id: number,
  version: number,
): Promise<void> {
  try {
    const { data, headers } = await api.get<Blob>(
      `/submissions/${id}/versions/${version}/file`,
      { responseType: 'blob', timeout: 120_000 },
    )
    downloadBlob(
      data,
      (headers['content-disposition'] as string | undefined) ?? '',
      `submission-${id}-v${version}`,
    )
  } catch (err) {
    toast.error(extractError(err, '版本下载失败，请检查网络后重试'))
  }
}

// 审稿报告列表（作者只看 comments_to_author + 审稿人署名选择）
export function useSubmissionReports(id: number) {
  return useQuery<ReviewReportResponse[]>({
    queryKey: keys.submission.reports(id),
    queryFn: async () =>
      (await api.get<ReviewReportResponse[]>(`/submissions/${id}/reports`)).data,
    enabled: id > 0,
  })
}

// 审稿意见草稿（服务端持久化，跨设备可续写）
export function useReviewDraft(assignmentId: number) {
  return useQuery<ReviewDraftResponse>({
    queryKey: ['review', 'draft', assignmentId],
    queryFn: async () =>
      (await api.get<ReviewDraftResponse>(`/review/assignments/${assignmentId}/draft`)).data,
    enabled: assignmentId > 0,
  })
}

export function useSaveReviewDraft() {
  const qc = useQueryClient()
  return useMutation<ReviewDraftResponse, Error, { id: number; payload: Record<string, unknown> }>({
    mutationFn: async ({ id, payload }) =>
      (await api.put<ReviewDraftResponse>(`/review/assignments/${id}/draft`, { payload })).data,
    onSuccess: (_, { id }) => {
      void qc.invalidateQueries({ queryKey: ['review', 'draft', id] })
    },
  })
}

export function useDeleteReviewDraft() {
  const qc = useQueryClient()
  return useMutation<MessageResponse, Error, number>({
    mutationFn: async (id) =>
      (await api.delete<MessageResponse>(`/review/assignments/${id}/draft`)).data,
    onSuccess: (_, id) => {
      void qc.invalidateQueries({ queryKey: ['review', 'draft', id] })
    },
  })
}

// 论文全流程时间线（编辑/作者）
export function useSubmissionTimeline(id: number, enabled = true) {
  return useQuery<SubmissionTimelineResponse>({
    queryKey: ['submission', 'timeline', id],
    queryFn: async () =>
      (await api.get<SubmissionTimelineResponse>(`/submissions/${id}/timeline`)).data,
    enabled: id > 0 && enabled,
  })
}

// 作者逐条回复审稿人
export function useSaveAuthorResponse() {
  const qc = useQueryClient()
  return useMutation<SubmissionResponse, Error, { id: number; response: string }>({
    mutationFn: async ({ id, response }) =>
      (await api.put<SubmissionResponse>(`/submissions/${id}/response`, { response })).data,
    onSuccess: (data, { id }) => {
      qc.setQueryData(keys.submission.detail(id), data)
      void qc.invalidateQueries({ queryKey: ['submissions'] })
    },
  })
}

// 主编检索所有已完成审稿意见
export function useEditorReportSearch(q: string) {
  return useQuery<EditorReportSearchResponse>({
    queryKey: ['editor', 'workbench', 'reports', q],
    queryFn: async () =>
      (await api.get<EditorReportSearchResponse>('/editor/workbench/reports', {
        params: { q, limit: 80 },
      })).data,
    enabled: true,
  })
}

// --- Reviewer side ---
export function useMyReviewAssignments(
  status?: string,
  page = 1,
  pageSize = 20,
  options: { enabled?: boolean } = {},
) {
  return useQuery<AssignmentListResponse>({
    queryKey: keys.review.myAssignments(status, page, pageSize),
    queryFn: async () =>
      (await api.get<AssignmentListResponse>('/review/assignments/me', {
        params: { status, page, page_size: pageSize },
      })).data,
    enabled: options.enabled ?? true,
  })
}

export function useReviewAssignment(id: number) {
  return useQuery<AssignmentResponse>({
    queryKey: keys.review.assignment(id),
    queryFn: async () =>
      (await api.get<AssignmentResponse>(`/review/assignments/${id}`)).data,
    enabled: id > 0,
  })
}

// 审稿人查看分配稿件的完整内容（abstract / file_path / keywords / jel_codes 等）
// 单盲剥离仅作用于作者侧的 review reports，审稿人需要看完整稿件
export function useReviewSubmissionDetail(assignmentId: number) {
  return useQuery<SubmissionResponse>({
    queryKey: keys.review.submission(assignmentId),
    queryFn: async () =>
      (await api.get<SubmissionResponse>(
        `/review/assignments/${assignmentId}/submission`,
        // 审稿稿件的 Markdown 正文可能超过 3MB，默认 10s 超时会误报
        // “加载稿件失败”；该端点单独放宽到 30s。
        { timeout: 30_000 },
      )).data,
    enabled: assignmentId > 0,
  })
}

export function useAcceptAssignment() {
  const qc = useQueryClient()
  return useMutation<AssignmentResponse, Error, number>({
    mutationFn: async (id) =>
      (await api.post<AssignmentResponse>(`/review/assignments/${id}/accept`)).data,
    onSuccess: (data, id) => {
      qc.setQueryData(keys.review.assignment(id), data)
      void qc.invalidateQueries({ queryKey: ['review', 'my-assignments'] })
    },
  })
}

export function useDeclineAssignment() {
  const qc = useQueryClient()
  return useMutation<AssignmentResponse, Error, number>({
    mutationFn: async (id) =>
      (await api.post<AssignmentResponse>(`/review/assignments/${id}/decline`)).data,
    onSuccess: (data, id) => {
      qc.setQueryData(keys.review.assignment(id), data)
      void qc.invalidateQueries({ queryKey: ['review', 'my-assignments'] })
    },
  })
}

export function useUploadReviewAttachment() {
  const qc = useQueryClient()
  return useMutation<ReviewReportResponse, Error, { reportId: number; file: File }>({
    mutationFn: async ({ reportId, file }) => {
      const form = new FormData()
      form.append('file', file)
      return (
        await api.post<ReviewReportResponse>(
          `/review/reports/${reportId}/attachments`,
          form,
          { timeout: 120_000 },
        )
      ).data
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['submission', 'reports'] })
    },
  })
}

export function useSubmitReview() {
  const qc = useQueryClient()
  return useMutation<ReviewReportResponse, Error, { id: number; body: ReviewSubmit }>({
    mutationFn: async ({ id, body }) =>
      (await api.post<ReviewReportResponse>(`/review/assignments/${id}/submit`, body)).data,
    onSuccess: (_, { id }) => {
      void qc.invalidateQueries({ queryKey: keys.review.assignment(id) })
      void qc.invalidateQueries({ queryKey: ['review', 'my-assignments'] })
    },
  })
}

// --- Library ---
export function useReadingLists(page = 1, pageSize = 20) {
  return useQuery<ReadingListListResponse>({
    queryKey: keys.library.list(page),
    queryFn: async () =>
      (await api.get<ReadingListListResponse>('/reading-lists', {
        params: { page, page_size: pageSize },
      })).data,
  })
}

export function usePublicReadingLists(page = 1, pageSize = 12) {
  return useQuery<ReadingListListResponse>({
    queryKey: keys.library.public(page),
    queryFn: async () =>
      (await api.get<ReadingListListResponse>('/reading-lists/public', {
        params: { page, page_size: pageSize },
      })).data,
  })
}

export function useReadingList(id: number) {
  return useQuery<ReadingListDetailResponse>({
    queryKey: keys.library.detail(id),
    queryFn: async () =>
      (await api.get<ReadingListDetailResponse>(`/reading-lists/${id}`)).data,
    enabled: id > 0,
  })
}

// 当前用户所有合集里出现过的作品 id 集合：详情页「已收藏」按钮态以服务端
// 收藏关系为准。合集列表接口只回 item_count，这里逐个取详情汇总作品 id。
export function useMyLibraryItemIds(enabled = true) {
  return useQuery<Set<number>>({
    queryKey: ['library', 'my-item-ids'],
    enabled,
    queryFn: async () => {
      const lists = (
        await api.get<ReadingListListResponse>('/reading-lists', {
          params: { page: 1, page_size: 100 },
        })
      ).data
      const ids = new Set<number>()
      await Promise.all(
        lists.data.map(async (list) => {
          const detail = (
            await api.get<ReadingListDetailResponse>(`/reading-lists/${list.id}`)
          ).data
          detail.items.forEach((item) => ids.add(item.resource_id))
        }),
      )
      return ids
    },
  })
}

export function useCreateReadingList() {
  const qc = useQueryClient()
  return useMutation<ReadingListDetailResponse, Error, ReadingListCreate>({
    mutationFn: async (body) =>
      (await api.post<ReadingListDetailResponse>('/reading-lists', body)).data,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['library'] })
    },
  })
}

export function useUpdateReadingList() {
  const qc = useQueryClient()
  return useMutation<
    ReadingListDetailResponse,
    Error,
    { id: number; body: ReadingListUpdate }
  >({
    mutationFn: async ({ id, body }) =>
      (await api.patch<ReadingListDetailResponse>(`/reading-lists/${id}`, body)).data,
    onSuccess: (data, { id }) => {
      qc.setQueryData(keys.library.detail(id), data)
      void qc.invalidateQueries({ queryKey: ['library'] })
    },
  })
}

export function useDeleteReadingList() {
  const qc = useQueryClient()
  return useMutation<MessageResponse, Error, number>({
    mutationFn: async (id) => (await api.delete<MessageResponse>(`/reading-lists/${id}`)).data,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['library'] })
    },
  })
}

type LibraryItemIdsSnapshot = { snapshot?: Set<number> }

export function useAddReadingListItem() {
  const qc = useQueryClient()
  return useMutation<
    ReadingListDetailResponse,
    Error,
    { listId: number; body: ReadingListItemCreate },
    LibraryItemIdsSnapshot
  >({
    mutationFn: async ({ listId, body }) =>
      (await api.post<ReadingListDetailResponse>(`/reading-lists/${listId}/items`, body)).data,
    // 乐观标记「已收藏」；失败时回滚到快照，按钮态不能停留在假的已收藏。
    onMutate: ({ body }) => {
      const snapshot = qc.getQueryData<Set<number>>(['library', 'my-item-ids'])
      if (snapshot) {
        const next = new Set(snapshot)
        next.add(body.resource_id)
        qc.setQueryData(['library', 'my-item-ids'], next)
      }
      return { snapshot }
    },
    onError: (_err, _vars, context) => {
      if (context?.snapshot) qc.setQueryData(['library', 'my-item-ids'], context.snapshot)
    },
    onSuccess: (data, { listId }) => {
      qc.setQueryData(keys.library.detail(listId), data)
      void qc.invalidateQueries({ queryKey: ['library'] })
    },
  })
}

export function useRemoveReadingListItem() {
  const qc = useQueryClient()
  return useMutation<
    void,
    Error,
    { listId: number; resourceId: number },
    LibraryItemIdsSnapshot
  >({
    mutationFn: async ({ listId, resourceId }) => {
      await api.delete(`/reading-lists/${listId}/items/${resourceId}`)
    },
    onMutate: ({ resourceId }) => {
      const snapshot = qc.getQueryData<Set<number>>(['library', 'my-item-ids'])
      if (snapshot) {
        const next = new Set(snapshot)
        next.delete(resourceId)
        qc.setQueryData(['library', 'my-item-ids'], next)
      }
      return { snapshot }
    },
    onError: (_err, _vars, context) => {
      if (context?.snapshot) qc.setQueryData(['library', 'my-item-ids'], context.snapshot)
    },
    onSuccess: (_, { listId }) => {
      void qc.invalidateQueries({ queryKey: keys.library.detail(listId) })
      void qc.invalidateQueries({ queryKey: ['library', 'my-item-ids'] })
    },
  })
}

// --- Notifications ---
export type NotificationCategory =
  | 'review'
  | 'submission'
  | 'claim'
  | 'feedback'
  | 'community'
  | 'system'

export function useNotifications(
  page = 1,
  pageSize = 20,
  category?: NotificationCategory,
) {
  return useQuery<NotificationListResponse>({
    queryKey: ['notifications', 'list', page, pageSize, category ?? 'all'] as const,
    queryFn: async () =>
      (await api.get<NotificationListResponse>('/notifications', {
        params: { page, page_size: pageSize, ...(category ? { category } : {}) },
      })).data,
    refetchInterval: 30_000,
  })
}

export function useUnreadCount(options?: { enabled?: boolean }) {
  const enabled = options?.enabled ?? true
  return useQuery<UnreadCountResponse>({
    queryKey: keys.notifications.unread(),
    queryFn: async () => (await api.get<UnreadCountResponse>('/notifications/unread-count')).data,
    // 访客不轮询：未登录时该接口只会返回 401，白白打请求。
    enabled,
    refetchInterval: enabled ? 30_000 : false,
  })
}

export function useMarkAllRead() {
  const qc = useQueryClient()
  return useMutation<{ updated: number }, Error, void>({
    mutationFn: async () => (await api.patch('/notifications/read-all')).data,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['notifications'] })
    },
  })
}

export function useMarkRead() {
  const qc = useQueryClient()
  return useMutation<NotificationResponse, Error, number>({
    mutationFn: async (id) =>
      (await api.patch<NotificationResponse>(`/notifications/${id}/read`)).data,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['notifications'] })
    },
  })
}

export function useDeleteNotification() {
  const qc = useQueryClient()
  return useMutation<MessageResponse, Error, number>({
    mutationFn: async (id) =>
      (await api.delete<MessageResponse>(`/notifications/${id}`)).data,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['notifications'] })
    },
  })
}

// --- Recommendations ---
export function useMyRecommendations(limit = 10) {
  return useQuery<RecommendationListResponse>({
    queryKey: keys.recommendations.me(limit),
    queryFn: async () =>
      (await api.get<RecommendationListResponse>('/recommendations/me', {
        params: { limit },
      })).data,
  })
}

// --- Follows ---
export function useAuthorFollowStatus(authorName: string) {
  return useQuery<FollowStatusResponse>({
    queryKey: keys.follows.author(authorName),
    queryFn: async () =>
      (await api.get<FollowStatusResponse>(`/authors/${encodeURIComponent(authorName)}/follow`)).data,
    enabled: !!authorName,
  })
}

export function useFollowAuthor() {
  const qc = useQueryClient()
  return useMutation<FollowStatusResponse, Error, string>({
    mutationFn: async (authorName) =>
      (await api.post<FollowStatusResponse>(`/authors/${encodeURIComponent(authorName)}/follow`)).data,
    onSuccess: (data, authorName) => {
      qc.setQueryData(keys.follows.author(authorName), data)
      void qc.invalidateQueries({ queryKey: ['follows', 'my-authors'] })
    },
  })
}

export function useUnfollowAuthor() {
  const qc = useQueryClient()
  return useMutation<FollowStatusResponse, Error, string>({
    mutationFn: async (authorName) =>
      (await api.delete<FollowStatusResponse>(`/authors/${encodeURIComponent(authorName)}/follow`)).data,
    onSuccess: (data, authorName) => {
      qc.setQueryData(keys.follows.author(authorName), data)
      void qc.invalidateQueries({ queryKey: ['follows', 'my-authors'] })
    },
  })
}

export function useMyFollowedAuthors(page = 1, pageSize = 20) {
  return useQuery<AuthorFollowListResponse>({
    queryKey: keys.follows.myAuthors(page),
    queryFn: async () =>
      (await api.get<AuthorFollowListResponse>('/users/me/following/authors', {
        params: { page, page_size: pageSize },
      })).data,
  })
}

export function useDisciplineSubscriptionStatus(discipline: string) {
  return useQuery<SubscriptionStatusResponse>({
    queryKey: keys.follows.discipline(discipline),
    queryFn: async () =>
      (await api.get<SubscriptionStatusResponse>(`/disciplines/${encodeURIComponent(discipline)}/subscribe`)).data,
    enabled: !!discipline,
  })
}

export function useSubscribeDiscipline() {
  const qc = useQueryClient()
  return useMutation<SubscriptionStatusResponse, Error, string>({
    mutationFn: async (discipline) =>
      (await api.post<SubscriptionStatusResponse>(`/disciplines/${encodeURIComponent(discipline)}/subscribe`)).data,
    onSuccess: (data, discipline) => {
      qc.setQueryData(keys.follows.discipline(discipline), data)
      void qc.invalidateQueries({ queryKey: ['follows', 'my-disciplines'] })
    },
  })
}

export function useUnsubscribeDiscipline() {
  const qc = useQueryClient()
  return useMutation<SubscriptionStatusResponse, Error, string>({
    mutationFn: async (discipline) =>
      (await api.delete<SubscriptionStatusResponse>(`/disciplines/${encodeURIComponent(discipline)}/subscribe`)).data,
    onSuccess: (data, discipline) => {
      qc.setQueryData(keys.follows.discipline(discipline), data)
      void qc.invalidateQueries({ queryKey: ['follows', 'my-disciplines'] })
    },
  })
}

export function useMySubscribedDisciplines() {
  return useQuery<DisciplineSubscriptionListResponse>({
    queryKey: keys.follows.myDisciplines(),
    queryFn: async () =>
      (await api.get<DisciplineSubscriptionListResponse>('/users/me/subscriptions/disciplines')).data,
  })
}

// --- Ingest ---
export function useParseIngest() {
  return useMutation<ParseResponse, Error, ParseRequest>({
    mutationFn: async (body) => (await api.post<ParseResponse>('/ingest/parse', body)).data,
  })
}

export function useFetchIngest() {
  return useMutation<IngestResource, Error, FetchRequest>({
    mutationFn: async (body) => (await api.post<IngestResource>('/ingest/fetch', body)).data,
  })
}

// --- Admin ---
export function useAdminUsers(limit = 50, offset = 0, query = '') {
  return useQuery<UserResponse[]>({
    // query 进 key：搜索词变化要重新请求，而不是复用上一页的缓存
    queryKey: keys.admin.usersSearch(limit, offset, query),
    // 后台列表不跟随窗口焦点重拉：E2E / 多标签切换时回到窗口会触发
    // refetch，数据一换行就重渲染，正在展开的 Radix 下拉会被卸载，
    // 键盘焦点落空（admin-user-management 的 Space/Enter 用例因此抖动）。
    // 写操作本身已 invalidate 该 key，不靠 focus 刷新取新数据。
    refetchOnWindowFocus: false,
    queryFn: async () =>
      (
        await api.get<UserResponse[]>('/admin/users', {
          params: { limit, offset, ...(query ? { q: query } : {}) },
        })
      ).data,
  })
}

export function useCreateAdminUser() {
  const qc = useQueryClient()
  return useMutation<
    AdminUserCreateResponse,
    Error,
    { email: string; username: string; role?: AssignableRole; note?: string }
  >({
    mutationFn: async (body) =>
      (await api.post<AdminUserCreateResponse>('/admin/users', body)).data,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin', 'users'] })
    },
  })
}

/** 管理员手动发放活跃值（XP）；用于编辑贡献、活动奖励，不是积分余额。 */
export function useGrantUserXp() {
  const qc = useQueryClient()
  return useMutation<{ points: number; note: string }, Error, { userId: number; points: number; note: string }>({
    mutationFn: async ({ userId, points, note }) =>
      (await api.post(`/gamification/admin/users/${userId}/grant`, { points, note })).data,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin', 'users'] })
    },
  })
}

export function useSetUserActive() {
  const qc = useQueryClient()
  return useMutation<UserResponse, Error, { userId: number; isActive: boolean }>({
    mutationFn: async ({ userId, isActive }) =>
      (await api.patch<UserResponse>(`/admin/users/${userId}/active`, null, {
        params: { is_active: isActive },
      })).data,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin', 'users'] })
    },
  })
}

// admin 给用户分配角色（同租户内幂等：已分配则后端返回 200）
export function useAssignRole() {
  const qc = useQueryClient()
  return useMutation<UserResponse, Error, { userId: number; role: AssignableRole }>({
    mutationFn: async ({ userId, role }) =>
      (await api.post<UserResponse>(`/admin/users/${userId}/roles`, { role })).data,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin', 'users'] })
    },
  })
}

// admin 撤销用户角色（不存在则后端 404）
export function useRevokeRole() {
  const qc = useQueryClient()
  return useMutation<UserResponse, Error, { userId: number; role: AssignableRole }>({
    mutationFn: async ({ userId, role }) =>
      (await api.delete<UserResponse>(`/admin/users/${userId}/roles/${role}`)).data,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin', 'users'] })
    },
  })
}

/** 站务代改成员领域：科目领域、审稿领域与审稿标签。 */
export function useUpdateUserAreas() {
  const qc = useQueryClient()
  return useMutation<
    UserResponse,
    Error,
    {
      userId: number
      subject_disciplines: string[]
      reviewer_disciplines: string[]
      reviewer_tags: string[]
    }
  >({
    mutationFn: async ({ userId, ...body }) =>
      (await api.patch<UserResponse>(`/admin/users/${userId}/areas`, body)).data,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin', 'users'] })
    },
  })
}

// --- 作者申诉（Appeal） -----------------------------------------------------

export function useMyAppeals() {
  return useQuery<AppealListResponse>({
    queryKey: ['catalog', 'appeals', 'mine'],
    queryFn: async () => (await api.get<AppealListResponse>('/catalog/appeals/mine')).data,
  })
}

export function useCreateAppeal(resourceId: number) {
  const qc = useQueryClient()
  return useMutation<AppealItem, Error, { kind: AppealKind; reason: string }>({
    mutationFn: async (body) =>
      (await api.post<AppealItem>(`/catalog/${resourceId}/appeal`, body)).data,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['catalog', 'appeals'] })
    },
  })
}

export function useAdminAppeals(
  status: AppealStatus | 'all',
  page = 1,
  pageSize = 20,
  appealId?: number,
) {
  return useQuery<AppealListResponse>({
    queryKey: ['catalog', 'appeals', 'admin', status, page, pageSize, appealId ?? 0],
    queryFn: async () =>
      (
        await api.get<AppealListResponse>('/catalog/admin/appeals', {
          params: {
            status,
            page,
            page_size: pageSize,
            ...(appealId ? { appeal_id: appealId } : {}),
          },
        })
      ).data,
  })
}

export function useDecideAppeal() {
  const qc = useQueryClient()
  return useMutation<
    AppealItem,
    Error,
    { appealId: number; status: 'accepted' | 'rejected'; editorNote: string }
  >({
    mutationFn: async ({ appealId, status, editorNote }) =>
      (
        await api.patch<AppealItem>(`/catalog/admin/appeals/${appealId}`, {
          status,
          editor_note: editorNote,
        })
      ).data,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['catalog', 'appeals'] })
      void qc.invalidateQueries({ queryKey: ['notifications'] })
    },
  })
}

// --- 作者认领（Author Claim, v5） -----------------------------------------

// 查询某篇文章当前可否被认领（登录后文章页据此显示认领入口）
export function useClaimStatus(resourceId: number | null, enabled = true) {
  return useQuery<ClaimStatusResponse>({
    queryKey: keys.claims.status(resourceId ?? 0),
    enabled: enabled && resourceId != null,
    queryFn: async () =>
      (await api.get<ClaimStatusResponse>(`/catalog/${resourceId}/claim-status`)).data,
  })
}

// 发起认领（登录用户对"无人认领"的存量文章）
export function useClaimResource() {
  const qc = useQueryClient()
  return useMutation<
    ClaimSubmitResponse,
    Error,
    { resourceId: number; body: ClaimSubmitRequest }
  >({
    mutationFn: async ({ resourceId, body }) =>
      (await api.post<ClaimSubmitResponse>(`/catalog/${resourceId}/claim`, body)).data,
    onSuccess: (_res, vars) => {
      void qc.invalidateQueries({ queryKey: keys.claims.status(vars.resourceId) })
    },
  })
}

// 编辑部：认领申请列表（?claim_status=pending|approved|rejected）
export function useAdminClaims(state: string) {
  return useQuery<AdminClaimListResponse>({
    queryKey: keys.admin.claims(state),
    queryFn: async () =>
      (await api.get<AdminClaimListResponse>('/admin/claims', { params: { claim_status: state } })).data,
  })
}

// 待认领数量徽标：轻量轮询，未登录时静默不请求
export function usePendingClaimsCount(enabled: boolean) {
  return useQuery<{ count: number }>({
    queryKey: ['admin', 'claims', 'pending', 'count'],
    queryFn: async () => {
      const rows = (
        await api.get<AdminClaimListResponse>('/admin/claims', {
          params: { claim_status: 'pending' },
        })
      ).data
      return { count: rows.length }
    },
    enabled,
    refetchInterval: 60_000,
    staleTime: 30_000,
  })
}

// 编辑部：通过 / 驳回认领（后端 POST /admin/claims/{id}/decision）
export function useDecideClaim() {
  const qc = useQueryClient()
  return useMutation<
    { id: number; status: string },
    Error,
    { claimId: number; body: AdminClaimDecideRequest }
  >({
    mutationFn: async ({ claimId, body }) =>
      (await api.post(`/admin/claims/${claimId}/decision`, {
        action: body.approve ? 'approve' : 'reject',
        note: body.note,
      })).data,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin', 'claims'] })
    },
  })
}

// 编辑部：指定文章 owner（复议时一次指定多人，逐位调用）
export function useAssignOwner() {
  const qc = useQueryClient()
  return useMutation<
    unknown,
    Error,
    { resourceId: number; body: AssignOwnerRequest }
  >({
    mutationFn: async ({ resourceId, body }) =>
      (await api.post(`/admin/resources/${resourceId}/assign-owner`, body)).data,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['catalog'] })
      void qc.invalidateQueries({ queryKey: ['admin', 'claims'] })
    },
  })
}

// 编辑部：PUT 作者列表（资源或稿件二选一，按路径调）
export function usePutAuthors() {
  const qc = useQueryClient()
  return useMutation<
    unknown,
    Error,
    { path: 'resource' | 'submission'; id: number; authors: AuthorEditInput[] }
  >({
    mutationFn: async ({ path, id, authors }) => {
      const url =
        path === 'resource'
          ? `/admin/resources/${id}/authors`
          : `/admin/submissions/${id}/authors`
      return (await api.put(url, { authors })).data
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['catalog'] })
      void qc.invalidateQueries({ queryKey: ['submissions'] })
    },
  })
}

export function useSiteSettings() {
  return useQuery<SiteSettingsResponse>({
    queryKey: keys.admin.siteSettings(),
    queryFn: async () =>
      (await api.get<SiteSettingsResponse>('/admin/settings/site')).data,
  })
}

export function useUpdateSiteSettings() {
  const qc = useQueryClient()
  return useMutation<SiteSettingsResponse, Error, Partial<SiteSettingsResponse>>({
    mutationFn: async (patch) =>
      (await api.patch<SiteSettingsResponse>('/admin/settings/site', patch)).data,
    onSuccess: (data) => {
      qc.setQueryData(keys.admin.siteSettings(), data)
      // 注册页与社区表单都读 /capabilities，切换后立即使旧缓存失效。
      void qc.invalidateQueries({ queryKey: ['capabilities'] })
    },
  })
}

export interface AdminAuditFilters {
  action?: string
  actorUserId?: number
  targetType?: string
  start?: string
  end?: string
}

function adminAuditParams(filters: AdminAuditFilters): Record<string, string | number> {
  const params: Record<string, string | number> = {}
  if (filters.action?.trim()) params.action = filters.action.trim()
  if (filters.actorUserId) params.actor_user_id = filters.actorUserId
  if (filters.targetType?.trim()) params.target_type = filters.targetType.trim()
  if (filters.start) params.start = filters.start
  if (filters.end) params.end = filters.end
  return params
}

export function useAdminAuditLogs(
  limit = 50,
  offset = 0,
  filters: AdminAuditFilters = {},
) {
  return useQuery<AuditLogEntry[]>({
    queryKey: [...keys.admin.audit(limit, offset), filters] as const,
    refetchOnWindowFocus: false,
    queryFn: async () =>
      (
        await api.get<AuditLogEntry[]>('/admin/audit-logs', {
          params: { limit, offset, ...adminAuditParams(filters) },
        })
      ).data,
  })
}

export function useAdminAuditCount(filters: AdminAuditFilters = {}) {
  return useQuery<{ total: number }>({
    queryKey: ['admin', 'audit-count', filters] as const,
    queryFn: async () =>
      (
        await api.get<{ total: number }>('/admin/audit-logs/count', {
          params: adminAuditParams(filters),
        })
      ).data,
  })
}

export async function exportAdminAuditLogs(
  filters: AdminAuditFilters = {},
): Promise<{ blob: Blob; disposition: string }> {
  const response = await api.get<Blob>('/admin/audit-logs/export', {
    params: adminAuditParams(filters),
    responseType: 'blob',
  })
  return {
    blob: response.data,
    disposition: String(response.headers['content-disposition'] ?? ''),
  }
}

export function useMonthlyOpsReport(month: string) {
  return useQuery<MonthlyOpsReport>({
    queryKey: ['admin', 'ops-monthly', month],
    queryFn: async () =>
      (await api.get<MonthlyOpsReport>('/admin/ops/monthly', { params: { month } })).data,
    staleTime: 60_000,
  })
}

export async function exportMonthlyOpsReport(month: string): Promise<{ blob: Blob; disposition: string }> {
  const response = await api.get<Blob>('/admin/ops/monthly/export', {
    params: { month },
    responseType: 'blob',
  })
  return {
    blob: response.data,
    disposition: String(response.headers['content-disposition'] ?? ''),
  }
}

// --- Gamification / 等级体系 ---
export function useGamificationProfile(options?: { enabled?: boolean }) {
  return useQuery<GamificationProfile>({
    queryKey: keys.gamification.profile(),
    queryFn: async () => (await api.get<GamificationProfile>('/gamification/me')).data,
    enabled: options?.enabled ?? true,
    staleTime: 60_000,
  })
}

// --- /me：身份（权限轴）+ 全站活跃等级（经验轴） ---
export interface MeActivity {
  level: number
  max_level: number
  xp: number
  current_floor: number
  current_ceiling: number
  next_threshold: number | null
  to_next: number
  progress: number
}

export interface MePermissionGroup {
  key: 'member' | 'review' | 'admin'
  label: string
  rank: number
}

export interface MeWorkStats {
  total: number
  draft: number
  under_review: number
  revision: number
  published: number
}

export interface MeProfile {
  user_id: number
  username: string
  permission_role: 'user' | 'reviewer' | 'editor' | 'editor_in_chief'
  permission_label: string
  permission_group: MePermissionGroup
  permission_role_label?: string
  permissions: string[]
  activity: MeActivity
  rules_accepted: boolean
  work_stats?: MeWorkStats
}

export function useMeProfile() {
  return useQuery<MeProfile>({
    queryKey: ['me', 'profile'],
    queryFn: async () => (await api.get<MeProfile>('/me/profile')).data,
    staleTime: 60_000,
  })
}

export function useLadder() {
  return useQuery<LadderResponse>({
    queryKey: keys.gamification.ladder(),
    queryFn: async () => (await api.get<LadderResponse>('/gamification/ladder')).data,
    staleTime: 10 * 60_000,
  })
}

export function useAcknowledgeCommunity() {
  const qc = useQueryClient()
  return useMutation<{ level: LevelSnapshot }, unknown, void>({
    mutationFn: async () => (await api.post('/gamification/onboarding/community')).data,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.gamification.profile() })
      void qc.invalidateQueries({ queryKey: keys.forum.starter() })
      void qc.invalidateQueries({ queryKey: ['auth', 'me'] })
    },
  })
}

export interface ForumStarterTask {
  key: string
  label: string
  hint: string
  done: boolean
  action: 'ack_rules' | null
  to: string
}

export interface ForumStarter {
  tasks: ForumStarterTask[]
  completed: number
  total: number
  all_done: boolean
  claimed: boolean
  claimed_at: string | null
  reward_xp: number
  counts: { published_topics: number; replies: number }
}

export function useForumStarter(enabled = true) {
  return useQuery<ForumStarter>({
    queryKey: keys.forum.starter(),
    queryFn: async () => (await api.get<ForumStarter>('/forum/starter')).data,
    enabled,
    staleTime: 30_000,
  })
}

export function useClaimForumStarter() {
  const qc = useQueryClient()
  return useMutation<ForumStarter, unknown, void>({
    mutationFn: async () => (await api.post<ForumStarter>('/forum/starter/claim')).data,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.forum.starter() })
      void qc.invalidateQueries({ queryKey: keys.gamification.profile() })
      void qc.invalidateQueries({ queryKey: ['auth', 'me'] })
    },
  })
}

export interface ForumCreditRecord {
  kind: string
  label: string
  detail: string
  delta: number
  at: string
  ref_type: string
  ref_id: number
}

export interface ForumCredit {
  score: number
  max_score: number
  tier: string
  tier_label: string
  positive_points: number
  negative_points: number
  counts: {
    published_topics: number
    published_replies: number
    rejected_topics: number
    removed_contents: number
  }
  records: ForumCreditRecord[]
  scoring: string
}

export function useForumCredit(enabled = true) {
  return useQuery<ForumCredit>({
    queryKey: keys.forum.credit(),
    queryFn: async () => (await api.get<ForumCredit>('/forum/credit/me')).data,
    enabled,
    staleTime: 60_000,
  })
}

export function useAcceptAuthorRules() {
  const qc = useQueryClient()
  return useMutation<{ level: LevelSnapshot; rules_version: string }, unknown, void>({
    mutationFn: async () =>
      (await api.post('/gamification/onboarding/author', { accept_rules: true })).data,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.gamification.profile() })
      void qc.invalidateQueries({ queryKey: ['auth', 'me'] })
    },
  })
}

// --- Announcements ---
export function useActiveAnnouncement() {
  return useQuery<Announcement | null>({
    queryKey: keys.announcements.active(),
    queryFn: async () => {
      const res = await api.get<Announcement | null>('/announcements/active')
      return res.data
    },
    staleTime: 5 * 60_000,
  })
}

// --- Quality rubric ---
export function useQualityRubric() {
  return useQuery<QualityRubric>({
    queryKey: keys.quality.rubric(),
    queryFn: async () => (await api.get<QualityRubric>('/quality/rubric')).data,
    staleTime: 30 * 60_000,
  })
}

// --- 质量评分 v3.0（审稿表单 / 算分 / 改分 / 打回） ---

export function useQualityForm(track: 'academic' | 'absurd' = 'academic') {
  return useQuery<QualityForm>({
    queryKey: [...keys.quality.rubric(), 'form', track],
    queryFn: async () => (await api.get<QualityForm>('/quality/form', { params: { track } })).data,
    staleTime: 30 * 60_000,
  })
}

/** 按检查项答案折算建议分（无需登录，作者自查也能用）。 */
export function useSuggestScores() {
  return useMutation<
    { dimensions: Record<string, { label: string; suggested_score: number; items: unknown[] }> },
    Error,
    Record<string, string>
  >({
    mutationFn: async (answers) => (await api.post('/quality/suggest', { answers })).data,
  })
}

/** 服务端算分（审稿人）：返回总分、等级、逐维明细。 */
export function useComputeQualityScore() {
  return useMutation<
    QualityScoreResult,
    Error,
    { track: 'academic' | 'absurd'; article_type: string; dimensions: DimensionScoreInput[] }
  >({
    mutationFn: async (body) => (await api.post('/quality/score', body)).data,
  })
}

/** 管理员改分（必须写理由）。 */
export function useOverrideQualityScore() {
  const qc = useQueryClient()
  return useMutation<unknown, Error, { score: number; reason: string }>({
    mutationFn: async (body) => (await api.post('/quality/override', body)).data,
    onSuccess: () => void qc.invalidateQueries({ queryKey: keys.quality.rubric() }),
  })
}

/** D 级打回：通知审稿人补审 + 作者修改。 */
export function useRequestRework() {
  const qc = useQueryClient()
  return useMutation<
    SubmissionResponse,
    Error,
    { id: number; requirements: string[]; note?: string }
  >({
    mutationFn: async ({ id, ...body }) =>
      (await api.post<SubmissionResponse>(`/submissions/${id}/rework`, body)).data,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['submissions'] })
      void qc.invalidateQueries({ queryKey: ['notifications'] })
    },
  })
}

/** 设置/取消平台管理员（提权）。后端拒绝改自己、拒绝降级最后一个管理员。 */
export function useSetUserAdmin() {
  const qc = useQueryClient()
  return useMutation<
    unknown,
    Error,
    { userId: number; isAdmin: boolean }
  >({
    mutationFn: async ({ userId, isAdmin }) =>
      (
        await api.patch(`/admin/users/${userId}/admin`, null, {
          params: { is_admin: isAdmin },
        })
      ).data,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin', 'users'] })
    },
  })
}

/** 作者上传封面图（PNG/JPEG/WebP ≤5MB）。 */
export function useUploadSubmissionCover() {
  const qc = useQueryClient()
  return useMutation<SubmissionResponse, Error, { id: number; file: File }>({
    mutationFn: async ({ id, file }) => {
      const fd = new FormData()
      fd.append('file', file)
      return (await api.post<SubmissionResponse>(`/submissions/${id}/cover`, fd)).data
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['submissions'] })
    },
  })
}

// --- Workbench (审稿人 / 主编 两栏/四栏，独立接口) ---
export interface ReviewerWorkbenchRow {
  assignment_id: number
  submission_id: number
  title: string | null
  type: string | null
  reviewer_id: number
  reviewer_username: string | null
  status: string
  status_label?: string
  round?: number
  slot?: number
  invited_at: string
  due_date: string | null
  due_label: string | null
  is_overdue: boolean
  completed_at: string | null
  reminder_count: number
  recommendation?: string | null
  report_id?: number | null
  attachments?: import('@/lib/types').ReviewAttachment[]
}

export interface ReviewerWorkbenchResponse {
  pending: { count: number; items: ReviewerWorkbenchRow[] }
  completed: { count: number; items: ReviewerWorkbenchRow[] }
}

export type EditorAssignmentRow = ReviewerWorkbenchRow

export interface EditorColumnItem {
  submission_id: number
  title: string | null
  type: string | null
  discipline?: string | null
  submitted_by: number
  status: string
  submitted_at: string
  current_round?: number
  latest_version?: number
  editor_note?: string | null
  author_response?: string | null
  author_response_at?: string | null
  rework_due_at?: string | null
  interest_count?: number
  interesters?: string[]
  assignments?: EditorAssignmentRow[]
  active_count?: number
  completed_count?: number
  declined_count?: number
  needs_reassign?: boolean
  reassign_reason?: string | null
  is_overdue?: boolean
  recommendations?: {
    reviewer_id: number
    reviewer_username?: string | null
    recommendation: string | null
    report_id?: number | null
  }[]
}

export interface EmailDigestSummary {
  /** 运营开关 email_review_digest_enabled 是否打开 */
  enabled: boolean
  /** host/port/user/password 四项是否齐全（不看外发开关） */
  smtp_configured: boolean
  /** 最近一次投递结果；无记录时为 null */
  last_status:
    | 'sent'
    | 'failed'
    | 'skipped_no_smtp'
    | 'skipped_disabled'
    | 'skipped_user_pref'
    | null
  /** 近 30 天 skipped_no_smtp + skipped_disabled 条数 */
  skipped_count: number
  /** 近 30 天 failed 条数 */
  failed_count: number
  /** 最近一次尝试时间（ISO 字符串），无记录时为 null */
  last_attempt_at: string | null
}

export interface EmailDigestRecordRow {
  id: number
  event_type: string
  user_id: number
  recipient_email: string
  subject: string
  status:
    | 'sent'
    | 'failed'
    | 'skipped_no_smtp'
    | 'skipped_disabled'
    | 'skipped_user_pref'
  related_type: string | null
  related_id: string | null
  channel?: string | null
  attempts?: number
  last_error?: string | null
  next_retry_at?: string | null
  sent_at?: string | null
  created_at: string
}

export interface EditorWorkbenchResponse {
  columns: {
    to_assign: { count: number; items: EditorColumnItem[]; page_size?: number; has_more?: boolean }
    in_review: { count: number; items: EditorColumnItem[]; page_size?: number; has_more?: boolean }
    rework: { count: number; items: EditorColumnItem[]; page_size?: number; has_more?: boolean }
    to_decide: { count: number; items: EditorColumnItem[]; page_size?: number; has_more?: boolean }
    decided: { count: number; items: EditorColumnItem[]; page_size?: number; has_more?: boolean }
  }
  email_digest: EmailDigestSummary
}

export function useReviewerWorkbench() {
  return useQuery<ReviewerWorkbenchResponse>({
    queryKey: ['workbench', 'reviewer'] as const,
    queryFn: async () =>
      (await api.get<ReviewerWorkbenchResponse>('/review/workbench')).data,
    refetchInterval: 30_000,
  })
}

export function useEditorWorkbench(options?: { enabled?: boolean }) {
  return useQuery<EditorWorkbenchResponse>({
    queryKey: ['workbench', 'editor'] as const,
    queryFn: async () =>
      (await api.get<EditorWorkbenchResponse>('/editor/workbench')).data,
    refetchInterval: 30_000,
    enabled: options?.enabled ?? true,
  })
}

/** 主编查看最近邮件摘要投递记录（排查"为什么没发到"）。默认不自动拉取。 */
export function useEditorEmailDigestRecords(opts: { enabled: boolean; status?: string }) {
  return useQuery<{ count: number; items: EmailDigestRecordRow[] }>({
    queryKey: ['workbench', 'editor', 'email-digest-records', opts.status ?? 'all'] as const,
    queryFn: async () => {
      const qs = opts.status ? `?status=${encodeURIComponent(opts.status)}&limit=50` : '?limit=50'
      return (await api.get<{ count: number; items: EmailDigestRecordRow[] }>(
        `/editor/workbench/email-digest/records${qs}`,
      )).data
    },
    enabled: opts.enabled,
  })
}

export function useRetryEmailDigestRecord() {
  const qc = useQueryClient()
  return useMutation<EmailDigestRecordRow, Error, { id: number }>({
    mutationFn: async ({ id }) =>
      (
        await api.post<EmailDigestRecordRow>(
          `/editor/workbench/email-digest/records/${id}/retry`,
        )
      ).data,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['workbench', 'editor', 'email-digest-records'] })
    },
  })
}

export interface BatchAssignCreated {
  submission_id: number
  reviewer_id: number
  assignment_id: number
  due_date: string
}

export interface BatchAssignSkipped {
  submission_id: number
  reviewer_id?: number
  reason: string
}

export function useBatchAssign() {
  const qc = useQueryClient()
  return useMutation<
    {
      created: BatchAssignCreated[]
      skipped: BatchAssignSkipped[]
      created_count: number
    },
    Error,
    {
      items: { submission_id: number; reviewer_ids: number[] }[]
      due_days: number
    }
  >({
    mutationFn: async (body) =>
      (await api.post('/editor/workbench/batch-assign', body)).data,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['workbench'] })
      void qc.invalidateQueries({ queryKey: ['submissions'] })
      void qc.invalidateQueries({ queryKey: ['notifications'] })
    },
  })
}

export interface ConflictCandidate {
  reviewer_id: number
  username?: string
  exists: boolean
  is_submitter?: boolean
  name_matches_author?: boolean
  own_submission_count?: number
  warnings?: string[]
  warning: boolean
  default_selected?: boolean
}

export function useCheckConflicts() {
  return useMutation<
    { submission_id: number; candidates: ConflictCandidate[] },
    Error,
    { submission_id: number; reviewer_ids: number[] }
  >({
    mutationFn: async (body) =>
      (await api.post('/editor/workbench/conflicts', body)).data,
  })
}

export function useRemindReviewers() {
  const qc = useQueryClient()
  return useMutation<
    { reminded: { assignment_id: number; reviewer_id: number }[]; reminded_count: number },
    Error,
    { assignment_ids: number[] }
  >({
    mutationFn: async (body) =>
      (await api.post('/editor/workbench/remind', body)).data,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['workbench'] })
      void qc.invalidateQueries({ queryKey: ['notifications'] })
    },
  })
}


export interface ReviewBoardItem {
  submission_id: number
  title: string
  type: string | null
  abstract: string
  track: string | null
  discipline: string | null
  subdiscipline: string | null
  submitted_at: string | null
  reviewer_count: number
  already_assigned: boolean
}

export interface ReviewBoardResponse {
  data: ReviewBoardItem[]
  can_apply: boolean
  total: number
}

export function useReviewBoard() {
  return useQuery<ReviewBoardResponse>({
    queryKey: ['review', 'board'],
    queryFn: async () => (await api.get<ReviewBoardResponse>('/review/board')).data,
    staleTime: 30_000,
  })
}

export function useExpressReviewInterest() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (submissionId: number) =>
      (await api.post(`/review/board/${submissionId}/interest`)).data,
    onSuccess: () => {
      toast.success('已记录互评意愿，内容整理组会在指派时看到')
      void qc.invalidateQueries({ queryKey: ['review', 'board'] })
    },
  })
}


// --- Release Gate / Manifest ---

export function useReleaseIssues(enabled = true) {
  return useQuery<{ items: ReleaseIssueSummary[] }>({
    queryKey: keys.admin.releaseIssues(),
    queryFn: async () =>
      (await api.get<{ items: ReleaseIssueSummary[] }>('/admin/releases/issues')).data,
    enabled,
    staleTime: 30_000,
  })
}

export function useReleaseManifests(volume: string, issue: string, enabled = true) {
  return useQuery<{ items: ReleaseManifest[] }>({
    queryKey: keys.admin.releaseManifests(volume, issue),
    queryFn: async () =>
      (
        await api.get<{ items: ReleaseManifest[] }>('/admin/releases/manifests', {
          params: { volume, issue },
        })
      ).data,
    enabled: enabled && Boolean(volume) && Boolean(issue),
    staleTime: 15_000,
  })
}

export function useCheckRelease() {
  const qc = useQueryClient()
  return useMutation<ReleaseManifest, unknown, { volume: string; issue: string }>({
    mutationFn: async ({ volume, issue }) =>
      (await api.post('/admin/releases/check', { volume, issue })).data,
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({ queryKey: keys.admin.releaseIssues() })
      void qc.invalidateQueries({
        queryKey: keys.admin.releaseManifests(vars.volume, vars.issue),
      })
    },
  })
}

export function usePublishRelease() {
  const qc = useQueryClient()
  return useMutation<
    ReleaseManifest,
    unknown,
    { volume: string; issue: string; manifestId: number; publishAt: string | null }
  >({
    mutationFn: async ({ volume, issue, manifestId, publishAt }) =>
      (
        await api.post('/admin/releases/publish', {
          volume,
          issue,
          manifest_id: manifestId,
          publish_at: publishAt,
        })
      ).data,
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({ queryKey: ['catalog'] })
      void qc.invalidateQueries({ queryKey: keys.issuePlan() })
      void qc.invalidateQueries({ queryKey: keys.admin.releaseIssues() })
      void qc.invalidateQueries({
        queryKey: keys.admin.releaseManifests(vars.volume, vars.issue),
      })
    },
  })
}

export function useApproveRelease() {
  const qc = useQueryClient()
  return useMutation<
    ReleaseManifest,
    unknown,
    { volume: string; issue: string; manifestId: number; note?: string | null }
  >({
    mutationFn: async ({ manifestId, note }) =>
      (
        await api.post('/admin/releases/approve', {
          manifest_id: manifestId,
          note: note || null,
        })
      ).data,
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({ queryKey: keys.admin.releaseIssues() })
      void qc.invalidateQueries({
        queryKey: keys.admin.releaseManifests(vars.volume, vars.issue),
      })
    },
  })
}

export function useRollbackRelease() {
  const qc = useQueryClient()
  return useMutation<
    ReleaseManifest,
    unknown,
    { volume: string; issue: string; manifestId: number; reason: string }
  >({
    mutationFn: async ({ volume, issue, manifestId, reason }) =>
      (
        await api.post('/admin/releases/rollback', {
          volume,
          issue,
          manifest_id: manifestId,
          reason,
        })
      ).data,
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({ queryKey: ['catalog'] })
      void qc.invalidateQueries({ queryKey: keys.issuePlan() })
      void qc.invalidateQueries({ queryKey: keys.admin.releaseIssues() })
      void qc.invalidateQueries({
        queryKey: keys.admin.releaseManifests(vars.volume, vars.issue),
      })
    },
  })
}
