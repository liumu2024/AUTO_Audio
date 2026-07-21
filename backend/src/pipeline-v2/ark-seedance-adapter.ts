import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { classifyExternalUrlAccess } from '../../../shared/lib/external-url-access.js'
import { env } from '../config/env.js'
import type {
  V2MaterialGenerationAdapter,
  V2MaterialGenerationRequest,
  V2MaterialGenerationResult,
} from './material-generation-adapter.js'

interface ArkSeedanceAdapterOptions {
  apiKey?: string
  model?: string
  submitUrl?: string
  statusUrlTemplate?: string
  defaultImageUrl?: string
  outputDir: string
  timeoutMs?: number
  pollIntervalMs?: number
  fetchImpl?: typeof fetch
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stringAt(value: unknown, pathParts: string[]): string | undefined {
  let current = value
  for (const part of pathParts) {
    if (!isRecord(current)) return undefined
    current = current[part]
  }
  return typeof current === 'string' && current.trim() ? current : undefined
}

function extractTaskId(value: unknown): string | undefined {
  return (
    stringAt(value, ['id']) ??
    stringAt(value, ['task_id']) ??
    stringAt(value, ['data', 'id']) ??
    stringAt(value, ['data', 'task_id']) ??
    stringAt(value, ['result', 'id']) ??
    stringAt(value, ['result', 'task_id'])
  )
}

function extractStatus(value: unknown): string | undefined {
  return (
    stringAt(value, ['status']) ??
    stringAt(value, ['data', 'status']) ??
    stringAt(value, ['result', 'status']) ??
    stringAt(value, ['task', 'status'])
  )?.toLowerCase()
}

function extractError(value: unknown): string | undefined {
  return (
    stringAt(value, ['error', 'message']) ??
    stringAt(value, ['message']) ??
    stringAt(value, ['data', 'error', 'message']) ??
    stringAt(value, ['data', 'message'])
  )
}

function extractVideoUrl(value: unknown): string | undefined {
  const stack: Array<{ value: unknown; path: string[] }> = [{ value, path: [] }]
  while (stack.length) {
    const current = stack.pop()
    if (!current) continue
    if (Array.isArray(current.value)) {
      current.value.forEach((item, index) => stack.push({ value: item, path: [...current.path, String(index)] }))
      continue
    }
    if (!isRecord(current.value)) continue
    for (const [key, child] of Object.entries(current.value)) {
      const nextPath = [...current.path, key]
      if (key === 'video_url') {
        if (typeof child === 'string' && child.trim()) return child
        if (isRecord(child) && typeof child.url === 'string' && child.url.trim()) return child.url
      }
      if (key === 'url' && nextPath.some((part) => /video/i.test(part))) {
        if (typeof child === 'string' && child.trim()) return child
      }
      stack.push({ value: child, path: nextPath })
    }
  }
  return undefined
}

function statusUrl(template: string, taskId: string): string {
  return template.replace('{id}', encodeURIComponent(taskId))
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function safeFilePart(value: string): string {
  return value.replace(/[^a-zA-Z0-9_.-]/g, '_')
}

async function readJsonResponse(response: Response): Promise<unknown> {
  const text = await response.text()
  try {
    return JSON.parse(text) as unknown
  } catch {
    return { raw_text: text }
  }
}

export function createArkSeedanceMaterialGenerationAdapter(
  options: ArkSeedanceAdapterOptions,
): V2MaterialGenerationAdapter {
  const fetchImpl = options.fetchImpl ?? fetch
  const apiKey = options.apiKey ?? env.v2VideoGenerationApiKey
  const model = options.model ?? env.v2VideoGenerationModel
  const submitUrl = options.submitUrl ?? env.v2VideoGenerationSubmitUrl
  const taskStatusUrlTemplate = options.statusUrlTemplate ?? env.v2VideoGenerationStatusUrlTemplate
  const timeoutMs = options.timeoutMs ?? env.v2VideoGenerationTimeoutMs
  const pollIntervalMs = options.pollIntervalMs ?? env.v2VideoGenerationPollIntervalMs

  async function submitTask(input: V2MaterialGenerationRequest): Promise<{ id?: string; raw: unknown }> {
    const imageUrl = input.inputImageUrl ?? options.defaultImageUrl ?? env.v2VideoGenerationDefaultImageUrl
    if (!apiKey) throw new Error('V2_VIDEO_GENERATION_API_KEY or ARK_API_KEY is not configured.')
    if (!submitUrl) throw new Error('V2_VIDEO_GENERATION_SUBMIT_URL is not configured.')
    if (!imageUrl) {
      throw new Error('Seedance image-to-video generation requires input_image_url or V2_VIDEO_GENERATION_DEFAULT_IMAGE_URL.')
    }
    const urlAccess = classifyExternalUrlAccess(imageUrl)
    if (!urlAccess.ok) {
      throw new Error(
        `Seedance input_image_url is not externally reachable (${urlAccess.kind}): ${urlAccess.reason} ` +
          'Upload the image through /api/uploads with requirePublicUrl=true and configure the asset publisher, or provide an already public image URL.',
      )
    }

    const response = await fetchImpl(submitUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        content: [
          {
            type: 'text',
            text: input.prompt,
          },
          {
            type: 'image_url',
            image_url: {
              url: imageUrl,
            },
          },
        ],
      }),
      signal: AbortSignal.timeout(Math.min(timeoutMs, 60_000)),
    })
    const raw = await readJsonResponse(response)
    if (!response.ok) {
      throw new Error(`Ark Seedance submit failed ${response.status}: ${JSON.stringify(raw).slice(0, 1000)}`)
    }
    return { id: extractTaskId(raw), raw }
  }

  async function pollTask(taskId: string): Promise<{ raw: unknown; videoUrl: string }> {
    if (!taskStatusUrlTemplate) throw new Error('V2_VIDEO_GENERATION_STATUS_URL_TEMPLATE is not configured.')
    const deadline = Date.now() + timeoutMs
    let lastRaw: unknown
    while (Date.now() < deadline) {
      const response = await fetchImpl(statusUrl(taskStatusUrlTemplate, taskId), {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        signal: AbortSignal.timeout(Math.min(pollIntervalMs + 20_000, 60_000)),
      })
      const raw = await readJsonResponse(response)
      lastRaw = raw
      if (!response.ok) {
        throw new Error(`Ark Seedance status failed ${response.status}: ${JSON.stringify(raw).slice(0, 1000)}`)
      }
      const currentStatus = extractStatus(raw)
      const videoUrl = extractVideoUrl(raw)
      if (videoUrl && (!currentStatus || ['succeeded', 'success', 'completed', 'done'].includes(currentStatus))) {
        return { raw, videoUrl }
      }
      if (currentStatus && ['failed', 'error', 'cancelled', 'canceled'].includes(currentStatus)) {
        throw new Error(extractError(raw) ?? `Ark Seedance task ${taskId} failed with status ${currentStatus}.`)
      }
      await sleep(pollIntervalMs)
    }
    throw new Error(`Ark Seedance task ${taskId} timed out. Last response: ${JSON.stringify(lastRaw).slice(0, 1000)}`)
  }

  async function downloadVideo(input: {
    url: string
    outputAssetId: string
  }): Promise<string> {
    await mkdir(options.outputDir, { recursive: true })
    const outputPath = path.join(options.outputDir, `${safeFilePart(input.outputAssetId)}.raw.mp4`)
    const response = await fetchImpl(input.url, {
      method: 'GET',
      signal: AbortSignal.timeout(Math.min(timeoutMs, 120_000)),
    })
    if (!response.ok) {
      throw new Error(`Ark Seedance video download failed ${response.status}.`)
    }
    const bytes = Buffer.from(await response.arrayBuffer())
    await writeFile(outputPath, bytes)
    return outputPath
  }

  return {
    async generate(input): Promise<V2MaterialGenerationResult> {
      if (input.type !== 'generate_video') {
        return {
          ok: false,
          error: 'Ark Seedance adapter only supports generate_video jobs.',
        }
      }
      try {
        const submitted = await submitTask(input)
        if (!submitted.id) {
          return {
            ok: false,
            metadata: { submit_response: submitted.raw },
            error: 'Ark Seedance submit response did not include a task id.',
          }
        }
        const completed = await pollTask(submitted.id)
        const src = await downloadVideo({
          url: completed.videoUrl,
          outputAssetId: input.outputAssetId,
        })
        return {
          ok: true,
          providerTaskId: submitted.id,
          metadata: {
            submit_response: submitted.raw,
            final_response: completed.raw,
            video_url: completed.videoUrl,
          },
          asset: {
            id: input.outputAssetId,
            type: 'video',
            src,
            source: 'generated_asset',
          },
        }
      } catch (error) {
        return {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        }
      }
    },
  }
}
