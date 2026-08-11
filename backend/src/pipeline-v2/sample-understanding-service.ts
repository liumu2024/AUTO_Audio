import { readFile } from 'node:fs/promises'

import {
  V2_SAMPLE_UNDERSTANDING_SCHEMA_VERSION,
  type V2SampleEvidenceRange,
  type V2SampleUnderstandingResult,
} from '../../../shared/types/v2-sample-understanding.js'
import { extractStructuredJsonCandidate } from '../modules/agent-tools/structured-json-tool.js'
import { env } from '../config/env.js'
import { extractAudioVisualUnderstandingHints } from './audio-visual-feature-extractor.js'
import { resolveVideoInput } from './resolve-video-input.js'
import type { VideoInput } from './video-input.js'
import { createV2TraceWriter, type V2TraceContext } from './trace.js'
import type { V2AgentSkillContext, V2AgentToolContext } from './v2-input.js'

const evidenceRangeSchema = {
  type: 'object',
  required: ['start_sec', 'end_sec'],
  additionalProperties: false,
  properties: { start_sec: { type: 'number' }, end_sec: { type: 'number' } },
} as const

const SampleUnderstandingJsonSchema = {
  type: 'object',
  required: [
    'schema_version', 'task_id', 'summary', 'content_observations',
    'method_observations', 'transferable_knowledge', 'shot_evidence', 'questions', 'warnings',
  ],
  additionalProperties: false,
  properties: {
    schema_version: { type: 'string', const: V2_SAMPLE_UNDERSTANDING_SCHEMA_VERSION },
    task_id: { type: 'string' },
    summary: { type: 'string' },
    content_observations: {
      type: 'array',
      items: {
        type: 'object', required: ['statement', 'evidence_ranges'], additionalProperties: false,
        properties: { statement: { type: 'string' }, evidence_ranges: { type: 'array', items: evidenceRangeSchema } },
      },
    },
    method_observations: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'expression', 'purpose', 'timing_rationale', 'evidence_ranges'],
        additionalProperties: false,
        properties: {
          id: { type: 'string' }, expression: { type: 'string' }, purpose: { type: 'string' },
          timing_rationale: { type: 'string' }, evidence_ranges: { type: 'array', items: evidenceRangeSchema },
        },
      },
    },
    transferable_knowledge: {
      type: 'array',
      items: {
        type: 'object', required: ['statement', 'applicability', 'evidence_method_ids'], additionalProperties: false,
        properties: {
          statement: { type: 'string' }, applicability: { type: 'string' },
          evidence_method_ids: { type: 'array', items: { type: 'string' } },
        },
      },
    },
    shot_evidence: { type: 'array', items: { type: 'object' } },
    questions: { type: 'array', items: { type: 'string' } },
    warnings: { type: 'array', items: { type: 'string' } },
  },
} as const

export interface V2SampleAnalyzeInput {
  taskId: string
  prompt: string
  sampleVideoPath: string
  sampleVideoName?: string
  agentSkillContext?: V2AgentSkillContext
  agentToolContext?: V2AgentToolContext
  traceContext?: V2TraceContext
}

export interface V2SampleAnalyzeResult {
  taskId: string
  understanding: V2SampleUnderstandingResult
  traceDir: string
}

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function heuristicUnderstanding(input: {
  taskId: string
  video: VideoInput
  hints: Awaited<ReturnType<typeof extractAudioVisualUnderstandingHints>>
  warning?: string
}): V2SampleUnderstandingResult {
  const durationSec = Number(input.hints.metadata.video_duration.toFixed(3))
  return {
    schema_version: V2_SAMPLE_UNDERSTANDING_SCHEMA_VERSION,
    task_id: input.taskId,
    source: input.warning ? 'llm_fallback' : 'heuristic',
    sample: {
      name: input.video.originalName,
      duration_sec: durationSec,
      width: input.hints.metadata.width,
      height: input.hints.metadata.height,
      fps: input.hints.metadata.fps,
    },
    summary: 'Only media metadata was verified; semantic sample understanding requires reanalysis.',
    content_observations: [],
    method_observations: [],
    transferable_knowledge: [],
    shot_evidence: [],
    questions: ['Which storytelling or expression methods should be emphasized after reanalysis?'],
    warnings: input.warning ? [input.warning] : ['Semantic sample understanding is unavailable.'],
  }
}

