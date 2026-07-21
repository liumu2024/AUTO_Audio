import assert from 'node:assert/strict'
import path from 'node:path'

process.env.ASSET_PUBLISHER_PROVIDER = 'local'
process.env.PUBLIC_ASSET_BASE_URL = 'https://assets.example.com'

const { publishUploadedAsset } = await import('../src/modules/upload/asset-publisher.js')
const { classifyExternalUrlAccess } = await import('../../shared/lib/external-url-access.js')

const fakeFile = {
  path: path.resolve(process.cwd(), 'uploads', 'mock-input.png'),
  mimetype: 'image/png',
  size: 1024,
} as Express.Multer.File

const published = await publishUploadedAsset(fakeFile, { requirePublicUrl: true })
assert.equal(published.provider, 'local')
assert.equal(published.status, 'published')
assert.equal(published.externallyReachable, true)
assert.equal(published.publicUrl, 'https://assets.example.com/uploads/mock-input.png')
assert.equal(published.localUrl, 'https://assets.example.com/uploads/mock-input.png')

const localOnly = classifyExternalUrlAccess('http://localhost:3001/uploads/mock-input.png')
assert.equal(localOnly.ok, false)
assert.equal(localOnly.kind, 'local_host')

console.info('[smoke-v2-asset-publisher] OK')
