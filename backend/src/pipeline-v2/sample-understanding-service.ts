import { readFile } from 'node:fs/promises'

import {
  V2_SAMPLE_UNDERSTANDING_SCHEMA_VERSION,
  type V2SampleUnderstandingResult,
  type V2SampleUnderstandingSegment,
} from '../../../shared/types/v2-sample-understanding.js'
import {
  extractStructuredJsonCandidate,
} from '../modules/agent-tools/structured-json-tool.js'
import { env } from '../config/env.js'
import { extractAudioVisualUnderstandingHints } from './audio-visual-feature-extractor.js'
import { resolveVideoInput } from './resolve-video-input.js'
import type { VideoInput } from './video-input.js'
import { createV2TraceWriter } from './trace.js'
import type { V2TraceContext } from './trace.js'
import type { V2AgentSkillContext, V2AgentToolContext } from './v2-input.js'

const SampleUnderstandingJsonSchema = {
  type: 'object',
  required: ['schema_version', 'task_id', 'summary_zh', 'segments'],
  properties: {
    schema_version: { type: 'string', const: V2_SAMPLE_UNDERSTANDING_SCHEMA_VERSION },
    task_id: { type: 'string' },
    summary_zh: { type: 'string' },
    story_zh: { type: 'string' },
    atmosphere_zh: { type: 'string' },
    editing_zh: { type: 'string' },
    rhythm_zh: { type: 'string' },
    reusable_style_zh: { type: 'string' },
    not_reusable_zh: { type: 'string' },
    segments: { type: 'array', items: { type: 'object' } },
    questions_for_user_zh: { type: 'array', items: { type: 'string' } },
    warnings_zh: { type: 'array', items: { type: 'string' } },
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

function splitSegments(durationSec: number): Array<{ start: number; end: number }> {
  const count = durationSec <= 8 ? 3 : durationSec <= 20 ? 4 : 5
  const part = durationSec / count
  return Array.from({ length: count }, (_, index) => {
    const start = Number((index * part).toFixed(3))
    const end = index === count - 1 ? durationSec : Number(((index + 1) * part).toFixed(3))
    return { start, end }
  })
}

function heuristicUnderstanding(input: {
  taskId: string
  prompt: string
  video: VideoInput
  hints: Awaited<ReturnType<typeof extractAudioVisualUnderstandingHints>>
  warning?: string
}): V2SampleUnderstandingResult {
  const durationSec = Number(input.hints.metadata.video_duration.toFixed(3))
  const segments: V2SampleUnderstandingSegment[] = splitSegments(durationSec).map((part, index, all) => {
    const role =
      index === 0
        ? '开场建立'
        : index === all.length - 1
          ? '收束记忆点'
          : index === Math.floor(all.length / 2)
            ? '节奏高点'
            : '内容推进'
    return {
      id: `sample_seg_${String(index + 1).padStart(3, '0')}`,
      title_zh: role,
      start_sec: part.start,
      end_sec: part.end,
      visual_content_zh: '本地兜底理解只能确认时间结构，具体画面内容需要以多模态模型结果为准。',
      characters_objects_zh: '未稳定识别到具体人物或主体物体。',
      atmosphere_zh: input.prompt.trim() || '根据样例画面和节奏建立整体氛围。',
      camera_zh: '按样例时间段观察镜头景别、视角和主体位置。',
      motion_zh: '结合画面运动和音乐能量判断推近、平移、静止或切换。',
      editing_zh: index < all.length - 1 ? '与下一段衔接处需要重点观察转场方式。' : '最后一段承担收束。',
      rhythm_zh: input.hints.audio_features.energy_peaks.length
        ? `附近能量点：${input.hints.audio_features.energy_peaks
            .filter((peak) => peak.time >= part.start && peak.time <= part.end)
            .slice(0, 3)
            .map((peak) => `${peak.time.toFixed(2)}s`)
            .join('、') || '无明显峰值'}`
        : '未检测到稳定音乐峰值，按平均段落兜底。',
      transition_after_zh: index < all.length - 1 ? '待模型结合画面判断硬切、淡入淡出、滑动或闪白。' : undefined,
      text_cues_zh: '未稳定识别到字幕或屏幕文字。',
      reusable_style_zh: '复用节奏、段落功能和转场位置，不直接复用样例画面。',
      material_hint_zh: '后续生成方案时需要使用用户上传素材替换样例画面。',
      caution_zh: '这是启发式兜底报告，不能当作完整视觉理解结论。',
    }
  })

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
    summary_zh: '已完成样例的时间结构兜底拆解；如果理解模型可用，会进一步补充人物、故事、氛围、镜头和转场细节。',
    story_zh: '兜底模式无法可靠判断故事内容，只保留段落功能。',
    atmosphere_zh: input.prompt.trim() || '待根据模型理解补充具体氛围。',
    editing_zh: '按时长和音频能量点拆成可审查段落，转场类型需模型或人工确认。',
    rhythm_zh: input.hints.audio_features.beats.length
      ? `检测到 ${input.hints.audio_features.beats.length} 个节奏点，${input.hints.audio_features.energy_peaks.length} 个能量峰值。`
      : '未检测到稳定节奏点。',
    reusable_style_zh: '复用结构、节奏、镜头功能和转场位置。',
    not_reusable_zh: '样例原始画面不作为成片素材，不直接进入最终视频。',
    segments,
    questions_for_user_zh: ['你希望后续重点复用样例的节奏、镜头语言、氛围，还是具体转场方式？'],
    warnings_zh: input.warning ? [input.warning] : [],
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
    '你是短视频样例理解 Agent，只负责理解 reference sample，不生成成片方案，不输出 RemotionTimelineSpec。',
    '',
    '只输出严格 JSON，不要 Markdown，不要解释。',
    `schema_version 必须是 "${V2_SAMPLE_UNDERSTANDING_SCHEMA_VERSION}"，task_id 必须是 "${input.taskId}"。`,
    '',
    '你需要告诉用户真正关心的样例内容：人物/主体、故事或画面进展、氛围、剪辑手法、镜头景别和运镜、转场方式、节奏依据、字幕/文字线索、可复用风格、不应复用的边界。',
    '样例视频只作为结构、风格和节奏来源，不是成片素材。',
    '',
    '字段要求：',
    '- summary_zh：一句话概括这个样例是什么。',
    '- story_zh：说明人物/主体/事件/画面进展；没有人物就说明主要景物或物体。',
    '- atmosphere_zh：说明情绪、色调、光线、速度感。',
    '- editing_zh：说明剪辑方式、镜头切换密度、转场类型。',
    '- rhythm_zh：说明节奏、音乐/运动依据。',
    '- reusable_style_zh：哪些结构和风格可迁移。',
    '- not_reusable_zh：哪些不应该照搬。',
    '- segments：按镜头或段落输出 3-8 段，每段必须具体描述画面内容和镜头/转场，不要写空话。',
    '',
    'Runtime input:',
    JSON.stringify(
      {
        user_prompt: input.prompt,
        sample_name: input.video.originalName,
        sample_mime: input.video.mimeType,
        sample_size_bytes: input.video.sizeBytes,
        fallback_time_structure: input.fallback,
        agent_skill_context: input.agentSkillContext ?? null,
        agent_tool_context: input.agentToolContext ?? null,
      },
      null,
      2,
    ),
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
      const blockRecord = block as Record<string, unknown>
      if (typeof blockRecord.text === 'string') parts.push(blockRecord.text)
      if (typeof blockRecord.output_text === 'string') parts.push(blockRecord.output_text)
    }
  }
  return parts.join('\n')
}

