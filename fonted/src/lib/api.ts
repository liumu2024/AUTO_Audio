import { env } from '@/config/env'
import type { DirectorWorkspaceState } from '@shared/types/director-workspace-session'
import type { DirectorAgentStreamEvent } from '@shared/types/director-stream'
import type { DirectorConversationRuntime } from '@shared/lib/director-understanding'
import type { DirectorContext } from '@shared/types/director-context'
import type { RemotionTimelineSpecV1 } from '@shared/types/remotion-timeline-spec.v1'
import { streamDirectorEventsWithReplay } from '@/lib/director-stream-replay'

export interface UploadResult {
  url: string
  publicUrl?: string
  localUrl?: string
  localPath?: string
  filename: string
  size: number
  mimetype: string
  publication?: {
    provider: 'local' | 'tos'
    status: 'published' | 'local_only' | 'failed'
    localUrl: string
    publicUrl?: string
    objectKey?: string
    externallyReachable: boolean
    error?: string
  }
}

export interface DirectorAgentChatPayload {
  prompt: string
  context: DirectorContext
  runtime: DirectorConversationRuntime
  currentTurnMaterialIds?: string[]
  contextMaterialsAuthoritative?: boolean
  contextSampleAuthoritative?: boolean
  workspaceSessionId?: string
  turnRequestId?: string
  workspaceStateRevision?: number
  timelineRevisionDecision?: {
    confirmationId: string
    action: 'confirm' | 'reject'
  }
  timelinePlanDecision?: {
    confirmationId: string
    action: 'confirm' | 'reject'
  }
}

export interface DirectorWorkspaceSessionResponse {
  workspaceSessionId: string
  state: DirectorWorkspaceState
  updatedAt: string
}

export interface V2TimelinePlanningReview {
  schema_version: string
  risk_level: 'low' | 'medium' | 'high'
  summary_zh: string
  scenes: Array<{
    id: string
    type: string
    owner_zh: string
    source_zh: string
    role_zh: string
    start_sec: number
    duration_sec: number
    transition_after?: string
    title_zh?: string
    description_zh?: string
    asset_id?: string
    asset_label_zh?: string
    motion_zh?: string
    overlay_texts_zh?: string[]
    material_usage_zh?: string
  }>
  metrics: Record<string, number>
  warnings_zh: string[]
  next_actions_zh: string[]
}

export interface V2TimelineDraftDto {
  draftId: string
  revision: number
  spec: RemotionTimelineSpecV1
  plannerSource?: string
  review?: V2TimelinePlanningReview
  traceDir?: string
  pendingTimelineRevisions?: Array<{ instruction: string; callId: string; baseRevision: number }>
  createdAt: string
  updatedAt: string
}

export interface V2TimelineDraftReadinessDto {
  draftId: string
  revision: number
  status: 'ready' | 'blocked'
  missing: Array<{ code: string; description: string }>
  alternatives: string[]
  generationJobCount: number
}

export interface V2TimelineDraftRevisionSummaryDto {
  revision: number
  kind: 'preview' | 'user_edit'
  plannerSource?: string
  traceDir?: string
  createdAt: string
}

export interface V2TimelineDraftRunSummaryDto {
  id: string
  sourceRevision: number
  status: 'running' | 'completed' | 'failed' | 'cancelled'
  outputUrl?: string
  traceDir?: string
  createdAt: string
  completedAt?: string
}

export interface V2TimelineDraftRunStatusDto {
  renderRunId: string
  draftId: string
  draftRevision: number
  status: V2TimelineDraftRunSummaryDto['status']
  canCancel: boolean
  providerStatuses: Array<{
    jobId: string
    providerTaskId?: string
    status: string
  }>
  outputUrl?: string
  traceDir?: string
}

