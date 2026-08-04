import assert from 'node:assert/strict'

import { evaluateDirectorReplyQuality } from './v2-director-reply-quality-gate.js'

const baseInput = {
  label: '字幕讨论',
  prompt: '当前方案里的字幕会如何服务叙事？',
  assistantResponse: '字幕会围绕镜头叙事承担信息提示和情绪推进，不会复制镜头说明。',
  expected: {
    requiredFacts: ['当前方案', '字幕'],
  },
  currentFacts: ['当前已有 V2 草稿', '字幕不能复制镜头说明'],
}

const hardFailure = await evaluateDirectorReplyQuality({
  ...baseInput,
  assistantResponse: '我看不到当前内容，也不了解你的方案。',
  judge: async () => ({ pass: true, failure_kind: 'none', reason: 'unused', relevance_score: 1 }),
})
assert.equal(hardFailure.pass, false)
assert.equal(hardFailure.failureKind, 'capability_refusal')
assert.equal(hardFailure.judgeUsage.calls, 1)

const judgeFailure = await evaluateDirectorReplyQuality({
  ...baseInput,
  judge: async () => ({ pass: false, failure_kind: 'off_topic', reason: '回答没有处理字幕问题', relevance_score: 0.1 }),
})
assert.equal(judgeFailure.pass, false)
assert.equal(judgeFailure.failureKind, 'off_topic')

const pass = await evaluateDirectorReplyQuality({
  ...baseInput,
  judge: async () => ({ pass: true, failure_kind: 'none', reason: '回答直接回应了问题', relevance_score: 0.93 }),
})
assert.equal(pass.pass, true)

console.log('[smoke] V2 director reply quality gate passed')
