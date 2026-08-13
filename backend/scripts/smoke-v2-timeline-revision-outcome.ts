import assert from 'node:assert/strict'

import { validateRemotionTimelineSpec } from '../../shared/lib/remotion-timeline-validator.js'
import type { RemotionTimelineSpecV1 } from '../../shared/types/remotion-timeline-spec.v1.js'
import {
  buildV2TimelineFactDigest,
  buildDirectorTimelineFacts,
  buildV2TimelineOutcomeReviewPrompt,
  describeV2TimelineSpecDiff,
  evaluateV2TimelineRevisionCommit,
  reviewV2TimelineRevisionOutcome,
  verifyV2TimelinePendingResolution,
} from '../src/pipeline-v2/timeline-revision-outcome-review.js'
import { bindRenderComponentDisplayNames } from '../src/modules/render-components/component-registry.js'
import { applyV2TimelineRevisionScope } from '../src/pipeline-v2/timeline-revision-scope.js'

const base: RemotionTimelineSpecV1 = {
  schema_version: 'remotion_timeline_spec.v1',
  task_id: 'revision_outcome_smoke',
  canvas: { width: 1080, height: 1920, fps: 30, duration_sec: 15 },
  assets: [],
  scenes: [
    { id: 'scene_1', type: 'remotion_card', start_sec: 0, duration_sec: 5, title: 'Luma 夜光开场', visual_role: 'hook' },
    { id: 'scene_2', type: 'remotion_card', start_sec: 5, duration_sec: 5, title: '专注陪伴', visual_role: 'proof' },
    { id: 'scene_3', type: 'remotion_card', start_sec: 10, duration_sec: 5, title: '温和收束', visual_role: 'cta' },
  ],
  transitions: [
    { id: 't_1', from_scene_id: 'scene_1', to_scene_id: 'scene_2', type: 'fade', duration_sec: 0.3 },
    { id: 't_2', from_scene_id: 'scene_2', to_scene_id: 'scene_3', type: 'fade', duration_sec: 0.3 },
  ],
  overlays: [
    { id: 'caption_1', type: 'caption', scene_id: 'scene_1', start_sec: 0, end_sec: 4.6, x_pct: 50, y_pct: 82, width_pct: 78, max_lines: 2, text: '让夜晚更专注' },
    { id: 'caption_2', type: 'caption', scene_id: 'scene_2', start_sec: 5, end_sec: 9.6, x_pct: 50, y_pct: 82, width_pct: 78, max_lines: 2, text: '把光留给此刻' },
  ],
  material_jobs: [],
  audio: [],
  render_policy: { renderer: 'remotion_timeline' },
  notes: ['产品主题：Luma 智能桌面灯；蓝紫夜光与暖色桌面氛围。'],
}

assert.equal(buildV2TimelineFactDigest(base).visible_text.length, 2)
const realizedSpec: RemotionTimelineSpecV1 = {
  ...base,
  assets: [{ id: 'source_image', type: 'image', src: 'https://example.invalid/source.png', source: 'user_material' }],
  scenes: base.scenes.map((scene, index) => index === 0
    ? { ...scene, type: 'image_motion', asset_id: 'source_image', motion: 'slow_zoom_in' }
    : index === 1
      ? { ...scene, type: 'ai_video', asset_id: 'generated_scene_2' }
      : scene),
  material_jobs: [{
    id: 'generate_scene_2',
    scene_id: 'scene_2',
    type: 'generate_video',
    status: 'planned',
    input_asset_id: 'source_image',
    output_asset_id: 'generated_scene_2',
    prompt: 'generate visible motion',
  }],
}
const realizedDigest = buildV2TimelineFactDigest(realizedSpec)
assert.equal(realizedDigest.scenes[0]?.type, 'image_motion')
assert.equal(realizedDigest.scenes[0]?.motion, 'slow_zoom_in')
assert.equal(realizedDigest.scenes[1]?.material_jobs[0]?.type, 'generate_video')
assert.equal(realizedDigest.scenes[1]?.material_jobs[0]?.input_asset_id, 'source_image')
assert.equal(realizedDigest.scenes[0]?.caption_count, 1)
assert.equal(buildDirectorTimelineFacts(9, realizedSpec).scenes[1]?.materialJobs[0]?.outputAssetId, 'generated_scene_2')
const realizationPrompt = buildV2TimelineOutcomeReviewPrompt({
  prompt: 'Add a flying bird that is not present in the source image.',
  baseDigest: buildV2TimelineFactDigest(base),
  candidateDigest: realizedDigest,
  hasBase: true,
})
assert.match(realizationPrompt, /image_motion can only pan, zoom, or crop existing pixels/i)
assert.match(realizationPrompt, /remotion_card can fulfill only an intentional typography or motion-graphics scene/i)
assert.match(realizationPrompt, /generate_video/i)
assert.match(realizationPrompt, /input_asset_id/i)
assert.match(realizationPrompt, /subject, location, action, event, or prop/i)
assert.match(realizationPrompt, /visual_strategy/i)
assert.match(realizationPrompt, /reusing an unchanged generation request is incomplete/i)
const authorizedBoundaryPrompt = buildV2TimelineOutcomeReviewPrompt({
  prompt: 'Resize the timeline and update only the selected caption.',
  baseDigest: buildV2TimelineFactDigest(base),
  candidateDigest: buildV2TimelineFactDigest(base),
  hasBase: true,
  revisionScope: 'subtitle',
  revisionOverlayIds: ['caption_1'],
  revisionDurationMode: 'resize_timeline',
})
assert.match(authorizedBoundaryPrompt, /overlay_ids=caption_1/)
assert.match(authorizedBoundaryPrompt, /duration_mode=resize_timeline/)
assert.match(
  buildV2TimelineOutcomeReviewPrompt({
    prompt: '请围绕产品主题自由重写字幕，不要重复旧文案。',
    baseDigest: buildV2TimelineFactDigest(base),
    candidateDigest: buildV2TimelineFactDigest(base),
    hasBase: true,
  }),
  /old on-screen copy is intentionally replaceable/,
)

