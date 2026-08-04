import { access, mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { env } from '../config/env.js'
import type { VideoInput } from './video-input.js'

const UPLOADS_DIR = path.resolve(process.cwd(), 'uploads')

/** 将 analyze 请求里的 videoUrl 解析为本地可读 VideoInput */
export async function resolveVideoInput(videoUrl: string): Promise<VideoInput> {
  const url = videoUrl.trim()
  if (!url) {
    throw new Error('videoUrl is empty')
  }

  const localFromUploads = tryResolveLocalUpload(url)
  if (localFromUploads) {
    await access(localFromUploads)
    return toVideoInput(localFromUploads, path.basename(localFromUploads))
  }

  if (url.startsWith('file://')) {
    const localPath = path.normalize(url.replace(/^file:\/\//, ''))
    await access(localPath)
    return toVideoInput(localPath, path.basename(localPath))
  }

  if (url.startsWith('http://') || url.startsWith('https://')) {
    const res = await fetch(url)
    if (!res.ok) {
      throw new Error(`Failed to download video: HTTP ${res.status}`)
    }
    const buffer = Buffer.from(await res.arrayBuffer())
    const tmpDir = path.join(process.cwd(), 'tmp', 'understanding-downloads')
    await mkdir(tmpDir, { recursive: true })
    const name = `remote_${Date.now()}.mp4`
    const localPath = path.join(tmpDir, name)
    await writeFile(localPath, buffer)
    const mimeType = res.headers.get('content-type') ?? 'video/mp4'
    return toVideoInput(localPath, name, mimeType, buffer.length)
  }

  await access(url)
  return toVideoInput(url, path.basename(url))
}

function tryResolveLocalUpload(url: string): string | null {
  try {
    const parsed = new URL(url)
    const allowedOrigins = [env.publicBaseUrl, env.publicAssetBaseUrl].map((value) => new URL(value).origin)
    if (!allowedOrigins.includes(parsed.origin)) return null
    const match = parsed.pathname.match(/^\/uploads\/(.+)$/)
    if (!match) return null
    return path.join(UPLOADS_DIR, decodeURIComponent(match[1]))
  } catch {
    if (path.isAbsolute(url) && url.includes('uploads')) {
      return url
    }
    return null
  }
}

function toVideoInput(
  localPath: string,
  originalName: string,
  mimeType = 'video/mp4',
  sizeBytes?: number,
): VideoInput {
  return {
    storageKind: 'local',
    localPath,
    originalName,
    mimeType,
    sizeBytes: sizeBytes ?? 0,
    createdAt: new Date(),
  }
}
