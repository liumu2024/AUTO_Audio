import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import path from 'node:path'

import { validateRemotionTimelineSpec } from '../../shared/lib/remotion-timeline-validator.js'
import { normalizeV2TimelineTextOwnership } from '../../shared/lib/remotion-timeline-text-ownership.js'
import {
  applyV2TimelineHardRequirements,
  extractV2TimelineHardRequirements,
} from '../src/pipeline-v2/hard-requirements.js'
import { buildDeterministicRemotionTimelineSpec } from '../src/pipeline-v2/remotion-timeline-planner.js'
import {
  buildV2TimelinePlanningReview,
  renderV2TimelinePlanningReviewMarkdown,
} from '../src/pipeline-v2/remotion-timeline-review.js'
import {
  buildV2TimelinePlannerPrompt,
  repairV2LlmGeneratedMaterialPrompts,
} from '../src/pipeline-v2/remotion-timeline-llm-planner.js'
import {
  applyV2TimelineRevisionPreservation,
  buildV2TimelineRevisionContext,
} from '../src/pipeline-v2/timeline-revision-context.js'
import { hydrateV2TimelineAssetIds } from '../src/pipeline-v2/timeline-asset-id-hydration.js'

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

const activeRequirementPrompt = buildV2TimelinePlannerPrompt({
  taskId: 'active_requirement_context',
  prompt: '按当前有效要求规划',
  planningContext: {
    kind: 'revision',
    activeRequirements: ['画面使用中性低饱和色调'],
    recalledCreativeMemories: ['品牌表达可靠但不冰冷'],
  },
})
assert.match(activeRequirementPrompt, /画面使用中性低饱和色调/)
assert.match(activeRequirementPrompt, /activeRequirements is authoritative/)
assert.match(activeRequirementPrompt, /品牌表达可靠但不冰冷/)
assert.match(activeRequirementPrompt, /current request and activeRequirements take priority/)
assert.match(activeRequirementPrompt, /applied_preferences/)
assert.match(activeRequirementPrompt, /only exact statements.*actually adopted/i)

const availableComponentPrompt = buildV2TimelinePlannerPrompt({
  taskId: 'component_hint_context',
  prompt: '第二三镜头间使用模糊溶解过渡',
  availableComponents: [{ id: 'cmp_blur_dissolve', purpose: 'transition', displayName: '模糊溶解', effectSummary: '模糊溶解过渡：前一镜头模糊消失' }],
})
assert.match(availableComponentPrompt, /cmp_blur_dissolve/)
assert.match(availableComponentPrompt, /Available registered render capabilities/)
assert.match(availableComponentPrompt, /implementation candidates, not recommendations/i)
assert.match(availableComponentPrompt, /Decide the intended effect before choosing/i)
assert.match(availableComponentPrompt, /source, list order, and preset-versus-component origin do not imply priority/i)
assert.match(availableComponentPrompt, /custom_render/)

const validation = validateRemotionTimelineSpec(spec)
assert.equal(validation.ok, true, JSON.stringify(validation.issues, null, 2))
assert.deepEqual(spec.creative_brief?.applied_preferences, [])
assert.equal(spec.scenes.length, 3)

const malformedAudioSpec = { ...spec, audio: {} } as unknown as typeof spec
const malformedAudioValidation = validateRemotionTimelineSpec(malformedAudioSpec)
assert.equal(malformedAudioValidation.ok, false)
assert.ok(malformedAudioValidation.issues.some((issue) => issue.path === 'audio'))

const imageFallback = buildDeterministicRemotionTimelineSpec({
  taskId: `v2_timeline_caption_fallback_${Date.now()}`,
  creationMode: 'material_brief',
  prompt: '根据现有图片安排一版可编辑方案。',
  materials: [{ id: 'mat_image_1', name: '4.png', type: 'image', src: sampleImage }],
})
assert.deepEqual(
  imageFallback.assets.map((asset) => asset.id),
  ['mat_image_1'],
  'New plans must keep the server-owned material ID instead of inventing a second planner ID.',
)
assert.equal(
  imageFallback.assets.some((asset) => asset.id.startsWith('material_') || asset.id === 'planner_image_asset'),
  false,
)

