import { env } from '@/config/env'
import type { DirectorWorkspaceState } from '@shared/types/director-workspace-session'
import type { DirectorAgentStreamEvent } from '@shared/types/director-stream'
import type { DirectorConversationRuntime } from '@shared/lib/director-understanding'
import type { DirectorContext } from '@shared/types/director-context'
import type { RemotionTimelineSpecV1 } from '@shared/types/remotion-timeline-spec.v1'
import type { V2SampleUnderstandingResult } from '@shared/types/v2-sample-understanding'

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
}

export interface DirectorWorkspaceSessionResponse {
  workspaceSessionId: string
  state: DirectorWorkspaceState
  updatedAt: string
}

export interface V2TimelinePayload {
  taskId?: string
  mainVideoPath?: string
  prompt: string
  creationMode?: 'sample_replicate' | 'material_brief' | 'text_to_video'
  inputImageUrl?: string
  imageSrc?: string
  referenceVideoPath?: string
  sampleUnderstanding?: V2SampleUnderstandingResult
  conversationSummary?: string
  planningContext?: {
    kind: 'initial' | 'revision'
    draftId?: string
    baseRevision?: number
    authorizationEvidence?: string
  }
  materials?: Array<{
    id: string
    name?: string
    type: 'video' | 'image' | 'audio'
    src: string
    publicUrl?: string
    tags?: string[]
  }>
  plannerMode?: 'deterministic' | 'llm'
  allowPlannerFallback?: boolean
  durationSec?: number
  timelineSpecOverride?: unknown
  canvas?: {
    width?: number
    height?: number
    fps?: number
  }
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

export interface V2SampleAnalyzePayload {
  taskId?: string
  prompt: string
  sampleVideoPath: string
  sampleVideoName?: string
}

export interface V2SampleAnalyzeResult {
  taskId: string
  understanding: V2SampleUnderstandingResult
  traceDir: string
}

export interface V2TimelinePreviewResult {
  taskId: string
  plannerSource: string
  spec: RemotionTimelineSpecV1
  validation: unknown
  review: V2TimelinePlanningReview
  traceDir: string
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
  status: 'running' | 'completed' | 'failed'
  outputUrl?: string
  traceDir?: string
  createdAt: string
  completedAt?: string
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

export interface V2TimelineDraftPreviewResult extends V2TimelinePreviewResult {
  draft: V2TimelineDraftDto
}

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
  origin: 'explicit' | 'inferred'
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
    taskId: string
    sampleName?: string
    methodIds: string[]
    evidenceRanges: Array<{ start_sec: number; end_sec: number }>
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
    reason: 'selected' | 'below_threshold' | 'top_k_cutoff' | 'status_filtered'
  }>
}

