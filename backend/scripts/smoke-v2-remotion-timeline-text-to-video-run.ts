import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

import { runV2RemotionTimeline } from '../src/pipeline-v2/remotion-timeline-service.js'
import { assertV2MaterialResolutionContract } from './v2-material-resolution-contract.js'

const taskId = `v2_text_to_video_run_${Date.now()}`
const result = await runV2RemotionTimeline({
  taskId,
  creationMode: 'text_to_video',
  prompt: [
    '片段 1: "清晨薄雾掠过山谷。" (第 0 - 24 帧)',
    '片段 2: "阳光穿过树林照亮小径。" (第 25 - 48 帧)',
  ].join('\n'),
  plannerMode: 'deterministic',
  canvas: {
    width: 360,
    height: 640,
    fps: 12,
  },
})

assert.equal(result.ok, true, JSON.stringify(result.evaluation, null, 2))
assert.equal(existsSync(result.outputPath), true)
assert.equal(result.spec.assets.some((asset) => asset.source === 'user_asset'), false)
assert.equal(result.spec.material_jobs.length, result.spec.scenes.length)
assert.equal(result.spec.material_jobs.every((job) => job.type === 'generate_video'), true)
assertV2MaterialResolutionContract({
  spec: result.spec,
  report: result.materialResolution,
  expectedGeneratedJobCount: result.spec.scenes.length,
})

const tracePath = path.join(
  result.traceDir,
  '03-material-jobs',
  'timeline-material-resolution.json',
)
assert.equal(existsSync(tracePath), true)
const trace = JSON.parse(readFileSync(tracePath, 'utf8')) as {
  schema_version?: string
  generation_trace?: typeof result.materialResolution.generation_trace
}
assert.equal(trace.schema_version, result.materialResolution.schema_version)
assert.deepEqual(trace.generation_trace, result.materialResolution.generation_trace)

console.info('[smoke-v2-remotion-timeline-text-to-video-run] OK')
console.info(JSON.stringify({
  taskId,
  outputPath: result.outputPath,
  traceDir: result.traceDir,
  fulfilledJobs: result.materialResolution.generation_trace.filter((entry) => entry.status === 'fulfilled').length,
  fallbackJobs: result.materialResolution.generation_trace.filter((entry) => entry.status === 'fallback').length,
  fileSizeBytes: result.render.fileSizeBytes,
}, null, 2))
