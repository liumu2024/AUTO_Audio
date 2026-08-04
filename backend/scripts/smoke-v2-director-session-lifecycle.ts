import assert from 'node:assert/strict'

import {
  ACTIVE_DIRECTOR_WORKSPACE_SESSION_KEY,
  LEGACY_DIRECTOR_WORKSPACE_SESSION_KEY,
  resolveActiveDirectorWorkspaceSessionId,
  restoreWorkspaceDraft,
  type WorkspaceSessionStorage,
} from '../../fonted/src/services/director/workspaceSessionLifecycle.js'
import { deliveryAuthorizationFromDirectorDecision } from '../src/pipeline-v2/agent-tools/authorization.js'

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

console.log('V2 director session lifecycle smoke passed')