function buildPrompt(input: {
  taskId: string
  prompt: string
  video: VideoInput
  fallback: V2SampleUnderstandingResult
  agentSkillContext?: V2AgentSkillContext
  agentToolContext?: V2AgentToolContext
}): string {
  return [
    'You are the V2 sample-video understanding agent. Analyze evidence; do not create a final timeline.',
    'Return strict JSON only.',
    `schema_version must be "${V2_SAMPLE_UNDERSTANDING_SCHEMA_VERSION}" and task_id must be "${input.taskId}".`,
    '',
    'Answer three distinct questions with timestamp evidence:',
    '1. What visibly happens? Record content_observations without inventing unseen events.',
    '2. How is it expressed? Record camera distance and movement, subject movement, pacing, transitions, reveal order, sound/beat alignment, color, light and emotional intensity as method_observations.',
    '3. Why is each method used at that time? Record its narrative purpose and timing_rationale: attention, environment, character, conflict, proof, climax preparation or emotional closure.',
    'transferable_knowledge must abstract reusable creation methods and cite evidence_method_ids.',
    'shot_evidence records only visible shot boundaries. Do not force the video into three, four or five semantic chapters.',
    'A sample is knowledge evidence, not final footage and not a fixed scene-count template.',
    '',
    'Runtime input:',
    JSON.stringify({
      user_prompt: input.prompt,
      sample_name: input.video.originalName,
      sample_mime: input.video.mimeType,
      sample_size_bytes: input.video.sizeBytes,
      verified_media_metadata: input.fallback.sample,
      agent_skill_context: input.agentSkillContext ?? null,
      agent_tool_context: input.agentToolContext ?? null,
    }, null, 2),
  ].join('\n')
}

function extractText(payload: unknown): string {
  if (!payload || typeof payload !== 'object') return ''
  const record = payload as Record<string, unknown>
  if (typeof record.output_text === 'string') return record.output_text
  const output = record.output
  if (!Array.isArray(output)) return ''
  const parts: string[] = []
  for (const item of output) {
    if (!item || typeof item !== 'object') continue
    const content = (item as Record<string, unknown>).content
    if (!Array.isArray(content)) continue
    for (const block of content) {
      if (!block || typeof block !== 'object') continue
      const value = block as Record<string, unknown>
      if (typeof value.text === 'string') parts.push(value.text)
      if (typeof value.output_text === 'string') parts.push(value.output_text)
    }
  }
  return parts.join('\n')
}

