import { mkdir, readFile, stat, writeFile, appendFile } from 'node:fs/promises'
import path from 'node:path'

import { env } from '../../config/env.js'
import {
  AGENT_TRACE_EVENT_SCHEMA_VERSION,
  AGENT_TRACE_INDEX_SCHEMA_VERSION,
  AGENT_TRACE_MANIFEST_SCHEMA_VERSION,
  type AgentTraceActor,
  type AgentTraceArtifactRef,
  type AgentTraceEventKind,
  type AgentTraceEventV1,
  type AgentTraceIndexV1,
  type AgentTraceManifestV1,
  type AgentTracePhase,
  type AgentTraceStatus,
} from '../../../../shared/types/agent-trace.v1.js'
import {
  agentTraceArtifactsDir,
  agentTraceTaskDir,
  toAgentTraceRelativePath,
} from './paths.js'

interface RecordAgentTraceEventInput {
  taskId: string
  phase: AgentTracePhase
  actor: AgentTraceActor
  event: AgentTraceEventKind
  status: AgentTraceStatus
  summary: string
  inputRefs?: AgentTraceArtifactRef[]
  outputRefs?: AgentTraceArtifactRef[]
  artifactRefs?: AgentTraceArtifactRef[]
  metrics?: Record<string, number>
  data?: Record<string, unknown>
  error?: AgentTraceEventV1['error']
}

interface WriteAgentTraceArtifactInput {
  taskId: string
  phase: AgentTracePhase
  actor: AgentTraceActor
  fileName: string
  summary: string
  json?: unknown
  text?: string
  artifactKind?: AgentTraceArtifactRef['kind']
  status?: AgentTraceStatus
  data?: Record<string, unknown>
}

const taskWriteQueues = new Map<string, Promise<void>>()
const taskSeq = new Map<string, number>()

function traceFilePath(taskId: string): string {
  return path.join(agentTraceTaskDir(taskId), 'trace.jsonl')
}

function manifestFilePath(taskId: string): string {
  return path.join(agentTraceTaskDir(taskId), 'manifest.json')
}

function indexFilePath(taskId: string): string {
  return path.join(agentTraceTaskDir(taskId), 'trace-index.json')
}

function stageSummaryFilePath(taskId: string): string {
  return path.join(agentTraceTaskDir(taskId), 'stage-summary.json')
}

async function readManifest(taskId: string): Promise<AgentTraceManifestV1 | null> {
  try {
    return JSON.parse(await readFile(manifestFilePath(taskId), 'utf8')) as AgentTraceManifestV1
  } catch {
    return null
  }
}

async function nextSeq(taskId: string): Promise<number> {
  const current = taskSeq.get(taskId)
  if (current != null) {
    const next = current + 1
    taskSeq.set(taskId, next)
    return next
  }

  const manifest = await readManifest(taskId)
  const next = (manifest?.event_count ?? 0) + 1
  taskSeq.set(taskId, next)
  return next
}

function uniqueArtifacts(artifacts: AgentTraceArtifactRef[]): AgentTraceArtifactRef[] {
  const seen = new Map<string, AgentTraceArtifactRef>()
  for (const artifact of artifacts) {
    seen.set(artifact.path, artifact)
  }
  return [...seen.values()].sort((a, b) => a.path.localeCompare(b.path))
}

function groupArtifactsByPhase(
  artifacts: AgentTraceArtifactRef[],
): AgentTraceIndexV1['artifacts_by_phase'] {
  const grouped: AgentTraceIndexV1['artifacts_by_phase'] = {}
  for (const artifact of artifacts) {
    if (!artifact.phase || !artifact.category) continue
    const phaseGroup = grouped[artifact.phase] ?? {}
    const categoryArtifacts = phaseGroup[artifact.category] ?? []
    categoryArtifacts.push(artifact)
    phaseGroup[artifact.category] = categoryArtifacts
    grouped[artifact.phase] = phaseGroup
  }
  return grouped
}

function filesFor(
  artifacts: AgentTraceArtifactRef[],
  phase: AgentTracePhase,
  categories: Array<NonNullable<AgentTraceArtifactRef['category']>>,
): AgentTraceArtifactRef[] {
  const categorySet = new Set(categories)
  return artifacts.filter(
    (artifact) => artifact.phase === phase && artifact.category && categorySet.has(artifact.category),
  )
}

function overviewArtifact(pathValue: string, label: string): AgentTraceArtifactRef {
  return {
    path: pathValue,
    label,
    kind: pathValue.endsWith('.jsonl') ? 'text' : 'json',
    category: 'summary',
  }
}

