import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdir, readFile, readdir, stat, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { env } from '../../config/env.js'

const UPLOAD_DIR = path.resolve(process.cwd(), 'uploads')
const UPLOAD_INDEX_FILE = path.join(UPLOAD_DIR, '.upload-index.json')

export interface UploadedFileIdentity {
  filePath: string
  filename: string
  contentHash: string
  duplicateOf?: string
}

type UploadIndex = Record<string, string>

export async function ensureUploadDir(): Promise<string> {
  await mkdir(UPLOAD_DIR, { recursive: true })
  return UPLOAD_DIR
}

async function sha256File(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256')
    const stream = createReadStream(filePath)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('error', reject)
    stream.on('end', () => resolve(hash.digest('hex')))
  })
}

async function readUploadIndex(): Promise<UploadIndex> {
  try {
    return JSON.parse(await readFile(UPLOAD_INDEX_FILE, 'utf8')) as UploadIndex
  } catch {
    return {}
  }
}

async function writeUploadIndex(index: UploadIndex): Promise<void> {
  await ensureUploadDir()
  await writeFile(UPLOAD_INDEX_FILE, `${JSON.stringify(index, null, 2)}\n`, 'utf8')
}

async function existingFile(filePath: string | undefined): Promise<string | undefined> {
  if (!filePath) return undefined
  try {
    const resolved = path.resolve(filePath)
    const uploadDir = await ensureUploadDir()
    if (!resolved.startsWith(uploadDir)) return undefined
    const fileStat = await stat(resolved)
    return fileStat.isFile() ? resolved : undefined
  } catch {
    return undefined
  }
}

export async function resolveUploadedAssetPath(value: string): Promise<string | undefined> {
  let pathname = value.trim()
  try {
    const url = new URL(pathname)
    const allowedOrigins = [env.publicBaseUrl, env.publicAssetBaseUrl]
      .map((item) => {
        try {
          return new URL(item).origin
        } catch {
          return undefined
        }
      })
      .filter((item): item is string => Boolean(item))
    if (!allowedOrigins.includes(url.origin)) return undefined
    pathname = url.pathname
  } catch {
    // Relative /uploads URLs are valid inputs here.
  }
  const parts = pathname.replace(/\\/g, '/').split('/').filter(Boolean)
  if (parts.length !== 2 || parts[0] !== 'uploads') return undefined
  let filename: string
  try {
    filename = decodeURIComponent(parts[1]!)
  } catch {
    return undefined
  }
  if (!filename || path.basename(filename) !== filename || filename.startsWith('.')) return undefined
  return existingFile(path.join(await ensureUploadDir(), filename))
}

async function findExistingUploadByHash(input: {
  hash: string
  currentPath: string
  index: UploadIndex
}): Promise<string | undefined> {
  const indexed = await existingFile(input.index[input.hash])
  if (indexed && indexed !== path.resolve(input.currentPath)) return indexed

  const uploadDir = await ensureUploadDir()
  const files = await readdir(uploadDir)
  for (const file of files) {
    if (file.startsWith('.')) continue
    const candidate = path.join(uploadDir, file)
    if (path.resolve(candidate) === path.resolve(input.currentPath)) continue
    const candidateStat = await stat(candidate).catch(() => undefined)
    if (!candidateStat?.isFile()) continue
    const candidateHash = await sha256File(candidate).catch(() => undefined)
    if (candidateHash === input.hash) return candidate
  }

  return undefined
}

export async function resolveUploadedFileIdentity(
  file: Express.Multer.File,
): Promise<UploadedFileIdentity> {
  await ensureUploadDir()
  const contentHash = await sha256File(file.path)
  const index = await readUploadIndex()
  const duplicateOf = await findExistingUploadByHash({
    hash: contentHash,
    currentPath: file.path,
    index,
  })

  if (duplicateOf) {
    await unlink(file.path).catch(() => undefined)
    index[contentHash] = duplicateOf
    await writeUploadIndex(index)
    return {
      filePath: duplicateOf,
      filename: path.basename(duplicateOf),
      contentHash,
      duplicateOf,
    }
  }

  index[contentHash] = file.path
  await writeUploadIndex(index)
  return {
    filePath: file.path,
    filename: path.basename(file.path),
    contentHash,
  }
}