async function uploadVideoFile(video: VideoInput): Promise<string> {
  const buffer = await readFile(video.localPath)
  const form = new FormData()
  form.append('purpose', 'user_data')
  form.append('file', new Blob([buffer], { type: video.mimeType }), video.originalName)
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
  const id = typeof json.id === 'string' ? json.id : typeof json.file_id === 'string' ? json.file_id : undefined
  if (!id && json.data && typeof json.data === 'object') {
    const data = json.data as Record<string, unknown>
    const nested = typeof data.id === 'string' ? data.id : typeof data.file_id === 'string' ? data.file_id : undefined
    if (nested) return nested
  }
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
    if (status === 'failed' || status === 'error' || status === 'cancelled') {
      throw new Error(`Files preprocessing failed: ${status}`)
    }
    await new Promise((resolve) => setTimeout(resolve, env.videoUnderstandingFileReadyPollIntervalMs))
  }
  throw new Error(`Timed out waiting for Files API preprocessing. file_id=${fileId}`)
}

async function callUnderstandingModel(input: {
  fileId: string
  prompt: string
  includeVideo?: boolean
  allowStructuredOutput?: boolean
}): Promise<{
  raw: unknown
  structuredOutput: { requested: boolean; providerFallback: boolean; reason?: string }
}> {
  const requested = env.videoUnderstandingStructuredOutputMode === 'auto' && input.allowStructuredOutput !== false
  const payload = (useSchema: boolean) => ({
    model: env.videoUnderstandingModel,
    ...(useSchema
      ? { text: { format: { type: 'json_schema', name: 'v2_sample_understanding', schema: SampleUnderstandingJsonSchema } } }
      : {}),
    input: [
      {
        role: 'user',
        content: [
          ...(input.includeVideo === false ? [] : [{ type: 'input_video' as const, file_id: input.fileId }]),
          { type: 'input_text', text: input.prompt },
        ],
      },
    ],
  })
  const request = async (useSchema: boolean) => fetch(env.videoUnderstandingResponsesUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.videoUnderstandingApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload(useSchema)),
    signal: AbortSignal.timeout(env.videoUnderstandingTimeoutMs),
  })
  let response = await request(requested)
  let text = await response.text()
  const schemaRejected = requested && !response.ok && [400, 404, 422].includes(response.status)
  if (schemaRejected) {
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
  return {
    id: record.id,
    model: record.model,
    status: record.status,
    created_at: record.created_at,
    usage: record.usage,
    output_text: extractText(raw),
  }
}

