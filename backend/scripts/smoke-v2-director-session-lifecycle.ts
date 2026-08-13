import assert from 'node:assert/strict'

import {
  ACTIVE_DIRECTOR_WORKSPACE_SESSION_KEY,
  LEGACY_DIRECTOR_WORKSPACE_SESSION_KEY,
  replaceActiveDirectorWorkspaceSession,
  resolveActiveDirectorWorkspaceSessionId,
  restoreWorkspaceDraft,
  type WorkspaceSessionStorage,
} from '../../fonted/src/services/director/workspaceSessionLifecycle.js'
import {
  deliveryAuthorizationFromDirectorDecision,
  pendingDismissalAuthorizationFromDirectorDecision,
} from '../src/pipeline-v2/agent-tools/authorization.js'

class MemoryStorage implements WorkspaceSessionStorage {
  private readonly values = new Map<string, string>()

  getItem(key: string): string | null {
    return this.values.get(key) ?? null
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value)
  }

  removeItem(key: string): void {
    this.values.delete(key)
  }
}

const legacyStorage = new MemoryStorage()
const firstWindowStorage = new MemoryStorage()
legacyStorage.setItem(LEGACY_DIRECTOR_WORKSPACE_SESSION_KEY, 'v2_director_old_session')

const firstSessionId = resolveActiveDirectorWorkspaceSessionId({
  sessionStorage: firstWindowStorage,
  legacyStorage,
  createId: () => 'v2_director_new_session',
})
assert.equal(firstSessionId, 'v2_director_new_session')
assert.equal(legacyStorage.getItem(LEGACY_DIRECTOR_WORKSPACE_SESSION_KEY), null)
assert.equal(
  firstWindowStorage.getItem(ACTIVE_DIRECTOR_WORKSPACE_SESSION_KEY),
  firstSessionId,
)

const refreshedSessionId = resolveActiveDirectorWorkspaceSessionId({
  sessionStorage: firstWindowStorage,
  legacyStorage,
  createId: () => 'v2_director_should_not_be_used',
})
assert.equal(refreshedSessionId, firstSessionId)

const restartedWindowStorage = new MemoryStorage()
const restartedSessionId = resolveActiveDirectorWorkspaceSessionId({
  sessionStorage: restartedWindowStorage,
  legacyStorage,
  createId: () => 'v2_director_after_restart',
})
assert.equal(restartedSessionId, 'v2_director_after_restart')
assert.notEqual(restartedSessionId, firstSessionId)

const openedDraftSessionId = replaceActiveDirectorWorkspaceSession({
  sessionStorage: firstWindowStorage,
  createId: () => 'v2_director_opened_draft',
})
assert.equal(openedDraftSessionId, 'v2_director_opened_draft')
assert.equal(
  firstWindowStorage.getItem(ACTIVE_DIRECTOR_WORKSPACE_SESSION_KEY),
  openedDraftSessionId,
)

let restoredDraftId: string | undefined
const restored = await restoreWorkspaceDraft({
  workspace: { draftId: 'v2_draft_existing' },
  loadDraft: async (draftId) => ({
    draftId,
    revision: 3,
    spec: { schema_version: 'remotion_timeline_spec.v1' },
  }),
  openDraft: (draft) => {
    restoredDraftId = draft.draftId
  },
})
assert.equal(restored, true)
assert.equal(restoredDraftId, 'v2_draft_existing')

const draftAuthorization = deliveryAuthorizationFromDirectorDecision({
  prompt: '创建一版 15 秒暴雨通勤提醒短片，先出可编辑方案，不要渲染',
  intent: 'create',
  requestsDelivery: false,
})
assert.equal(draftAuthorization, undefined)

const deliveryAuthorization = deliveryAuthorizationFromDirectorDecision({
  prompt: '当前版本可以了，请直接导出 MP4',
  intent: 'execute',
  requestsDelivery: true,
})
assert.equal(deliveryAuthorization?.granted, true)
assert.equal(deliveryAuthorization?.evidence, '当前版本可以了，请直接导出 MP4')

