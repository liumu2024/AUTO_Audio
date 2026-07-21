import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { env } from '../src/config/env.js'
import { extractAudioVisualUnderstandingHints } from '../src/modules/sample-understanding/preprocessor/audio-visual-feature-extractor.js'
import type { VideoInput } from '../src/modules/video-understanding/video-input.js'

type JsonRecord = Record<string, unknown>

const outDir = path.resolve('tmp/gt-workflow')
const latestUploadPath = path.resolve(
  'tmp/agent-trace/latest/sample_understanding/ark-files-upload-response.json',
)
const latestHintsPath = path.resolve(
  'tmp/agent-trace/latest/sample_understanding/sample-audio-visual-hints.json',
)
const latestUnderstandingPath = path.resolve(
  'tmp/agent-trace/latest/sample_understanding/sample-understanding-from-director-grounding.json',
)

interface CliArgs {
  sample?: string
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {}
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index]
    if (item === '--sample') {
      args.sample = argv[index + 1]
      index += 1
    }
  }
  return args
}

async function readJson<T>(filePath: string): Promise<T> {
  return JSON.parse(await readFile(filePath, 'utf8')) as T
}

function extractFileStatus(raw: unknown): string | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const record = raw as JsonRecord
  for (const value of [record.status, record.state]) {
    if (typeof value === 'string') return value.toLowerCase()
  }
  return undefined
}

function extractFileId(raw: unknown): string {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('Files API response is not an object')
  }
  const record = raw as JsonRecord
  for (const value of [record.id, record.file_id]) {
    if (typeof value === 'string' && value) return value
  }
  throw new Error('Could not locate file id in Files API response')
}

async function uploadVideo(video: VideoInput, taskId: string): Promise<string> {
  const buffer = await readFile(video.localPath)
  const form = new FormData()
  form.append('purpose', 'user_data')
  form.append('file', new Blob([buffer], { type: video.mimeType }), video.originalName)
  form.append(
    'preprocess_configs[video][fps]',
    String(env.videoUnderstandingPreprocessFps),
  )

  const response = await fetch(env.videoUnderstandingFilesUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.videoUnderstandingApiKey}`,
    },
    body: form,
    signal: AbortSignal.timeout(env.videoUnderstandingTimeoutMs),
  })
  const responseText = await response.text()
  await writeFile(
    path.join(outDir, `${taskId}.files-upload-response.txt`),
    responseText,
    'utf8',
  )
  if (!response.ok) {
    throw new Error(`Files API returned ${response.status}: ${responseText.slice(0, 1000)}`)
  }
  const payload = JSON.parse(responseText) as JsonRecord
  await writeFile(
    path.join(outDir, `${taskId}.files-upload-response.json`),
    `${JSON.stringify(payload, null, 2)}\n`,
    'utf8',
  )
  return extractFileId(payload)
}

async function retrieveFile(fileId: string): Promise<unknown> {
  const response = await fetch(
    `${env.videoUnderstandingFilesUrl.replace(/\/+$/, '')}/${encodeURIComponent(fileId)}`,
    {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${env.videoUnderstandingApiKey}`,
      },
      signal: AbortSignal.timeout(env.videoUnderstandingTimeoutMs),
    },
  )
  const text = await response.text()
  if (!response.ok) {
    throw new Error(`Files retrieve API returned ${response.status}: ${text.slice(0, 1000)}`)
  }
  return JSON.parse(text) as unknown
}

async function waitForFileReady(fileId: string): Promise<void> {
  const startedAt = Date.now()
  while (Date.now() - startedAt <= env.videoUnderstandingFileReadyTimeoutMs) {
    const metadata = await retrieveFile(fileId)
    const status = extractFileStatus(metadata)
    if (status === 'active' || status === 'processed') return
    if (status === 'failed' || status === 'error' || status === 'cancelled') {
      throw new Error(`Files API preprocessing failed. file_id=${fileId} status=${status}`)
    }
    await new Promise((resolve) =>
      setTimeout(resolve, env.videoUnderstandingFileReadyPollIntervalMs),
    )
  }
  throw new Error(`Timed out waiting for Files API preprocessing. file_id=${fileId}`)
}