async function uploadVideoFile(video: VideoInput): Promise<string> {
  const form = new FormData()
  form.append('purpose', 'user_data')
  form.append('file', new Blob([await readFile(video.localPath)], { type: video.mimeType }), video.originalName)
  form.append('preprocess_configs[video][fps]', String(env.videoUnderstandingPreprocessFps))
  const response = await fetch(env.videoUnderstandingFilesUrl, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.videoUnderstandingApiKey}` },
    body: form,
    signal: AbortSignal.timeout(env.videoUnderstandingTimeoutMs),
  })
  const text = await response.text()
  if (!response.ok) throw new Error(`Files API returned ${response.status}: ${text.slice(0, 500)}`)
  const json = JSON.parse(text) as Record<string, unknown>
  const data = json.data && typeof json.data === 'object' ? json.data as Record<string, unknown> : undefined
  const id = [json.id, json.file_id, data?.id, data?.file_id].find((value): value is string => typeof value === 'string')
  if (!id) throw new Error('Files API response did not include file_id.')
  return id
}

async function waitForFileReady(fileId: string): Promise<void> {
  const started = Date.now()
  while (Date.now() - started < env.videoUnderstandingFileReadyTimeoutMs) {
    const response = await fetch(`${env.videoUnderstandingFilesUrl.replace(/\/+$/, '')}/${encodeURIComponent(fileId)}`, {
      headers: { Authorization: `Bearer ${env.videoUnderstandingApiKey}` },
      signal: AbortSignal.timeout(env.videoUnderstandingTimeoutMs),
    })
    const text = await response.text()
    if (!response.ok) throw new Error(`Files retrieve API returned ${response.status}: ${text.slice(0, 500)}`)
    const json = JSON.parse(text) as Record<string, unknown>
    const status = String(json.status ?? json.state ?? '').toLowerCase()
    if (status === 'active' || status === 'processed') return
    if (['failed', 'error', 'cancelled'].includes(status)) throw new Error(`Files preprocessing failed: ${status}`)
    await new Promise((resolve) => setTimeout(resolve, env.videoUnderstandingFileReadyPollIntervalMs))
  }
  throw new Error(`Timed out waiting for Files API preprocessing. file_id=${fileId}`)
}

async function callUnderstandingModel(input: {
  fileId: string
  prompt: string
  includeVideo?: boolean
  allowStructuredOutput?: boolean
}): Promise<{ raw: unknown; structuredOutput: { requested: boolean; providerFallback: boolean; reason?: string } }> {
  const requested = env.videoUnderstandingStructuredOutputMode === 'auto' && input.allowStructuredOutput !== false
  const payload = (useSchema: boolean) => ({
    model: env.videoUnderstandingModel,
    ...(useSchema ? { text: { format: { type: 'json_schema', name: 'v2_sample_understanding', schema: SampleUnderstandingJsonSchema } } } : {}),
    input: [{
      role: 'user',
      content: [
        ...(input.includeVideo === false ? [] : [{ type: 'input_video' as const, file_id: input.fileId }]),
        { type: 'input_text', text: input.prompt },
      ],
    }],
  })
  const request = (useSchema: boolean) => fetch(env.videoUnderstandingResponsesUrl, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.videoUnderstandingApiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload(useSchema)),
    signal: AbortSignal.timeout(env.videoUnderstandingTimeoutMs),
  })
  let response = await request(requested)
  let text = await response.text()
  if (requested && !response.ok && [400, 404, 422].includes(response.status)) {
    response = await request(false)
    const retryText = await response.text()
    if (!response.ok) throw new Error(`Responses API returned ${response.status}: ${retryText.slice(0, 500)}`)
    try {
      return { raw: JSON.parse(retryText), structuredOutput: { requested: true, providerFallback: true, reason: text.slice(0, 500) } }
    } catch {
      return { raw: retryText, structuredOutput: { requested: true, providerFallback: true, reason: text.slice(0, 500) } }
    }
  }
  if (!response.ok) throw new Error(`Responses API returned ${response.status}: ${text.slice(0, 500)}`)
  try {
    return { raw: JSON.parse(text), structuredOutput: { requested, providerFallback: false } }
  } catch {
    return { raw: text, structuredOutput: { requested, providerFallback: false } }
  }
}

function responseAudit(raw: unknown) {
  const record = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {}
  return { id: record.id, model: record.model, status: record.status, created_at: record.created_at, usage: record.usage, output_text: extractText(raw) }
}

function parseUnderstandingCandidate(raw: unknown) {
  const extracted = extractStructuredJsonCandidate(raw, (value): value is V2SampleUnderstandingResult =>
    typeof value === 'object' && value !== null && !Array.isArray(value)
      && (value as { schema_version?: unknown }).schema_version === V2_SAMPLE_UNDERSTANDING_SCHEMA_VERSION)
  if (extracted.candidate) return { candidate: extracted.candidate, report: extracted.report }
  const text = extractText(raw)
  if (!text) throw new Error('Understanding model did not return extractable final text.')
  return { candidate: JSON.parse(text), report: extracted.report }
}

function normalizeRanges(value: unknown, durationSec: number): V2SampleEvidenceRange[] {
  return (Array.isArray(value) ? value : []).flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    const record = item as Record<string, unknown>
    const start = clamp(finiteNumber(record.start_sec, 0), 0, durationSec)
    const end = clamp(finiteNumber(record.end_sec, start), start, durationSec)
    return end > start ? [{ start_sec: start, end_sec: end }] : []
  }).slice(0, 12)
}

function strings(value: unknown, limit: number): string[] {
  return (Array.isArray(value) ? value : [])
    .filter((item): item is string => typeof item === 'string' && Boolean(item.trim()))
    .map((item) => item.trim())
    .slice(0, limit)
}

function normalizeUnderstanding(raw: unknown, fallback: V2SampleUnderstandingResult): V2SampleUnderstandingResult {
  const value = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {}
  if (value.schema_version !== V2_SAMPLE_UNDERSTANDING_SCHEMA_VERSION) {
    throw new Error(`Unsupported sample understanding schema: ${String(value.schema_version ?? 'missing')}.`)
  }
  if (value.task_id !== fallback.task_id) {
    throw new Error(`Sample understanding task_id must remain ${fallback.task_id}.`)
  }
  for (const field of ['content_observations', 'method_observations', 'transferable_knowledge', 'shot_evidence', 'questions', 'warnings']) {
    if (!Array.isArray(value[field])) throw new Error(`Sample understanding ${field} must be an array.`)
  }
  const durationSec = fallback.sample.duration_sec
  const contentObservations = (Array.isArray(value.content_observations) ? value.content_observations : []).flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    const record = item as Record<string, unknown>
    if (typeof record.statement !== 'string' || !record.statement.trim()) return []
    return [{ statement: record.statement.trim(), evidence_ranges: normalizeRanges(record.evidence_ranges, durationSec) }]
  }).slice(0, 60)
  const methodObservations = (Array.isArray(value.method_observations) ? value.method_observations : []).flatMap((item, index) => {
    if (!item || typeof item !== 'object') return []
    const record = item as Record<string, unknown>
    if (![record.expression, record.purpose, record.timing_rationale].every((field) => typeof field === 'string' && Boolean(field.trim()))) return []
    return [{
      id: typeof record.id === 'string' && record.id.trim() ? record.id.trim() : `sample_method_${index + 1}`,
      expression: String(record.expression).trim(),
      purpose: String(record.purpose).trim(),
      timing_rationale: String(record.timing_rationale).trim(),
      evidence_ranges: normalizeRanges(record.evidence_ranges, durationSec),
    }]
  }).slice(0, 60)
  const methodIds = new Set(methodObservations.map((item) => item.id))
  const transferableKnowledge = (Array.isArray(value.transferable_knowledge) ? value.transferable_knowledge : []).flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    const record = item as Record<string, unknown>
    if (typeof record.statement !== 'string' || !record.statement.trim()
      || typeof record.applicability !== 'string' || !record.applicability.trim()) return []
    return [{
      statement: record.statement.trim(),
      applicability: record.applicability.trim(),
      evidence_method_ids: strings(record.evidence_method_ids, 20).filter((id) => methodIds.has(id)),
    }]
  }).slice(0, 40)
  const shotEvidence = (Array.isArray(value.shot_evidence) ? value.shot_evidence : []).flatMap((item, index) => {
    if (!item || typeof item !== 'object') return []
    const record = item as Record<string, unknown>
    const ranges = normalizeRanges([record], durationSec)
    if (!ranges[0]) return []
    const boundary = ['hard_cut', 'soft_transition', 'continuous', 'end', 'unknown'].includes(String(record.boundary))
      ? String(record.boundary) as V2SampleUnderstandingResult['shot_evidence'][number]['boundary']
      : 'unknown'
    return [{
      id: typeof record.id === 'string' ? record.id : `sample_shot_${index + 1}`,
      ...ranges[0], boundary,
      confidence: clamp(finiteNumber(record.confidence, 0), 0, 1),
      description: typeof record.description === 'string' ? record.description : undefined,
    }]
  }).sort((a, b) => a.start_sec - b.start_sec).slice(0, 80)
  return {
    ...fallback,
    source: 'llm',
    summary: typeof value.summary === 'string' && value.summary.trim() ? value.summary.trim() : fallback.summary,
    content_observations: contentObservations,
    method_observations: methodObservations,
    transferable_knowledge: transferableKnowledge,
    shot_evidence: shotEvidence,
    questions: strings(value.questions, 6),
    warnings: strings(value.warnings, 8),
  }
}

function jsonRepairPrompt(input: { invalidText: string; error: string; taskId: string }): string {
  return [
    'Repair JSON format only. Do not add, remove or reinterpret video observations.',
    `schema_version must be "${V2_SAMPLE_UNDERSTANDING_SCHEMA_VERSION}" and task_id must be "${input.taskId}".`,
    `Error: ${input.error}`,
    `Schema: ${JSON.stringify(SampleUnderstandingJsonSchema)}`,
    'Original final text:', input.invalidText,
  ].join('\n')
}

async function maybeDeleteFile(fileId: string): Promise<void> {
  const response = await fetch(`${env.videoUnderstandingFilesUrl.replace(/\/+$/, '')}/${encodeURIComponent(fileId)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${env.videoUnderstandingApiKey}` },
    signal: AbortSignal.timeout(env.videoUnderstandingTimeoutMs),
  }).catch((error) => {
    console.warn(`Failed to delete sample-understanding file ${fileId}: ${error instanceof Error ? error.message : String(error)}`)
    return undefined
  })
  if (response && !response.ok) console.warn(`Failed to delete sample-understanding file ${fileId}: HTTP ${response.status}`)
}

export async function analyzeV2Sample(input: V2SampleAnalyzeInput): Promise<V2SampleAnalyzeResult> {
  const trace = createV2TraceWriter({ taskId: input.taskId, sessionId: input.traceContext?.sessionId, operationId: input.traceContext?.operationId })
  await trace.writeJson('01-input', 'sample-understanding-input.json', input)
  const video = await resolveVideoInput(input.sampleVideoPath)
  const hints = await extractAudioVisualUnderstandingHints(video)
  await trace.writeJson('02-sample-understanding', 'audio-visual-hints.json', hints)
  const fallback = heuristicUnderstanding({ taskId: input.taskId, video, hints })
  let understanding = fallback
  if (env.videoUnderstandingApiKey) {
    let fileId: string | undefined
    try {
      const prompt = buildPrompt({ taskId: input.taskId, prompt: input.prompt, video, fallback, agentSkillContext: input.agentSkillContext, agentToolContext: input.agentToolContext })
      await trace.writeText('02-sample-understanding', 'sample-understanding-prompt.md', prompt)
      fileId = await uploadVideoFile(video)
      await waitForFileReady(fileId)
      const response = await callUnderstandingModel({ fileId, prompt })
      await trace.writeJson('02-sample-understanding', 'sample-understanding-model-response.audit.json', responseAudit(response.raw))
      let parsed
      try {
        parsed = parseUnderstandingCandidate(response.raw)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        const repairPrompt = jsonRepairPrompt({ invalidText: extractText(response.raw), error: message, taskId: input.taskId })
        await trace.writeText('02-sample-understanding', 'sample-understanding-json-repair-request.md', repairPrompt)
        const repaired = await callUnderstandingModel({ fileId, prompt: repairPrompt, includeVideo: false, allowStructuredOutput: false })
        parsed = parseUnderstandingCandidate(repaired.raw)
      }
      await trace.writeJson('02-sample-understanding', 'sample-understanding-extraction-report.json', parsed.report)
      understanding = normalizeUnderstanding(parsed.candidate, fallback)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      understanding = heuristicUnderstanding({ taskId: input.taskId, video, hints, warning: message })
      await trace.writeJson('02-sample-understanding', 'sample-understanding-error.json', { message })
    } finally {
      if (fileId) await maybeDeleteFile(fileId)
    }
  }
  await trace.writeJson('02-sample-understanding', 'sample-understanding.json', understanding)
  await trace.writeText('02-sample-understanding', 'sample-understanding.md', [
    '# V2 Sample Understanding', '', understanding.summary, '',
    `- Source: ${understanding.source}`,
    `- Duration: ${understanding.sample.duration_sec}s`,
    `- Content observations: ${understanding.content_observations.length}`,
    `- Method observations: ${understanding.method_observations.length}`,
    '',
    ...understanding.method_observations.map((item) => `- ${item.expression} — ${item.purpose} (${item.timing_rationale})`),
  ].join('\n'))
  await trace.writeSummary([
    '# V2 Sample Understanding', '', `- Task: ${input.taskId}`, `- Source: ${understanding.source}`,
    `- Duration: ${understanding.sample.duration_sec}s`, `- Methods: ${understanding.method_observations.length}`,
  ])
  await trace.appendSessionEvent({
    type: 'sample_understanding_completed', source: understanding.source,
    duration_sec: understanding.sample.duration_sec,
    method_count: understanding.method_observations.length,
    shot_count: understanding.shot_evidence.length,
    artifact_dir: trace.rootDir,
  })
  return { taskId: input.taskId, understanding, traceDir: trace.rootDir }
}