const hydratedLegacyAsset = hydrateV2TimelineAssetIds({
  ...imageFallback,
  creative_brief: {
    direction: 'legacy fixture',
    sample_methods: [],
    applied_preferences: [],
    image_references: [{
      asset_id: 'material_01_mat_image_1',
      observed_facts: ['legacy fact'],
      intended_use: 'legacy use',
    }],
  },
  assets: [{
    ...imageFallback.assets[0]!,
    id: 'material_01_mat_image_1',
  }],
  scenes: imageFallback.scenes.map((scene, index) =>
    index === 0 ? { ...scene, asset_id: 'material_01_mat_image_1' } : scene),
  material_jobs: imageFallback.material_jobs.map((job, index) =>
    index === 0
      ? { ...job, input_asset_id: 'material_01_mat_image_1', output_asset_id: 'material_01_mat_image_1' }
      : job),
}, {
  taskId: 'legacy-hydration',
  prompt: 'legacy hydration',
  materials: [{ id: 'mat_image_1', type: 'image', src: sampleImage }],
})
assert.deepEqual(hydratedLegacyAsset.assets.map((asset) => asset.id), ['mat_image_1'])
assert.equal(hydratedLegacyAsset.scenes[0]?.asset_id, 'mat_image_1')
assert.equal(hydratedLegacyAsset.material_jobs[0]?.input_asset_id, 'mat_image_1')
assert.equal(hydratedLegacyAsset.material_jobs[0]?.output_asset_id, 'mat_image_1')
assert.equal(hydratedLegacyAsset.creative_brief?.image_references[0]?.asset_id, 'mat_image_1')

const ambiguousLegacyAsset = hydrateV2TimelineAssetIds({
  ...imageFallback,
  assets: [{ ...imageFallback.assets[0]!, id: 'planner_image_asset', src: 'legacy://unknown' }],
  scenes: imageFallback.scenes.map((scene, index) =>
    index === 0 ? { ...scene, asset_id: 'planner_image_asset' } : scene),
}, {
  taskId: 'ambiguous-hydration',
  prompt: 'ambiguous hydration',
  materials: [
    { id: 'mat_image_1', type: 'image', src: sampleImage },
    { id: 'mat_image_2', type: 'image', src: `${sampleImage}.other` },
  ],
})
assert.equal(ambiguousLegacyAsset.assets[0]?.id, 'planner_image_asset')
assert.equal(ambiguousLegacyAsset.scenes[0]?.asset_id, 'planner_image_asset')
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
      animation: 'zoom_in',
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
assert.equal(repairedModelSpec.overlays[0]?.animation, 'fade')
assert.equal(validateRemotionTimelineSpec(repairedModelSpec).ok, true)

const captionLineLimit = normalizeV2TimelineTextOwnership({
  ...repairedModelSpec,
  overlays: repairedModelSpec.overlays.map((overlay) => ({
    ...overlay,
    max_lines: 2,
  })),
})
assert.equal(captionLineLimit.overlays[0]?.max_lines, 2)
assert.equal(validateRemotionTimelineSpec(captionLineLimit).ok, true)
const invalidCaptionLineLimit = validateRemotionTimelineSpec({
  ...captionLineLimit,
  overlays: captionLineLimit.overlays.map((overlay) => ({ ...overlay, max_lines: 0 })),
})
assert.equal(invalidCaptionLineLimit.ok, false)
assert.ok(invalidCaptionLineLimit.issues.some((issue) => issue.path.endsWith('.max_lines')))

