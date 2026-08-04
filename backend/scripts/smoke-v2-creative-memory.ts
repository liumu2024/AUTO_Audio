import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const dataDir = mkdtempSync(path.join(os.tmpdir(), 'v2-creative-memory-'))
process.env.DPL304_LOCAL_MODE = 'true'
process.env.DPL304_LOCAL_DATA_DIR = dataDir

try {
  const {
    applyCreativeMemoryActions,
    createCreativeMemory,
    listCreativeMemories,
    searchCreativeMemories,
    updateCreativeMemory,
  } = await import('../src/modules/creative-memory/creative-memory.service.js')
  const { prisma } = await import('../src/shared/prisma.service.js')
  for (const id of ['draft_alpha', 'draft_beta']) {
    await prisma.v2TimelineDraft.create({
      data: {
        id,
        userId: 1,
        creationMode: 'text_to_video',
        plannerInputJson: {},
        specJson: {},
      },
    })
  }

  const neutral = await createCreativeMemory({
    userId: 1,
    scopeType: 'user',
    statement: '画面整体偏好中性低饱和色调',
    status: 'active',
    origin: 'explicit',
    sourceWorkspaceSessionId: 'workspace_memory_smoke',
    sourceTurnIds: ['turn_1'],
    sourceExcerpt: '我通常喜欢中性低饱和的画面。',
  })
  const draftCaption = await createCreativeMemory({
    userId: 1,
    scopeType: 'draft',
    draftId: 'draft_alpha',
    statement: '字幕只保留关键信息',
    status: 'active',
    origin: 'explicit',
    sourceWorkspaceSessionId: 'workspace_memory_smoke',
    sourceTurnIds: ['turn_2'],
    sourceExcerpt: '这条片的字幕只保留关键信息。',
  })
  const betaTransition = await createCreativeMemory({
    userId: 1,
    scopeType: 'draft',
    draftId: 'draft_beta',
    statement: '使用快速闪烁转场',
    status: 'active',
    origin: 'explicit',
    sourceWorkspaceSessionId: 'workspace_memory_smoke',
    sourceTurnIds: ['turn_3'],
    sourceExcerpt: '另一条片使用快速闪烁转场。',
  })
  const candidate = await createCreativeMemory({
    userId: 1,
    scopeType: 'user',
    statement: '旁白可能偏好冷静克制',
    status: 'candidate',
    origin: 'inferred',
    sourceWorkspaceSessionId: 'workspace_memory_smoke',
    sourceTurnIds: ['turn_4'],
    sourceExcerpt: '这次旁白冷静一点。',
  })

  const captionSearch = await searchCreativeMemories({
    userId: 1,
    draftId: 'draft_alpha',
    query: '继续调整字幕，只保留关键信息',
  })
  assert.equal(captionSearch.active[0]?.memory.id, draftCaption.id)
  assert.equal(captionSearch.active.some((item) => item.memory.draftId === 'draft_beta'), false)
  assert.equal(captionSearch.audit.some((item) => item.reason === 'scope_filtered'), true)
  assert.equal(captionSearch.active.length <= 8, true)
  assert.deepEqual(
    [...captionSearch.active].sort((a, b) => b.score - a.score || a.memory.id.localeCompare(b.memory.id)),
    captionSearch.active,
  )

  const candidateSearch = await searchCreativeMemories({
    userId: 1,
    draftId: 'draft_alpha',
    query: '旁白可能偏好冷静克制',
  })
  assert.equal(candidateSearch.candidate[0]?.memory.id, candidate.id)
  assert.equal(candidateSearch.active.some((item) => item.memory.id === candidate.id), false)

  const explicitActive = await applyCreativeMemoryActions({
    userId: 1,
    workspaceSessionId: 'workspace_memory_smoke',
    currentTurnId: 'turn_explicit_active',
    actions: [{
      ref: 'explicit_active',
      operation: 'add',
      scopeType: 'user',
      statement: '标题使用白色粗体',
      status: 'active',
      origin: 'explicit',
      sourceTurnIds: ['turn_explicit_active'],
    }],
  })
  assert.equal(explicitActive[0].status, 'succeeded')
  assert.equal(
    (await listCreativeMemories({ userId: 1 })).find((item) => item.id === explicitActive[0].memoryId)?.status,
    'active',
  )

  const crossSessionNearDuplicate = await applyCreativeMemoryActions({
    userId: 1,
    workspaceSessionId: 'workspace_memory_other',
    currentTurnId: 'turn_cross_session',
    actions: [{
      ref: 'cross_session',
      operation: 'add',
      scopeType: 'user',
      statement: '画面整体偏爱中性低饱和的色彩',
      status: 'active',
      origin: 'explicit',
      sourceTurnIds: ['turn_cross_session'],
    }],
  })
  assert.equal(crossSessionNearDuplicate[0].status, 'succeeded')
  assert.equal(
    (await listCreativeMemories({ userId: 1 })).find((item) => item.id === crossSessionNearDuplicate[0].memoryId)?.status,
    'candidate',
  )

  const inferredActive = await applyCreativeMemoryActions({
    userId: 1,
    workspaceSessionId: 'workspace_memory_smoke',
    currentTurnId: 'turn_inferred_active',
    actions: [{
      ref: 'inferred_active',
      operation: 'add',
      scopeType: 'user',
      statement: '画面偏爱冷色调背景',
      status: 'active',
      origin: 'inferred',
      sourceTurnIds: ['turn_inferred_active'],
    }],
  })
  assert.equal(inferredActive[0].status, 'succeeded')
  assert.equal(
    (await listCreativeMemories({ userId: 1 })).find((item) => item.id === inferredActive[0].memoryId)?.status,
    'candidate',
  )

  await updateCreativeMemory({ userId: 1, id: neutral.id, status: 'revoked' })
  const revokedSearch = await searchCreativeMemories({
    userId: 1,
    draftId: 'draft_alpha',
    query: '继续使用中性低饱和画面',
  })
  assert.equal(revokedSearch.active.some((item) => item.memory.id === neutral.id), false)
  assert.equal(revokedSearch.audit.some(
    (item) => item.memoryId === neutral.id && item.reason === 'status_filtered',
  ), true)

  const crossDraft = await applyCreativeMemoryActions({
    userId: 1,
    workspaceSessionId: 'workspace_memory_smoke',
    currentTurnId: 'turn_cross_draft',
    currentDraftId: 'draft_alpha',
    recalledMemoryIds: new Set([betaTransition.id]),
    actions: [{
      ref: 'cross_draft_revoke',
      operation: 'revoke',
      targetMemoryId: betaTransition.id,
      sourceTurnIds: ['turn_cross_draft'],
    }],
  })
  assert.equal(crossDraft[0].status, 'failed')
  assert.match(crossDraft[0].reason ?? '', /another draft/i)

  const candidateReplace = await applyCreativeMemoryActions({
    userId: 1,
    workspaceSessionId: 'workspace_memory_smoke',
    currentTurnId: 'turn_replace_candidate',
    currentDraftId: 'draft_alpha',
    recalledMemoryIds: new Set([candidate.id]),
    actions: [{
      ref: 'replace_candidate',
      operation: 'replace',
      targetMemoryId: candidate.id,
      statement: '旁白保持冷静克制的语速',
      sourceTurnIds: ['turn_replace_candidate'],
    }],
  })
  assert.equal(candidateReplace[0].status, 'succeeded')
  const replacement = (await listCreativeMemories({ userId: 1 }))
    .find((item) => item.id === candidateReplace[0].memoryId)
  assert.ok(replacement)
  assert.equal(replacement.status, 'candidate')
  assert.equal(replacement.origin, 'inferred')

  const revokedReAdd = await applyCreativeMemoryActions({
    userId: 1,
    workspaceSessionId: 'workspace_memory_third',
    currentTurnId: 'turn_revoked_readd',
    actions: [{
      ref: 'revoked_readd',
      operation: 'add',
      scopeType: 'user',
      statement: '画面整体偏好中性低饱和色调',
      status: 'active',
      origin: 'explicit',
      sourceTurnIds: ['turn_revoked_readd'],
    }],
  })
  assert.equal(revokedReAdd[0].status, 'succeeded')
  assert.equal(
    (await listCreativeMemories({ userId: 1 })).find((item) => item.id === revokedReAdd[0].memoryId)?.status,
    'candidate',
  )

  const reopened = await searchCreativeMemories({
    userId: 1,
    draftId: 'draft_alpha',
    query: '字幕只保留关键信息',
  })
  assert.equal(reopened.active.some((item) => item.memory.id === draftCaption.id), true)
  await prisma.v2TimelineDraft.deleteMany({ where: { id: 'draft_alpha' } })
  const afterDraftDeletion = await searchCreativeMemories({
    userId: 1,
    draftId: 'draft_alpha',
    query: '字幕只保留关键信息',
  })
  assert.equal(afterDraftDeletion.active.some((item) => item.memory.id === draftCaption.id), false)

  console.log('V2 creative memory smoke passed.')
} finally {
  rmSync(dataDir, { recursive: true, force: true })
}
