// Backend API 类型镜像。从 pydantic schemas 1:1 映射；ISO 时间用 string。
// 所有 union 类型保持 Literal 等价，便于 form 校验和 Zod 推断。

// --- Core: PaginationMeta + MessageResponse ---
export interface PaginationMeta {
  total: number
  page: number
  page_size: number
  total_pages: number
}

export interface MessageResponse {
  message: string
}

// --- Auth + User ---
export interface TokenResponse {
  access_token: string
  refresh_token: string
  token_type: 'bearer'
  user_id: number
  username: string
  is_admin: boolean
  // M2 2FA: when the account requires 2FA, access/refresh are empty
  // strings and the client must redeem ``two_factor_token`` via
  // ``POST /auth/2fa/authenticate`` before storing any tokens.
  requires_2fa?: boolean
  two_factor_token?: string | null
}

// --- 2FA ---
export interface UserResponse {
  id: number
  email: string
  username: string
  is_active: boolean
  is_admin: boolean
  is_email_verified: boolean
  created_at: string
  // admin 端点会填入；普通 /auth/* 端点保持空数组
  roles: string[]
}

// 可分配的角色名（与 backend ASSIGNABLE_ROLES 一致；admin 不在此处，由 is_admin 控制）
export type AssignableRole =
  | 'reviewer'
  | 'editor'
  | 'section_editor'
  | 'author'
  | 'reader'

export interface UserCreate {
  email: string
  username: string
  password: string
}

export interface UserLogin {
  username: string
  password: string
}

// --- Two-factor auth (TOTP) ---
// /auth/login 在账号开启 2FA 时返回它而不是 TokenResponse
export interface TwoFactorRequiredResponse {
  two_factor_required: true
  pending_token: string
}

export type LoginResponse = TokenResponse | TwoFactorRequiredResponse

export function isTwoFactorRequired(
  r: LoginResponse,
): r is TwoFactorRequiredResponse {
  return 'two_factor_required' in r && r.two_factor_required === true
}

export interface TwoFactorLoginRequest {
  pending_token: string
  code: string
}

export interface TwoFactorSetupResponse {
  secret: string
  otpauth_uri: string
  // 10 个一次性恢复码，只在 setup 响应里出现这一次
  backup_codes: string[]
}

export interface TwoFactorStatusResponse {
  enabled: boolean
  backup_codes_remaining: number
}

export interface VerifyEmailRequest {
  token: string
}

export interface ResendVerificationRequest {
  email: string
}

export interface ForgotPasswordRequest {
  email: string
}

export interface ResetPasswordRequest {
  token: string
  new_password: string
}

// --- Module info + Health ---
export interface ModuleInfo {
  name: string
  version: string
  description: string
}

export interface HealthResponse {
  status: 'ok'
  version: string
}

// --- Catalog ---
export type ResourceType = 'paper' | 'book' | 'dataset' | 'tutorial'
export type PublicationStatus = 'published' | 'in_review' | 'draft'

export interface ResourceBase {
  type: ResourceType
  title: string
  authors: string[]
  year: number
  venue?: string | null
  discipline: string
  subdiscipline?: string | null
  tags: string[]
  abstract: string
  preview: string
  download_url?: string | null
  external_url?: string | null
  doi?: string | null
  volume?: string | null
  issue?: string | null
  pages?: string | null
  issn?: string | null
  isbn?: string | null
  publisher?: string | null
  short_container_title?: string | null
  keywords?: string[] | null
  language: string
  publication_status: PublicationStatus
}

export interface ResourceCreate extends ResourceBase {
  slug?: string | null
}

export type ResourceUpdate = Partial<ResourceCreate>

export interface ResourceResponse extends ResourceBase {
  id: number
  slug?: string | null
  created_at: string
  updated_at: string
}

export interface ResourceListResponse {
  data: ResourceResponse[]
  meta: PaginationMeta
}

export interface ResourceStats {
  total: number
  by_type: Record<string, number>
  by_discipline: Record<string, number>
}

export interface FacetBucket {
  value: string
  count: number
}

export interface ResourceFacets {
  years: FacetBucket[]
  tags: FacetBucket[]
}

export interface ResourceListParams {
  type?: ResourceType
  discipline?: string
  year?: number
  q?: string
  page?: number
  page_size?: number
  sort?: 'created_at' | 'year' | 'title'
  order?: 'asc' | 'desc'
}