async function request<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const res = await requestResponse(path, init)

  if (!res.ok) {
    throw new Error(res.status === 409
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

function directorRequestSignal(signal: AbortSignal | undefined, remainingMs: number): AbortSignal {
  const timeout = AbortSignal.timeout(Math.max(1, Math.min(IDEMPOTENT_HTTP_TIMEOUT_MS, remainingMs)))
  return signal ? AbortSignal.any([signal, timeout]) : timeout
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
} = {}) {
  const query = new URLSearchParams()
  if (input.draftId) query.set('draftId', input.draftId)
  if (input.scopeType) query.set('scopeType', input.scopeType)
  if (input.status) query.set('status', input.status)
  return request<{ memories: CreativeMemoryDto[] }>(
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

export async function listCreativeKnowledge(status?: CreativeKnowledgeDto['status']) {
  const query = new URLSearchParams()
  if (status) query.set('status', status)
  return request<{ knowledge: CreativeKnowledgeDto[] }>(
    `/api/creative-knowledge${query.size ? `?${query}` : ''}`,
  )
}

export async function searchCreativeKnowledge(queryText: string) {
  const query = new URLSearchParams({ q: queryText })
  return request<CreativeKnowledgeSearchResult>(`/api/creative-knowledge/search?${query}`)
}

export async function updateCreativeKnowledge(input: {
  id: string
  statement?: string
  applicability?: string
  status?: CreativeKnowledgeDto['status']
}) {
  return request<{ knowledge: CreativeKnowledgeDto }>(
    `/api/creative-knowledge/${encodeURIComponent(input.id)}`,
    { method: 'PATCH', body: JSON.stringify(input) },
  )
}

export async function deleteCreativeKnowledge(id: string) {
  return request<{ deleted: true }>(
    `/api/creative-knowledge/${encodeURIComponent(id)}`,
    { method: 'DELETE' },
  )
}

export async function previewV2Timeline(
  payload: V2TimelinePayload,
  idempotencyKey = crypto.randomUUID(),
) {
  return idempotentJsonRequest<V2TimelinePreviewResult>({
    path: '/api/v2/timeline/preview',
    method: 'POST',
    body: payload,
    idempotencyKey,
  })
}

export async function previewV2TimelineDraft(
  payload: V2TimelinePayload & { draftId?: string; baseRevision?: number },
  idempotencyKey = crypto.randomUUID(),
) {
  return idempotentJsonRequest<V2TimelineDraftPreviewResult>({
    path: '/api/v2/timeline-drafts/preview',
    method: 'POST',
    body: payload,
    idempotencyKey,
  })
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
        status: 'running' | 'completed' | 'failed'
      }>(`${path}/${encodeURIComponent(pending.renderRunId)}`, {
        signal: idempotentRequestSignal(),
      })
      if (run.status === 'running') continue
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

export async function analyzeV2Sample(payload: V2SampleAnalyzePayload) {
  return request<V2SampleAnalyzeResult>('/api/v2/sample/analyze', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
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
  const MAX_DIRECTOR_REPLAY_POLLS = 300
  const deadline = Date.now() + DIRECTOR_REPLAY_TIMEOUT_MS
  const sendDirectorTurn = () => fetch(`${env.apiBase}/api/director/chat`, {
    method: 'POST',
    signal: directorRequestSignal(signal, deadline - Date.now()),
    headers: {
      'Content-Type': 'application/json',
      'X-User-Id': String(env.userId),
    },
    body: JSON.stringify(payload),
  })

  for (let attempt = 0; attempt < MAX_DIRECTOR_REPLAY_POLLS; attempt += 1) {
    if (Date.now() >= deadline) break
    let res: Response
    try {
      res = await sendDirectorTurn()
    } catch (error) {
      if (signal?.aborted || attempt === MAX_DIRECTOR_REPLAY_POLLS - 1) throw error
      await new Promise((resolve) => setTimeout(resolve, 1_000))
      continue
    }
    if (!res.ok) {
      throw new Error('对话服务暂时不可用，请稍后重试。')
    }

    let turnReceiptRunning = false
    let finalResultSeen = false
    let doneSeen = false
    if (res.body) {
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const chunks = buffer.split('\n\n')
        buffer = chunks.pop() ?? ''
        for (const chunk of chunks) {
          const line = chunk.split('\n').find((item) => item.startsWith('data: '))
          if (!line) continue
          const json = line.slice('data: '.length).trim()
          if (!json) continue
          const event = JSON.parse(json) as DirectorAgentStreamEvent
          if (event.type === 'turn_receipt' && event.status === 'running') turnReceiptRunning = true
          if (event.type === 'assistant_reply' || event.type === 'workspace_session' || event.type === 'error') {
            finalResultSeen = true
          }
          if (event.type === 'done') doneSeen = true
          onEvent(event)
        }
      }
    }
    if (doneSeen && (!turnReceiptRunning || finalResultSeen)) return
    if (signal?.aborted) throw signal.reason
    await new Promise((resolve) => setTimeout(resolve, 1_000))
  }
  throw new Error('这轮处理仍在继续，请稍后再查看结果。')
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