async function buildVideoInput(samplePath: string): Promise<VideoInput> {
  const absolute = path.resolve(samplePath)
  const info = await stat(absolute)
  return {
    storageKind: 'local',
    localPath: absolute,
    originalName: path.basename(absolute),
    mimeType: 'video/mp4',
    sizeBytes: info.size,
    createdAt: new Date(),
  }
}

function extractResponseText(payload: JsonRecord): string {
  const output = Array.isArray(payload.output) ? payload.output : []
  return output
    .flatMap((item) => {
      if (!item || typeof item !== 'object') return []
      const content = (item as JsonRecord).content
      if (!Array.isArray(content)) return []
      return content
        .map((part) => {
          if (!part || typeof part !== 'object') return ''
          const record = part as JsonRecord
          return typeof record.text === 'string' ? record.text : ''
        })
        .filter(Boolean)
    })
    .join('\n')
}

function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]
  const raw = (fenced ?? text).trim()
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start < 0 || end <= start) return raw
  return JSON.parse(raw.slice(start, end + 1)) as unknown
}

function buildPrompt(input: {
  taskId: string
  hints: unknown
  baseline: unknown
}): string {
  return [
    '你是一个专业短视频导演、剪辑师和 Remotion 特效规划师。',
    '这次不要输出 TemplateSchema，也不要输出营销脚本。请模拟人工制作 GT 的复盘过程，输出 director_grounding.v0 JSON。',
    '',
    '目标：把样例视频抽象成“可复刻导演手法 + 时间事件 + Remotion 插件能力匹配 + render_recipe 草案”。',
    '样例视频只作为结构和风格来源，不得当作用户素材；不要生成成片内容，不要假设有用户素材。',
    '',
    `task_id=${input.taskId}`,
    '',
    'AUDIO/VISUAL HINTS，必须作为时间切点依据：',
    JSON.stringify(input.hints, null, 2),
    '',
    'BASELINE UNDERSTANDING，仅作参考。你需要更像人工 GT 复盘一样抽象视觉机制：',
    JSON.stringify(input.baseline, null, 2),
    '',
    '当前已有 Remotion 插件能力：',
    JSON.stringify(
      [
        {
          preset: 'cinematic_grade_pack',
          capability: '电影调色、暗角、颗粒、bloom、轻微色散',
        },
        {
          preset: 'audio_reactive_cut_driver',
          capability: 'beat/strong beat/energy peak 驱动画面 pulse、flash、shake',
        },
        {
          preset: 'mask_slice_transition',
          capability: '横向/纵向切片转场、错峰滑入、shuffle/reveal/cover',
        },
        {
          preset: 'editorial_split_collage',
          capability: '多面板分屏拼贴、三联屏、横向版面、色散边缘',
        },
        {
          preset: 'primitive_color_transform',
          capability: '黑白底层 + 局部彩色圆形透视 + 霓虹环',
        },
        {
          preset: 'primitive_directional_wave_reveal',
          capability: '光球路径、滞后圆环、水波/方向性色彩解锁',
        },
        {
          preset: 'ripple_displacement',
          capability: '从某点出发的水波位移/层次感扰动',
        },
      ],
      null,
      2,
    ),
    '',
    '必须严格输出 JSON 对象，字段如下：',
    JSON.stringify(
      {
        schema_version: 'director_grounding.v0',
        task_id: input.taskId,
        style_summary: {
          style_family: 'string',
          editing_pattern: 'string',
          audio_sync_logic: 'string',
          reusable_director_moves: ['string'],
        },
        phenomenon_events: [
          {
            id: 'ev_001',
            time_range: { start: 0, end: 1 },
            observed_visual: '具体看到的视觉现象',
            mechanism: '可复刻机制，不要只写自然语言风格',
            evidence: '来自画面/音频/节拍的证据',
            confidence: 0.8,
          },
        ],
        temporal_events: [
          {
            time: 0.96,
            type: 'cut|mask_reveal|layout_change|beat_pulse|color_change',
            trigger: 'beat|strong_beat|energy_peak|visual_boundary',
            action: '这时应该执行什么剪辑/特效动作',
          },
        ],
        plugin_plan: {
          matched_plugins: [
            {
              event_id: 'ev_001',
              preset: 'cinematic_grade_pack',
              reason: '为什么这个插件能覆盖',
              parameter_notes: '关键参数应该怎么调',
            },
          ],
          missing_capabilities: [
            {
              name: 'geometric_window_reveal',
              reason: '现有插件缺什么',
              suggested_plugin_contract: {
                preset: 'geometric_window_reveal',
                params: {},
              },
            },
          ],
        },
        render_recipe: {
          style_family: 'string',
          global_effects: ['cinematic_grade_pack'],
          scene_effects: [
            {
              segment_id: 'seg_001',
              preset: 'cinematic_grade_pack',
              params: {},
            },
          ],
          audio_driver: {
            preset: 'audio_reactive_cut_driver',
            beat_times: [],
            strong_beats: [],
            energy_peaks: [],
          },
        },
        critique: {
          likely_failure_points: ['string'],
          next_plugin_to_build: ['string'],
          notes_for_generation_stage: ['string'],
        },
      },
      null,
      2,
    ),
  ].join('\n')
}

