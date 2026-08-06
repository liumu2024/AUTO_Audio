import assert from 'node:assert/strict'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

// Simulate a reachable upload base BEFORE the env module loads.
process.env.PUBLIC_UPLOAD_BASE_URL = 'http://media.example.com'
process.env.ASSET_PUBLISHER_PROVIDER = 'local'
process.env.ASSET_PUBLISHER_VERIFY_PUBLIC_URL = 'false'

const { ensureExternallyReachableUploadUrl } = await import(
  '../src/modules/upload/asset-publisher.js'
)
const { classifyExternalUrlAccess } = await import('../../shared/lib/external-url-access.js')

const uploadsDir = path.resolve(process.cwd(), 'uploads')
const filename = `chain-test-${randomUUID().slice(0, 8)}.png`
const localPath = path.join(uploadsDir, filename)

try {
  await mkdir(uploadsDir, { recursive: true })
  await writeFile(localPath, Buffer.from('public-material-chain-test'))

  // 1. A local upload path is published to the configured reachable base.
  const publicUrl = await ensureExternallyReachableUploadUrl(`/uploads/${filename}`)
  assert.equal(publicUrl, `http://media.example.com/uploads/${filename}`)
  assert.equal(classifyExternalUrlAccess(publicUrl).ok, true, 'published URL must be reachable')

  // 2. Re-publication is cached and idempotent.
  assert.equal(await ensureExternallyReachableUploadUrl(`/uploads/${filename}`), publicUrl)

  // 3. An already-public URL passes through unchanged.
  assert.equal(
    await ensureExternallyReachableUploadUrl('https://cdn.example.com/a.png'),
    'https://cdn.example.com/a.png',
  )

  console.log('V2 public material chain smoke passed (local upload -> reachable URL, passthrough, cache).')
} finally {
  await rm(localPath, { force: true })
}