export interface V2TimelineDraftHistoryDto {
  draftId: string
  revision: number
  creationMode: 'sample_replicate' | 'material_brief' | 'text_to_video'
  title?: string
  summary?: string
  aspectRatio?: '9:16' | '16:9' | '1:1' | '4:3'
  durationSec?: number
  sceneCount?: number
  visibleTextCount?: number
  plannerSource?: string
  traceDir?: string
  createdAt: string
  updatedAt: string
  latestRevision: V2TimelineDraftRevisionSummaryDto
  latestRun?: V2TimelineDraftRunSummaryDto
}

export type V2TimelineDraftDetailDto = V2TimelineDraftDto & V2TimelineDraftHistoryDto

export interface V2TimelineDraftRunResult {
  ok: boolean
  draftId: string
  draftRevision: number
  renderRunId: string
  plannerSource: string
  resolvedSpec: RemotionTimelineSpecV1
  outputPath: string
  outputUrl?: string
  traceDir: string
  review: V2TimelinePlanningReview
  validation: unknown
  materialResolution: unknown
  standardizedAssets: Array<{ id: string; src: string }>
  evaluation: {
    ok: boolean
    metrics: Record<string, number>
    warnings: string[]
  }
}

export interface CreativeMemoryDto {
  id: string
  userId: number
  scopeType: 'user' | 'draft'
  draftId?: string
  statement: string
  status: 'active' | 'candidate' | 'revoked'
  origin: 'explicit' | 'inferred' | 'synthetic'
  sourceWorkspaceSessionId?: string
  sourceTurnIds: string[]
  sourceExcerpt?: string
  createdAt: string
  updatedAt: string
  revokedAt?: string
}

export interface CreativeMemorySearchResult {
  active: Array<{
    memory: CreativeMemoryDto
    score: number
    matchedTerms: string[]
    rank: number
  }>
  candidate: Array<{
    memory: CreativeMemoryDto
    score: number
    matchedTerms: string[]
    rank: number
  }>
  audit: Array<{
    memoryId: string
    status: CreativeMemoryDto['status']
    score: number
    matchedTerms: string[]
    rank?: number
    selected: boolean
    reason: 'selected' | 'below_threshold' | 'top_k_cutoff' | 'scope_filtered' | 'status_filtered'
  }>
}

export interface CreativeKnowledgeDto {
  id: string
  statement: string
  applicability: string
  status: 'active' | 'candidate' | 'revoked'
  sources: Array<{
    type: 'sample'
    seedId?: string
    taskId: string
    sampleName?: string
    methodIds: string[]
    evidenceRanges: Array<{ start_sec: number; end_sec: number }>
  } | {
    type: 'catalog' | 'manual'
    seedId?: string
    sourceId: string
    sourceTitle: string
    catalogVersion?: string
  } | {
    type: 'manual_revision'
    seedId?: string
    editorUserId: number
    editedAt: string
  } | {
    type: 'review'
    reviewerId: string
    reviewedAt: string
  }>
  createdByUserId?: number
  createdAt: string
  updatedAt: string
  revokedAt?: string
}

export interface CreativeKnowledgeSearchResult {
  items: Array<{
    knowledge: CreativeKnowledgeDto
    score: number
    matchedTerms: string[]
    rank: number
  }>
  audit: Array<{
    knowledgeId: string
    score: number
    matchedTerms: string[]
    rank?: number
    selected: boolean
    reason: 'selected' | 'below_threshold' | 'top_k_cutoff' | 'status_filtered' | 'review_filtered'
  }>
}

async function request<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const res = await requestResponse(path, init)

  if (!res.ok) {
    throw new Error(res.status === 403
      ? '当前操作需要管理员权限，请检查管理凭证。'
      : res.status === 409
      ? '当前内容已经发生变化，请刷新后重试。'
      : '请求暂时没有完成，请稍后重试。')
  }

  return res.json() as Promise<T>
}

function requestResponse(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${env.apiBase}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      'X-User-Id': String(env.userId),
      ...init?.headers,
    },
  })
}

