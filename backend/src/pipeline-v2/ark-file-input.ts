import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { env } from '../config/env.js'

export interface ArkFileInput {
  fileId: string
  sourcePath: string
  originalName: string
}

function imageMimeType(filePath: string): string {
  switch (path.extname(filePath).toLowerCase()) {
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg'
    case '.webp':
      return 'image/webp'
    case '.gif':
      return 'image/gif'
    case '.bmp':
      return 'image/bmp'
    default:
      return 'image/png'
  }
}

function fileIdFromResponse(payload: unknown): string | undefined {
  if (!payload || typeof payload !== 'object') return undefined
  const record = payload as Record<string, unknown>
  if (typeof record.id === 'string') return record.id
  if (typeof record.file_id === 'string') return record.file_id
  if (!record.data || typeof record.data !== 'object') return undefined
  const data = record.data as Record<string, unknown>
  return typeof data.id === 'string'
    ? data.id
    : typeof data.file_id === 'string'
      ? data.file_id
      : undefined
}

function filesUrl(): string {
  return env.directorAgentFilesUrl.replace(/\/+$/, '')
}

function authorizationHeaders(): HeadersInit {
  if (!env.directorAgentApiKey) {
    throw new Error('DIRECTOR_AGENT_API_KEY is not configured for Ark Files image inputs.')
  }
  return { Authorization: `Bearer ${env.directorAgentApiKey}` }
}

/**
 * Creates a short-lived Ark Files reference for an image that only exists on
 * this machine. It is deliberately not a public publishing mechanism: image
 * understanding can use a file_id, while image-to-video still needs a public
 * URL supplied by the asset publisher.
 */
export async function uploadV2PlannerImageFile(input: {
  localPath: string
  originalName?: string
}): Promise<ArkFileInput> {
  const sourcePath = path.resolve(input.localPath)
  const originalName = input.originalName?.trim() || path.basename(sourcePath)
  const buffer = await readFile(sourcePath)
  const form = new FormData()
  form.append('purpose', 'user_data')
  form.append('file', new Blob([buffer], { type: imageMimeType(sourcePath) }), originalName)

  const response = await fetch(filesUrl(), {
    method: 'POST',
    headers: authorizationHeaders(),
    body: form,
    signal: AbortSignal.timeout(env.directorAgentTimeoutMs),
  })
  const text = await response.text()
  if (!response.ok) throw new Error(`Ark Files image upload returned ${response.status}: ${text.slice(0, 500)}`)

  let payload: unknown
  try {
    payload = JSON.parse(text)
  } catch {
    throw new Error('Ark Files image upload returned invalid JSON.')
  }
  const fileId = fileIdFromResponse(payload)
  if (!fileId) throw new Error('Ark Files image upload response did not include file_id.')
  return { fileId, sourcePath, originalName }
}

export async function waitForV2PlannerFileReady(fileId: string): Promise<void> {
  const started = Date.now()
  while (Date.now() - started < env.directorAgentFileReadyTimeoutMs) {
    const response = await fetch(`${filesUrl()}/${encodeURIComponent(fileId)}`, {
      headers: authorizationHeaders(),
      signal: AbortSignal.timeout(env.directorAgentTimeoutMs),
    })
    const text = await response.text()
    if (!response.ok) throw new Error(`Ark Files image retrieve returned ${response.status}: ${text.slice(0, 500)}`)
    let payload: Record<string, unknown>
    try {
      payload = JSON.parse(text) as Record<string, unknown>
    } catch {
      throw new Error('Ark Files image retrieve returned invalid JSON.')
    }
    const status = String(payload.status ?? payload.state ?? '').toLowerCase()
    if (status === 'active' || status === 'processed') return
    if (status === 'failed' || status === 'error' || status === 'cancelled') {
      throw new Error(`Ark Files image preprocessing failed: ${status}`)
    }
    await new Promise((resolve) => setTimeout(resolve, env.directorAgentFileReadyPollIntervalMs))
  }
  throw new Error(`Timed out waiting for Ark Files image preprocessing. file_id=${fileId}`)
}

export async function deleteV2PlannerFile(fileId: string): Promise<void> {
  await fetch(`${filesUrl()}/${encodeURIComponent(fileId)}`, {
    method: 'DELETE',
    headers: authorizationHeaders(),
    signal: AbortSignal.timeout(env.directorAgentTimeoutMs),
  }).catch(() => undefined)
}
