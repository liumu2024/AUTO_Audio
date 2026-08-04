import { env } from '@/config/env'
import type { DirectorSessionState } from '@shared/types/director-state'
import type { DirectorWorkspaceState } from '@shared/types/director-workspace-session'
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

export type DirectorAgentStreamEvent =
  | {
      type: 'surface'
      mode:
        | 'smalltalk'
        | 'help'
        | 'capability_intro'
        | 'creative_guide'
        | 'task'
        | 'edit'
        | 'repair'
        | 'unknown'
      confidence: number
      shouldRunIntentRouter: boolean
      directMessage?: string
    }
  | {
      type: 'thought'
      title: string
      content: string
    }
  | {
      type: 'intent'
      intent: string
      confidence: number
      contentDomain: string
      source?: 'llm' | 'llm_unstructured_safe_reply' | 'context_fallback'
    }
  | {
      type: 'slot_update'
      slots: DirectorContext['slots']
      missingSlots: string[]
    }
  | { type: 'constraint_resolution'; config: NonNullable<DirectorContext['effectiveCreativeConfig']> }
  | { type: 'skill_selected'; skillId: string; purpose: string }
  | {
      type: 'skill_loaded'
      skillId: string
      version: string
      source: 'v2_official' | 'official_remotion'
      hash: string
      dependency: boolean
    }
  | {
      type: 'tool_proposed'
      callId: string
      toolId: string
      requestedMode: 'preview' | 'execute'
      effectiveMode: 'preview' | 'execute'
      modeNormalized: boolean
    }
  | { type: 'tool_started'; callId: string; toolId: string }
  | {
      type: 'tool_progress'
      callId: string
      toolId: string
      phase: string
      progress: number
      message: string
      elapsedMs?: number
      jobId?: string
      sceneId?: string
    }
  | {
      type: 'tool_result'
      callId: string
      toolId: string
      ok: boolean
      summary: string
      result?: Record<string, unknown>
      draft?: Pick<V2TimelineDraftDto, 'draftId' | 'revision' | 'spec' | 'traceDir'>
    }
  | { type: 'assistant_reply'; message: string }
  | { type: 'workspace_snapshot'; workspaceSessionId: string; state: DirectorWorkspaceState }
  | {
      type: 'state_update'
      state: DirectorSessionState
    }
  | {
      type: 'workspace_session'
      workspaceSessionId: string
      state: DirectorWorkspaceState
      traceDir: string
      modelCalled: boolean
      responseId?: string
      responseContinuityDisabled?: boolean
    }
  | {
      type: 'done'
      message?: string
    }
  | {
      type: 'error'
      message: string
    }

export interface DirectorAgentChatPayload {
  prompt: string
  context: DirectorContext
  runtime: DirectorConversationRuntime
  workspaceSessionId?: string
  turnRequestId?: string
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
    selectedClipId?: string
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
  createdAt: string
  updatedAt: string
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

export interface V2TimelineRunResult {
  ok: boolean
  taskId: string
  plannerSource: string
  spec: RemotionTimelineSpecV1
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
  evaluation: V2TimelineRunResult['evaluation']
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

async function request<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const res = await fetch(`${env.apiBase}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      'X-User-Id': String(env.userId),
      ...init?.headers,
    },
  })

  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string }
    throw new Error(body.error ?? `HTTP ${res.status} ${path}`)
  }

  return res.json() as Promise<T>
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

export async function previewV2Timeline(payload: V2TimelinePayload) {
  return request<V2TimelinePreviewResult>('/api/v2/timeline/preview', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export async function runV2Timeline(payload: V2TimelinePayload) {
  return request<V2TimelineRunResult>('/api/v2/timeline/run', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export async function previewV2TimelineDraft(
  payload: V2TimelinePayload & { draftId?: string; baseRevision?: number },
) {
  return request<V2TimelineDraftPreviewResult>('/api/v2/timeline-drafts/preview', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export async function getV2TimelineDraft(draftId: string) {
  return request<{ draft: V2TimelineDraftDetailDto }>(
    `/api/v2/timeline-drafts/${encodeURIComponent(draftId)}`,
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
}) {
  return request<{ draft: V2TimelineDraftDto }>(
    `/api/v2/timeline-drafts/${encodeURIComponent(input.draftId)}`,
    {
      method: 'PUT',
      body: JSON.stringify({ baseRevision: input.baseRevision, spec: input.spec }),
    },
  )
}

export async function runV2TimelineDraft(input: {
  draftId: string
  revision: number
}) {
  return request<V2TimelineDraftRunResult>(
    `/api/v2/timeline-drafts/${encodeURIComponent(input.draftId)}/runs`,
    {
      method: 'POST',
      body: JSON.stringify({ revision: input.revision }),
    },
  )
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
  } catch (error) {
    throw new Error(
      `无法连接后端上传接口 ${env.apiBase}/api/uploads，请确认后端或桌面端服务正在运行。原始错误：${
        error instanceof Error ? error.message : String(error)
      }`,
    )
  }

  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string }
    throw new Error(body.error ?? `HTTP ${res.status} /api/uploads`)
  }

  return res.json() as Promise<UploadResult>
}

export async function streamDirectorChat(
  payload: DirectorAgentChatPayload,
  onEvent: (event: DirectorAgentStreamEvent) => void,
  signal?: AbortSignal,
) {
  const res = await fetch(`${env.apiBase}/api/director/chat`, {
    method: 'POST',
    signal,
    headers: {
      'Content-Type': 'application/json',
      'X-User-Id': String(env.userId),
    },
    body: JSON.stringify(payload),
  })

  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string }
    throw new Error(body.error ?? `HTTP ${res.status} /api/director/chat`)
  }
  if (!res.body) return

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
      const line = chunk
        .split('\n')
        .find((item) => item.startsWith('data: '))
      if (!line) continue
      const json = line.slice('data: '.length).trim()
      if (!json) continue
      onEvent(JSON.parse(json) as DirectorAgentStreamEvent)
    }
  }
}

export async function getDirectorWorkspaceSession(workspaceSessionId: string) {
  const res = await fetch(
    `${env.apiBase}/api/director/workspaces/${encodeURIComponent(workspaceSessionId)}`,
    { headers: { 'X-User-Id': String(env.userId) } },
  )
  if (res.status === 404) return null
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string }
    throw new Error(body.error ?? `HTTP ${res.status} director workspace`)
  }
  return res.json() as Promise<DirectorWorkspaceSessionResponse>
}

export async function reportDirectorWorkspaceOutcome(input: {
  workspaceSessionId: string
  action: string
  ok: boolean
  outcome: string
  traceDir?: string
  currentTimeline?: DirectorContext['currentTimeline']
}) {
  const res = await fetch(
    `${env.apiBase}/api/director/workspaces/${encodeURIComponent(input.workspaceSessionId)}/outcomes`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-User-Id': String(env.userId) },
      body: JSON.stringify(input),
    },
  )
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string }
    throw new Error(body.error ?? `HTTP ${res.status} director workspace outcome`)
  }
  return res.json() as Promise<DirectorWorkspaceSessionResponse & { traceDir: string }>
}