const MAX_IDEMPOTENCY_POLL_ATTEMPTS = 300
const IDEMPOTENT_HTTP_TIMEOUT_MS = 30_000
const DIRECTOR_REPLAY_TIMEOUT_MS = 5 * 60_000

function idempotentRequestSignal(): AbortSignal {
  return AbortSignal.timeout(IDEMPOTENT_HTTP_TIMEOUT_MS)
}

async function idempotentJsonRequest<T>(input: {
  path: string
  method: 'POST' | 'PUT'
  body: unknown
  idempotencyKey: string
}): Promise<T> {
  const send = () => requestResponse(input.path, {
    method: input.method,
    headers: { 'Idempotency-Key': input.idempotencyKey },
    body: JSON.stringify(input.body),
    signal: idempotentRequestSignal(),
  })
  let response: Response
  try {
    response = await send()
  } catch {
    response = await send()
  }
  for (let attempt = 0; response.status === 202 && attempt < MAX_IDEMPOTENCY_POLL_ATTEMPTS; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 500))
    response = await send()
  }
  if (response.status === 202) {
    throw new Error('这项处理仍在继续，请稍后再查看结果。')
  }
  if (!response.ok) {
    throw new Error(response.status === 409
      ? '当前内容已经发生变化，请刷新后重试。'
      : '这项处理暂时没有完成，请稍后重试。')
  }
  return response.json() as Promise<T>
}

export async function healthCheck(): Promise<{ ok: boolean }> {
  return request('/health')
}

export async function listCreativeMemories(input: {
  draftId?: string
  scopeType?: CreativeMemoryDto['scopeType']
  status?: CreativeMemoryDto['status']
  offset?: number
  limit?: number
} = {}) {
  const query = new URLSearchParams()
  if (input.draftId) query.set('draftId', input.draftId)
  if (input.scopeType) query.set('scopeType', input.scopeType)
  if (input.status) query.set('status', input.status)
  if (input.offset !== undefined) query.set('offset', String(input.offset))
  if (input.limit !== undefined) query.set('limit', String(input.limit))
  return request<{
    memories: CreativeMemoryDto[]
    total: number
    offset: number
    limit: number
  }>(
    `/api/creative-memories${query.size ? `?${query}` : ''}`,
  )
}

export async function searchCreativeMemories(input: {
  draftId?: string
  query: string
  activeLimit?: number
  candidateLimit?: number
}) {
  const query = new URLSearchParams()
  if (input.draftId) query.set('draftId', input.draftId)
  query.set('q', input.query)
  if (input.activeLimit) query.set('activeLimit', String(input.activeLimit))
  if (input.candidateLimit) query.set('candidateLimit', String(input.candidateLimit))
  return request<CreativeMemorySearchResult>(`/api/creative-memories/search?${query}`)
}

