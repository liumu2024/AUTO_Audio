import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import path from 'node:path'

import { createRemotionTimelineFixture } from '../../shared/lib/remotion-timeline-fixtures.js'
import { validateRemotionTimelineSpec } from '../../shared/lib/remotion-timeline-validator.js'
import { assertV2TimelinePlanningComplete } from '../src/pipeline-v2/timeline-planning-gaps.js'

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

const imageAsset = spec.assets.find((asset) => asset.type === 'image')!
const planningGapSpec = {
  ...structuredClone(spec),
  creative_brief: {
    direction: 'Preserve the requested direction while image planning is repaired.',
    image_references: [{
      asset_id: imageAsset.id,
      observed_facts: [],
      intended_use: 'Use as a faithful visual reference.',
    }],
    sample_methods: [],
    applied_preferences: [],
    planning_gaps: [{ area: 'image_understanding' as const, message: 'Image facts are not available yet.' }],
  },
}
assert.equal(validateRemotionTimelineSpec(planningGapSpec).ok, true)
assert.throws(() => assertV2TimelinePlanningComplete(planningGapSpec), /planning gaps/i)
const invalidBrief = structuredClone(planningGapSpec)
invalidBrief.creative_brief.image_references[0]!.asset_id = 'model_invented_asset'
assert.equal(validateRemotionTimelineSpec(invalidBrief).ok, false)

const videoAsset = spec.assets.find((asset) => asset.type === 'video')!
const conditionedSpec = structuredClone(planningGapSpec)
conditionedSpec.creative_brief.image_references = []
conditionedSpec.scenes[0] = {
  ...conditionedSpec.scenes[0]!,
  type: 'ai_video',
  asset_id: videoAsset.id,
  creative_intent: { description: 'Preserve the visible source image identity while adding motion.' },
}
conditionedSpec.material_jobs = [{
  id: 'conditioned_job',
  scene_id: conditionedSpec.scenes[0]!.id,
  type: 'generate_video',
  status: 'fulfilled',
  prompt: 'Animate the visible source subject.',
  input_asset_id: imageAsset.id,
  output_asset_id: videoAsset.id,
}]
const missingConditionedReference = validateRemotionTimelineSpec(conditionedSpec)
assert.equal(missingConditionedReference.ok, false)
assert.ok(missingConditionedReference.issues.some((issue) => issue.path === 'creative_brief.image_references'))
conditionedSpec.creative_brief.image_references = planningGapSpec.creative_brief.image_references
assert.equal(validateRemotionTimelineSpec(conditionedSpec).ok, true)

const unknownRenderPolicySpec = structuredClone(spec) as unknown as {
  render_policy: Record<string, unknown>
}
unknownRenderPolicySpec.render_policy.obsolete_policy_flag = true
const unknownRenderPolicyReport = validateRemotionTimelineSpec(unknownRenderPolicySpec)
assert.equal(unknownRenderPolicyReport.ok, false)
assert.match(unknownRenderPolicyReport.issues.map((issue) => issue.path).join(','), /obsolete_policy_flag/)

console.info('[smoke-v2-remotion-timeline-spec] OK')