function artifactFileName(artifact: AgentTraceArtifactRef): string {
  const parts = artifact.path.split('/')
  return (artifact.label ?? parts[parts.length - 1] ?? artifact.path).toLowerCase()
}

function primarySampleArtifact(artifact: AgentTraceArtifactRef): boolean {
  const name = artifactFileName(artifact)
  return [
    'sample-audio-visual-hints.json',
    '01-director-observation-prompt.md',
    '01-director-observation-brief.json',
    '02-director-grounding-structuring-prompt.md',
    'director-grounding-summary.json',
    'prompt-clause-audit.json',
    'director-grounding-validated.json',
    'director-grounding-normalization-diff.json',
    'sample-understanding-adapter-summary.json',
  ].includes(name)
}

function primaryEffectArtifact(artifact: AgentTraceArtifactRef): boolean {
  const name = artifactFileName(artifact)
  return [
    'effect-roadmap.json',
    'atom-plan.json',
    'mapping-decisions.json',
    'mapping-decisions.seed.json',
    'compiled-effect-layers.json',
    'composition-validation.json',
    'doctor-report.json',
    'effect-debug-manifest.json',
  ].includes(name)
}

function primaryComponentArtifact(artifact: AgentTraceArtifactRef): boolean {
  const name = artifactFileName(artifact)
  return [
    '01-component-knowledge-summary.json',
    '02-component-retrieval-summary.json',
    '02-component-gap-report.json',
    '06-component-resolution.report.json',
    '05-validation.json',
    '05-validation-summary.json',
    '03-authoring-prompt.txt',
    '04-llm-output.raw.txt',
  ].includes(name) ||
    name.includes('authoring-prompt') ||
    name.includes('llm-output') ||
    name.includes('parsed-output') ||
    name.endsWith('-05-validation.json') ||
    name.endsWith('.effect-validation.json')
}

function primaryTimelineArtifact(artifact: AgentTraceArtifactRef): boolean {
  const name = artifactFileName(artifact)
  return name.includes('timeline-') || name.includes('timeline.')
}

function primaryRenderArtifact(artifact: AgentTraceArtifactRef): boolean {
  const name = artifactFileName(artifact)
  return (
    name.includes('render-props.summary') ||
    artifact.category === 'render_output' ||
    name.endsWith('.mp4')
  )
}

function primaryQualityArtifact(artifact: AgentTraceArtifactRef): boolean {
  const name = artifactFileName(artifact)
  return name.includes('render-output-quality') || name.includes('evaluation')
}

function curatedFilesFor(
  artifacts: AgentTraceArtifactRef[],
  predicate: (artifact: AgentTraceArtifactRef) => boolean,
): AgentTraceArtifactRef[] {
  return artifacts.filter(predicate)
}

function buildReadOrder(artifacts: AgentTraceArtifactRef[]): AgentTraceIndexV1['read_order'] {
  const candidates: AgentTraceIndexV1['read_order'] = [
    {
      step: 1,
      title: 'Trace overview',
      purpose: '先读中文 stage-summary.json，再用 trace-index.json 的 curated read order 深入重点文件；manifest.json 和 trace.jsonl 保留完整底账。',
      files: [
        overviewArtifact('stage-summary.json', 'stage-summary.json'),
        overviewArtifact('trace-index.json', 'trace-index.json'),
        overviewArtifact('manifest.json', 'manifest.json'),
        overviewArtifact('trace.jsonl', 'trace.jsonl'),
      ],
    },
    {
      step: 2,
      title: 'Sample understanding',
      purpose: '只看分阶段 prompt、观测摘要、最终 Director Grounding 与审计摘要；raw request/response 仅在故障时从 manifest 深查。',
      files: curatedFilesFor(
        artifacts.filter((artifact) => artifact.phase === 'sample_understanding'),
        primarySampleArtifact,
      ),
    },
    {
      step: 3,
      title: 'Effect planning',
      purpose: '查看效果路线、素材/效果映射、编译后的 effect layers 与 doctor 结果。',
      files: curatedFilesFor(
        artifacts.filter((artifact) => artifact.phase === 'effect_planning'),
        primaryEffectArtifact,
      ),
    },
    {
      step: 4,
      title: 'Component authoring',
      purpose: '仅在启用组件生成时查看组件解析、校验和真实 LLM 生成输入输出。',
      files: curatedFilesFor(
        artifacts.filter((artifact) => artifact.phase === 'component_authoring'),
        primaryComponentArtifact,
      ),
    },
    {
      step: 5,
      title: 'V2 timeline planning',
      purpose: '查看时间线方案与校验记录，确认进入 Remotion 前的可渲染性。',
      files: curatedFilesFor(
        artifacts.filter((artifact) => artifact.phase === 'timeline_planning'),
        primaryTimelineArtifact,
      ),
    },
    {
      step: 6,
      title: 'Render IO',
      purpose: '优先看 render props 摘要和最终视频；完整 render props 只作为 Remotion 运行输入保留。',
      files: curatedFilesFor(
        artifacts.filter((artifact) => artifact.phase === 'render'),
        primaryRenderArtifact,
      ),
    },
    {
      step: 7,
      title: 'Post-render evaluation',
      purpose: '查看后渲染质量评估，包括素材使用、转场覆盖、镜头节奏与关键帧对比。',
      files: curatedFilesFor(
        artifacts.filter((artifact) => artifact.phase === 'quality_gate'),
        primaryQualityArtifact,
      ),
    },
  ]

  return candidates.filter((entry) => entry.step === 1 || entry.files.length > 0)
}

