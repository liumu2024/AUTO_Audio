import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import path from 'node:path'

import {
  createNoopMaterialGenerationAdapter,
  createStaticMaterialGenerationAdapter,
} from '../src/pipeline-v2/material-generation-adapter.js'

const repoRoot = path.resolve(process.cwd(), '..')
const sampleVideo = path.join(repoRoot, 'example_videos', '9.mp4')

if (!existsSync(sampleVideo)) {
  throw new Error(`Missing smoke material video: ${sampleVideo}`)
}

const request = {
  jobId: 'job_generate_video',
  shotId: 'shot_001',
  type: 'generate_video' as const,
  durationSec: 5,
  prompt: 'mock generated video',
  outputAssetId: 'generated_video_asset',
}

const withoutAdapter = await createNoopMaterialGenerationAdapter().generate(request)
assert.equal(withoutAdapter.ok, false)

const withAdapter = await createStaticMaterialGenerationAdapter({ videoAssetPath: sampleVideo }).generate({
  ...request,
})
assert.equal(withAdapter.ok, true, withAdapter.error)
assert.equal(withAdapter.asset?.id, 'generated_video_asset')
assert.equal(withAdapter.asset?.src, sampleVideo)

console.info('[smoke-v2-material-adapter] OK')
