import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import path from 'node:path'

import { validateRemotionTimelineSpec } from '../../shared/lib/remotion-timeline-validator.js'
import { buildDeterministicRemotionTimelineSpec } from '../src/pipeline-v2/remotion-timeline-planner.js'
import {
  buildV2TimelinePlanningReview,
  renderV2TimelinePlanningReviewMarkdown,
} from '../src/pipeline-v2/remotion-timeline-review.js'

const repoRoot = path.resolve(process.cwd(), '..')
const sampleVideo = path.join(repoRoot, 'example_videos', '9.mp4')
const sampleImage = path.join(repoRoot, 'example_videos', 'img', '1.png')

if (!existsSync(sampleVideo)) throw new Error(`Missing sample video: ${sampleVideo}`)
if (!existsSync(sampleImage)) throw new Error(`Missing sample image: ${sampleImage}`)

const spec = buildDeterministicRemotionTimelineSpec({
  taskId: `v2_timeline_planner_${Date.now()}`,
  prompt: '快速展示产品卖点',
  mainVideoPath: sampleVideo,
  imageSrc: sampleImage,
  durationSec: 6,
  canvas: { width: 720, height: 1280, fps: 24 },
})

const validation = validateRemotionTimelineSpec(spec)
assert.equal(validation.ok, true, JSON.stringify(validation.issues, null, 2))
assert.equal(spec.scenes.length, 3)
assert.equal(spec.render_policy.allow_custom_component, false)

const review = buildV2TimelinePlanningReview({ spec, validation })
const markdown = renderV2TimelinePlanningReviewMarkdown(review)
assert.equal(review.metrics.scene_count, 3)
assert.ok(markdown.includes('V2 Timeline 分镜审查'))
assert.ok(markdown.includes('Remotion'))

console.info('[smoke-v2-remotion-timeline-planner] OK')
