import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import path from 'node:path'

import { createRemotionTimelineFixture } from '../../shared/lib/remotion-timeline-fixtures.js'
import { validateRemotionTimelineSpec } from '../../shared/lib/remotion-timeline-validator.js'

const repoRoot = path.resolve(process.cwd(), '..')
const sampleVideo = path.join(repoRoot, 'example_videos', '9.mp4')
const sampleImage = path.join(repoRoot, 'example_videos', 'img', '1.png')

if (!existsSync(sampleVideo)) throw new Error(`Missing sample video: ${sampleVideo}`)
if (!existsSync(sampleImage)) throw new Error(`Missing sample image: ${sampleImage}`)

const spec = createRemotionTimelineFixture({
  taskId: `v2_timeline_spec_${Date.now()}`,
  mainVideoSrc: sampleVideo,
  imageSrc: sampleImage,
  durationSec: 6,
  width: 720,
  height: 1280,
  fps: 24,
})

const report = validateRemotionTimelineSpec(spec)
assert.equal(report.ok, true, JSON.stringify(report.issues, null, 2))
assert.equal(report.summary.scene_count, 3)
assert.equal(report.summary.transition_count, 2)
assert.equal(report.summary.overlay_count, 3)
assert.equal(spec.render_policy.renderer, 'remotion_timeline')
assert.equal(spec.render_policy.allow_custom_component, false)

console.info('[smoke-v2-remotion-timeline-spec] OK')