const initialPlanReview = await reviewV2TimelineRevisionOutcome({
  prompt: '生成一条 Luma 智能桌面灯的 15 秒竖屏商业短片。',
  candidateSpec: base,
  assess: async () => ({ pass: true, violations: [] }),
})
assert.equal(initialPlanReview.pass, true)
assert.equal(initialPlanReview.baseDigest.scenes.length, 0)

const pendingResolutionReview = await verifyV2TimelinePendingResolution({
  instruction: 'Replace the first caption with the requested safety message.',
  candidateSpec: base,
  assess: async ({ prompt, baseDigest }) => {
    assert.equal(prompt, 'Replace the first caption with the requested safety message.')
    assert.equal(baseDigest.scenes.length, 0, 'pending resolution checks final state without authorizing a second edit')
    return { pass: false, violations: [{ kind: 'missing_requested_change', message: 'caption is unchanged' }] }
  },
})
assert.equal(pendingResolutionReview.pass, false)

const unchangedRevisionReview = await reviewV2TimelineRevisionOutcome({
  prompt: '补充更具体的观众可见字幕。',
  baseSpec: base,
  candidateSpec: structuredClone(base),
  assess: async () => ({ pass: true, violations: [] }),
})
assert.equal(unchangedRevisionReview.pass, false)
assert.equal(unchangedRevisionReview.violations[0]?.kind, 'missing_requested_change')

const unrelatedOnlyCandidate = {
  ...base,
  scenes: base.scenes.map((scene, index) =>
    index === 0 ? { ...scene, title: 'Changed outside subtitle scope' } : scene),
}
assert.equal(evaluateV2TimelineRevisionCommit({
  baseSpec: base,
  candidateSpec: unrelatedOnlyCandidate,
  scope: 'subtitle',
}).ok, false)
const scopedSubtitleCandidate = applyV2TimelineRevisionScope({
  baseSpec: base,
  candidateSpec: {
    ...unrelatedOnlyCandidate,
    overlays: unrelatedOnlyCandidate.overlays.map((overlay, index) => ({
      ...overlay,
      text: index === 0 ? '新的观众字幕' : overlay.text,
    })),
  },
  scope: 'subtitle',
})
assert.equal(scopedSubtitleCandidate.scenes[0]?.title, base.scenes[0]?.title)
assert.equal(scopedSubtitleCandidate.overlays[0]?.text, '新的观众字幕')

const internalTextCandidate: RemotionTimelineSpecV1 = {
  ...base,
  overlays: base.overlays.map((overlay) => ({
    ...overlay,
    text: '字幕统一放在下方两行；不出现内部规划文字',
  })),
}
const internalTextReview = await reviewV2TimelineRevisionOutcome({
  prompt: '字幕统一放在下方两行；不出现内部规划文字。',
  baseSpec: base,
  candidateSpec: internalTextCandidate,
  assess: async () => ({
    pass: false,
    violations: [{ kind: 'visible_text_violation', message: '展示约束被错误写成了可见字幕。' }],
    repairInstruction: '保留原有创作字幕，只调整其位置与行数。',
  }),
})
assert.equal(internalTextReview.pass, false)
assert.equal(internalTextReview.violations[0]?.kind, 'visible_text_violation')

