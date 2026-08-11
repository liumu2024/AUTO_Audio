import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import {
  applyDirectorRequirementChange,
  applyDirectorWorkspacePatch,
  compactDirectorWorkspaceContext,
  compactDirectorWorkspaceTurns,
  createDirectorWorkspaceState,
  hydrateDirectorWorkspaceState,
} from '../src/modules/director-agent/director-workspace-session.js'
import {
  createDirectorWorkspaceSessionRepository,
  DirectorWorkspaceRevisionConflictError,
} from '../src/modules/director-agent/director-workspace-session-repository.js'

const state = createDirectorWorkspaceState({
  context: {
    materials: [],
    userIntent: { goal: 'generate_timeline', constraints: ['字幕应根据画面内容创作，不复用素材文件名'] },
    slots: {
      sampleVideoStatus: 'missing',
      materialStatus: 'missing',
      contentDomain: 'general',
      aspectRatio: '9:16',
      durationSec: 15,
      styleIntensity: 'strong',
    },
  },
})
assert.equal(state.stateRevision, 0)
assert.deepEqual(state.context.userIntent, { goal: 'generate_timeline' })
assert.equal(state.confirmedRequirements.length, 1)
assert.equal(state.confirmedRequirements[0]?.statement, '字幕应根据画面内容创作，不复用素材文件名')
assert.equal(state.confirmedRequirements[0]?.sourceTurnId, 'initial_context')

const historicalDraftState = createDirectorWorkspaceState({
  context: {
    ...state.context,
    currentTimeline: {
      kind: 'v2_timeline',
      status: 'saved',
      draftId: 'draft_opened_from_history',
      currentRevision: 3,
      savedRevision: 3,
      sceneCount: 3,
    },
  },
})
assert.equal(historicalDraftState.draftId, 'draft_opened_from_history')
assert.equal(historicalDraftState.baseRevision, 3)

const preserved = applyDirectorWorkspacePatch(state, {
  context: { slots: { durationSec: undefined, styleIntensity: undefined } },
  recentVisualMaterialIds: ['material_mountain', 'material_river'],
})
assert.equal(preserved.context.slots.durationSec, 15)
assert.equal(preserved.context.slots.styleIntensity, 'strong')
assert.deepEqual(preserved.recentVisualMaterialIds, ['material_mountain', 'material_river'])
assert.deepEqual(
  compactDirectorWorkspaceContext(preserved).durableFacts.recentVisualMaterialIds,
  ['material_mountain', 'material_river'],
)
const hydratedLegacySubtitleState = hydrateDirectorWorkspaceState({
  ...preserved,
  context: {
    ...preserved.context,
    slots: { ...preserved.context.slots, subtitlePolicy: 'keep' } as typeof preserved.context.slots,
  },
})
assert.equal(hydratedLegacySubtitleState.stateRevision, 0)
assert.equal('subtitlePolicy' in hydratedLegacySubtitleState.context.slots, false)
const hydratedLegacySampleState = hydrateDirectorWorkspaceState({
  ...preserved,
  context: {
    ...preserved.context,
    sampleVideo: {
      id: 'legacy_sample', url: '/uploads/legacy.mp4',
      sampleUnderstanding: { schema_version: 'v2_sample_understanding.v1' } as never,
      reference: { source: 'sample_video', summary: 'legacy', segmentCount: 3, shotCount: 3 } as never,
    },
  },
})
assert.equal(hydratedLegacySampleState.context.sampleVideo?.url, '/uploads/legacy.mp4')
assert.equal(hydratedLegacySampleState.context.sampleVideo?.sampleUnderstanding, undefined)
assert.equal(hydratedLegacySampleState.context.sampleVideo?.reference, undefined)

