import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
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
  const {
    createV2IdempotencyRepository,
    v2IdempotencyRequestHash,
  } = await import('../src/pipeline-v2/idempotency-repository.js')
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

  const runningAction = {
    ref: 'running_replay',
    operation: 'add' as const,
    scopeType: 'user' as const,
    statement: 'Prefer measured pacing',
    status: 'active' as const,
    origin: 'explicit' as const,
    sourceTurnIds: ['turn_running_replay'],
  }
  const idempotency = createV2IdempotencyRepository()
  const runningReservation = await idempotency.reserve({
    userId: 1,
    operation: 'memory.add',
    idempotencyKey: 'turn_running_replay:running_replay',
    resourceKey: 'user',
    requestHash: v2IdempotencyRequestHash({
      workspaceSessionId: 'workspace_running_replay',
      currentDraftId: undefined,
      requirementStatements: [],
      action: { ...runningAction, statement: 'prefer measured pacing' },
    }),
  })
  assert.equal(runningReservation.kind, 'reserved')
  const storedRunningResult = {
    ref: runningAction.ref,
    operation: runningAction.operation,
    status: 'succeeded' as const,
    memoryId: 'memory_running_replay',
    effectiveStatus: 'active' as const,
  }
  setTimeout(() => {
    void idempotency.update({
      id: runningReservation.receipt.id,
      status: 'completed',
      resultJson: { value: storedRunningResult },
    })
  }, 50)
  const replayedRunning = await applyCreativeMemoryActions({
    userId: 1,
    workspaceSessionId: 'workspace_running_replay',
    currentTurnId: 'turn_running_replay',
    actions: [runningAction],
  })
  assert.deepEqual(
    replayedRunning,
    [storedRunningResult],
    'an in-flight retry must await and replay the original memory receipt instead of fabricating a failure',
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
    'active',
    'a user preference repeated across sessions is behavior evidence and becomes active',
  )

  // An existing candidate that reappears in another session is promoted to
  // active automatically (behavior-driven sedimentation).
  const firstSession = await applyCreativeMemoryActions({
    userId: 1,
    workspaceSessionId: 'workspace_mem_a',
    currentTurnId: 'turn_mem_a',
    actions: [{
      ref: 'mem_a',
      operation: 'add',
      scopeType: 'user',
      statement: '长期偏好冷灰色调',
      status: 'candidate',
      origin: 'explicit',
      sourceTurnIds: ['turn_mem_a'],
    }],
  })
  assert.equal(
    (await listCreativeMemories({ userId: 1 })).find((item) => item.id === firstSession[0].memoryId)?.status,
    'candidate',
  )
  const secondSession = await applyCreativeMemoryActions({
    userId: 1,
    workspaceSessionId: 'workspace_mem_b',
    currentTurnId: 'turn_mem_b',
    actions: [{
      ref: 'mem_b',
      operation: 'add',
      scopeType: 'user',
      statement: '长期偏好冷灰色调',
      status: 'active',
      origin: 'explicit',
      sourceTurnIds: ['turn_mem_b'],
    }],
  })
  assert.equal(secondSession[0].status, 'succeeded')
  assert.equal(
    (await listCreativeMemories({ userId: 1 })).find((item) => item.id === firstSession[0].memoryId)?.status,
    'active',
    'existing candidate must be promoted when it reappears in another session',
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

  // A statement that is also recorded as this turn's requirement must not be
  // silently promoted to an active user preference (double-write guard).
  const duplicateOfRequirement = await applyCreativeMemoryActions({
    userId: 1,
    workspaceSessionId: 'workspace_memory_smoke',
    currentTurnId: 'turn_duplicate_requirement',
    requirementStatements: ['描写战锤40k世界大战的视频方案，至少出现4种种族角色，包含10个镜头'],
    actions: [{
      ref: 'dup_req',
      operation: 'add',
      scopeType: 'user',
      statement: '描写战锤40k世界大战的视频方案，至少出现4种种族角色',
      status: 'active',
      origin: 'explicit',
      sourceTurnIds: ['turn_duplicate_requirement'],
    }],
  })
  assert.equal(duplicateOfRequirement[0].status, 'skipped')
  assert.equal(duplicateOfRequirement[0].reason, 'duplicate_of_requirement')
  assert.equal(duplicateOfRequirement[0].memoryId, undefined)
  assert.equal(
    (await listCreativeMemories({ userId: 1 })).some((item) => item.statement.includes('战锤40k世界大战')),
    false,
    'a project requirement must not create a duplicate candidate memory',
  )

  const duplicateOfEarlierRequirement = await applyCreativeMemoryActions({
    userId: 1,
    workspaceSessionId: 'workspace_memory_smoke',
    currentTurnId: 'turn_duplicate_earlier_requirement',
    requirementStatements: ['这个项目的画面使用冷蓝低照度'],
    actions: [{
      ref: 'dup_earlier_req',
      operation: 'add',
      scopeType: 'user',
      statement: '这个项目的画面使用冷蓝低照度',
      status: 'active',
      origin: 'explicit',
      sourceTurnIds: ['turn_duplicate_earlier_requirement'],
    }],
  })
  assert.equal(duplicateOfEarlierRequirement[0].status, 'skipped')
  assert.equal(duplicateOfEarlierRequirement[0].memoryId, undefined)

  const stablePreferenceThatAlsoAppliesNow = await applyCreativeMemoryActions({
    userId: 1,
    workspaceSessionId: 'workspace_memory_smoke',
    currentTurnId: 'turn_stable_preference_also_applies_now',
    requirementStatements: ['本片采用低饱和度画面'],
    actions: [{
      ref: 'stable_preference_also_applies_now',
      operation: 'add',
      scopeType: 'user',
      statement: '我一直偏好低饱和度风格',
      status: 'active',
      origin: 'explicit',
      sourceTurnIds: ['turn_stable_preference_also_applies_now'],
    }],
  })
  assert.equal(stablePreferenceThatAlsoAppliesNow[0].status, 'succeeded')
  assert.ok(stablePreferenceThatAlsoAppliesNow[0].memoryId)

  const explicitStablePreferenceWithSameRequirementText = await applyCreativeMemoryActions({
    userId: 1,
    workspaceSessionId: 'workspace_memory_smoke',
    currentTurnId: 'turn_exact_stable_preference',
    currentUserText: '我一直偏好克制留白的画面风格，这一版也这么做',
    requirementStatements: ['我一直偏好克制留白的画面风格'],
    actions: [{
      ref: 'exact_stable_preference',
      operation: 'add',
      scopeType: 'user',
      statement: '我一直偏好克制留白的画面风格',
      status: 'active',
      origin: 'explicit',
      sourceTurnIds: ['turn_exact_stable_preference'],
      sourceExcerpt: '我一直偏好克制留白的画面风格，这一版也这么做',
    }],
  })
  assert.equal(explicitStablePreferenceWithSameRequirementText[0].status, 'succeeded')
  assert.ok(explicitStablePreferenceWithSameRequirementText[0].memoryId)

  const forgedPreferenceEvidence = await applyCreativeMemoryActions({
    userId: 1,
    workspaceSessionId: 'workspace_memory_smoke',
    currentTurnId: 'turn_forged_preference_evidence',
    currentUserText: '这次使用冷灰色背景',
    requirementStatements: ['这次使用冷灰色背景'],
    actions: [{
      ref: 'forged_preference_evidence',
      operation: 'add',
      scopeType: 'user',
      statement: '这次使用冷灰色背景',
      status: 'active',
      origin: 'explicit',
      sourceTurnIds: ['turn_forged_preference_evidence'],
      sourceExcerpt: '我一直偏好冷灰色背景',
    }],
  })
  assert.equal(forgedPreferenceEvidence[0].status, 'skipped')
  assert.equal(forgedPreferenceEvidence[0].memoryId, undefined)

  const unrelatedPreferenceEvidence = await applyCreativeMemoryActions({
    userId: 1,
    workspaceSessionId: 'workspace_memory_smoke',
    currentTurnId: 'turn_unrelated_preference_evidence',
    currentUserText: '我一直偏好黑白风格；这次使用冷灰色背景',
    requirementStatements: ['这次使用冷灰色背景'],
    actions: [{
      ref: 'unrelated_preference_evidence',
      operation: 'add',
      scopeType: 'user',
      statement: '这次使用冷灰色背景',
      status: 'active',
      origin: 'explicit',
      sourceTurnIds: ['turn_unrelated_preference_evidence'],
      sourceExcerpt: '我一直偏好黑白风格',
    }],
  })
  assert.equal(unrelatedPreferenceEvidence[0].status, 'skipped')
  assert.equal(unrelatedPreferenceEvidence[0].memoryId, undefined)

  // A genuine transferable preference is not blocked just because this turn
  // also records an unrelated requirement.
  const unrelatedRequirement = await applyCreativeMemoryActions({
    userId: 1,
    workspaceSessionId: 'workspace_memory_smoke',
    currentTurnId: 'turn_unrelated_requirement',
    requirementStatements: ['描写战锤40k世界大战的视频方案，至少出现4种种族角色，包含10个镜头'],
    actions: [{
      ref: 'unrelated_mem',
      operation: 'add',
      scopeType: 'user',
      statement: '标题使用白色粗体',
      status: 'active',
      origin: 'explicit',
      sourceTurnIds: ['turn_unrelated_requirement'],
    }],
  })
  assert.equal(unrelatedRequirement[0].reason, undefined)
  assert.equal(
    (await listCreativeMemories({ userId: 1 })).find((item) => item.id === unrelatedRequirement[0].memoryId)?.status,
    'active',
    'unrelated transferable preference must stay active',
  )

  const idempotentAction = {
    userId: 1,
    workspaceSessionId: 'workspace_memory_idempotent',
    currentTurnId: 'turn_memory_idempotent',
    actions: [{
      ref: 'memory_action_1',
      operation: 'add' as const,
      scopeType: 'user' as const,
      statement: 'Prefer concise documentary narration',
      status: 'active' as const,
      origin: 'explicit' as const,
      sourceTurnIds: ['turn_memory_idempotent'],
    }],
  }
  const idempotentFirst = await applyCreativeMemoryActions(idempotentAction)
  const idempotentReplay = await applyCreativeMemoryActions(idempotentAction)
  assert.deepEqual(idempotentReplay, idempotentFirst)
  assert.equal((await createV2IdempotencyRepository().get({
    userId: 1,
    operation: 'memory.add',
    idempotencyKey: 'turn_memory_idempotent:memory_action_1',
  }))?.status, 'completed')

  const concurrentStatement = 'Prefer restrained cyan data visualization'
  const concurrent = await Promise.all(Array.from({ length: 4 }, (_, index) =>
    createCreativeMemory({
      userId: 1,
      scopeType: 'user',
      statement: index % 2 ? `  ${concurrentStatement}  ` : concurrentStatement,
      status: 'active',
      origin: 'explicit',
      sourceWorkspaceSessionId: `workspace_concurrent_${index}`,
    })))
  assert.equal(new Set(concurrent.map((item) => item.id)).size, 1)
  assert.equal(
    (await listCreativeMemories({ userId: 1 })).filter(
      (item) => item.statement.trim() === concurrentStatement,
    ).length,
    1,
    'semantic duplicates must converge under concurrent requests',
  )

  await updateCreativeMemory({ userId: 1, id: concurrent[0].id, status: 'revoked' })
  const restored = await createCreativeMemory({
    userId: 1,
    scopeType: 'user',
    statement: concurrentStatement,
    status: 'active',
    origin: 'explicit',
    sourceWorkspaceSessionId: 'workspace_restore',
  })
  assert.equal(restored.id, concurrent[0].id, 'revoked semantic duplicates must reuse the existing entity')

  const staleTarget = await createCreativeMemory({
    userId: 1,
    scopeType: 'user',
    statement: 'Prefer stable editorial pacing',
    status: 'candidate',
    origin: 'inferred',
    sourceWorkspaceSessionId: 'workspace_stale_target',
  })
  await updateCreativeMemory({ userId: 1, id: staleTarget.id, status: 'revoked' })
  await assert.rejects(
    () => updateCreativeMemory({
      userId: 1,
      id: staleTarget.id,
      statement: 'Prefer energetic editorial pacing',
      status: 'active',
      expectedStatus: 'candidate',
    }),
    /changed concurrently/i,
  )
  assert.equal(
    (await listCreativeMemories({ userId: 1 })).find((item) => item.id === staleTarget.id)?.status,
    'revoked',
    'a stale replacement must not reactivate a concurrently revoked memory',
  )

  const mixedStatusStatement = 'Prefer decisive high-contrast title cards'
  const mixedStatus = await Promise.all([
    createCreativeMemory({
      userId: 1, scopeType: 'user', statement: mixedStatusStatement,
      status: 'candidate', origin: 'inferred', sourceWorkspaceSessionId: 'workspace_candidate_first',
    }),
    createCreativeMemory({
      userId: 1, scopeType: 'user', statement: mixedStatusStatement,
      status: 'active', origin: 'explicit', sourceWorkspaceSessionId: 'workspace_active_second',
    }),
  ])
  assert.equal(new Set(mixedStatus.map((item) => item.id)).size, 1)
  assert.equal(
    (await listCreativeMemories({ userId: 1 })).find((item) => item.id === mixedStatus[0]!.id)?.status,
    'active',
    'a concurrent explicit preference must promote an inferred candidate winner',
  )

  const interleaved = await createCreativeMemory({
    userId: 1,
    scopeType: 'user',
    statement: 'Prefer calm documentary framing',
    status: 'candidate',
    origin: 'inferred',
    sourceWorkspaceSessionId: 'workspace_interleaved_candidate',
  })
  const memoryDelegate = (prisma as unknown as {
    creativeMemory: {
      updateMany: (input: { where: Record<string, unknown>; data: Record<string, unknown> }) => Promise<{ count: number }>
    }
  }).creativeMemory
  const originalUpdateMany = memoryDelegate.updateMany.bind(memoryDelegate)
  let forcedConcurrentRevoke = false
  memoryDelegate.updateMany = async (update) => {
    if (!forcedConcurrentRevoke
      && update.where.id === interleaved.id
      && update.where.status === 'candidate'
      && update.data.status === 'active') {
      forcedConcurrentRevoke = true
      await originalUpdateMany({ where: { id: interleaved.id, userId: 1 }, data: { status: 'revoked' } })
      return { count: 0 }
    }
    return originalUpdateMany(update)
  }
  try {
    const promoted = await createCreativeMemory({
      userId: 1,
      scopeType: 'user',
      statement: 'Prefer calm documentary framing',
      status: 'active',
      origin: 'explicit',
      sourceWorkspaceSessionId: 'workspace_interleaved_active',
    })
    assert.equal(promoted.status, 'active')
    assert.equal(
      (await listCreativeMemories({ userId: 1 })).find((item) => item.id === interleaved.id)?.status,
      'active',
      'an add must not report active while a concurrent revoke left the entity revoked',
    )
  } finally {
    memoryDelegate.updateMany = originalUpdateMany
  }

  const migrationSql = readFileSync(
    new URL('../prisma/migrations/202608110003_add_memory_semantic_identity/migration.sql', import.meta.url),
    'utf8',
  )
  assert.match(
    migrationSql,
    /normalize\("statement",\s*NFKC\)/i,
    'PostgreSQL hydration must use the same NFKC normalization as runtime and local JSON',
  )

  console.log('V2 creative memory smoke passed.')
} finally {
  rmSync(dataDir, { recursive: true, force: true })
}
