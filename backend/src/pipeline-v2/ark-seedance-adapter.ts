import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

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

function normalizedProviderStatus(status: string | undefined): 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'unknown' {
  if (!status) return 'unknown'
  if (['queued', 'pending'].includes(status)) return 'queued'
  if (['running', 'processing', 'in_progress'].includes(status)) return 'running'
  if (['succeeded', 'success', 'completed', 'done'].includes(status)) return 'succeeded'
  if (['failed', 'error'].includes(status)) return 'failed'
  if (['cancelled', 'canceled'].includes(status)) return 'cancelled'
  return 'unknown'
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

function requestSignal(timeoutMs: number, signal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs)
  return signal ? AbortSignal.any([signal, timeout]) : timeout
}

function safeFilePart(value: string): string {
  return value.replace(/[^a-zA-Z0-9_.-]/g, '_')
}

class ProviderTaskPendingError extends Error {}
class ProviderTaskTerminalError extends Error {}

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

  async function submitTask(
    input: V2MaterialGenerationRequest,
    onDispatch: () => void,
    signal?: AbortSignal,
  ): Promise<{ id?: string; raw: unknown }> {
    const imageUrl = input.inputImageUrl ?? options.defaultImageUrl ?? env.v2VideoGenerationDefaultImageUrl
    if (!apiKey) throw new Error('V2_VIDEO_GENERATION_API_KEY or ARK_API_KEY is not configured.')
    if (!submitUrl) throw new Error('V2_VIDEO_GENERATION_SUBMIT_URL is not configured.')
    if (imageUrl) {
      const urlAccess = classifyExternalUrlAccess(imageUrl)
      if (!urlAccess.ok) {
        throw new Error(
          `Seedance input_image_url is not externally reachable (${urlAccess.kind}): ${urlAccess.reason} ` +
            'Upload the image through /api/uploads with requirePublicUrl=true and configure the asset publisher, or provide an already public image URL.',
        )
      }
    }
    const content: Array<Record<string, unknown>> = [
      {
        type: 'text',
        text: input.prompt,
      },
    ]
    if (imageUrl) {
      content.push({
        type: 'image_url',
        image_url: {
          url: imageUrl,
        },
      })
    }

    onDispatch()
    const response = await fetchImpl(submitUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        content,
      }),
      signal: requestSignal(Math.min(timeoutMs, 60_000), signal),
    })
    const raw = await readJsonResponse(response)
    if (!response.ok) {
      throw new Error(`Ark Seedance submit failed ${response.status}: ${JSON.stringify(raw).slice(0, 1000)}`)
    }
    return { id: extractTaskId(raw), raw }
  }

  async function readTask(taskId: string, signal?: AbortSignal): Promise<{ raw: unknown; status?: string }> {
    if (!taskStatusUrlTemplate) throw new Error('V2_VIDEO_GENERATION_STATUS_URL_TEMPLATE is not configured.')
    const response = await fetchImpl(statusUrl(taskStatusUrlTemplate, taskId), {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      signal: requestSignal(Math.min(pollIntervalMs + 20_000, 60_000), signal),
    })
    const raw = await readJsonResponse(response)
    if (!response.ok) {
      throw new Error(`Ark Seedance status failed ${response.status}: ${JSON.stringify(raw).slice(0, 1000)}`)
    }
    return { raw, status: extractStatus(raw) }
  }

  async function pollTask(taskId: string, signal?: AbortSignal): Promise<{ raw: unknown; videoUrl: string }> {
    const deadline = Date.now() + timeoutMs
    let lastRaw: unknown
    while (Date.now() < deadline) {
      const { raw, status: currentStatus } = await readTask(taskId, signal)
      lastRaw = raw
      const videoUrl = extractVideoUrl(raw)
      if (videoUrl && (!currentStatus || ['succeeded', 'success', 'completed', 'done'].includes(currentStatus))) {
        return { raw, videoUrl }
      }
      if (currentStatus && ['failed', 'error', 'cancelled', 'canceled'].includes(currentStatus)) {
        throw new ProviderTaskTerminalError(
          extractError(raw) ?? `Ark Seedance task ${taskId} failed with status ${currentStatus}.`,
        )
      }
      await delay(pollIntervalMs, undefined, { signal })
    }
    throw new ProviderTaskPendingError(
      `Ark Seedance task ${taskId} timed out. Last response: ${JSON.stringify(lastRaw).slice(0, 1000)}`,
    )
  }

  async function downloadVideo(input: {
    url: string
    outputAssetId: string
    signal?: AbortSignal
  }): Promise<string> {
    await mkdir(options.outputDir, { recursive: true })
    const outputPath = path.join(options.outputDir, `${safeFilePart(input.outputAssetId)}.raw.mp4`)
    const response = await fetchImpl(input.url, {
      method: 'GET',
      signal: requestSignal(Math.min(timeoutMs, 120_000), input.signal),
    })
    if (!response.ok) {
      throw new Error(`Ark Seedance video download failed ${response.status}.`)
    }
    const bytes = Buffer.from(await response.arrayBuffer())
    await writeFile(outputPath, bytes)
    return outputPath
  }

  return {
    async getTaskStatus(providerTaskId) {
      const { status } = await readTask(providerTaskId)
      return { status: normalizedProviderStatus(status) }
    },
    async cancelTask(providerTaskId) {
      const current = await readTask(providerTaskId)
      const status = normalizedProviderStatus(current.status)
      if (status !== 'queued') {
        return { cancelled: status === 'cancelled', status, reason: `provider_task_${status}` }
      }
      if (!taskStatusUrlTemplate) return { cancelled: false, status: 'unknown', reason: 'status_endpoint_unavailable' }
      const response = await fetchImpl(statusUrl(taskStatusUrlTemplate, providerTaskId), {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        signal: requestSignal(Math.min(timeoutMs, 60_000)),
      })
      const raw = await readJsonResponse(response)
      if (!response.ok) {
        return { cancelled: false, status: 'queued', reason: extractError(raw) ?? `cancel_failed_${response.status}` }
      }
      const confirmed = await readTask(providerTaskId).catch(() => undefined)
      const cancelledStatus = normalizedProviderStatus(confirmed?.status)
      return cancelledStatus === 'cancelled'
        ? { cancelled: true, status: 'cancelled' }
        : { cancelled: false, status: cancelledStatus, reason: 'provider_cancel_not_confirmed' }
    },
    async generate(input, generationOptions): Promise<V2MaterialGenerationResult> {
      if (input.type !== 'generate_video') {
        return {
          ok: false,
          submissionState: 'not_submitted',
          error: 'Ark Seedance adapter only supports generate_video jobs.',
        }
      }
      let requestDispatched = false
      let providerTaskId: string | undefined
      try {
        const submitted = await submitTask(input, () => {
          requestDispatched = true
        }, generationOptions?.signal)
        if (!submitted.id) {
          return {
            ok: false,
            submissionState: 'unknown',
            failureCode: 'provider_submit_state_unknown',
            metadata: { submit_response: submitted.raw },
            error: 'Ark Seedance submit response did not include a task id.',
          }
        }
        providerTaskId = submitted.id
        try {
          await generationOptions?.onProviderTaskSubmitted?.(submitted.id)
        } catch (error) {
          return {
            ok: false,
            providerTaskId: submitted.id,
            submissionState: 'submitted',
            failureCode: 'provider_receipt_persist_failed',
            metadata: { submit_response: submitted.raw },
            error: `Provider task was submitted but its receipt could not be persisted: ${
              error instanceof Error ? error.message : String(error)
            }`,
          }
        }
        const completed = await pollTask(submitted.id, generationOptions?.signal)
        const src = await downloadVideo({
          url: completed.videoUrl,
          outputAssetId: input.outputAssetId,
          signal: generationOptions?.signal,
        })
        return {
          ok: true,
          providerTaskId: submitted.id,
          submissionState: 'submitted',
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
          providerTaskId,
          submissionState: providerTaskId ? 'submitted' : requestDispatched ? 'unknown' : 'not_submitted',
          failureCode: error instanceof ProviderTaskPendingError
            ? 'provider_task_pending'
            : error instanceof ProviderTaskTerminalError
              ? 'provider_task_terminal'
              : providerTaskId
                ? 'provider_task_pending'
                : requestDispatched ? 'provider_submit_state_unknown' : undefined,
          error: error instanceof Error ? error.message : String(error),
        }
      }
    },
    async resume(input, providerTaskId, generationOptions): Promise<V2MaterialGenerationResult> {
      try {
        const completed = await pollTask(providerTaskId, generationOptions?.signal)
        const src = await downloadVideo({
          url: completed.videoUrl,
          outputAssetId: input.outputAssetId,
          signal: generationOptions?.signal,
        })
        return {
          ok: true,
          providerTaskId,
          submissionState: 'submitted',
          metadata: { final_response: completed.raw, video_url: completed.videoUrl },
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
          providerTaskId,
          submissionState: 'submitted',
          failureCode: error instanceof ProviderTaskTerminalError
            ? 'provider_task_terminal'
            : 'provider_task_pending',
          error: error instanceof Error ? error.message : String(error),
        }
      }
    },
  }
}