function parseUnderstandingCandidate(raw: unknown) {
  const extracted = extractStructuredJsonCandidate(
    raw,
    (value): value is V2SampleUnderstandingResult =>
      typeof value === 'object' &&
      value !== null &&
      !Array.isArray(value) &&
      (value as { schema_version?: unknown }).schema_version === V2_SAMPLE_UNDERSTANDING_SCHEMA_VERSION,
  )
  if (extracted.candidate) return { candidate: extracted.candidate, report: extracted.report }
  const text = extractText(raw)
  if (!text) throw new Error('理解模型未返回可提取的最终文本。')
  return { candidate: JSON.parse(text), report: extracted.report }
}

function jsonRepairPrompt(input: { invalidText: string; error: string; taskId: string }) {
  return [
    '只修复下列 JSON 的格式，不重新分析视频，不增加或删除语义内容。',
    `schema_version 必须是 "${V2_SAMPLE_UNDERSTANDING_SCHEMA_VERSION}"，task_id 必须是 "${input.taskId}"。`,
    `解析错误：${input.error}`,
    '只输出修复后的严格 JSON，不要 Markdown、解释或推理。',
    '原始最终文本：',
    input.invalidText,
  ].join('\n')
}

function normalizeSegment(raw: unknown, index: number, fallback: V2SampleUnderstandingSegment): V2SampleUnderstandingSegment {
  const value = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  return {
    id: typeof value.id === 'string' ? value.id : fallback.id,
    title_zh: typeof value.title_zh === 'string' ? value.title_zh : fallback.title_zh,
    start_sec: finiteNumber(value.start_sec, fallback.start_sec),
    end_sec: finiteNumber(value.end_sec, fallback.end_sec),
    visual_content_zh: typeof value.visual_content_zh === 'string' ? value.visual_content_zh : fallback.visual_content_zh,
    characters_objects_zh: typeof value.characters_objects_zh === 'string' ? value.characters_objects_zh : fallback.characters_objects_zh,
    atmosphere_zh: typeof value.atmosphere_zh === 'string' ? value.atmosphere_zh : fallback.atmosphere_zh,
    camera_zh: typeof value.camera_zh === 'string' ? value.camera_zh : fallback.camera_zh,
    motion_zh: typeof value.motion_zh === 'string' ? value.motion_zh : fallback.motion_zh,
    editing_zh: typeof value.editing_zh === 'string' ? value.editing_zh : fallback.editing_zh,
    rhythm_zh: typeof value.rhythm_zh === 'string' ? value.rhythm_zh : fallback.rhythm_zh,
    transition_after_zh: typeof value.transition_after_zh === 'string' ? value.transition_after_zh : fallback.transition_after_zh,
    text_cues_zh: typeof value.text_cues_zh === 'string' ? value.text_cues_zh : fallback.text_cues_zh,
    reusable_style_zh: typeof value.reusable_style_zh === 'string' ? value.reusable_style_zh : fallback.reusable_style_zh,
    material_hint_zh: typeof value.material_hint_zh === 'string' ? value.material_hint_zh : fallback.material_hint_zh,
    caution_zh: typeof value.caution_zh === 'string' ? value.caution_zh : fallback.caution_zh,
  }
}

