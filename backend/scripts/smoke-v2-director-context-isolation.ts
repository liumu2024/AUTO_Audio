import assert from 'node:assert/strict'

import { compactDirectorContextForPrompt } from '../src/modules/director-agent/llm-intent-router.ts'
import { createDefaultDirectorSlots } from '../../shared/lib/director-understanding.js'
import { createInitialDirectorSessionState } from '../../shared/lib/director-state-machine.js'
import type { DirectorContext } from '../../shared/types/director-context.js'

const state = createInitialDirectorSessionState()
const v2Context: DirectorContext & { staleLegacyPayload?: unknown } = {
  materials: [],
  userIntent: { goal: 'generate_video' },
  slots: createDefaultDirectorSlots(),
  // An untyped stale payload must never reach a V2 prompt.
  staleLegacyPayload: { legacy_plan_sentinel: 'must-not-serialize' },
  currentTimeline: {
    kind: 'v2_timeline',
    status: 'saved',
    draftId: 'draft_v2',
    currentRevision: 3,
    savedRevision: 3,
    sceneCount: 2,
  },
  directorState: {
    ...state,
    timeline: {
      kind: 'v2_timeline',
      status: 'saved',
      draftId: 'draft_v2',
      currentRevision: 3,
      savedRevision: 3,
    },
  },
  conversationSummary: 'legacy_outline_sentinel',
}

const v2Compact = compactDirectorContextForPrompt({
  prompt: 'render the current draft',
  context: v2Context,
  runtime: {
    backendEnabled: true,
    hasV2Timeline: true,
  },
})

assert.equal('currentEditablePlan' in v2Compact, false)
assert.equal('conversationSummary' in v2Compact, false)
assert.equal(JSON.stringify(v2Compact).includes('legacy_plan_sentinel'), false)
assert.equal(v2Compact.conversationMemory, 'legacy_outline_sentinel')
assert.equal(v2Compact.currentEditableTimeline?.kind, 'v2_timeline')
assert.equal(v2Compact.currentEditableTimeline?.currentRevision, 3)

console.info('[smoke-v2-director-context-isolation] OK')