const withOutcome = applyDirectorWorkspacePatch(preserved, {
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

const added = applyDirectorRequirementChange(compacted, {
  type: 'apply',
  operations: [
    { operation: 'add', statement: '目标受众为独居青年' },
    { operation: 'add', statement: '画面使用暖色调' },
  ],
}, 'turn_add')
assert.equal(added.ok, true)
assert.equal(added.changes.added.length, 2)
assert.equal(added.state.confirmedRequirements.filter((item) => item.status === 'active').length, 3)

const duplicate = applyDirectorRequirementChange(added.state, {
  type: 'apply', operations: [{ operation: 'add', statement: '  目标受众为独居青年  ' }],
}, 'turn_duplicate')
assert.equal(duplicate.ok, true)
assert.equal(duplicate.changes.unchanged.length, 1)
assert.equal(duplicate.state.confirmedRequirements.length, added.state.confirmedRequirements.length)

const warm = duplicate.state.confirmedRequirements.find((item) => item.statement === '画面使用暖色调')!
const replaced = applyDirectorRequirementChange(duplicate.state, {
  type: 'apply', operations: [{ operation: 'replace', targetRequirementId: warm.id, statement: '画面使用中性低饱和色调' }],
}, 'turn_replace')
assert.equal(replaced.ok, true)
assert.equal(replaced.changes.replaced.length, 1)
assert.equal(replaced.state.confirmedRequirements.find((item) => item.id === warm.id)?.status, 'superseded')
const neutral = replaced.state.confirmedRequirements.find((item) => item.status === 'active' && item.statement === '画面使用中性低饱和色调')!
assert.notEqual(neutral.id, warm.id)
assert.equal(neutral.sourceTurnId, 'turn_replace')
assert.equal(replaced.state.confirmedRequirements.find((item) => item.id === warm.id)?.supersededBy, neutral.id)

const audience = replaced.state.confirmedRequirements.find((item) => item.statement === '目标受众为独居青年')!
const revoked = applyDirectorRequirementChange(replaced.state, {
  type: 'apply', operations: [{ operation: 'revoke', targetRequirementId: audience.id }],
}, 'turn_revoke')
assert.equal(revoked.ok, true)
assert.equal(revoked.state.confirmedRequirements.find((item) => item.id === audience.id)?.status, 'revoked')

const rejected = applyDirectorRequirementChange(revoked.state, {
  type: 'apply', operations: [
    { operation: 'add', statement: '这一项必须随批次回滚' },
    { operation: 'revoke', targetRequirementId: 'req_missing' },
  ],
}, 'turn_rejected')
assert.equal(rejected.ok, false)
assert.deepEqual(rejected.state, revoked.state)
assert.equal(rejected.changes.rejected.length, 1)

const duplicateTarget = applyDirectorRequirementChange(revoked.state, {
  type: 'apply', operations: [
    { operation: 'replace', targetRequirementId: neutral.id, statement: '低饱和蓝灰色' },
    { operation: 'revoke', targetRequirementId: neutral.id },
  ],
}, 'turn_duplicate_target')
assert.equal(duplicateTarget.ok, false)
assert.deepEqual(duplicateTarget.state, revoked.state)

const emptyStatement = applyDirectorRequirementChange(revoked.state, {
  type: 'apply', operations: [{ operation: 'add', statement: '   ' }],
}, 'turn_empty')
assert.equal(emptyStatement.ok, false)
assert.deepEqual(emptyStatement.state, revoked.state)

const compactContext = compactDirectorWorkspaceContext(revoked.state)
assert.equal(compactContext.durableFacts.confirmedRequirements.some((item) => item.statement === '画面使用中性低饱和色调'), true)
assert.equal(compactContext.durableFacts.recentRequirementChanges.some((item) => item.statement === '画面使用暖色调'), true)

const sessionDir = mkdtempSync(path.join(os.tmpdir(), 'v2-director-workspace-cas-'))
const previousSessionDir = process.env.V2_DIRECTOR_SESSION_DIR
process.env.V2_DIRECTOR_SESSION_DIR = sessionDir
try {
  const repository = createDirectorWorkspaceSessionRepository()
  const initial = await repository.save({ id: 'workspace_cas', userId: 1, state, expectedStateRevision: 0 })
  const left = applyDirectorWorkspacePatch(initial.state, { responseId: 'response_left' })
  const right = applyDirectorWorkspacePatch(initial.state, { responseId: 'response_right' })
  const commits = await Promise.allSettled([
    repository.save({ id: initial.id, userId: 1, state: left, expectedStateRevision: 1 }),
    repository.save({ id: initial.id, userId: 1, state: right, expectedStateRevision: 1 }),
  ])
  assert.equal(commits.filter((item) => item.status === 'fulfilled').length, 1)
  const rejectedCommit = commits.find((item) => item.status === 'rejected')
  assert.equal(rejectedCommit?.status, 'rejected')
  assert.equal(rejectedCommit.status === 'rejected' && rejectedCommit.reason instanceof DirectorWorkspaceRevisionConflictError, true)
  assert.equal((await repository.get(initial.id, 1))?.state.stateRevision, 2)
} finally {
  if (previousSessionDir === undefined) delete process.env.V2_DIRECTOR_SESSION_DIR
  else process.env.V2_DIRECTOR_SESSION_DIR = previousSessionDir
  rmSync(sessionDir, { recursive: true, force: true })
}

console.log('[smoke] V2 director workspace state contract passed')