const PHASE_LABELS: Record<AgentTracePhase, string> = {
  task: '任务状态',
  director_chat: '导演对话',
  sample_understanding: '样例理解',
  effect_planning: '效果规划',
  timeline_planning: 'V2 时间线规划',
  component_authoring: '组件生成',
  render: 'Remotion 渲染',
  quality_gate: '质量评估',
}

const CATEGORY_LABELS: Record<NonNullable<AgentTraceArtifactRef['category']>, string> = {
  model_input: '模型输入',
  model_raw_output: '模型原始输出',
  model_structured_output: '模型结构化输出',
  api_raw_io: 'API 原始 IO',
  tool_output: '工具输出',
  audit: '校验/审计',
  render_input: '渲染输入',
  render_output: '渲染输出',
  summary: '摘要',
  debug: '调试底账',
}

function categoryCounts(artifacts: AgentTraceArtifactRef[]): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const artifact of artifacts) {
    const label = artifact.category ? CATEGORY_LABELS[artifact.category] : '未分类'
    counts[label] = (counts[label] ?? 0) + 1
  }
  return counts
}

function recommendedArtifactsForPhase(
  phase: AgentTracePhase,
  artifacts: AgentTraceArtifactRef[],
): AgentTraceArtifactRef[] {
  if (phase === 'sample_understanding') return curatedFilesFor(artifacts, primarySampleArtifact)
  if (phase === 'effect_planning') return curatedFilesFor(artifacts, primaryEffectArtifact)
  if (phase === 'component_authoring') return curatedFilesFor(artifacts, primaryComponentArtifact)
  if (phase === 'timeline_planning') return curatedFilesFor(artifacts, primaryTimelineArtifact)
  if (phase === 'render') return curatedFilesFor(artifacts, primaryRenderArtifact)
  if (phase === 'quality_gate') return curatedFilesFor(artifacts, primaryQualityArtifact)
  return artifacts.filter((artifact) => artifact.category === 'summary' || artifact.category === 'audit')
}

function buildStageSummary(manifest: AgentTraceManifestV1): unknown {
  const phases: AgentTracePhase[] = [
    'sample_understanding',
    'effect_planning',
    'component_authoring',
    'timeline_planning',
    'render',
    'quality_gate',
    'task',
    'director_chat',
  ]

  return {
    schema_version: 'agent_trace_stage_summary.v1',
    task_id: manifest.task_id,
    updated_at: manifest.updated_at,
    如何阅读: [
      '先看本文件，确认每个阶段的状态和重点文件。',
      '再按 trace-index.json 的 read_order 打开重点文件。',
      'manifest.json 和 trace.jsonl 保留完整底账；raw-response、curl、request 只在排错时查看。',
    ],
    最新事件: manifest.latest_event ?? null,
    总览: {
      事件数: manifest.event_count,
      artifact数: manifest.artifact_count,
    },
    阶段: phases
      .map((phase) => {
        const phaseArtifacts = manifest.artifacts.filter((artifact) => artifact.phase === phase)
        if (phaseArtifacts.length === 0) return null
        const recommended = recommendedArtifactsForPhase(phase, phaseArtifacts)
        return {
          阶段: PHASE_LABELS[phase],
          phase,
          文件数: phaseArtifacts.length,
          文件类型统计: categoryCounts(phaseArtifacts),
          建议优先查看: recommended.map((artifact) => ({
            path: artifact.path,
            label: artifact.label ?? artifact.path,
            category: artifact.category ? CATEGORY_LABELS[artifact.category] : '未分类',
            bytes: artifact.bytes,
          })),
          深查提示:
            recommended.length === phaseArtifacts.length
              ? '本阶段文件量较少，优先文件基本覆盖人工审查需要。'
              : `本阶段隐藏了 ${phaseArtifacts.length - recommended.length} 个低信号/raw/debug 文件，可在 manifest.json 中按需查看。`,
        }
      })
      .filter(Boolean),
  }
}

