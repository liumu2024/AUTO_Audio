import assert from 'node:assert/strict'

import type { RemotionTimelineSpecV1 } from '../../shared/types/remotion-timeline-spec.v1.js'
import {
  buildV2TimelineFactDigest,
  buildV2TimelineOutcomeReviewPrompt,
  evaluateV2TimelineRevisionCommit,
  reviewV2TimelineRevisionOutcome,
} from '../src/pipeline-v2/timeline-revision-outcome-review.js'
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
  render_policy: { renderer: 'remotion_timeline', allow_custom_component: false },
  notes: ['产品主题：Luma 智能桌面灯；蓝紫夜光与暖色桌面氛围。'],
}

assert.equal(buildV2TimelineFactDigest(base).visible_text.length, 2)
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

console.info('[smoke-v2-timeline-revision-outcome] OK')
