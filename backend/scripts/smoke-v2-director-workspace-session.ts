import assert from 'node:assert/strict'

import {
  applyDirectorWorkspacePatch,
  compactDirectorWorkspaceTurns,
  createDirectorWorkspaceState,
} from '../src/modules/director-agent/director-workspace-session.js'

const state = createDirectorWorkspaceState({
  context: {
    materials: [],
    userIntent: {
      goal: 'generate_timeline',
      constraints: ['字幕应根据画面内容创作，不复用素材文件名'],
    },
    slots: {
      sampleVideoStatus: 'missing',
      materialStatus: 'missing',
      contentDomain: 'general',
      aspectRatio: '9:16',
      durationSec: 15,
      styleIntensity: 'strong',
      subtitlePolicy: 'rewrite',
    },
  },
})

const preserved = applyDirectorWorkspacePatch(state, {
  context: { slots: { durationSec: undefined, styleIntensity: undefined } },
})
assert.equal(preserved.context.slots.durationSec, 15)
assert.equal(preserved.context.slots.styleIntensity, 'strong')

const cleared = applyDirectorWorkspacePatch(preserved, {
  context: { userIntent: { requestedStyle: null } },
})
assert.equal(cleared.context.userIntent.requestedStyle, undefined)

const withOutcome = applyDirectorWorkspacePatch(cleared, {
  draftId: 'draft_v2_1',
  baseRevision: 2,
  latestExecution: { action: 'REVISE_TIMELINE', outcome: 'preview completed', traceDir: 'trace_1' },
})
assert.equal(withOutcome.draftId, 'draft_v2_1')
assert.equal(withOutcome.baseRevision, 2)
assert.equal(withOutcome.latestExecution?.action, 'REVISE_TIMELINE')

const withTurns = {
  ...withOutcome,
  turns: Array.from({ length: 6 }, (_, index) => ({
    role: index % 2 ? ('assistant' as const) : ('user' as const),
    content: `第 ${index + 1} 轮：保留字幕应该根据画面内容创作这一要求。`,
    at: `2026-07-27T00:00:0${index}.000Z`,
  })),
}
const compacted = compactDirectorWorkspaceTurns(withTurns)
assert.equal(compacted.turns.length, 4)
assert.match(compacted.rollingSummary, /字幕应该根据画面内容创作/)
assert.match(compacted.context.userIntent.constraints?.join(' ') ?? '', /素材文件名/)

console.log('[smoke] V2 director workspace state contract passed')