async function writeStageSummary(taskId: string, manifest: AgentTraceManifestV1): Promise<void> {
  await writeFile(stageSummaryFilePath(taskId), `${JSON.stringify(buildStageSummary(manifest), null, 2)}\n`, 'utf8')
}

async function writeTraceIndex(taskId: string, manifest: AgentTraceManifestV1): Promise<void> {
  const index: AgentTraceIndexV1 = {
    schema_version: AGENT_TRACE_INDEX_SCHEMA_VERSION,
    trace_id: taskId,
    task_id: taskId,
    updated_at: manifest.updated_at,
    trace_file: 'trace.jsonl',
    manifest_file: 'manifest.json',
    read_order: buildReadOrder(manifest.artifacts),
    artifacts_by_phase: groupArtifactsByPhase(manifest.artifacts),
  }
  await writeFile(indexFilePath(taskId), `${JSON.stringify(index, null, 2)}\n`, 'utf8')
  await writeStageSummary(taskId, manifest)
}

async function writeManifest(taskId: string, event: AgentTraceEventV1): Promise<void> {
  const previous = await readManifest(taskId)
  const nextArtifacts = uniqueArtifacts([
    ...(previous?.artifacts ?? []),
    ...(event.input_refs ?? []),
    ...(event.output_refs ?? []),
    ...(event.artifact_refs ?? []),
  ])
  const manifest: AgentTraceManifestV1 = {
    schema_version: AGENT_TRACE_MANIFEST_SCHEMA_VERSION,
    trace_id: taskId,
    task_id: taskId,
    updated_at: event.timestamp,
    trace_file: 'trace.jsonl',
    index_file: 'trace-index.json',
    event_count: event.seq,
    artifact_count: nextArtifacts.length,
    artifacts: nextArtifacts,
    latest_event: {
      seq: event.seq,
      timestamp: event.timestamp,
      phase: event.phase,
      actor: event.actor,
      event: event.event,
      status: event.status,
      summary: event.summary,
    },
  }
  await writeFile(manifestFilePath(taskId), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
  await writeTraceIndex(taskId, manifest)
}

async function writeTraceEvent(input: RecordAgentTraceEventInput): Promise<void> {
  if (!env.enableAgentTrace) return

  const taskDir = agentTraceTaskDir(input.taskId)
  await mkdir(taskDir, { recursive: true })

  const event: AgentTraceEventV1 = {
    schema_version: AGENT_TRACE_EVENT_SCHEMA_VERSION,
    trace_id: input.taskId,
    task_id: input.taskId,
    seq: await nextSeq(input.taskId),
    timestamp: new Date().toISOString(),
    phase: input.phase,
    actor: input.actor,
    event: input.event,
    status: input.status,
    summary: input.summary,
    ...(input.inputRefs?.length ? { input_refs: input.inputRefs } : {}),
    ...(input.outputRefs?.length ? { output_refs: input.outputRefs } : {}),
    ...(input.artifactRefs?.length ? { artifact_refs: input.artifactRefs } : {}),
    ...(input.metrics ? { metrics: input.metrics } : {}),
    ...(input.data ? { data: input.data } : {}),
    ...(input.error ? { error: input.error } : {}),
  }

  await appendFile(traceFilePath(input.taskId), `${JSON.stringify(event)}\n`, 'utf8')
  await writeManifest(input.taskId, event)
}

export function recordAgentTraceEvent(input: RecordAgentTraceEventInput): Promise<void> {
  if (!env.enableAgentTrace) return Promise.resolve()

  const previous = taskWriteQueues.get(input.taskId) ?? Promise.resolve()
  const next = previous
    .catch(() => undefined)
    .then(() => writeTraceEvent(input))
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error)
      console.warn(`[agent-trace] failed to write trace for ${input.taskId}: ${message}`)
    })
  taskWriteQueues.set(input.taskId, next)
  return next
}

export async function flushAgentTrace(taskId: string): Promise<void> {
  await taskWriteQueues.get(taskId)
}