const scopeDriftCandidate: RemotionTimelineSpecV1 = {
  ...base,
  scenes: base.scenes.map((scene, index) => index === 0
    ? { ...scene, title: '自然风景展示' }
    : scene),
  notes: ['BGM 策略：克制的电子氛围，开头不喧宾夺主。'],
}
const scopeReview = await reviewV2TimelineRevisionOutcome({
  prompt: '加入克制的电子氛围 BGM 策略，开头不要喧宾夺主。',
  baseSpec: base,
  candidateSpec: scopeDriftCandidate,
  assess: async () => ({
    pass: false,
    violations: [{ kind: 'unrelated_change', message: '音频策略修订不应改写产品开场主题。' }],
    repairInstruction: '保留原镜头和字幕，仅更新音频策略说明。',
  }),
})
assert.equal(scopeReview.pass, false)
assert.equal(scopeReview.baseDigest.scenes[0]?.title, 'Luma 夜光开场')
assert.equal(scopeReview.candidateDigest.scenes[0]?.title, '自然风景展示')

const captionRewriteCandidate: RemotionTimelineSpecV1 = {
  ...base,
  overlays: base.overlays.map((overlay, index) => ({
    ...overlay,
    text: index === 0 ? '夜光留白，让专注自然发生' : '给此刻一点温度',
  })),
}
const captionRewriteReview = await reviewV2TimelineRevisionOutcome({
  prompt: '围绕夜光、专注、留白与温度自由创作字幕，不要复用旧文案。',
  baseSpec: base,
  candidateSpec: captionRewriteCandidate,
  assess: async () => ({ pass: true, violations: [] }),
})
assert.equal(captionRewriteReview.pass, true)
assert.notEqual(captionRewriteReview.candidateDigest.visible_text[0]?.text, base.overlays[0]?.text)

// Scene-scope merge must preserve base transition order; candidate may update
// in-scope content but cannot reorder the global transition sequence.
const reorderedTransitionsCandidate: RemotionTimelineSpecV1 = {
  ...base,
  transitions: [
    { ...base.transitions[1]!, type: 'flash' },
    { ...base.transitions[0]! },
  ],
}
const scopedSceneCandidate = applyV2TimelineRevisionScope({
  baseSpec: base,
  candidateSpec: reorderedTransitionsCandidate,
  scope: 'scene',
  sceneId: 'scene_2',
})
assert.deepEqual(
  scopedSceneCandidate.transitions.map((item) => `${item.from_scene_id}->${item.to_scene_id}:${item.type}`),
  ['scene_1->scene_2:fade', 'scene_2->scene_3:fade'],
  'scene scope must preserve transitions; transition edits use the transition scope',
)

// A style-only revision (caption background) is a real, deliverable change and
// must not be rejected by the "no change" guard even though the digest omits
// presentation fields.
const styleOnlyCandidate: RemotionTimelineSpecV1 = {
  ...base,
  overlays: base.overlays.map((overlay, index) =>
    index === 0 ? { ...overlay, background: 'rgba(0,0,0,0)' } : overlay),
}
const styleOnlyReview = await reviewV2TimelineRevisionOutcome({
  prompt: '把字幕嵌入框设为透明，不影响背景画面。',
  baseSpec: base,
  candidateSpec: styleOnlyCandidate,
  assess: async () => ({ pass: true, violations: [] }),
})
assert.equal(
  styleOnlyReview.pass,
  true,
  'style-only caption change must be recognized as a real revision',
)
const stylePrompt = buildV2TimelineOutcomeReviewPrompt({
  prompt: '把字幕嵌入框设为透明',
  baseDigest: buildV2TimelineFactDigest(base),
  candidateDigest: buildV2TimelineFactDigest(styleOnlyCandidate),
  hasBase: true,
  specDiff: describeV2TimelineSpecDiff(base, styleOnlyCandidate),
})
assert.match(stylePrompt, /Computed spec diff \(authoritative for field changes\)/)
assert.match(stylePrompt, /overlay\.caption_1\.background/)

