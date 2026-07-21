import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import path from 'node:path'

import { createRemotionTimelineFixture } from '../../shared/lib/remotion-timeline-fixtures.js'
import { validateRemotionTimelineSpec } from '../../shared/lib/remotion-timeline-validator.js'
import { standardizeGeneratedVideoAsset } from '../src/pipeline-v2/media-standardizer.js'
import { renderV2RemotionTimeline } from '../src/pipeline-v2/remotion-timeline-renderer.js'

const repoRoot = path.resolve(process.cwd(), '..')
const taskId = `v2_timeline_render_${Date.now()}`
const sampleVideo = path.join(repoRoot, 'example_videos', '9.mp4')
const sampleImage = path.join(repoRoot, 'example_videos', 'img', '1.png')
const outputDir = path.resolve(process.cwd(), 'v2-renders', taskId)

if (!existsSync(sampleVideo)) throw new Error(`Missing sample video: ${sampleVideo}`)
if (!existsSync(sampleImage)) throw new Error(`Missing sample image: ${sampleImage}`)

const standardizedVideo = await standardizeGeneratedVideoAsset({
  src: sampleVideo,
  assetId: 'timeline_smoke_main_video',
  outputDir,
  width: 360,
  height: 640,
  fps: 12,
})

const spec = createRemotionTimelineFixture({
  taskId,
  mainVideoSrc: standardizedVideo.src,
  imageSrc: sampleImage,
  durationSec: 3,
  width: 360,
  height: 640,
  fps: 12,
})

const validation = validateRemotionTimelineSpec(spec)
assert.equal(validation.ok, true, JSON.stringify(validation.issues, null, 2))

const result = await renderV2RemotionTimeline({
  spec,
  outputDir,
  outputName: `${taskId}.mp4`,
})

assert.equal(existsSync(result.outputPath), true)
assert.ok(result.fileSizeBytes > 10_000, `Unexpectedly small render: ${result.fileSizeBytes}`)

console.info('[smoke-v2-remotion-timeline-render] OK')
console.info(JSON.stringify({
  taskId,
  outputPath: result.outputPath,
  propsPath: result.propsPath,
  fileSizeBytes: result.fileSizeBytes,
}, null, 2))
