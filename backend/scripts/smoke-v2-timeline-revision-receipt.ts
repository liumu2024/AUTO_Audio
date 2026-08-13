import assert from 'node:assert/strict'

const { buildV2TimelineRevisionIntent } = await import(
  '../src/pipeline-v2/timeline-revision-receipt.js'
)

const subtitle = buildV2TimelineRevisionIntent({
  callId: 'call_subtitle',
  userRequest: '把第一条字幕改短，其他内容不变',
  arguments: {
    scope: 'subtitle',
    sceneId: 'scene_001',
    overlayIds: ['overlay_001'],
    instruction: '把第一条字幕改短，其他内容不变',
  },
})
assert.deepEqual(subtitle, {
  callId: 'call_subtitle',
  originalRequest: '把第一条字幕改短，其他内容不变',
  instruction: '把第一条字幕改短，其他内容不变',
  scope: 'subtitle',
  targetIds: ['overlay_001'],
  expectedImpact: '目标字幕的文字、时间或呈现方式',
  protectedBoundary: '未选中的字幕及作用域外对象保持不变',
})

const global = buildV2TimelineRevisionIntent({
  callId: 'call_global',
  userRequest: '整版推翻重做',
  arguments: { scope: 'global', mode: 'full_replan' },
})
assert.equal(global?.globalMode, 'full_replan')
assert.equal(global?.targetIds.length, 0)

assert.equal(buildV2TimelineRevisionIntent({
  callId: 'not_patch',
  userRequest: 'render',
  arguments: {},
}), undefined)

console.info('[smoke-v2-timeline-revision-receipt] OK')