export async function createCreativeMemory(input: {
  scopeType: CreativeMemoryDto['scopeType']
  draftId?: string
  statement: string
}) {
  return request<{ memory: CreativeMemoryDto }>('/api/creative-memories', {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export async function updateCreativeMemory(input: {
  id: string
  statement?: string
  status?: CreativeMemoryDto['status']
}) {
  return request<{ memory: CreativeMemoryDto }>(
    `/api/creative-memories/${encodeURIComponent(input.id)}`,
    { method: 'PATCH', body: JSON.stringify({ statement: input.statement, status: input.status }) },
  )
}

export async function deleteCreativeMemory(id: string) {
  return request<{ deleted: true }>(
    `/api/creative-memories/${encodeURIComponent(id)}`,
    { method: 'DELETE' },
  )
}

export async function listCreativeKnowledge(input: {
  status?: CreativeKnowledgeDto['status']
  offset?: number
  limit?: number
  adminToken?: string
} = {}) {
  const query = new URLSearchParams()
  if (input.status) query.set('status', input.status)
  if (input.offset !== undefined) query.set('offset', String(input.offset))
  if (input.limit !== undefined) query.set('limit', String(input.limit))
  return request<{
    knowledge: CreativeKnowledgeDto[]
    total: number
    offset: number
    limit: number
  }>(
    `/api/creative-knowledge${query.size ? `?${query}` : ''}`,
    input.adminToken ? { headers: { Authorization: `Bearer ${input.adminToken}` } } : undefined,
  )
}

export async function createCreativeKnowledge(input: {
  statement: string
  applicability: string
}) {
  return request<{ knowledge: CreativeKnowledgeDto }>('/api/creative-knowledge', {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export async function searchCreativeKnowledge(queryText: string, input: {
  status?: CreativeKnowledgeDto['status']
  adminToken?: string
} = {}) {
  const query = new URLSearchParams({ q: queryText })
  if (input.status) query.set('status', input.status)
  return request<CreativeKnowledgeSearchResult>(
    `/api/creative-knowledge/search?${query}`,
    input.adminToken ? { headers: { Authorization: `Bearer ${input.adminToken}` } } : undefined,
  )
}

export async function updateCreativeKnowledge(input: {
  id: string
  statement?: string
  applicability?: string
  status?: CreativeKnowledgeDto['status']
  adminToken?: string
}) {
  const { id, adminToken, ...body } = input
  return request<{ knowledge: CreativeKnowledgeDto }>(
    `/api/creative-knowledge/${encodeURIComponent(id)}`,
    {
      method: 'PATCH',
      headers: adminToken ? { Authorization: `Bearer ${adminToken}` } : undefined,
      body: JSON.stringify(body),
    },
  )
}

export async function deleteCreativeKnowledge(input: { id: string; adminToken?: string }) {
  return request<{ deleted: true }>(
    `/api/creative-knowledge/${encodeURIComponent(input.id)}`,
    {
      method: 'DELETE',
      headers: input.adminToken ? { Authorization: `Bearer ${input.adminToken}` } : undefined,
    },
  )
}

export async function getV2TimelineDraft(draftId: string) {
  return request<{ draft: V2TimelineDraftDetailDto }>(
    `/api/v2/timeline-drafts/${encodeURIComponent(draftId)}`,
  )
}

export async function getV2TimelineDraftReadiness(draftId: string, revision: number) {
  return request<V2TimelineDraftReadinessDto>(
    `/api/v2/timeline-drafts/${encodeURIComponent(draftId)}/readiness?revision=${revision}`,
  )
}

export async function listV2TimelineDrafts(limit = 48) {
  return request<{ drafts: V2TimelineDraftHistoryDto[] }>(
    `/api/v2/timeline-drafts?limit=${Math.max(1, Math.min(limit, 100))}`,
  )
}

export async function deleteV2TimelineDraft(draftId: string) {
  return request<{ draftId: string; deleted: true }>(
    `/api/v2/timeline-drafts/${encodeURIComponent(draftId)}`,
    { method: 'DELETE' },
  )
}

export async function saveV2TimelineDraft(input: {
  draftId: string
  baseRevision: number
  spec: RemotionTimelineSpecV1
  idempotencyKey?: string
}) {
  return idempotentJsonRequest<{ draft: V2TimelineDraftDto }>({
    path: `/api/v2/timeline-drafts/${encodeURIComponent(input.draftId)}`,
    method: 'PUT',
    body: { baseRevision: input.baseRevision, spec: input.spec },
    idempotencyKey: input.idempotencyKey ?? crypto.randomUUID(),
  })
}

export async function runV2TimelineDraft(input: {
  draftId: string
  revision: number
  idempotencyKey?: string
}) {
  const path = `/api/v2/timeline-drafts/${encodeURIComponent(input.draftId)}/runs`
  const idempotencyKey = input.idempotencyKey ?? crypto.randomUUID()
  const post = () => requestResponse(path, {
    method: 'POST',
    headers: { 'Idempotency-Key': idempotencyKey },
    body: JSON.stringify({ revision: input.revision }),
    signal: idempotentRequestSignal(),
  })
  let response: Response
  try {
    response = await post()
  } catch {
    response = await post()
  }
  if (response.status === 202) {
    const pending = await response.json() as { renderRunId: string }
    for (let attempt = 0; attempt < MAX_IDEMPOTENCY_POLL_ATTEMPTS; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 1000))
      const run = await request<{
        status: 'running' | 'completed' | 'failed' | 'cancelled'
      }>(`${path}/${encodeURIComponent(pending.renderRunId)}`, {
        signal: idempotentRequestSignal(),
      })
      if (run.status === 'running') continue
      if (run.status === 'cancelled') throw new Error('这次成片任务已经取消。')
      if (run.status === 'failed') throw new Error('这次成片导出没有完成。')
      response = await post()
      break
    }
    if (response.status === 202) {
      throw new Error('成片仍在生成中，请稍后查看结果。')
    }
  }
  if (!response.ok) {
    throw new Error(response.status === 409
      ? '当前方案已经发生变化，请刷新后重试。'
      : '成片导出暂时没有完成，请稍后重试。')
  }
  return response.json() as Promise<V2TimelineDraftRunResult>
}

export async function getV2TimelineDraftRun(input: { draftId: string; renderRunId: string }) {
  return request<V2TimelineDraftRunStatusDto>(
    `/api/v2/timeline-drafts/${encodeURIComponent(input.draftId)}/runs/${encodeURIComponent(input.renderRunId)}`,
  )
}

export async function cancelV2TimelineDraftRun(input: { draftId: string; renderRunId: string }) {
  const response = await requestResponse(
    `/api/v2/timeline-drafts/${encodeURIComponent(input.draftId)}/runs/${encodeURIComponent(input.renderRunId)}`,
    { method: 'DELETE', signal: idempotentRequestSignal() },
  )
  const result = await response.json() as {
    cancelled: boolean
    status: 'running' | 'completed' | 'failed' | 'cancelled'
    reason?: string
  }
  return result
}

export async function uploadFile(
  file: File,
  options: { requirePublicUrl?: boolean } = {},
): Promise<UploadResult> {
  const form = new FormData()
  form.append('file', file)
  if (options.requirePublicUrl) {
    form.append('requirePublicUrl', 'true')
  }

  let res: Response
  try {
    res = await fetch(`${env.apiBase}/api/uploads`, {
      method: 'POST',
      headers: {
        'X-User-Id': String(env.userId),
      },
      body: form,
    })
  } catch {
    throw new Error('上传服务暂时无法连接，请确认创作服务正在运行后重试。')
  }

  if (!res.ok) {
    throw new Error('文件上传失败，请重新选择后再试。')
  }

  return res.json() as Promise<UploadResult>
}

export async function streamDirectorChat(
  payload: DirectorAgentChatPayload,
  onEvent: (event: DirectorAgentStreamEvent) => void,
  signal?: AbortSignal,
) {
  return streamDirectorEventsWithReplay({
    payload,
    signal,
    onEvent,
    connectTimeoutMs: IDEMPOTENT_HTTP_TIMEOUT_MS,
    replayTimeoutMs: DIRECTOR_REPLAY_TIMEOUT_MS,
    pollDelayMs: 1_000,
    send: (body, requestSignal) => fetch(`${env.apiBase}/api/director/chat`, {
      method: 'POST',
      signal: requestSignal,
      headers: {
        'Content-Type': 'application/json',
        'X-User-Id': String(env.userId),
      },
      body: JSON.stringify(body),
    }),
  })
}

export async function getDirectorWorkspaceSession(workspaceSessionId: string) {
  const res = await fetch(
    `${env.apiBase}/api/director/workspaces/${encodeURIComponent(workspaceSessionId)}`,
    { headers: { 'X-User-Id': String(env.userId) } },
  )
  if (res.status === 404) return null
  if (!res.ok) {
    throw new Error('当前对话状态暂时无法读取，请稍后重试。')
  }
  return res.json() as Promise<DirectorWorkspaceSessionResponse>
}