// The review digest must project custom_render so the reviewer can see that a
// sedimented component implements the requested effect even when the preset
// transition type stays fade.
const customTransitionBase: RemotionTimelineSpecV1 = {
  ...base,
  transitions: [{ id: 't_custom', from_scene_id: 'scene_1', to_scene_id: 'scene_2', type: 'fade', duration_sec: 0.4 }],
}
const customTransitionSpec: RemotionTimelineSpecV1 = {
  ...customTransitionBase,
  transitions: [{
    id: 't_custom',
    from_scene_id: 'scene_1',
    to_scene_id: 'scene_2',
    type: 'fade',
    duration_sec: 0.4,
    custom_render: { component_id: 'cmp_blur_dissolve', params: {} },
  }],
}
const scopedCustomTransitionSpec = applyV2TimelineRevisionScope({
  baseSpec: customTransitionBase,
  candidateSpec: customTransitionSpec,
  scope: 'transition',
  transitionIds: ['t_custom'],
})
assert.equal(
  validateRemotionTimelineSpec(scopedCustomTransitionSpec).ok,
  true,
  'a scoped transition revision may add custom_render without a second policy flag',
)
assert.equal(
  buildV2TimelineFactDigest(customTransitionSpec).transitions[0]?.custom_render_component_id,
  'cmp_blur_dissolve',
  'review digest must expose custom_render component id',
)
const customTransitionPrompt = buildV2TimelineOutcomeReviewPrompt({
  prompt: 'Use the registered blur dissolve transition.',
  baseDigest: buildV2TimelineFactDigest(customTransitionBase),
  candidateDigest: buildV2TimelineFactDigest(customTransitionSpec),
  hasBase: true,
  availableComponents: [{
    id: 'cmp_blur_dissolve',
    purpose: 'transition',
    displayName: '模糊溶解',
    effectSummary: 'Blur dissolve transition implemented by the registered custom component.',
  }],
})
assert.match(customTransitionPrompt, /custom component defines the effective transition/i)
assert.match(customTransitionPrompt, /Blur dissolve transition implemented by the registered custom component/)
assert.match(customTransitionPrompt, /"fallback_preset":"fade"/)
const labeledCustomTransitionSpec = bindRenderComponentDisplayNames(customTransitionSpec, [{
  id: 'cmp_blur_dissolve',
  purpose: 'transition',
  displayName: '模糊溶解',
  effectSummary: 'Blur dissolve transition implemented by the registered custom component.',
}])
assert.equal(labeledCustomTransitionSpec.transitions[0]?.custom_render?.display_name, '模糊溶解')

// A scene creative-intent change must re-derive that scene's generation prompt,
// otherwise the edit never reaches the video-generation model.
const generationBase: RemotionTimelineSpecV1 = {
  ...base,
  scenes: base.scenes.map((scene, index) =>
    index === 1
      ? {
          ...scene,
          type: 'ai_video',
          creative_intent: { title: '专注陪伴', description: '旧场景描述' },
        }
      : scene),
  material_jobs: [{
    id: 'job_generate_scene_2',
    scene_id: 'scene_2',
    type: 'generate_video',
    status: 'planned',
    prompt: '旧生成提示词',
    output_asset_id: 'generated_scene_2',
  }],
}
const sceneIntentCandidate: RemotionTimelineSpecV1 = {
  ...generationBase,
  scenes: generationBase.scenes.map((scene, index) =>
    index === 1
      ? { ...scene, creative_intent: { title: '专注陪伴', description: '极限战士与圣血天使两种星际战士出场' } }
      : scene),
}
const scopedSceneGeneration = applyV2TimelineRevisionScope({
  baseSpec: generationBase,
  candidateSpec: sceneIntentCandidate,
  scope: 'scene',
  sceneId: 'scene_2',
})
assert.equal(
  scopedSceneGeneration.material_jobs[0]?.prompt,
  '极限战士与圣血天使两种星际战士出场；画面应连贯呈现主体、环境、光线、动作和镜头运动',
  'scene creative-intent revision must re-derive the generation prompt',
)
assert.doesNotMatch(scopedSceneGeneration.material_jobs[0]?.prompt ?? '', /proof|feature|镜头作用/)

const explicitScenePromptCandidate = structuredClone(sceneIntentCandidate)
explicitScenePromptCandidate.material_jobs[0] = {
  ...explicitScenePromptCandidate.material_jobs[0]!,
  prompt: 'Two armored figures enter a library while the camera tracks backward.',
}
const explicitScenePromptScoped = applyV2TimelineRevisionScope({
  baseSpec: generationBase,
  candidateSpec: explicitScenePromptCandidate,
  scope: 'scene',
  sceneId: 'scene_2',
})
assert.equal(
  explicitScenePromptScoped.material_jobs[0]?.prompt,
  'Two armored figures enter a library while the camera tracks backward.',
  'an explicit scene-generation prompt must survive the scene scope instead of being replaced by a generic template',
)

console.info('[smoke-v2-timeline-revision-outcome] OK')