function normalizeUnderstanding(raw: unknown, fallback: V2SampleUnderstandingResult): V2SampleUnderstandingResult {
  const value = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const rawSegments = Array.isArray(value.segments) ? value.segments : []
  const segments = (rawSegments.length ? rawSegments : fallback.segments).map((segment, index) =>
    normalizeSegment(segment, index, fallback.segments[index] ?? fallback.segments[fallback.segments.length - 1]),
  )
  return {
    ...fallback,
    source: 'llm',
    summary_zh: typeof value.summary_zh === 'string' ? value.summary_zh : fallback.summary_zh,
    story_zh: typeof value.story_zh === 'string' ? value.story_zh : fallback.story_zh,
    atmosphere_zh: typeof value.atmosphere_zh === 'string' ? value.atmosphere_zh : fallback.atmosphere_zh,
    editing_zh: typeof value.editing_zh === 'string' ? value.editing_zh : fallback.editing_zh,
    rhythm_zh: typeof value.rhythm_zh === 'string' ? value.rhythm_zh : fallback.rhythm_zh,
    reusable_style_zh: typeof value.reusable_style_zh === 'string' ? value.reusable_style_zh : fallback.reusable_style_zh,
    not_reusable_zh: typeof value.not_reusable_zh === 'string' ? value.not_reusable_zh : fallback.not_reusable_zh,
    segments: segments.map((segment) => ({
      ...segment,
      start_sec: clamp(segment.start_sec, 0, fallback.sample.duration_sec),
      end_sec: clamp(segment.end_sec, 0.01, fallback.sample.duration_sec),
    })),
    questions_for_user_zh: Array.isArray(value.questions_for_user_zh)
      ? value.questions_for_user_zh.filter((item): item is string => typeof item === 'string').slice(0, 4)
      : fallback.questions_for_user_zh,
    warnings_zh: Array.isArray(value.warnings_zh)
      ? value.warnings_zh.filter((item): item is string => typeof item === 'string').slice(0, 6)
      : [],
  }
}

async function maybeDeleteFile(fileId: string): Promise<void> {
  await fetch(`${env.videoUnderstandingFilesUrl.replace(/\/+$/, '')}/${encodeURIComponent(fileId)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${env.videoUnderstandingApiKey}` },
    signal: AbortSignal.timeout(env.videoUnderstandingTimeoutMs),
  }).catch(() => undefined)
}

