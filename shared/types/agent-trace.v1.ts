export const AGENT_TRACE_EVENT_SCHEMA_VERSION = 'agent_trace_event.v1' as const
export const AGENT_TRACE_MANIFEST_SCHEMA_VERSION = 'agent_trace_manifest.v1' as const
export const AGENT_TRACE_INDEX_SCHEMA_VERSION = 'agent_trace_index.v1' as const

export type AgentTracePhase =
  | 'task'
  | 'director_chat'
  | 'sample_understanding'
  | 'effect_planning'
  | 'render_plan'
  | 'component_authoring'
  | 'render'
  | 'quality_gate'

export type AgentTraceActor =
  | 'system'
  | 'user'
  | 'llm'
  | 'tool'
  | 'validator'
  | 'renderer'
  | 'cache'

export type AgentTraceEventKind =
  | 'progress'
  | 'decision'
  | 'artifact'
  | 'validation'
  | 'llm_call'
  | 'tool_call'
  | 'render'
  | 'quality_check'
  | 'error'

export type AgentTraceStatus =
  | 'started'
  | 'success'
  | 'warning'
  | 'failed'
  | 'skipped'
  | 'fallback'

export interface AgentTraceArtifactRef {
  path: string
  label?: string
  kind?: 'json' | 'text' | 'markdown' | 'curl' | 'video' | 'image' | 'other'
  phase?: AgentTracePhase
  category?:
    | 'model_input'
    | 'model_raw_output'
    | 'model_structured_output'
    | 'api_raw_io'
    | 'tool_output'
    | 'audit'
    | 'render_input'
    | 'render_output'
    | 'summary'
    | 'debug'
  bytes?: number
}

export interface AgentTraceError {
  message: string
  code?: string
  stack?: string
}

export interface AgentTraceEventV1 {
  schema_version: typeof AGENT_TRACE_EVENT_SCHEMA_VERSION
  trace_id: string
  task_id: string
  seq: number
  timestamp: string
  phase: AgentTracePhase
  actor: AgentTraceActor
  event: AgentTraceEventKind
  status: AgentTraceStatus
  summary: string
  input_refs?: AgentTraceArtifactRef[]
  output_refs?: AgentTraceArtifactRef[]
  artifact_refs?: AgentTraceArtifactRef[]
  metrics?: Record<string, number>
  data?: Record<string, unknown>
  error?: AgentTraceError
}

export interface AgentTraceManifestV1 {
  schema_version: typeof AGENT_TRACE_MANIFEST_SCHEMA_VERSION
  trace_id: string
  task_id: string
  updated_at: string
  trace_file: 'trace.jsonl'
  index_file?: 'trace-index.json'
  event_count: number
  artifact_count: number
  artifacts: AgentTraceArtifactRef[]
  latest_event?: Pick<
    AgentTraceEventV1,
    'seq' | 'timestamp' | 'phase' | 'actor' | 'event' | 'status' | 'summary'
  >
}

export interface AgentTraceIndexV1 {
  schema_version: typeof AGENT_TRACE_INDEX_SCHEMA_VERSION
  trace_id: string
  task_id: string
  updated_at: string
  trace_file: 'trace.jsonl'
  manifest_file: 'manifest.json'
  read_order: Array<{
    step: number
    title: string
    purpose: string
    files: AgentTraceArtifactRef[]
  }>
  artifacts_by_phase: Partial<
    Record<
      AgentTracePhase,
      Partial<Record<NonNullable<AgentTraceArtifactRef['category']>, AgentTraceArtifactRef[]>>
    >
  >
}