// --- Submission ---
// 完整 workflow 9-态机：pending → under_review → (major_revision | minor_revision | accepted | rejected)
//   major_revision / minor_revision → resubmitted → under_review（作者重投后再分配）
// approved/rejected 是旧 review 端点的别名，保留向后兼容
export type SubmissionStatus =
  | 'pending'
  | 'under_review'
  | 'major_revision'
  | 'minor_revision'
  | 'resubmitted'
  | 'accepted'
  | 'rejected'
  | 'approved'
export type SubmissionType = 'paper' | 'book' | 'dataset' | 'tutorial'

export interface SubmissionCreate {
  title: string
  type: SubmissionType
  authors: string[]
  year: number
  venue?: string | null
  discipline: string
  subdiscipline?: string | null
  keywords?: string[]
  jel_codes?: string[]
  tags: string[]
  abstract: string
  preview: string
  download_url?: string | null
  external_url?: string | null
  doi?: string | null
  corresponding_author_email?: string | null
}

// 4-元决定（编辑终决）
export type EditorDecision =
  | 'accept'
  | 'minor_revision'
  | 'major_revision'
  | 'reject'
  | 'approved'
  | 'rejected'

export interface SubmissionDecision {
  decision: EditorDecision
  editor_note?: string | null
  resource_id?: number | null
}

export interface SubmissionResponse {
  id: number
  title: string
  type: string
  authors: string[]
  year: number
  venue?: string | null
  discipline: string
  subdiscipline?: string | null
  keywords: string[]
  jel_codes: string[]
  tags: string[]
  abstract: string
  preview: string
  download_url?: string | null
  external_url?: string | null
  doi?: string | null
  corresponding_author_email?: string | null
  status: SubmissionStatus
  admin_note?: string | null
  editor_note?: string | null
  resource_id?: number | null
  file_path?: string | null
  /**
   * 双盲评审下编辑提供给审稿人的匿名稿外链。
   * 与作者可控的 download_url / external_url 完全隔离：只能经编辑端点
   * PUT /submissions/{id}/anonymized-file 写入，传 null 表示清除。
   */
  anonymized_file_url?: string | null
  /** 双盲评审下，审稿人视图中该字段会被置空 */
  submitted_by: number | null
  submitted_at: string
  reviewed_by?: number | null
  reviewed_at?: string | null
}

export interface SubmissionListResponse {
  data: SubmissionResponse[]
  meta: PaginationMeta
}

/** 作者修改稿件：所有字段可选，只提交改动的部分 */
export type SubmissionUpdate = Partial<SubmissionCreate>

/** 稿件版本快照。payload 与 SubmissionCreate 同形（书目字段） */
export interface SubmissionVersionResponse {
  id: number
  submission_id: number
  version: number
  payload: Record<string, unknown>
  file_path?: string | null
  /** 作者重投时填写的修改说明；v1 恒为 null */
  note?: string | null
  created_by?: number | null
  created_at: string
}

export interface SubmissionVersionListResponse {
  data: SubmissionVersionResponse[]
}

// --- Peer review ---
export type AssignmentStatus =
  | 'pending'
  | 'accepted'
  | 'declined'
  | 'completed'
  | 'cancelled'
export type Recommendation =
  | 'accept'
  | 'minor_revision'
  | 'major_revision'
  | 'reject'

export interface AssignmentCreate {
  reviewer_id: number
  due_date?: string | null
}

export interface AssignmentResponse {
  id: number
  submission_id: number
  reviewer_id: number
  assigned_by?: number | null
  status: AssignmentStatus
  due_date?: string | null
  invited_at: string
  responded_at?: string | null
  completed_at?: string | null
  reviewer_username?: string | null
  submission_title?: string | null
}

export interface AssignmentListResponse {
  data: AssignmentResponse[]
  meta: PaginationMeta
}

export interface ReviewSubmit {
  recommendation: Recommendation
  scores: Record<string, number>
  comments_to_editor?: string | null
  comments_to_author?: string | null
}

export interface ReviewReportResponse {
  id: number
  assignment_id: number
  recommendation: Recommendation
  scores: Record<string, number>
  comments_to_editor?: string | null
  comments_to_author?: string | null
  submitted_at: string
}

// --- Library ---
export interface ReadingListCreate {
  name: string
  description?: string | null
}

export type ReadingListUpdate = Partial<ReadingListCreate>

export interface ReadingListItemCreate {
  resource_id: number
}

export interface ResourceRef {
  id: number
  title: string
  type: string
  authors: string[]
  year: number
}

export interface ReadingListItemResponse {
  id: number
  resource_id: number
  added_at: string
  resource: ResourceRef
}

export interface ReadingListResponse {
  id: number
  name: string
  description?: string | null
  item_count: number
  created_at: string
  updated_at: string
}

