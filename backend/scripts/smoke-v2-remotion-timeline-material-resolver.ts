import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { createRemotionTimelineFixture } from '../../shared/lib/remotion-timeline-fixtures.js'
import { validateRemotionTimelineSpec } from '../../shared/lib/remotion-timeline-validator.js'
import {
  createNoopMaterialGenerationAdapter,
  createStaticMaterialGenerationAdapter,
  type V2MaterialGenerationAdapter,
} from '../src/pipeline-v2/material-generation-adapter.js'
import { resolveRemotionTimelineMaterialJobs } from '../src/pipeline-v2/remotion-timeline-material-resolver.js'
import { assertV2MaterialResolutionContract } from './v2-material-resolution-contract.js'

const repoRoot = path.resolve(process.cwd(), '..')
const sampleVideo = path.join(repoRoot, 'example_videos', '9.mp4')
const sampleImage = path.join(repoRoot, 'example_videos', 'img', '1.png')
const outputDir = await mkdtemp(path.join(os.tmpdir(), 'v2-remotion-timeline-material-smoke-'))

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
  assets: base.assets
    .filter((asset) => asset.id !== 'main_video_asset')
    .map((asset) => asset.id === 'hero_image_asset'
      ? { ...asset, src: 'https://cdn.example.com/source-landscape.png' }
      : asset),
  overlays: [],
  scenes: base.scenes.map((scene) =>
    scene.id === 'scene_001'
      ? {
          ...scene,
          type: 'ai_video' as const,
          asset_id: 'generated_scene_001',
          creative_intent: {
            title: 'Generated landscape motion',
            description: 'Keep the supplied landscape composition and add a moving subject in the sky.',
            material_label: 'Source landscape',
          },
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
      input_asset_id: 'hero_image_asset',
      output_asset_id: 'generated_scene_001',
      fallback_asset_id: undefined,
      fallback_kind: 'none' as const,
      provider: 'manual' as const,
    },
  ],
}

let boundGenerationImageUrl: string | undefined
const staticAdapter = createStaticMaterialGenerationAdapter({ videoAssetPath: sampleVideo })
const resolved = await resolveRemotionTimelineMaterialJobs({
  spec,
  adapter: {
    async generate(input) {
      boundGenerationImageUrl = input.inputImageUrl
      return staticAdapter.generate(input)
    },
  },
  outputDir,
})

assert.equal(resolved.report.ok, true, JSON.stringify(resolved.report.failed_jobs, null, 2))
assertV2MaterialResolutionContract({
  spec: resolved.spec,
  report: resolved.report,
  expectedGeneratedJobCount: 1,
})
assert.equal(resolved.report.generation_trace[0]?.provider_task_id, `static:${path.basename(sampleVideo)}`)
assert.equal(boundGenerationImageUrl, 'https://cdn.example.com/source-landscape.png')
assert.equal(resolved.report.generation_trace[0]?.input_asset_id, 'hero_image_asset')
assert.equal(validateRemotionTimelineSpec(resolved.spec).ok, true)

const invalidInputAsset = validateRemotionTimelineSpec({
  ...spec,
  material_jobs: spec.material_jobs.map((job) => ({ ...job, input_asset_id: 'missing_image_asset' })),
})
assert.equal(invalidInputAsset.ok, false)
assert.equal(
  invalidInputAsset.issues.some((issue) => issue.path.endsWith('.input_asset_id')),
  true,
  'image-conditioned generation must reference an existing image asset',
)

const missingMaterialExplanation = validateRemotionTimelineSpec({
  ...spec,
  scenes: spec.scenes.map((scene) => scene.id === 'scene_001'
    ? { ...scene, creative_intent: undefined }
    : scene),
})
assert.equal(missingMaterialExplanation.ok, false)
assert.equal(
  missingMaterialExplanation.issues.some((issue) => issue.path.endsWith('.creative_intent.description')),
  true,
  'an image-conditioned generated scene must explain how the source material is used',
)