const discussionAuthorization = deliveryAuthorizationFromDirectorDecision({
  prompt: '你觉得现在适合导出吗？',
  intent: 'chat',
  requestsDelivery: false,
})
assert.equal(discussionAuthorization, undefined)

const pendingDismissalAuthorization = pendingDismissalAuthorizationFromDirectorDecision({
  prompt: '放弃刚才失败的字幕修改，保留当前方案。',
  intent: 'revise',
  requestedCallId: 'pending_subtitle',
  pendingRevisions: [{ callId: 'pending_subtitle' }],
})
assert.equal(pendingDismissalAuthorization?.granted, true)
assert.equal(
  pendingDismissalAuthorization?.evidence,
  '放弃刚才失败的字幕修改，保留当前方案。',
)
assert.equal(pendingDismissalAuthorizationFromDirectorDecision({
  prompt: '放弃失败修改并渲染当前版本。',
  intent: 'execute',
  requestedCallId: 'pending_subtitle',
  pendingRevisions: [{ callId: 'pending_subtitle' }],
})?.granted, true)
assert.equal(pendingDismissalAuthorizationFromDirectorDecision({
  prompt: '这个失败了吗？',
  intent: 'chat',
  requestedCallId: 'pending_subtitle',
  pendingRevisions: [{ callId: 'pending_subtitle' }],
}), undefined)
assert.equal(pendingDismissalAuthorizationFromDirectorDecision({
  prompt: '继续修复刚才失败的字幕修改',
  intent: 'revise',
  requestedCallId: 'pending_subtitle',
  pendingRevisions: [{ callId: 'pending_subtitle' }],
}), undefined, 'a model-proposed dismissal is not authorization without user abandonment evidence')
assert.equal(pendingDismissalAuthorizationFromDirectorDecision({
  prompt: '不要放弃刚才失败的字幕修改，继续修复',
  intent: 'revise',
  requestedCallId: 'pending_subtitle',
  pendingRevisions: [{ callId: 'pending_subtitle' }],
}), undefined)
assert.equal(pendingDismissalAuthorizationFromDirectorDecision({
  prompt: '取消字幕背景，继续修复之前失败项',
  intent: 'revise',
  requestedCallId: 'pending_subtitle',
  pendingRevisions: [{ callId: 'pending_subtitle' }],
}), undefined, 'an unrelated cancellation must not authorize pending dismissal')
for (const prompt of [
  '我不想取消刚才失败的修改',
  '取消这个失败修改会怎样？',
  '如果取消这个失败修改，当前方案会怎样？',
  'do not cancel the failed edit',
  'what happens if I cancel the failed edit?',
  '我想知道如果取消失败修改会发生什么',
  'I wonder whether to cancel the failed edit',
]) {
  assert.equal(pendingDismissalAuthorizationFromDirectorDecision({
    prompt,
    intent: 'revise',
    requestedCallId: 'pending_subtitle',
    pendingRevisions: [{ callId: 'pending_subtitle' }],
  }), undefined, `non-affirmative dismissal must be rejected: ${prompt}`)
}
assert.equal(pendingDismissalAuthorizationFromDirectorDecision({
  prompt: '放弃之前失败的修改',
  intent: 'revise',
  requestedCallId: 'pending_subtitle',
  pendingRevisions: [{ callId: 'pending_subtitle' }, { callId: 'pending_transition' }],
}), undefined, 'multiple pending edits require clarification instead of model-selected deletion')
assert.equal(pendingDismissalAuthorizationFromDirectorDecision({
  prompt: '放弃之前失败的修改',
  intent: 'revise',
  requestedCallId: 'unknown_pending',
  pendingRevisions: [{ callId: 'pending_subtitle' }],
}), undefined)

console.log('V2 director session lifecycle smoke passed')
