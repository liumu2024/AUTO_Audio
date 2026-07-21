import path from 'node:path'

import { TosClient } from '@volcengine/tos-sdk'

import { classifyExternalUrlAccess } from '../../../../shared/lib/external-url-access.js'
import { env } from '../../config/env.js'

export type AssetPublicationProvider = 'local' | 'tos'
export type AssetPublicationStatus = 'published' | 'local_only' | 'failed'

export interface AssetPublicationResult {
  provider: AssetPublicationProvider
  status: AssetPublicationStatus
  localUrl: string
  publicUrl?: string
  objectKey?: string
  externallyReachable: boolean
  error?: string
}

export interface AssetPublicationOptions {
  requirePublicUrl?: boolean
}

function normalizeBaseUrl(value: string): string {
  return value.replace(/\/$/, '')
}

function objectKeyForUploadedFile(file: Express.Multer.File): string {
  const prefix = env.tosObjectPrefix.replace(/^\/+|\/+$/g, '')
  const today = new Date().toISOString().slice(0, 10)
  const filename = path.basename(file.path)
  return [prefix, today, filename].filter(Boolean).join('/')
}

function publicUrlForKey(key: string): string {
  const base = normalizeBaseUrl(env.assetPublisherPublicBaseUrl!)
  return `${base}/${key.split('/').map(encodeURIComponent).join('/')}`
}

function localPublication(localUrl: string): AssetPublicationResult {
  const access = classifyExternalUrlAccess(localUrl)
  return {
    provider: 'local',
    status: access.ok ? 'published' : 'local_only',
    localUrl,
    publicUrl: access.ok ? access.normalizedUrl ?? localUrl : undefined,
    externallyReachable: access.ok,
    error: access.ok ? undefined : access.reason,
  }
}

function missingTosConfig(): string[] {
  const missing: string[] = []
  if (!env.tosAccessKeyId) missing.push('TOS_ACCESS_KEY_ID')
  if (!env.tosAccessKeySecret) missing.push('TOS_ACCESS_KEY_SECRET')
  if (!env.tosBucket) missing.push('TOS_BUCKET')
  if (!env.assetPublisherPublicBaseUrl) missing.push('ASSET_PUBLISHER_PUBLIC_BASE_URL or TOS_PUBLIC_BASE_URL')
  return missing
}

function createTosClient(): InstanceType<typeof TosClient> {
  return new TosClient({
    accessKeyId: env.tosAccessKeyId!,
    accessKeySecret: env.tosAccessKeySecret!,
    region: env.tosRegion,
    endpoint: env.tosEndpoint,
    bucket: env.tosBucket!,
  })
}

async function verifyPublicUrl(publicUrl: string): Promise<string | undefined> {
  if (!env.assetPublisherVerifyPublicUrl) return undefined

  try {
    const head = await fetch(publicUrl, {
      method: 'HEAD',
      signal: AbortSignal.timeout(env.assetPublisherVerifyTimeoutMs),
    })
    if (head.ok) return undefined

    const get = await fetch(publicUrl, {
      method: 'GET',
      headers: { Range: 'bytes=0-0' },
      signal: AbortSignal.timeout(env.assetPublisherVerifyTimeoutMs),
    })
    if (get.ok || get.status === 206) return undefined

    return `Public URL verification failed: HEAD ${head.status}, GET ${get.status}.`
  } catch (error) {
    return `Public URL verification failed: ${error instanceof Error ? error.message : String(error)}.`
  }
}

async function publishToTos(input: {
  file: Express.Multer.File
  localUrl: string
}): Promise<AssetPublicationResult> {
  const missing = missingTosConfig()
  if (missing.length > 0) {
    return {
      provider: 'tos',
      status: 'failed',
      localUrl: input.localUrl,
      externallyReachable: false,
      error: `TOS asset publisher is not configured. Missing: ${missing.join(', ')}.`,
    }
  }

  const key = objectKeyForUploadedFile(input.file)
  const publicUrl = publicUrlForKey(key)
  const access = classifyExternalUrlAccess(publicUrl)
  if (!access.ok) {
    return {
      provider: 'tos',
      status: 'failed',
      localUrl: input.localUrl,
      publicUrl,
      objectKey: key,
      externallyReachable: false,
      error: `Published TOS URL is not externally reachable (${access.kind}): ${access.reason}`,
    }
  }

  const client = createTosClient()
  await client.putObjectFromFile({
    key,
    filePath: input.file.path,
    contentType: input.file.mimetype,
  })

  const verifyError = await verifyPublicUrl(publicUrl)
  if (verifyError) {
    return {
      provider: 'tos',
      status: 'failed',
      localUrl: input.localUrl,
      publicUrl,
      objectKey: key,
      externallyReachable: false,
      error: verifyError,
    }
  }

  return {
    provider: 'tos',
    status: 'published',
    localUrl: input.localUrl,
    publicUrl,
    objectKey: key,
    externallyReachable: true,
  }
}

export async function publishUploadedAsset(
  file: Express.Multer.File,
  options: AssetPublicationOptions = {},
): Promise<AssetPublicationResult> {
  const base = normalizeBaseUrl(env.publicAssetBaseUrl)
  const localUrl = `${base}/uploads/${encodeURIComponent(path.basename(file.path))}`

  const result =
    env.assetPublisherProvider === 'tos'
      ? await publishToTos({ file, localUrl })
      : localPublication(localUrl)

  if (options.requirePublicUrl && !result.externallyReachable) {
    throw new Error(
      result.error ??
        'Uploaded asset has no externally reachable public URL. Configure ASSET_PUBLISHER_PROVIDER=tos and TOS public access.',
    )
  }

  return result
}
