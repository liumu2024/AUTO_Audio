import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import path from 'node:path'

import { validateRemotionTimelineSpec } from '../../shared/lib/remotion-timeline-validator.js'
import { normalizeV2TimelineTextOwnership } from '../../shared/lib/remotion-timeline-text-ownership.js'
import { buildDeterministicRemotionTimelineSpec } from '../src/pipeline-v2/remotion-timeline-planner.js'
import {
  buildV2TimelinePlanningReview,
  renderV2TimelinePlanningReviewMarkdown,
} from '../src/pipeline-v2/remotion-timeline-review.js'
import {
  applyV2TimelineRevisionPreservation,
  buildV2TimelineRevisionContext,
} from '../src/pipeline-v2/timeline-revision-context.js'

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

const imageFallback = buildDeterministicRemotionTimelineSpec({
  taskId: `v2_timeline_caption_fallback_${Date.now()}`,
  creationMode: 'material_brief',
  prompt: '根据现有图片安排一版可编辑方案。',
  materials: [{ id: 'image_1', name: '4.png', type: 'image', src: sampleImage }],
})
assert.equal(
  imageFallback.overlays.some((overlay) => overlay.text?.includes('4.png')),
  false,
  'A deterministic fallback must not turn image metadata into on-screen captions.',
)
assert.ok(
  imageFallback.scenes.every(
    (scene) =>
      scene.type !== 'image_motion' ||
      (!scene.title && !scene.subtitle && !scene.body && scene.creative_intent?.material_label),
  ),
  'Visual-scene material metadata must stay in creative_intent, not scene text fields.',
)

const repairedModelSpec = normalizeV2TimelineTextOwnership({
  ...imageFallback,
  scenes: imageFallback.scenes.map((scene, index) =>
    index === 0
      ? {
          ...scene,
          title: '镜头说明',
          subtitle: '4.png',
          body: '这是一段仅供编辑器审阅的镜头说明。',
        }
      : scene,
  ),
  overlays: [
    {
      id: 'model_caption_without_geometry',
      type: 'caption',
      scene_id: imageFallback.scenes[0]!.id,
      start_sec: imageFallback.scenes[0]!.start_sec,
      end_sec: Number.NaN,
      text: '模型给出的字幕',
      x_pct: Number.NaN,
      y_pct: Number.NaN,
    },
  ],
})
const repairedFirstScene = repairedModelSpec.scenes[0]!
assert.equal(repairedFirstScene.title, undefined)
assert.equal(repairedFirstScene.subtitle, undefined)
assert.equal(repairedFirstScene.body, undefined)
assert.equal(repairedFirstScene.creative_intent?.material_label, '4.png')
assert.equal(repairedModelSpec.overlays[0]?.text, '模型给出的字幕')
assert.equal(validateRemotionTimelineSpec(repairedModelSpec).ok, true)

const baseRevisionSpec = {
  ...spec,
  scenes: spec.scenes.map((scene, index) =>
    index === 0 ? { ...scene, note: '首镜必须保留安静的开场停顿。' } : scene,
  ),
}
const revisionContext = buildV2TimelineRevisionContext({
  draftId: 'draft_smoke',
  baseRevision: 7,
  spec: baseRevisionSpec,
  selectedClipId: `v2-scene-${baseRevisionSpec.scenes[0]!.id}`,
})
assert.equal(revisionContext.base_revision, 7)
assert.deepEqual(revisionContext.selected_item, {
  kind: 'scene',
  id: baseRevisionSpec.scenes[0]!.id,
})
assert.equal(revisionContext.timeline.scenes[0]?.note, '首镜必须保留安静的开场停顿。')

const preservedRevision = applyV2TimelineRevisionPreservation({
  baseSpec: baseRevisionSpec,
  nextSpec: {
    ...baseRevisionSpec,
    scenes: baseRevisionSpec.scenes.map((scene, index) =>
      index === 0 ? { ...scene, note: undefined } : scene,
    ),
  },
  baseRevision: 7,
})
assert.equal(preservedRevision.spec.scenes[0]?.note, '首镜必须保留安静的开场停顿。')
assert.deepEqual(preservedRevision.audit.preserved_scene_notes, [baseRevisionSpec.scenes[0]!.id])

const review = buildV2TimelinePlanningReview({ spec, validation })
const markdown = renderV2TimelinePlanningReviewMarkdown(review)
assert.equal(review.metrics.scene_count, 3)
assert.ok(markdown.includes('V2 Timeline 分镜审查'))
assert.ok(markdown.includes('Remotion'))

console.info('[smoke-v2-remotion-timeline-planner] OK')