function inferArtifactKind(fileName: string): AgentTraceArtifactRef['kind'] {
  const lower = fileName.toLowerCase()
  if (lower.endsWith('.json')) return 'json'
  if (lower.endsWith('.md')) return 'markdown'
  if (lower.endsWith('.curl.txt')) return 'curl'
  if (lower.endsWith('.txt')) return 'text'
  if (lower.endsWith('.mp4') || lower.endsWith('.mov') || lower.endsWith('.webm')) return 'video'
  if (lower.endsWith('.png') || lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image'
  return 'other'
}

function inferArtifactPhase(relativePath: string): AgentTracePhase | undefined {
  const parts = relativePath.split('/')
  const artifactsIndex = parts.indexOf('artifacts')
  const phase = artifactsIndex >= 0 ? parts[artifactsIndex + 1] : undefined
  if (!phase && relativePath.includes('renders/') && inferArtifactKind(relativePath) === 'video') {
    return 'render'
  }
  const knownPhases: AgentTracePhase[] = [
    'task',
    'director_chat',
    'sample_understanding',
    'effect_planning',
    'timeline_planning',
    'component_authoring',
    'render',
    'quality_gate',
  ]
  return knownPhases.find((item) => item === phase)
}

function inferArtifactCategory(input: {
  phase?: AgentTracePhase
  fileName: string
  kind?: AgentTraceArtifactRef['kind']
}): AgentTraceArtifactRef['category'] {
  const lower = input.fileName.toLowerCase()

  if (
    lower.includes('audit') ||
    lower.includes('validation') ||
    lower.includes('quality') ||
    lower.includes('repair') ||
    lower.includes('doctor') ||
    lower.includes('evaluation')
  ) {
    return 'audit'
  }
  if (lower.includes('summary')) return 'summary'
  if (input.phase === 'render') {
    if (lower.includes('render-props')) return 'render_input'
    if (input.kind === 'video') return 'render_output'
  }
  if (input.kind === 'video') return 'render_output'
  if (lower.includes('prompt') || lower.includes('request.json')) return 'model_input'
  if (lower.includes('raw-response') || lower.includes('raw-output') || lower.includes('llm-output')) {
    return 'model_raw_output'
  }
  if (lower.includes('parsed-output')) return 'model_structured_output'
  if (input.phase === 'effect_planning') return 'tool_output'
  if (input.phase === 'component_authoring') return 'tool_output'
  if (
    lower.includes('extracted') ||
    lower.includes('validated') ||
    lower.includes('director-grounding') ||
    lower.includes('sample-understanding')
  ) {
    return 'model_structured_output'
  }
  if (lower.includes('curl') || lower.includes('ark-files') || lower.includes('request')) {
    return 'api_raw_io'
  }
  if (input.phase === 'timeline_planning') return 'audit'
  return 'debug'
}

export async function artifactRefForPath(input: {
  taskId: string
  path: string
  label?: string
  kind?: AgentTraceArtifactRef['kind']
  phase?: AgentTracePhase
  category?: AgentTraceArtifactRef['category']
}): Promise<AgentTraceArtifactRef> {
  const file = await stat(input.path).catch(() => null)
  const relativePath = toAgentTraceRelativePath(input.taskId, input.path)
  const kind = input.kind ?? inferArtifactKind(input.path)
  const phase = input.phase ?? inferArtifactPhase(relativePath)
  return {
    path: relativePath,
    label: input.label ?? path.basename(input.path),
    kind,
    ...(phase ? { phase } : {}),
    category:
      input.category ??
      inferArtifactCategory({
        phase,
        fileName: input.label ?? path.basename(input.path),
        kind,
      }),
    ...(file ? { bytes: file.size } : {}),
  }
}

export async function writeAgentTraceArtifact(
  input: WriteAgentTraceArtifactInput,
): Promise<AgentTraceArtifactRef | null> {
  if (!env.enableAgentTrace) return null
  if (input.json === undefined && input.text === undefined) {
    throw new Error('writeAgentTraceArtifact requires json or text content')
  }

  const artifactDir = agentTraceArtifactsDir(input.taskId, input.phase)
  await mkdir(artifactDir, { recursive: true })
  const artifactPath = path.join(artifactDir, input.fileName)
  const content =
    input.json !== undefined
      ? `${JSON.stringify(input.json, null, 2)}\n`
      : input.text!.endsWith('\n')
        ? input.text!
        : `${input.text!}\n`
  await writeFile(artifactPath, content, 'utf8')

  const artifact = await artifactRefForPath({
    taskId: input.taskId,
    path: artifactPath,
    label: input.fileName,
    kind: input.artifactKind,
  })
  await recordAgentTraceEvent({
    taskId: input.taskId,
    phase: input.phase,
    actor: input.actor,
    event: 'artifact',
    status: input.status ?? 'success',
    summary: input.summary,
    artifactRefs: [artifact],
    data: input.data,
  })
  return artifact
}
