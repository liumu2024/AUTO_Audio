import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import path from 'node:path'

import { runV2RemotionTimeline } from '../src/pipeline-v2/remotion-timeline-service.js'

const repoRoot = path.resolve(process.cwd(), '..')
const taskId = `v2_timeline_service_${Date.now()}`
const sampleVideo = path.join(repoRoot, 'example_videos', '9.mp4')
const sampleImage = path.join(repoRoot, 'example_videos', 'img', '1.png')

if (!existsSync(sampleVideo)) throw new Error(`Missing sample video: ${sampleVideo}`)
if (!existsSync(sampleImage)) throw new Error(`Missing sample image: ${sampleImage}`)

let result: Awaited<ReturnType<typeof runV2RemotionTimeline>> | undefined
try {
  result = await runV2RemotionTimeline({
    taskId,
    prompt: '用参考素材做一条节奏清楚的产品展示短片，突出开场、卖点和收束。',
    mainVideoPath: sampleVideo,
    imageSrc: sampleImage,
    durationSec: 3,
    plannerMode: 'deterministic',
    allowPlannerFallback: true,
    canvas: {
      width: 360,
      height: 640,
      fps: 12,
    },
  })

assert.equal(result.ok, true, JSON.stringify(result.evaluation, null, 2))
assert.equal(existsSync(result.outputPath), true)
assert.equal(result.validation.ok, true, JSON.stringify(result.validation.issues, null, 2))
assert.ok(result.standardizedAssets.length >= 1, 'Expected at least one standardized video asset.')
assert.ok(result.render.fileSizeBytes > 10_000, `Unexpectedly small render: ${result.render.fileSizeBytes}`)

console.info('[smoke-v2-remotion-timeline-service] OK')
console.info(JSON.stringify({
  taskId,
  outputPath: result.outputPath,
  traceDir: result.traceDir,
  scenes: result.spec.scenes.length,
  transitions: result.spec.transitions.length,
  overlays: result.spec.overlays.length,
  standardizedAssets: result.standardizedAssets.length,
  fileSizeBytes: result.render.fileSizeBytes,
}, null, 2))
} finally {
  await Promise.all([
    rm(path.resolve(process.cwd(), 'v2-renders', taskId), {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 100,
    }),
    rm(path.resolve(process.cwd(), 'tmp', 'v2-traces', 'tasks', taskId), {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 100,
    }),
  ])
}
