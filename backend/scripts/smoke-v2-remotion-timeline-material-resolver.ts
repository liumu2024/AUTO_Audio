import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import path from 'node:path'

import { createRemotionTimelineFixture } from '../../shared/lib/remotion-timeline-fixtures.js'
import { validateRemotionTimelineSpec } from '../../shared/lib/remotion-timeline-validator.js'
import {
  createNoopMaterialGenerationAdapter,
  createStaticMaterialGenerationAdapter,
} from '../src/pipeline-v2/material-generation-adapter.js'
import { resolveRemotionTimelineMaterialJobs } from '../src/pipeline-v2/remotion-timeline-material-resolver.js'
import { assertV2MaterialResolutionContract } from './v2-material-resolution-contract.js'

const repoRoot = path.resolve(process.cwd(), '..')
const sampleVideo = path.join(repoRoot, 'example_videos', '9.mp4')
const sampleImage = path.join(repoRoot, 'example_videos', 'img', '1.png')
const outputDir = path.resolve(process.cwd(), 'tmp', 'v2-remotion-timeline-material-smoke')

if (!existsSync(sampleVideo)) throw new Error(`Missing sample video: ${sampleVideo}`)
if (!existsSync(sampleImage)) throw new Error(`Missing sample image: ${sampleImage}`)

const base = createRemotionTimelineFixture({
  taskId: `v2_timeline_material_${Date.now()}`,
  mainVideoSrc: sampleVideo,
  imageSrc: sampleImage,
  durationSec: 4,
  width: 360,
  height: 640,
  fps: 12,
})

const spec = {
  ...base,
  assets: base.assets.filter((asset) => asset.id !== 'main_video_asset'),
  scenes: base.scenes.map((scene) =>
    scene.id === 'scene_001'
      ? {
          ...scene,
          type: 'ai_video' as const,
          asset_id: 'generated_scene_001',
        }
      : scene,
  ),
  material_jobs: [
    {
      id: 'job_generate_scene_001',
      scene_id: 'scene_001',
      type: 'generate_video' as const,
      status: 'planned' as const,
      prompt: 'Generate a short product scene',
      output_asset_id: 'generated_scene_001',
      fallback_asset_id: undefined,
      fallback_kind: 'none' as const,
      provider: 'manual' as const,
    },
  ],
}

const resolved = await resolveRemotionTimelineMaterialJobs({
  spec,
  adapter: createStaticMaterialGenerationAdapter({ videoAssetPath: sampleVideo }),
  outputDir,
})

assert.equal(resolved.report.ok, true, JSON.stringify(resolved.report.failed_jobs, null, 2))
assertV2MaterialResolutionContract({
  spec: resolved.spec,
  report: resolved.report,
  expectedGeneratedJobCount: 1,
})
assert.equal(resolved.report.generation_trace[0]?.provider_task_id, `static:${path.basename(sampleVideo)}`)
assert.equal(validateRemotionTimelineSpec(resolved.spec).ok, true)

const blankCardFallbackSpec = {
  ...spec,
  task_id: `v2_timeline_material_fallback_${Date.now()}`,
  scenes: spec.scenes.map((scene) =>
    scene.id === 'scene_001'
      ? {
          ...scene,
          type: 'remotion_card' as const,
          asset_id: undefined,
        }
      : scene,
  ),
  material_jobs: spec.material_jobs.map((job) => ({
    ...job,
    fallback_kind: 'blank_card' as const,
  })),
}

const fallbackResolved = await resolveRemotionTimelineMaterialJobs({
  spec: blankCardFallbackSpec,
  adapter: createNoopMaterialGenerationAdapter(),
})

assert.equal(fallbackResolved.report.ok, true)
assertV2MaterialResolutionContract({
  spec: fallbackResolved.spec,
  report: fallbackResolved.report,
  expectedGeneratedJobCount: 1,
})
assert.equal(validateRemotionTimelineSpec(fallbackResolved.spec).ok, true)

console.info('[smoke-v2-remotion-timeline-material-resolver] OK')
