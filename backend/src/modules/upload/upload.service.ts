import { mkdir } from 'node:fs/promises'
import path from 'node:path'

const UPLOAD_DIR = path.resolve(process.cwd(), 'uploads')

export async function ensureUploadDir(): Promise<string> {
  await mkdir(UPLOAD_DIR, { recursive: true })
  return UPLOAD_DIR
}