export async function analyzeV2Sample(input: V2SampleAnalyzeInput): Promise<V2SampleAnalyzeResult> {
  const trace = createV2TraceWriter({
    taskId: input.taskId,
    sessionId: input.traceContext?.sessionId,
    operationId: input.traceContext?.operationId,
  })
  await trace.writeJson('01-input', 'sample-understanding-input.json', input)
  const video = await resolveVideoInput(input.sampleVideoPath)
  const hints = await extractAudioVisualUnderstandingHints(video)
  await trace.writeJson('02-sample-understanding', 'audio-visual-hints.json', hints)
  const fallback = heuristicUnderstanding({ taskId: input.taskId, prompt: input.prompt, video, hints })

  let understanding = fallback
  if (env.videoUnderstandingApiKey) {
    let fileId: string | undefined
    try {
      const prompt = buildPrompt({
        taskId: input.taskId,
        prompt: input.prompt,
        video,
        fallback,
        agentSkillContext: input.agentSkillContext,
        agentToolContext: input.agentToolContext,
      })
      await trace.writeText('02-sample-understanding', 'sample-understanding-prompt.md', prompt)
      fileId = await uploadVideoFile(video)
      await trace.writeJson('02-sample-understanding', 'ark-file.json', { file_id: fileId })
      await waitForFileReady(fileId)
      const response = await callUnderstandingModel({ fileId, prompt })
      const raw = response.raw
      await trace.writeJson('02-sample-understanding', 'sample-understanding-model-response.audit.json', responseAudit(raw))
      let parsed: ReturnType<typeof parseUnderstandingCandidate>
      try {
        parsed = parseUnderstandingCandidate(raw)
      } catch (firstError) {
        const message = firstError instanceof Error ? firstError.message : String(firstError)
        await trace.writeJson('02-sample-understanding', 'sample-understanding-protocol-diagnostic.json', {
          kind: 'json_syntax_or_extraction', message, retry: 'format_only_without_video',
          structured_output: response.structuredOutput,
        })
        const repairPrompt = jsonRepairPrompt({ invalidText: extractText(raw), error: message, taskId: input.taskId })
        await trace.writeText('02-sample-understanding', 'sample-understanding-json-repair-request.md', repairPrompt)
        const repairedResponse = await callUnderstandingModel({
          fileId, prompt: repairPrompt, includeVideo: false, allowStructuredOutput: false,
        })
        const repairedRaw = repairedResponse.raw
        await trace.writeJson('02-sample-understanding', 'sample-understanding-json-repair-response.audit.json', responseAudit(repairedRaw))
        parsed = parseUnderstandingCandidate(repairedRaw)
      }
      await trace.writeJson('02-sample-understanding', 'sample-understanding-extraction-report.json', parsed.report)
      const candidate = parsed.candidate
      understanding = normalizeUnderstanding(candidate, fallback)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const protocolFailure = /JSON|schema_version|extraction|Unexpected token/i.test(message)
      understanding = heuristicUnderstanding({
        taskId: input.taskId,
        prompt: input.prompt,
        video,
        hints,
        warning: `${protocolFailure ? '理解模型输出协议失败' : '理解模型调用失败'}，已使用本地兜底结构：${message}`,
      })
      await trace.writeJson('02-sample-understanding', 'sample-understanding-error.json', {
        kind: protocolFailure ? 'output_protocol_failure' : 'provider_request_failure', message,
      })
    } finally {
      if (fileId) await maybeDeleteFile(fileId)
    }
  }

  await trace.writeJson('02-sample-understanding', 'sample-understanding.json', understanding)
  await trace.writeText(
    '02-sample-understanding',
    'sample-understanding.zh.md',
    [
      '# V2 样例理解',
      '',
      understanding.summary_zh,
      '',
      `- 来源：${understanding.source}`,
      `- 时长：${understanding.sample.duration_sec}s`,
      `- 段落：${understanding.segments.length}`,
      '',
      '## 段落',
      '',
      ...understanding.segments.map(
        (segment, index) =>
          `${index + 1}. ${segment.title_zh}（${segment.start_sec}-${segment.end_sec}s）：${segment.visual_content_zh}；镜头：${segment.camera_zh}；转场：${segment.transition_after_zh ?? '无后续转场'}`,
      ),
    ].join('\n'),
  )
  await trace.writeSummary([
    '# V2 样例理解',
    '',
    `- 任务 ID：${input.taskId}`,
    `- 理解来源：${understanding.source}`,
    `- 样例时长：${understanding.sample.duration_sec}s`,
    `- 段落数量：${understanding.segments.length}`,
    `- 样例概括：${understanding.summary_zh}`,
    '',
    '本步骤只理解样例视频，不生成 V2 时间线方案，也不渲染成片。',
  ])
  await trace.appendSessionEvent({
    type: 'sample_understanding_completed',
    source: understanding.source,
    duration_sec: understanding.sample.duration_sec,
    segment_count: understanding.segments.length,
    artifact_dir: trace.rootDir,
  })
  return {
    taskId: input.taskId,
    understanding,
    traceDir: trace.rootDir,
  }
}
