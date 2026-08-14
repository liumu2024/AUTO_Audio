import assert from 'node:assert/strict'

import { createRemotionTimelineFixture } from '../../shared/lib/remotion-timeline-fixtures.js'

const { buildV2TimelineRevisionIntent } = await import(
  '../src/pipeline-v2/timeline-revision-receipt.js'
)
const spec = createRemotionTimelineFixture({
  mainVideoSrc: '/fixtures/main.mp4',
  imageSrc: '/fixtures/image.png',
  durationSec: 10,
})

const subtitle = buildV2TimelineRevisionIntent({
  callId: 'call_subtitle',
  userRequest: '把第一条字幕改短，其他内容不变',
  arguments: {
    scope: 'subtitle',
    sceneId: 'scene_001',
    overlayIds: ['caption_001'],
    instruction: '把 overlay_001.end_sec 改短，保留 scene_001',
  },
  baseSpec: spec,
})
assert.deepEqual(subtitle, {
  callId: 'call_subtitle',
  originalRequest: '把第一条字幕改短，其他内容不变',
  scope: 'subtitle',
  targetDisplay: ['“Scene 1: user or generated video” · 0.3s–1.8s'],
  expectedImpact: '将调整 “Scene 1: user or generated video” · 0.3s–1.8s 的文字、时间或呈现方式',
  protectedBoundary: '未选中的字幕及作用域外对象保持不变',
})

const global = buildV2TimelineRevisionIntent({
  callId: 'call_global',
  userRequest: '整版推翻重做',
  arguments: { scope: 'global', mode: 'full_replan' },
})
assert.equal(global?.scope, 'global')
assert.equal('instruction' in (subtitle ?? {}), false)
assert.equal('targetIds' in (subtitle ?? {}), false)
assert.equal('globalMode' in (global ?? {}), false)
assert.equal('durationMode' in (subtitle ?? {}), false)

assert.equal(buildV2TimelineRevisionIntent({
  callId: 'not_patch',
  userRequest: 'render',
  arguments: {},
}), undefined)

console.info('[smoke-v2-timeline-revision-receipt] OK')