async function main(): Promise<void> {
  if (!env.videoUnderstandingApiKey) {
    throw new Error('VIDEO_UNDERSTANDING_API_KEY / ARK_API_KEY is required')
  }

  await mkdir(outDir, { recursive: true })
  const args = parseArgs(process.argv.slice(2))
  const sample = args.sample ? await buildVideoInput(args.sample) : undefined
  const taskId = sample
    ? `gt_${path.basename(sample.localPath, path.extname(sample.localPath)).replace(/[^a-zA-Z0-9_-]/g, '_')}_${Date.now()}`
    : undefined
  const upload = sample
    ? { id: await uploadVideo(sample, taskId ?? `gt_workflow_${Date.now()}`) }
    : await readJson<{ id: string }>(latestUploadPath)
  if (sample) await waitForFileReady(upload.id)

  const hints = sample
    ? await extractAudioVisualUnderstandingHints(sample)
    : await readJson<unknown>(latestHintsPath)
  const baseline = sample
    ? {
        note: 'No baseline TemplateSchema was provided for this experiment. Analyze the input video directly and use audio/video hints as evidence.',
        sample_video: {
          id: sample.originalName,
          name: sample.originalName,
        },
      }
    : await readJson<{ task_id?: string }>(latestUnderstandingPath)
  const resolvedTaskId = taskId ?? baseline.task_id ?? `gt_workflow_${Date.now()}`
  if (sample) {
    await writeFile(
      path.join(outDir, `${resolvedTaskId}.sample-audio-visual-hints.json`),
      `${JSON.stringify(hints, null, 2)}\n`,
      'utf8',
    )
  }
  const prompt = buildPrompt({ taskId: resolvedTaskId, hints, baseline })

  const request = {
    model: env.videoUnderstandingModel,
    input: [
      {
        role: 'user',
        content: [
          { type: 'input_video', file_id: upload.id },
          { type: 'input_text', text: prompt },
        ],
      },
    ],
  }

  const requestPath = path.join(outDir, `${resolvedTaskId}.request.json`)
  await writeFile(requestPath, `${JSON.stringify(request, null, 2)}\n`, 'utf8')

  const response = await fetch(env.videoUnderstandingResponsesUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.videoUnderstandingApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(request),
    signal: AbortSignal.timeout(env.videoUnderstandingTimeoutMs),
  })
  const responseText = await response.text()
  const rawPath = path.join(outDir, `${resolvedTaskId}.raw-response.txt`)
  await writeFile(rawPath, responseText, 'utf8')
  if (!response.ok) {
    throw new Error(`Responses API returned ${response.status}: ${responseText.slice(0, 1000)}`)
  }

  const payload = JSON.parse(responseText) as JsonRecord
  const rawJsonPath = path.join(outDir, `${resolvedTaskId}.raw-response.json`)
  await writeFile(rawJsonPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')

  const text = extractResponseText(payload)
  const extracted = extractJson(text)
  const extractedPath = path.join(outDir, `${resolvedTaskId}.director-grounding.json`)
  await writeFile(extractedPath, `${JSON.stringify(extracted, null, 2)}\n`, 'utf8')

  console.info('[director-grounding-workflow] OK')
  console.info(
    JSON.stringify(
      {
        taskId: resolvedTaskId,
        model: env.videoUnderstandingModel,
        fileId: upload.id,
        requestPath,
        rawJsonPath,
        extractedPath,
      },
      null,
      2,
    ),
  )
}

main().catch((error) => {
  console.error('[director-grounding-workflow] FAILED')
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