const missingPromptSpec = buildDeterministicRemotionTimelineSpec({
  taskId: `v2_timeline_missing_material_prompt_${Date.now()}`,
  creationMode: 'text_to_video',
  prompt: '生成一版不依赖用户素材的科技招生短片。',
  durationSec: 6,
})
const missingPromptRepair = repairV2LlmGeneratedMaterialPrompts({
  ...missingPromptSpec,
  material_jobs: missingPromptSpec.material_jobs.map((job) =>
    job.type === 'generate_video' ? { ...job, prompt: undefined } : job,
  ),
})
assert.ok(missingPromptRepair.repairs.length > 0)
assert.ok(
  missingPromptRepair.spec.material_jobs
    .filter((job) => job.type === 'generate_video')
    .every((job) => Boolean(job.prompt?.trim())),
  'Recoverable missing generation prompts must be derived from their linked scene intent.',
)
assert.equal(validateRemotionTimelineSpec(missingPromptRepair.spec).ok, true)
const staleExecutionStatusRepair = repairV2LlmGeneratedMaterialPrompts({
  ...missingPromptSpec,
  material_jobs: missingPromptSpec.material_jobs.map((job) =>
    job.type === 'generate_video' ? { ...job, status: 'fulfilled' as const } : job),
})
assert.ok(
  staleExecutionStatusRepair.spec.material_jobs
    .filter((job) => job.type === 'generate_video')
    .every((job) => job.status === 'planned'),
  'The planner must not declare unresolved generation work fulfilled.',
)
assert.ok(staleExecutionStatusRepair.repairs.some((repair) => repair.field === 'status'))
assert.equal(validateRemotionTimelineSpec(staleExecutionStatusRepair.spec).ok, true)

const stagedAiVideoReview = buildV2TimelinePlanningReview({
  spec: missingPromptRepair.spec,
  validation: validateRemotionTimelineSpec(missingPromptRepair.spec),
})
assert.ok(stagedAiVideoReview.metrics.planned_ai_video_scene_count > 0)
assert.equal(
  stagedAiVideoReview.metrics.remotion_preview_fallback_scene_count,
  stagedAiVideoReview.metrics.planned_ai_video_scene_count,
  'Unresolved generate_video jobs must be reported as preview fallbacks, not pure Remotion scenes.',
)
assert.equal(stagedAiVideoReview.metrics.remotion_scene_count, 0)
assert.ok(renderV2TimelinePlanningReviewMarkdown(stagedAiVideoReview).includes('当前 Remotion 兜底镜头'))

const unsupportedAudioRepair = repairV2LlmGeneratedMaterialPrompts({
  ...missingPromptSpec,
  assets: [{ id: 'planned_bgm', type: 'audio', src: '', source: 'generated_asset' }],
  audio: [{ id: 'planned_bgm_clip', asset_id: 'planned_bgm', start_sec: 0, end_sec: 6 }],
  material_jobs: [
    ...missingPromptSpec.material_jobs,
    { id: 'generate_bgm', scene_id: missingPromptSpec.scenes[0]!.id, type: 'generate_video', status: 'planned', output_asset_id: 'planned_bgm' },
  ],
})
assert.equal(unsupportedAudioRepair.spec.assets.some((asset) => asset.id === 'planned_bgm'), false)
assert.equal(unsupportedAudioRepair.spec.audio?.some((clip) => clip.asset_id === 'planned_bgm'), false)
assert.equal(unsupportedAudioRepair.spec.material_jobs.some((job) => job.id === 'generate_bgm'), false)
assert.ok(unsupportedAudioRepair.repairs.some((repair) => repair.field === 'audio'))
assert.equal(validateRemotionTimelineSpec(unsupportedAudioRepair.spec).ok, true)

const metadataCaption = normalizeV2TimelineTextOwnership({
  ...imageFallback,
  overlays: [
    {
      id: 'caption_from_material_label',
      type: 'caption',
      scene_id: imageFallback.scenes[0]!.id,
      start_sec: 0,
      end_sec: 1,
      text: '4.png',
      x_pct: 50,
      y_pct: 80,
      width_pct: 84,
    },
  ],
})
assert.equal(metadataCaption.overlays.length, 0)

const explicitMetadataCaption = applyV2TimelineHardRequirements({
  spec: metadataCaption,
  requirements: extractV2TimelineHardRequirements('字幕显示“4.png”'),
})
assert.equal(explicitMetadataCaption.overlays.some((overlay) => overlay.text === '4.png'), true)

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
})
assert.deepEqual(revisionContext.timeline.creative_brief, baseRevisionSpec.creative_brief)
assert.equal(revisionContext.timeline.material_jobs[0]?.prompt, baseRevisionSpec.material_jobs[0]?.prompt)
assert.equal(revisionContext.base_revision, 7)
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