export interface ReadingListDetailResponse {
  id: number
  name: string
  description?: string | null
  items: ReadingListItemResponse[]
  created_at: string
  updated_at: string
}

export interface ReadingListListResponse {
  data: ReadingListResponse[]
  meta: PaginationMeta
}

// --- Reader ---
export type StorageBackend = 'local' | 's3' | 'minio'

export interface FileAssetCreate {
  filename: string
  original_filename: string
  mime_type: string
  file_size: number
  storage_path: string
  storage_backend: StorageBackend
  sha256?: string | null
}

export interface FileAssetResponse {
  id: number
  filename: string
  original_filename: string
  mime_type: string
  file_size: number
  storage_path: string
  storage_backend: string
  sha256?: string | null
  uploaded_by?: number | null
  created_at: string
}

export interface ReadingProgressUpdate {
  page?: number
  progress_percent?: number
  duration_sec?: number
  completed?: boolean
}

export interface ReadingProgressResponse {
  resource_id: number
  page?: number | null
  progress_percent?: number | null
  duration_sec: number
  visit_count: number
  last_read_at?: string | null
  viewed_at: string
  completed: boolean
}

export interface ReadingHistoryEntryResponse {
  resource_id: number
  viewed_at: string
  last_read_at?: string | null
  visit_count: number
  page?: number | null
  progress_percent?: number | null
  duration_sec: number
  completed: boolean
}

export interface ReadingHistoryListResponse {
  data: ReadingHistoryEntryResponse[]
  meta: PaginationMeta
}

// --- Notifications ---
export interface NotificationResponse {
  id: number
  type: string
  title: string
  body?: string | null
  related_type?: string | null
  related_id?: string | null
  is_read: boolean
  created_at: string
}

export interface NotificationListResponse {
  data: NotificationResponse[]
  meta: PaginationMeta
}

export interface UnreadCountResponse {
  unread: number
}

// --- Follows ---
export interface FollowStatusResponse {
  following: boolean
  followers_count: number
}

export interface SubscriptionStatusResponse {
  subscribed: boolean
  subscribers_count: number
}

export interface AuthorFollowEntry {
  author_name: string
  followed_at: string
}

export interface AuthorFollowListResponse {
  data: AuthorFollowEntry[]
  meta: PaginationMeta
}

export interface DisciplineSubscriptionListResponse {
  data: string[]
}

// --- Ingest ---
export type IngestResourceType =
  | 'paper'
  | 'book'
  | 'journal'
  | 'preprint'
  | 'thesis'
  | 'dataset'
  | 'tutorial'

export type ParseFormat = 'bibtex' | 'ris' | 'csv'
export type FetchSource = 'crossref' | 'arxiv'

export interface IngestResource {
  title: string
  type: IngestResourceType
  authors: string[]
  year?: number | null
  venue?: string | null
  discipline: string
  subdiscipline?: string | null
  tags: string[]
  abstract: string
  doi?: string | null
  publisher?: string | null
  volume?: string | null
  issue?: string | null
  pages?: string | null
  issn?: string | null
  short_container_title?: string | null
}

export interface ParseRequest {
  format: ParseFormat
  content: string
}

export interface FetchRequest {
  source: FetchSource
  id: string
}

export interface ParseError {
  line: number
  error: string
}

export interface ParseResponse {
  data: IngestResource[]
  count: number
  errors: ParseError[]
}

// --- Recommendations ---
export interface RecommendationItem {
  id: number
  title: string
  authors: string[]
  year?: number | null
  doi?: string | null
  discipline?: string | null
  subdiscipline?: string | null
  tags: string[]
  score: number
  reason: string
}

export interface RecommendationListResponse {
  data: RecommendationItem[]
  meta: PaginationMeta
}

// --- Audit log (admin) ---
export interface AuditLogEntry {
  id: number
  tenant_id: string | null
  actor_user_id: number | null
  action: string
  target_type: string | null
  target_id: string | null
  payload: Record<string, unknown> | null
  created_at: string
}

// --- Journal settings (admin) ---
export type ReviewMode = 'single_blind' | 'double_blind'

export interface ReviewModeResponse {
  review_mode: ReviewMode
}

// --- Volume / Issue management (admin) ---
export interface VolumeInfo {
  volume: string
  articleCount: number
  issueCount: number
}

export interface IssueInfo {
  issue: string
  articleCount: number
  firstYear: number
  lastYear: number
}

export interface JournalSettings {
  issn: string
  publisher: string
  short_container_title: string
}

// --- Export ---
