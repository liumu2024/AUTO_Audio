import { env } from '@/config/env'
import type { MigrationProtocolV12 } from '@/types/migration-protocol'
import type { RenderPlanV1 } from '@/types/render-plan'
import type { DirectorAction } from '@shared/types/director-action'
import type { DirectorSessionState } from '@shared/types/director-state'
import type { DirectorConversationRuntime } from '@shared/lib/director-understanding'
import type { DirectorContext } from '@shared/types/director-context'
import type { RemotionTimelineSpecV1 } from '@shared/types/remotion-timeline-spec.v1'

export interface TaskListItemDto {
  id: string
  title: string
  taskStatus: string
  createdAt: string
  completedAt: string | null
  sampleVideoUrl: string
  finalVideoUrl: string | null
  globalPrompt: string | null
  previewUrl: string | null
  hasStructure: boolean
}

export interface ReplicationTaskDto {
  id: string
  userId: number
  sampleVideoUrl: string
  globalPrompt?: string | null
  structureJson: MigrationProtocolV12 | null
  finalVideoUrl: string | null
  taskStatus: string
  createdAt: string
  completedAt: string | null
}

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
      source?: 'llm' | 'rule_fallback'
    }
  | {
      type: 'slot_update'
      slots: DirectorContext['slots']
      missingSlots: string[]
    }
  | {
      type: 'action_plan'
      action: DirectorAction
    }
  | {
      type: 'state_update'
      state: DirectorSessionState
    }
  | {
      type: 'done'
      action?: DirectorAction
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
}

export interface V2TimelinePayload {
  taskId?: string
  mainVideoPath?: string
  prompt: string
  inputImageUrl?: string
  imageSrc?: string
  referenceVideoPath?: string
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
  }>
  metrics: Record<string, number>
  warnings_zh: string[]
  next_actions_zh: string[]
}

export interface V2TimelinePreviewResult {
  taskId: string
  plannerSource: string
  spec: RemotionTimelineSpecV1
  validation: unknown
  review: V2TimelinePlanningReview
  traceDir: string
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

export async function uploadFile(
  file: File,
  options: { requirePublicUrl?: boolean } = {},
): Promise<UploadResult> {
  const form = new FormData()
  form.append('file', file)
  if (options.requirePublicUrl) {
    form.append('requirePublicUrl', 'true')
  }

  const res = await fetch(`${env.apiBase}/api/uploads`, {
    method: 'POST',
    headers: {
      'X-User-Id': String(env.userId),
    },
    body: form,
  })

  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string }
    throw new Error(body.error ?? `HTTP ${res.status} /api/uploads`)
  }

  return res.json() as Promise<UploadResult>
}

export async function getTaskPipeline(taskId: string) {
  return request<import('@/types/pipeline').PipelineBundle>(
    `/api/tasks/${taskId}/pipeline`,
  )
}

export async function listTasks(limit = 48) {
  return request<{ tasks: TaskListItemDto[] }>(
    `/api/tasks?limit=${limit}`,
  )
}

export async function getTask(taskId: string) {
  return request<ReplicationTaskDto>(`/api/tasks/${taskId}`)
}

export async function deleteTask(taskId: string) {
  return request<{ taskId: string; deleted: true }>(`/api/tasks/${taskId}`, {
    method: 'DELETE',
  })
}

export async function cancelTask(taskId: string) {
  return request<{
    taskId: string
    status: string
    removedJobs: number
    stoppedRender?: boolean
    alreadyTerminal: boolean
  }>(`/api/tasks/${taskId}/cancel`, {
    method: 'POST',
  })
}

export async function patchTaskStructure(
  taskId: string,
  structureJson: MigrationProtocolV12,
) {
  return request<ReplicationTaskDto>(`/api/tasks/${taskId}/structure`, {
    method: 'PATCH',
    body: JSON.stringify({ structureJson }),
  })
}

export async function patchTaskRenderPlan(
  taskId: string,
  renderPlan: RenderPlanV1,
) {
  return request<{ renderPlan: RenderPlanV1 }>(
    `/api/tasks/${taskId}/render-plan`,
    {
      method: 'PATCH',
      body: JSON.stringify({ renderPlan }),
    },
  )
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
