import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import path from 'node:path'

import { createArkSeedanceMaterialGenerationAdapter } from '../src/pipeline-v2/ark-seedance-adapter.js'

const outputDir = path.resolve(process.cwd(), 'tmp', 'v2-ark-seedance-smoke')
await rm(outputDir, { recursive: true, force: true })

const calls: string[] = []
const mockFetch: typeof fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input.url
  calls.push(`${init?.method ?? 'GET'} ${url}`)
  if (url.endsWith('/tasks') && init?.method === 'POST') {
    return new Response(JSON.stringify({ id: 'task_mock_001', status: 'queued' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }
  if (url.endsWith('/tasks/task_mock_001')) {
    return new Response(
      JSON.stringify({
        id: 'task_mock_001',
        status: 'succeeded',
        content: {
          video_url: {
            url: 'https://example.com/generated.mp4',
          },
        },
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      },
    )
  }
  if (url === 'https://example.com/generated.mp4') {
    return new Response(new Uint8Array([0, 1, 2, 3, 4]), { status: 200 })
  }
  return new Response(JSON.stringify({ error: 'unexpected mock url' }), { status: 404 })
}

const adapter = createArkSeedanceMaterialGenerationAdapter({
  apiKey: 'ark-mock-key',
  model: 'doubao-seedance-1-5-pro-251215',
  submitUrl: 'https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks',
  statusUrlTemplate: 'https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks/{id}',
  defaultImageUrl: 'https://example.com/input.png',
  outputDir,
  timeoutMs: 10_000,
  pollIntervalMs: 1,
  fetchImpl: mockFetch,
})

const submissionEvents: string[] = []
const result = await adapter.generate({
  jobId: 'job_001',
  shotId: 'shot_001',
  type: 'generate_video',
  prompt: 'mock seedance prompt --duration 5 --camerafixed false --watermark true',
  outputAssetId: 'generated_video_asset',
}, {
  onProviderTaskSubmitted: async (providerTaskId) => {
    submissionEvents.push(providerTaskId)
    assert.equal(calls.some((call) => call.includes('/tasks/task_mock_001')), false)
  },
})

assert.equal(result.ok, true, result.error)
assert.equal(result.providerTaskId, 'task_mock_001')
assert.equal(result.submissionState, 'submitted')
assert.deepEqual(submissionEvents, ['task_mock_001'])
assert.equal(result.asset?.type, 'video')
assert.equal(existsSync(result.asset?.src ?? ''), true)
assert.deepEqual(calls, [
  'POST https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks',
  'GET https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks/task_mock_001',
  'GET https://example.com/generated.mp4',
])

const unknownSubmission = await createArkSeedanceMaterialGenerationAdapter({
  apiKey: 'ark-mock-key',
  model: 'mock-model',
  submitUrl: 'https://example.com/tasks',
  statusUrlTemplate: 'https://example.com/tasks/{id}',
  outputDir,
  fetchImpl: async () => {
    throw new Error('connection reset after request dispatch')
  },
}).generate({
  jobId: 'job_unknown',
  shotId: 'shot_unknown',
  type: 'generate_video',
  prompt: 'unknown submit state',
  outputAssetId: 'generated_unknown',
})
assert.equal(unknownSubmission.ok, false)
assert.equal(unknownSubmission.submissionState, 'unknown')
assert.equal(unknownSubmission.failureCode, 'provider_submit_state_unknown')

console.info('[smoke-v2-ark-seedance-adapter] OK')
