import { mkdir } from 'node:fs/promises'
import path from 'node:path'

import { env } from '../../config/env.js'

const UPLOAD_DIR = path.resolve(process.cwd(), 'uploads')

export async function ensureUploadDir(): Promise<string> {
  await mkdir(UPLOAD_DIR, { recursive: true })
  return UPLOAD_DIR
}

/** multer 已写入 uploads/，此处仅拼公开 URL */
export function publicUrlForUploadedFile(file: Express.Multer.File): string {
  const filename = path.basename(file.path)
  const base = env.publicAssetBaseUrl.replace(/\/$/, '')
  return `${base}/uploads/${filename}`
}