const blankCardFallbackSpec = {
  ...spec,
  task_id: `v2_timeline_material_fallback_${Date.now()}`,
  scenes: spec.scenes.map((scene) =>
    scene.id === 'scene_001'
      ? {
          ...scene,
          creative_intent: {
            title: 'Fallback title',
            description: 'Fallback explanation for a missing generated visual.',
          },
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
assert.equal(fallbackResolved.spec.scenes[0]?.title, 'Fallback title')
assert.equal(fallbackResolved.spec.scenes[0]?.body, 'Fallback explanation for a missing generated visual.')
assert.equal(fallbackResolved.report.delivery_readiness.ready, false)
assert.deepEqual(fallbackResolved.report.delivery_readiness.missing_generated_scene_ids, ['scene_001'])
assert.equal(validateRemotionTimelineSpec(fallbackResolved.spec).ok, true)

const delayedAdapter: V2MaterialGenerationAdapter = {
  async generate(input) {
    await new Promise((resolve) => setTimeout(resolve, 200))
    return {
      ok: true,
      providerTaskId: `delayed:${input.jobId}`,
      asset: { id: input.outputAssetId, type: 'video', src: sampleVideo },
    }
  },
}
const concurrentSpec = {
  ...spec,
  task_id: `v2_timeline_material_concurrent_${Date.now()}`,
  scenes: [0, 1, 2].map((index) => ({
    id: `scene_${index + 1}`,
    type: 'ai_video' as const,
    start_sec: index,
    duration_sec: 1,
    asset_id: `generated_scene_${index + 1}`,
  })),
  material_jobs: [0, 1, 2].map((index) => ({
    id: `job_generate_scene_${index + 1}`,
    scene_id: `scene_${index + 1}`,
    type: 'generate_video' as const,
    status: 'planned' as const,
    prompt: `Generate scene ${index + 1}`,
    output_asset_id: `generated_scene_${index + 1}`,
    fallback_kind: 'none' as const,
    provider: 'manual' as const,
  })),
  overlays: [],
  transitions: [],
  canvas: { ...spec.canvas, duration_sec: 3 },
}
const progressEvents: string[] = []
const concurrentStartedAt = Date.now()
const concurrentResolved = await resolveRemotionTimelineMaterialJobs({
  spec: concurrentSpec,
  adapter: delayedAdapter,
  maxConcurrency: 3,
  onProgress: (event) => progressEvents.push(`${event.status}:${event.jobId}`),
})
const concurrentElapsedMs = Date.now() - concurrentStartedAt
assert.equal(concurrentResolved.report.delivery_readiness.ready, true)
assert.ok(concurrentElapsedMs < 450, `Expected bounded concurrency, got ${concurrentElapsedMs}ms`)
assert.equal(progressEvents.filter((event) => event.startsWith('started:')).length, 3)
assert.equal(progressEvents.filter((event) => event.startsWith('fulfilled:')).length, 3)

let staleFulfilledGenerationCalls = 0
const staleFulfilledResolved = await resolveRemotionTimelineMaterialJobs({
  spec: {
    ...concurrentSpec,
    task_id: `v2_timeline_stale_fulfilled_${Date.now()}`,
    material_jobs: concurrentSpec.material_jobs.map((job) => ({
      ...job,
      status: 'fulfilled' as const,
    })),
  },
  adapter: {
    async generate(input) {
      staleFulfilledGenerationCalls += 1
      return {
        ok: true,
        providerTaskId: `stale-status:${input.jobId}`,
        asset: { id: input.outputAssetId, type: 'video', src: sampleVideo },
      }
    },
  },
  maxConcurrency: 3,
})
assert.equal(staleFulfilledGenerationCalls, 3)
assert.equal(staleFulfilledResolved.report.delivery_readiness.ready, true)
assert.equal(staleFulfilledResolved.report.delivery_readiness.resolved_generated_scene_count, 3)

const attemptedJobs: string[] = []
const isolatedFailureResolved = await resolveRemotionTimelineMaterialJobs({
  spec: {
    ...concurrentSpec,
    task_id: `v2_timeline_isolated_failure_${Date.now()}`,
  },
  adapter: {
    async generate(input) {
      attemptedJobs.push(input.jobId)
      if (input.jobId === 'job_generate_scene_2') throw new Error('provider rejected scene 2')
      return {
        ok: true,
        providerTaskId: `isolated:${input.jobId}`,
        asset: { id: input.outputAssetId, type: 'video', src: sampleVideo },
      }
    },
  },
  maxConcurrency: 3,
})
assert.deepEqual(attemptedJobs.sort(), [
  'job_generate_scene_1',
  'job_generate_scene_2',
  'job_generate_scene_3',
])
assert.equal(isolatedFailureResolved.report.delivery_readiness.ready, false)
assert.deepEqual(isolatedFailureResolved.report.delivery_readiness.missing_generated_scene_ids, ['scene_2'])
assert.match(
  isolatedFailureResolved.report.generation_trace.find((item) => item.scene_id === 'scene_2')?.error ?? '',
  /provider rejected scene 2/,
)

await rm(outputDir, { recursive: true, force: true })
console.info('[smoke-v2-remotion-timeline-material-resolver] OK')
