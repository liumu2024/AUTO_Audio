import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

process.env.DIRECTOR_AGENT_ENABLED = 'true'
process.env.DIRECTOR_AGENT_RESPONSE_CONTINUITY = 'true'
process.env.DPL304_LOCAL_MODE = 'true'
process.env.DPL304_LOCAL_DATA_DIR = path.join('tmp', 'v2-director-smoke-local-data')
process.env.V2_DIRECTOR_SESSION_DIR = path.join('tmp', 'v2-director-smoke-session')

const { createDefaultDirectorSlots } = await import('../../shared/lib/director-understanding.js')
const { streamDirectorAgentChat } = await import('../src/modules/director-agent/director-agent.service.js')
const { createV2TimelineDraftRepository } = await import('../src/pipeline-v2/timeline-draft-repository.js')
const { env } = await import('../src/config/env.js')

assert.equal(env.directorAgentEnabled, true)
assert.equal(env.directorAgentResponseContinuity, true)

const baseContext = {
  materials: [],
  userIntent: { goal: 'generate_timeline' as const },
  slots: { ...createDefaultDirectorSlots(), durationSec: 15, styleIntensity: 'strong' as const },
}
const runtime = {
  backendEnabled: true,
  sampleUrl: '',
  isSampleParsed: false,
  hasV2Timeline: false,
  hasVisualMaterial: false,
  materialCount: 0,
}
const sessionId = `v2_multiturn_${Date.now()}`
const requests: Array<Record<string, unknown>> = []
const originalProposalContext = {
  ...baseContext,
  explicitUiControls: {
    aspectRatio: '16:9' as const,
    durationSec: 15,
    styleIntensity: 'strong' as const,
  },
  materials: [{
    id: 'mat_proposal', type: 'image' as const, name: 'proposal.png',
    url: '/uploads/proposal.png', tags: ['proposal'],
  }],
}
const replies = [
  {
    id: 'resp_1',
    output_text: JSON.stringify({
      replyDraft: '我会先记录本轮确认的字幕方向。', intent: 'create', creativeConfigDelta: {},
      stateActions: [{ ref: 'requirements', kind: 'requirements.update', operations: [{ operation: 'add', statement: '字幕基于画面创作' }] }],
      skillRequests: [], toolRequests: [], missingInformation: [],
    }),
  },
  {
    id: 'resp_2',
    output_text: JSON.stringify({
      replyDraft: '好的，我已记录新的字幕策略要求。', intent: 'chat', creativeConfigDelta: {},
      stateActions: [], skillRequests: [], toolRequests: [], missingInformation: [],
    }),
  },
  {
    id: 'resp_3',
    output_text: JSON.stringify({
      replyDraft: '我会保留当前方案并只调整字幕策略。', intent: 'revise',
      creativeConfigDelta: {}, stateActions: [],
      skillRequests: [], toolRequests: [], missingInformation: [],
    }),
  },
  new Error('mock director outage'),
  {
    id: 'resp_5',
    output_text: JSON.stringify({
      replyDraft: '已作废的颜色偏好是暖色，仍有效的是中性低饱和。', intent: 'chat',
      creativeConfigDelta: {}, stateActions: [], skillRequests: [], toolRequests: [], missingInformation: [],
    }),
  },
  {
    id: 'resp_6',
    output_text: JSON.stringify({
      replyDraft: '我会提交当前已确认版本渲染。', intent: 'execute', creativeConfigDelta: {},
      stateActions: [{ ref: 'requirements', kind: 'requirements.update', operations: [{ operation: 'replace', targetRequirementId: 'timeline_element_random', statement: '中性低饱和' }] }],
      skillRequests: [{ skillId: 'v2-render-delivery', purpose: '渲染当前版本' }],
      toolRequests: [{ ref: 'render', toolId: 'timeline.render', skillId: 'v2-render-delivery', arguments: {}, requestedMode: 'execute', dependsOn: [] }],
      missingInformation: [],
    }),
  },
  {
    id: 'resp_7',
    output_text: JSON.stringify({
      replyDraft: '我会记录这条要求。', intent: 'chat', creativeConfigDelta: {},
      stateActions: [{ ref: 'requirements', kind: 'requirements.update', operations: [{ operation: 'add', statement: '语气自然' }] }],
      skillRequests: [], toolRequests: [], missingInformation: [],
    }),
  },
  {
    id: 'resp_save_failure_after_tool',
    output_text: JSON.stringify({
      replyDraft: '我会渲染当前已保存版本。', intent: 'execute', creativeConfigDelta: {},
      stateActions: [], memoryActions: [],
      skillRequests: [{ skillId: 'v2-render-delivery', purpose: '渲染当前版本' }],
      toolRequests: [{
        ref: 'render_saved_draft', toolId: 'timeline.render', skillId: 'v2-render-delivery',
        arguments: {}, requestedMode: 'execute', dependsOn: [],
      }],
      missingInformation: [],
    }),
  },
  {
    id: 'resp_save_failure_after_ephemeral_tool',
    output_text: JSON.stringify({
      replyDraft: '我会检查当前素材。', intent: 'create', creativeConfigDelta: {},
      stateActions: [], memoryActions: [],
      skillRequests: [{ skillId: 'v2-timeline-authoring', purpose: '检查当前素材' }],
      toolRequests: [{
        ref: 'inspect_materials', toolId: 'material.inspect', skillId: 'v2-timeline-authoring',
        arguments: {}, requestedMode: 'preview', dependsOn: [],
      }],
      missingInformation: [],
    }),
  },
  {
    id: 'resp_8',
    output_text: JSON.stringify({
      replyDraft: '当前草稿已完成修订。', intent: 'create', creativeConfigDelta: {},
      stateActions: [{ ref: 'requirements', kind: 'requirements.update', operations: [{ operation: 'revoke', targetRequirementId: 'missing_requirement' }] }],
      memoryActions: [{
        ref: 'invalid_memory', operation: 'add', scopeType: 'user',
        statement: '偏好克制表达', status: 'active', origin: 'inferred',
        sourceTurnIds: ['not_the_current_turn'],
      }],
      skillRequests: [{ skillId: 'v2-timeline-authoring', purpose: 'plan the current request' }],
      toolRequests: [
        { ref: 'requires_requirement', toolId: 'timeline.plan', skillId: 'v2-timeline-authoring', arguments: {}, requestedMode: 'preview', dependsOn: ['requirements'] },
        { ref: 'failing_independent', toolId: 'timeline.plan', skillId: 'v2-timeline-authoring', arguments: {}, requestedMode: 'preview', dependsOn: [] },
        { ref: 'requires_failed_tool', toolId: 'timeline.plan', skillId: 'v2-timeline-authoring', arguments: {}, requestedMode: 'preview', dependsOn: ['failing_independent'] },
        { ref: 'successful_independent', toolId: 'timeline.plan', skillId: 'v2-timeline-authoring', arguments: {}, requestedMode: 'preview', dependsOn: [] },
      ],
      missingInformation: [],
    }),
  },
  {
    id: 'resp_9',
    output_text: JSON.stringify({
      replyDraft: '已记录：沟通语气可靠但不冰冷。你还可以继续说明希望这种语气用于哪些创作环节。', intent: 'chat', creativeConfigDelta: {},
      stateActions: [],
      memoryActions: [{
        ref: 'failed_memory_only', operation: 'add', scopeType: 'user',
        statement: '沟通语气可靠但不冰冷', status: 'active', origin: 'explicit',
        sourceTurnIds: ['not_current_turn'],
      }],
      skillRequests: [], toolRequests: [], missingInformation: [],
    }),
  },
  {
    id: 'resp_10',
    output_text: JSON.stringify({
      replyDraft: '当前是讨论模式；我不会记录任何偏好，也不会修改草稿。',
      intent: 'chat', creativeConfigDelta: {}, stateActions: [], memoryActions: [],
      skillRequests: [], toolRequests: [], missingInformation: [],
    }),
  },
  {
    id: 'resp_11',
    output_text: JSON.stringify({
      replyDraft: '我会创作并应用这个转场。', intent: 'revise', creativeConfigDelta: {},
      stateActions: [{
        ref: 'revision_requirement',
        kind: 'requirements.update',
        operations: [{ operation: 'add', statement: 'Use a particle transition only after confirmation.' }],
      }], memoryActions: [], skillRequests: [],
      toolRequests: [
        {
          ref: 'author_transition', toolId: 'render.author', skillId: 'v2-render-delivery',
          arguments: { purpose: 'transition', displayName: '粒子转场', effectBrief: '粒子转场', acceptanceCriteria: ['粒子在中间帧明显散开'] },
          requestedMode: 'preview', dependsOn: [],
        },
        {
          ref: 'apply_transition', toolId: 'timeline.patch', skillId: 'v2-timeline-authoring',
          arguments: { scope: 'transition', transitionIds: ['transition_random'], instruction: '使用刚创作的粒子转场' },
          requestedMode: 'preview', dependsOn: ['revision_requirement', 'author_transition'],
        },
      ],
      missingInformation: [],
    }),
  },
  {
    id: 'resp_stale_revision_confirmation',
    output_text: JSON.stringify({
      replyDraft: '我会修改这个转场。', intent: 'revise', creativeConfigDelta: {},
      stateActions: [], memoryActions: [], skillRequests: [],
      toolRequests: [{
        ref: 'stale_transition_patch', toolId: 'timeline.patch', skillId: 'v2-timeline-authoring',
        arguments: { scope: 'transition', transitionIds: ['transition_restore_target'], instruction: '改成滑动转场' },
        requestedMode: 'preview', dependsOn: [],
      }],
      missingInformation: [],
    }),
  },
  {
    id: 'resp_cross_draft_confirmation',
    output_text: JSON.stringify({
      replyDraft: '我会修改这个转场。', intent: 'revise', creativeConfigDelta: {},
      stateActions: [], memoryActions: [], skillRequests: [],
      toolRequests: [{
        ref: 'cross_draft_patch', toolId: 'timeline.patch', skillId: 'v2-timeline-authoring',
        arguments: { scope: 'transition', transitionIds: ['transition_restore_target'], instruction: '改成缩放转场' },
        requestedMode: 'preview', dependsOn: [],
      }],
      missingInformation: [],
    }),
  },
  {
    id: 'resp_switch_draft',
    output_text: JSON.stringify({
      replyDraft: '已切换到另一份草稿。', intent: 'chat', creativeConfigDelta: {},
      stateActions: [], memoryActions: [], skillRequests: [], toolRequests: [], missingInformation: [],
    }),
  },
  {
    id: 'resp_abandon_pending_and_patch',
    output_text: JSON.stringify({
      replyDraft: '我会放弃之前失败的修改，再调整当前转场。', intent: 'revise', creativeConfigDelta: {},
      stateActions: [], memoryActions: [],
      skillRequests: [{ skillId: 'v2-timeline-authoring', purpose: '处理失败修改并更新转场' }],
      toolRequests: [
        {
          ref: 'dismiss_failed_patch', toolId: 'timeline.pending.dismiss', skillId: 'v2-timeline-authoring',
          arguments: { callId: 'failed_patch_to_abandon' }, requestedMode: 'preview', dependsOn: [],
        },
        {
          ref: 'patch_after_dismiss', toolId: 'timeline.patch', skillId: 'v2-timeline-authoring',
          arguments: { scope: 'transition', transitionIds: ['transition_restore_target'], instruction: '改成淡化转场' },
          requestedMode: 'preview', dependsOn: ['dismiss_failed_patch'],
        },
      ],
      missingInformation: [],
    }),
  },
  ...Array.from({ length: 3 }, (_, index) => ({
    id: `resp_material_${index + 1}`,
    output_text: JSON.stringify({
      replyDraft: '继续讨论当前素材。', intent: 'chat', creativeConfigDelta: {},
      stateActions: [], memoryActions: [], skillRequests: [], toolRequests: [], missingInformation: [],
    }),
  })),
  {
    id: 'resp_sample_candidate',
    output_text: JSON.stringify({
      replyDraft: '我会分析唯一的视频候选。', intent: 'create', creativeConfigDelta: {},
      stateActions: [], memoryActions: [],
      skillRequests: [{ skillId: 'sample-reference-analysis', purpose: '分析用户指定的样例视频' }],
      toolRequests: [{
        ref: 'analyze_sample', toolId: 'sample.analyze', skillId: 'sample-reference-analysis',
        arguments: {}, requestedMode: 'preview', dependsOn: [],
      }],
      missingInformation: [],
    }),
  },
  {
    id: 'resp_sample_clear',
    output_text: JSON.stringify({
      replyDraft: 'Sample removed.', intent: 'chat', creativeConfigDelta: {},
      stateActions: [], memoryActions: [], skillRequests: [], toolRequests: [], missingInformation: [],
    }),
  },
]
const originalFetch = globalThis.fetch
let dispatchCount = 0
const authorizedDraftComponentsSeen: string[][] = []
const dispatchedContextMaterialIds: string[][] = []
const dismissalAuthorizationsSeen: Array<{ granted: boolean; evidence?: string } | undefined> = []
globalThis.fetch = async (_url, init) => {
  requests.push(JSON.parse(String(init?.body)) as Record<string, unknown>)
  const reply = replies.shift()
  if (reply instanceof Error) throw reply
  return new Response(JSON.stringify(reply), { status: 200 })
}
const preserveDeterministicReply = async (input: { fallbackMessage: string }) => ({
  message: input.fallbackMessage,
  source: 'fallback' as const,
})

async function turn(
  prompt: string,
  context = baseContext,
  overrides: Partial<typeof runtime> = {},
  failedRefs = new Set<string>(),
  contextMaterialsAuthoritative = false,
  contextSampleAuthoritative = false,
  timelineRevisionDecision?: { confirmationId: string; action: 'confirm' | 'reject' },
) {
  const events = [] as Array<{ type: string; [key: string]: unknown }>
  const request = {
    prompt,
    context,
    runtime: { ...runtime, ...overrides },
    workspaceSessionId: sessionId,
    userId: 1,
    contextMaterialsAuthoritative,
    contextSampleAuthoritative,
    timelineRevisionDecision,
  }
  for await (const event of streamDirectorAgentChat(request, {
    composeFinalReply: preserveDeterministicReply,
    dispatchTool: async (dispatchInput) => {
      const { stage } = dispatchInput
      dispatchCount += 1
      if (stage.toolRequest.toolId === 'sample.analyze') {
        const candidate = dispatchInput.runtime.sampleCandidates?.[0]!
        return {
          callId: stage.toolRequest.callId,
          toolId: stage.toolRequest.toolId,
          ok: true,
          summary: '样例理解已完成。',
          sampleSelection: candidate,
          sampleUnderstanding: {
            schema_version: 'v2_sample_understanding.v2' as const,
            task_id: 'sample_candidate_smoke', source: 'llm' as const,
            sample: { name: candidate.name, duration_sec: 8 },
            summary: '通过逐步加快的切换从开篇推进到收束',
            content_observations: [],
            method_observations: [{ id: 'method_1', expression: '逐步加快切换', purpose: '推进叙事', timing_rationale: '临近收束时加快', evidence_ranges: [{ start_sec: 0, end_sec: 8 }] }],
            transferable_knowledge: [{ statement: '临近收束时逐步加快切换', applicability: '短片收束', evidence_method_ids: ['method_1'] }],
            shot_evidence: [], questions: [], warnings: [],
          },
        }
      }
      if (stage.toolRequest.ref === 'apply_transition') {
        authorizedDraftComponentsSeen.push(dispatchInput.authorizedDraftComponentIds ?? [])
        dispatchedContextMaterialIds.push(dispatchInput.context.materials.map((item) => item.id))
      }
      if (stage.toolRequest.toolId === 'timeline.pending.dismiss') {
        dismissalAuthorizationsSeen.push(dispatchInput.authorization)
      }
      const ok = !failedRefs.has(stage.toolRequest.ref)
      return {
        callId: stage.toolRequest.callId,
        toolId: stage.toolRequest.toolId,
        ok,
        summary: ok ? 'V2 正式渲染已完成。' : 'mock tool failure',
        output: stage.toolRequest.toolId === 'render.author'
          ? {
              componentId: 'cmp_server_generated',
              purpose: 'transition',
              displayName: '粒子转场',
              effectSummary: '粒子在转场中间帧散开',
              status: 'promoted',
            }
          : undefined,
      }
    },
  })) events.push(event)
  return events
}

const restoredDraftRepository = createV2TimelineDraftRepository()
const restoredDraft = await restoredDraftRepository.createDraft({
  userId: 1,
  plannerInput: {
    taskId: `director_restore_${Date.now()}`,
    prompt: 'restore an existing timeline',
    creationMode: 'text_to_video',
    plannerMode: 'deterministic',
  },
  spec: {
    schema_version: 'remotion_timeline_spec.v1',
    task_id: `director_restore_${Date.now()}`,
    canvas: { width: 1080, height: 1920, fps: 30, duration_sec: 2 },
    assets: [],
    scenes: [
      { id: 'restore_scene_1', type: 'remotion_card', start_sec: 0, duration_sec: 1 },
      { id: 'restore_scene_2', type: 'remotion_card', start_sec: 1, duration_sec: 1 },
    ],
    transitions: [{
      id: 'transition_restore_target',
      from_scene_id: 'restore_scene_1',
      to_scene_id: 'restore_scene_2',
      type: 'fade',
      duration_sec: 0.3,
    }],
    overlays: [],
    audio: [],
    material_jobs: [],
    render_policy: { renderer: 'remotion_timeline' },
  },
  plannerSource: 'deterministic',
  review: {},
  traceDir: 'director-restore-smoke',
})
const otherDraft = await restoredDraftRepository.createDraft({
  userId: 1,
  plannerInput: {
    taskId: `director_other_${Date.now()}`,
    prompt: 'other timeline',
    creationMode: 'text_to_video',
    plannerMode: 'deterministic',
  },
  spec: { ...restoredDraft.spec, task_id: `director_other_${Date.now()}` },
  plannerSource: 'deterministic',
  review: {},
  traceDir: 'director-other-smoke',
})

try {
  const created = await turn('请生成一版 15 秒的校园介绍方案')
  assert.equal(created.some((event) => event.type === 'tool_started'), false)
  const createdSession = created.find((event) => event.type === 'workspace_session')!
  assert.equal(created.filter((event) => event.type === 'workspace_session').length, 1)
  assert.equal(created.some((event) => event.type === 'workspace_snapshot'), false)
  assert.equal(
    Object.hasOwn(created.find((event) => event.type === 'done') ?? {}, 'message'),
    false,
    'done must be a marker and must not duplicate the assistant reply',
  )
  assert.equal((createdSession.state as { context: typeof baseContext }).context.slots.durationSec, 15)
  assert.equal('generationMode' in (createdSession.state as { context: { slots: object } }).context.slots, false)
  assert.deepEqual(
    (createdSession.state as { confirmedRequirements: Array<{ statement: string; status: string }> })
      .confirmedRequirements.map(({ statement, status }) => ({ statement, status })),
    [{ statement: '字幕基于画面创作', status: 'active' }],
  )
  assert.match(
    String((created.find((event) => event.type === 'assistant_reply') as { message: string }).message),
    /我已经记下.*字幕基于画面创作/,
  )

  const asked = await turn('这版会加入什么字幕？', {
    ...baseContext,
    slots: { ...baseContext.slots, durationSec: undefined },
    currentTimeline: { kind: 'v2_timeline', status: 'saved', draftId: 'draft_1', currentRevision: 1 },
  }, { hasV2Timeline: true, v2SceneCount: 3 })
  const askedSession = asked.find((event) => event.type === 'workspace_session')!
  assert.equal((askedSession.state as { context: typeof baseContext }).context.slots.durationSec, 15)
  assert.equal(requests[1]?.previous_response_id, 'resp_1')
  assert.match(
    String((asked.find((event) => event.type === 'assistant_reply') as { message: string }).message),
    /没有产生可验证的要求变更/,
  )
  const askedTrace = JSON.parse(await readFile(
    path.join((askedSession as { traceDir: string }).traceDir, '00-director-turn', 'turn-result.json'),
    'utf8',
  )) as { requirement_changes: Record<string, unknown[]> }
  assert.deepEqual(askedTrace.requirement_changes, {
    added: [], replaced: [], revoked: [], unchanged: [], rejected: [],
  })

  const revised = await turn('请把字幕改成更简洁的两行', {
    ...baseContext,
    currentTimeline: { kind: 'v2_timeline', status: 'saved', draftId: 'draft_1', currentRevision: 1 },
  }, { hasV2Timeline: true, v2SceneCount: 3 })
  assert.equal(revised.some((event) => event.type === 'tool_started'), false)

  const failed = await turn('现在能否继续讨论节奏？')
  assert.equal((failed.find((event) => event.type === 'workspace_session') as { modelCalled: boolean }).modelCalled, true)

  const recovered = await turn('继续讨论这一版的节奏')
  assert.equal(
    String((recovered.find((event) => event.type === 'assistant_reply') as { message: string }).message),
    '已作废的颜色偏好是暖色，仍有效的是中性低饱和。',
  )
  assert.equal((recovered.find((event) => event.type === 'workspace_session') as { state: { pendingQuestion?: unknown } }).state.pendingQuestion, undefined)
  const executable = await turn('请渲染当前方案', {
    ...baseContext,
    currentTimeline: {
      kind: 'v2_timeline',
      status: 'saved',
      draftId: restoredDraft.id,
      currentRevision: restoredDraft.revision,
    },
  }, { hasV2Timeline: true, v2SceneCount: 3 })
  assert.match(
    JSON.stringify(requests.at(-1)),
    /transition_restore_target/,
    'a restored workspace must provide persisted transition ids to the Director model',
  )
  assert.equal(executable.some((event) => event.type === 'tool_started'), true)
  assert.equal(dispatchCount, 1)
  assert.match(
    String((executable.find((event) => event.type === 'assistant_reply') as { message: string }).message),
    /(?:要求变更未通过校验|创作要求没有保存).*成片导出已完成/,
  )
  assert.doesNotMatch(
    String((executable.find((event) => event.type === 'assistant_reply') as { message: string }).message),
    /我会提交当前已确认版本渲染/,
    'tool turns must use receipts instead of the pre-execution model draft',
  )
  const unsaved = [] as Array<{ type: string; [key: string]: unknown }>
  for await (const event of streamDirectorAgentChat({
    prompt: '请记录语气自然',
    context: baseContext,
    runtime,
    workspaceSessionId: `${sessionId}_save_failure`,
    userId: 1,
  }, {
    composeFinalReply: preserveDeterministicReply,
    saveWorkspace: async () => { throw new Error('mock save failure') },
  })) unsaved.push(event)
  assert.equal(unsaved.some((event) => event.type === 'workspace_session'), false)
  assert.equal(
    unsaved.some((event) => event.type === 'error'),
    true,
    'workspace persistence failures must remain failed when the Director turn is replayed',
  )
  assert.equal(Object.hasOwn(unsaved.find((event) => event.type === 'done') ?? {}, 'message'), false)
  assert.equal(
    (unsaved.find((event) => event.type === 'assistant_reply') as { message: string }).message,
    '工作区保存失败，本轮要求和状态均不能确认为已保存，请稍后重试。',
  )
  const partiallySaved = [] as Array<{ type: string; [key: string]: unknown }>
  for await (const event of streamDirectorAgentChat({
    prompt: '渲染当前草稿',
    context: {
      ...baseContext,
      currentTimeline: {
        kind: 'v2_timeline' as const,
        status: 'saved' as const,
        draftId: restoredDraft.id,
        currentRevision: restoredDraft.revision,
      },
    },
    runtime: { ...runtime, hasV2Timeline: true, v2SceneCount: 2 },
    workspaceSessionId: `${sessionId}_partial_save_failure`,
    userId: 1,
  }, {
    composeFinalReply: preserveDeterministicReply,
    dispatchTool: async (dispatchInput) => ({
      callId: dispatchInput.stage.toolRequest.callId,
      toolId: dispatchInput.stage.toolRequest.toolId,
      ok: true,
      summary: '草稿渲染已完成。',
      draft: {
        id: restoredDraft.id,
        revision: restoredDraft.revision,
        spec: restoredDraft.spec,
        traceDir: restoredDraft.traceDir,
      },
    }),
    saveWorkspace: async () => { throw new Error('mock save failure after tool') },
  })) partiallySaved.push(event)
  assert.equal(
    (partiallySaved.find((event) => event.type === 'assistant_reply') as { message: string }).message,
    '方案修改已经保存，但对话状态没有同步成功；重新打开当前方案即可恢复结果。',
  )
  assert.equal(partiallySaved.some((event) => event.type === 'workspace_session'), false)
  assert.equal(partiallySaved.some((event) => event.type === 'error'), true)
  assert.equal(Object.hasOwn(partiallySaved.find((event) => event.type === 'done') ?? {}, 'message'), false)

  const ephemeralResult = [] as Array<{ type: string; [key: string]: unknown }>
  for await (const event of streamDirectorAgentChat({
    prompt: '检查当前素材',
    context: {
      ...baseContext,
      materials: [{
        id: 'material_ephemeral', type: 'image' as const,
        url: 'https://cdn.example.com/ephemeral.png', name: 'ephemeral.png', tags: [],
      }],
    },
    runtime: { ...runtime, hasVisualMaterial: true, materialCount: 1 },
    workspaceSessionId: `${sessionId}_ephemeral_save_failure`,
    userId: 1,
  }, {
    composeFinalReply: preserveDeterministicReply,
    dispatchTool: async (dispatchInput) => ({
      callId: dispatchInput.stage.toolRequest.callId,
      toolId: dispatchInput.stage.toolRequest.toolId,
      ok: true,
      summary: '素材检查已完成。',
      output: { materials: [{ id: 'material_ephemeral', type: 'image' }] },
    }),
    saveWorkspace: async () => { throw new Error('mock save failure after ephemeral tool') },
  })) ephemeralResult.push(event)
  assert.equal(
    (ephemeralResult.find((event) => event.type === 'assistant_reply') as { message: string }).message,
    '这次处理已经返回结果，但对话中的状态没有保存成功，请重试。',
  )
  assert.equal(ephemeralResult.some((event) => event.type === 'workspace_session'), false)
  assert.equal(ephemeralResult.some((event) => event.type === 'error'), true)

  const isolated = await turn(
    'apply independent and dependent actions',
    baseContext,
    {},
    new Set(['failing_independent']),
  )
  assert.deepEqual(
    isolated
      .filter((event) => event.type === 'tool_result')
      .map((event) => ({ ref: event.actionRef, status: event.status })),
    [
      { ref: 'requires_requirement', status: 'skipped' },
      { ref: 'failing_independent', status: 'failed' },
      { ref: 'requires_failed_tool', status: 'skipped' },
      { ref: 'successful_independent', status: 'succeeded' },
    ],
  )
  assert.equal(dispatchCount, 3)
  assert.doesNotMatch(
    String((isolated.find((event) => event.type === 'assistant_reply') as { message: string }).message),
    /当前草稿已完成修订/,
    'failed or partial tool turns must discard unverified model success claims',
  )
  const isolatedReply = String(
    (isolated.find((event) => event.type === 'assistant_reply') as { message: string }).message,
  )
  const requirementOutcomeIndex = isolatedReply.indexOf('创作要求没有保存')
  const memoryOutcomeIndex = isolatedReply.indexOf('条偏好没有保存成功')
  const toolOutcomeIndex = isolatedReply.indexOf('这一步没有继续')
  assert.ok(
    requirementOutcomeIndex >= 0
      && memoryOutcomeIndex > requirementOutcomeIndex
      && toolOutcomeIndex > memoryOutcomeIndex,
    'fallback reply must preserve the authoritative requirement, memory, then tool receipt order',
  )
  const isolatedSession = isolated.find((event) => event.type === 'workspace_session') as { traceDir: string }
  const isolatedTrace = JSON.parse(await readFile(
    path.join(isolatedSession.traceDir, '00-director-turn', 'turn-result.json'),
    'utf8',
  )) as { creative_memory_changes: Array<{ ref: string; status: string }> }
  assert.deepEqual(isolatedTrace.creative_memory_changes, [
    { ref: 'invalid_memory', operation: 'add', status: 'failed', reason: 'Creative memory action must cite the current source turn.' },
  ])
  const failedMemoryOnly = await turn('再记录一条：沟通语气可靠但不冰冷。')
  const failedMemoryReply = String(
    (failedMemoryOnly.find((event) => event.type === 'assistant_reply') as { message: string }).message,
  )
  assert.match(failedMemoryReply, /未保存|拒绝/)
  assert.doesNotMatch(failedMemoryReply, /已记录/)
  assert.match(failedMemoryReply, /继续说明希望这种语气用于哪些创作环节/)
  const negatedPersistence = await turn('说明当前模式，不要记录偏好或修改草稿。')
  assert.equal(
    (negatedPersistence.find((event) => event.type === 'assistant_reply') as { message: string }).message,
    '当前是讨论模式；我不会记录任何偏好，也不会修改草稿。',
  )
  const componentTurn = await turn('创作一个粒子转场并应用到当前转场', {
    ...originalProposalContext,
    currentTimeline: {
      kind: 'v2_timeline', status: 'saved', draftId: restoredDraft.id, currentRevision: restoredDraft.revision,
    },
  }, { hasV2Timeline: true, v2SceneCount: 3 }, new Set(), true)
  const proposedPatch = componentTurn.find((event) => (
    event.type === 'tool_proposed' && event.toolId === 'timeline.patch'
  )) as { callId: string; revisionIntent?: { scope?: string; targetDisplay?: string[] } }
  assert.equal(proposedPatch.revisionIntent?.scope, 'transition')
  assert.equal(proposedPatch.revisionIntent?.targetDisplay?.length, 1)
  assert.equal(
    componentTurn.some((event) => event.type === 'tool_started' || event.type === 'tool_result'),
    false,
    'a parsed revision must wait for explicit confirmation before any Tool side effect',
  )
  const pendingConfirmation = (componentTurn.find((event) => event.type === 'workspace_session') as {
    state: { pendingTimelineRevisionConfirmation?: { confirmationId: string; revisionIntents: unknown[] } }
  }).state.pendingTimelineRevisionConfirmation
  assert.equal(pendingConfirmation?.confirmationId, proposedPatch.callId)
  assert.equal(pendingConfirmation?.revisionIntents.length, 1)
  const confirmedComponentTurn = await turn(
    'confirm the pending revision',
    {
      ...baseContext,
      explicitUiControls: {
        aspectRatio: '9:16' as const,
        durationSec: 30,
        styleIntensity: 'weak' as const,
      },
      materials: [{
        id: 'mat_late', type: 'image' as const, name: 'late.png',
        url: '/uploads/late.png', tags: ['late'],
      }],
    },
    {},
    new Set(),
    false,
    false,
    { confirmationId: proposedPatch.callId, action: 'confirm' },
  )
  const patchReceipt = confirmedComponentTurn.find((event) => (
    event.type === 'tool_result' && event.toolId === 'timeline.patch'
  )) as { revisionReceipt?: { status?: string; scope?: string } }
  assert.equal(patchReceipt.revisionReceipt?.status, 'succeeded')
  assert.equal(patchReceipt.revisionReceipt?.scope, 'transition')
  assert.deepEqual(authorizedDraftComponentsSeen, [['cmp_server_generated']])
  assert.deepEqual(
    dispatchedContextMaterialIds,
    [['mat_proposal']],
    'confirmation must execute with the context shown when the proposal was created',
  )
  assert.deepEqual(
    (confirmedComponentTurn.find((event) => event.type === 'workspace_session') as {
      state: { context: { effectiveCreativeConfig?: { aspectRatio?: string; durationSec?: number; styleIntensity?: string } } }
    }).state.context.effectiveCreativeConfig,
    {
      aspectRatio: '16:9',
      durationSec: 15,
      styleIntensity: 'strong',
      sources: { aspectRatio: 'ui', durationSec: 'ui', styleIntensity: 'ui' },
      conflicts: [],
    },
    'confirmation-time UI controls must not replace the configuration frozen with the proposal',
  )
  assert.equal(
    (confirmedComponentTurn.find((event) => event.type === 'workspace_session') as {
      state: { pendingTimelineRevisionConfirmation?: unknown }
    }).state.pendingTimelineRevisionConfirmation,
    undefined,
  )
  const staleProposalTurn = await turn('把当前转场改成滑动', {
    ...baseContext,
    currentTimeline: {
      kind: 'v2_timeline', status: 'saved', draftId: restoredDraft.id, currentRevision: restoredDraft.revision,
    },
  }, { hasV2Timeline: true, v2SceneCount: 2 })
  const staleProposal = staleProposalTurn.find((event) => (
    event.type === 'tool_proposed' && event.toolId === 'timeline.patch'
  )) as { callId: string }
  await restoredDraftRepository.saveDraft({
    draftId: restoredDraft.id,
    userId: 1,
    baseRevision: restoredDraft.revision,
    spec: { ...restoredDraft.spec, notes: ['advanced in another window'] },
    kind: 'user_edit',
  })
  const dispatchCountBeforeStaleConfirmation = dispatchCount
  const staleConfirmation = await turn(
    '确认执行已解析的修改提案。',
    baseContext,
    {},
    new Set(),
    false,
    false,
    { confirmationId: staleProposal.callId, action: 'confirm' },
  )
  assert.equal(dispatchCount, dispatchCountBeforeStaleConfirmation)
  assert.match(
    String((staleConfirmation.find((event) => event.type === 'error') as { message: string }).message),
    /(?:待确认的修改.*|当前方案已经发生了其他修改.*)重新提出修改/,
  )
  const latestRestoredDraft = await restoredDraftRepository.getDraft(restoredDraft.id, 1)
  const crossDraftProposalTurn = await turn('把当前转场改成缩放', {
    ...baseContext,
    currentTimeline: {
      kind: 'v2_timeline', status: 'saved', draftId: restoredDraft.id, currentRevision: latestRestoredDraft!.revision,
    },
  }, { hasV2Timeline: true, v2SceneCount: 2 })
  const crossDraftProposal = crossDraftProposalTurn.find((event) => (
    event.type === 'tool_proposed' && event.toolId === 'timeline.patch'
  )) as { callId: string }
  await turn('切换到另一份草稿继续查看', {
    ...baseContext,
    currentTimeline: {
      kind: 'v2_timeline', status: 'saved', draftId: otherDraft.id, currentRevision: otherDraft.revision,
    },
  }, { hasV2Timeline: true, v2SceneCount: 2 })
  const dispatchCountBeforeCrossDraftConfirmation = dispatchCount
  const crossDraftConfirmation = await turn(
    '确认执行已解析的修改提案。',
    baseContext,
    {},
    new Set(),
    false,
    false,
    { confirmationId: crossDraftProposal.callId, action: 'confirm' },
  )
  assert.equal(dispatchCount, dispatchCountBeforeCrossDraftConfirmation)
  assert.match(
    String((crossDraftConfirmation.find((event) => event.type === 'error') as { message: string }).message),
    /(?:待确认的修改.*|当前方案已经发生了其他修改.*)重新提出修改/,
  )
  assert.equal(
    (crossDraftConfirmation.find((event) => event.type === 'workspace_session') as {
      state: { draftId?: string; baseRevision?: number }
    }).state.draftId,
    otherDraft.id,
    'rejecting a stale proposal must preserve the draft the user has already switched to',
  )
  const dismissSourceDraft = await restoredDraftRepository.getDraft(restoredDraft.id, 1)
  assert.ok(dismissSourceDraft)
  await restoredDraftRepository.markPendingRevision({
    draftId: dismissSourceDraft.id,
    userId: 1,
    baseRevision: dismissSourceDraft.revision,
    callId: 'failed_patch_to_abandon',
    instruction: '之前失败的转场修改',
  })
  const abandonProposalTurn = await turn('放弃之前失败的修改，并把当前转场改成淡化', {
    ...baseContext,
    currentTimeline: {
      kind: 'v2_timeline', status: 'saved', draftId: dismissSourceDraft.id, currentRevision: dismissSourceDraft.revision,
    },
  }, { hasV2Timeline: true, v2SceneCount: 2 })
  const abandonPatchProposal = abandonProposalTurn.find((event) => (
    event.type === 'tool_proposed' && event.toolId === 'timeline.patch'
  )) as { callId: string }
  assert.ok(abandonPatchProposal.callId)
  const confirmedAbandonment = await turn(
    '确认执行已解析的修改提案。',
    baseContext,
    {},
    new Set(),
    false,
    false,
    { confirmationId: abandonPatchProposal.callId, action: 'confirm' },
  )
  assert.equal(confirmedAbandonment.some((event) => event.type === 'tool_result'), true)
  assert.deepEqual(
    dismissalAuthorizationsSeen,
    [{ granted: true, evidence: '放弃之前失败的修改，并把当前转场改成淡化' }],
    'confirmation must reuse the original user authorization frozen with the proposal',
  )
  const materialContext = {
    ...baseContext,
    materials: [{
      id: 'material_to_clear', type: 'image' as const,
      url: 'https://cdn.example.com/material.png', name: 'material.png',
    }],
    slots: { ...baseContext.slots, materialStatus: 'ready' as const },
  }
  const materialAdded = await turn('先讨论这张素材', materialContext, {}, new Set(), true)
  assert.equal(
    (materialAdded.find((event) => event.type === 'workspace_session') as { state: { context: { materials: unknown[] } } })
      .state.context.materials.length,
    1,
  )

  const staleWorkspaceEvents = [] as Array<{ type: string; [key: string]: unknown }>
  for await (const event of streamDirectorAgentChat({
    prompt: '保留这句话，等我基于最新方案重试',
    context: baseContext,
    runtime,
    workspaceSessionId: sessionId,
    workspaceStateRevision: 0,
    userId: 1,
  }, { composeFinalReply: preserveDeterministicReply })) staleWorkspaceEvents.push(event)
  assert.equal(
    (staleWorkspaceEvents.find((event) => event.type === 'error') as { code?: string }).code,
    'workspace_changed',
    'a stale workspace request must expose a stable recovery code instead of relying on message text',
  )
  const staleWorkspaceSnapshot = staleWorkspaceEvents.find((event) => event.type === 'workspace_session') as {
    stateRevision: number
    state: { context: { materials: unknown[] } }
  } | undefined
  assert.ok(staleWorkspaceSnapshot, 'a stale request must return the current workspace so the retry can advance')
  assert.ok(staleWorkspaceSnapshot.stateRevision > 0)
  assert.equal(staleWorkspaceSnapshot.state.context.materials.length, 1)
  const reloadWithoutRestoredMaterials = await turn('页面恢复后继续讨论', baseContext)
  assert.equal(
    (reloadWithoutRestoredMaterials.find((event) => event.type === 'workspace_session') as { state: { context: { materials: unknown[] } } })
      .state.context.materials.length,
    1,
    'an empty UI before restoration must not erase persisted materials',
  )
  assert.equal(
    (reloadWithoutRestoredMaterials.find((event) => event.type === 'workspace_session') as {
      state: { context: { slots: { materialStatus: string } } }
    }).state.context.slots.materialStatus,
    'ready',
    'material status must be derived from the preserved workspace materials, not an empty non-authoritative UI snapshot',
  )
  const explicitlyCleared = await turn('我已移除全部素材', baseContext, {}, new Set(), true)
  assert.equal(
    (explicitlyCleared.find((event) => event.type === 'workspace_session') as { state: { context: { materials: unknown[] } } })
      .state.context.materials.length,
    0,
    'an explicit empty material snapshot must clear persisted materials',
  )
  const sampleCandidateContext = {
    ...baseContext,
    materials: [{
      id: 'material_sample_video', type: 'video' as const,
      url: 'https://cdn.example.com/sample.mp4', name: 'sample.mp4',
    }],
    slots: { ...baseContext.slots, materialStatus: 'ready' as const },
  }
  const sampleCandidate = { id: 'material_sample_video', url: 'https://cdn.example.com/sample.mp4', name: 'sample.mp4' }
  const analyzedSample = await turn(
    '刚上传的视频就是样例，请分析，不要创建方案。',
    sampleCandidateContext,
    { hasVisualMaterial: true, materialCount: 1, sampleCandidates: [sampleCandidate] },
    new Set(),
    true,
  )
  const analyzedSampleState = (analyzedSample.find((event) => event.type === 'workspace_session') as {
    state: { context: { sampleVideo?: { id: string; reference?: { summary: string } }; materials: unknown[] } }
  }).state
  assert.equal(analyzedSampleState.context.sampleVideo?.id, 'material_sample_video')
  assert.equal(analyzedSampleState.context.sampleVideo?.reference?.summary, '通过逐步加快的切换从开篇推进到收束')
  assert.deepEqual(analyzedSampleState.context.materials, [], 'a selected sample must not remain a final-video material')
  const clearedSample = await turn('Remove the current sample.', baseContext, {}, new Set(), false, true)
  const clearedSampleState = (clearedSample.find((event) => event.type === 'workspace_session') as {
    state: { context: { sampleVideo?: unknown } }
  }).state
  assert.equal(clearedSampleState.context.sampleVideo, undefined, 'an explicit sample clear must persist')
  assert.equal(requests.length, 22)
} finally {
  globalThis.fetch = originalFetch
  await restoredDraftRepository.deleteDraft(restoredDraft.id, 1)
  await restoredDraftRepository.deleteDraft(otherDraft.id, 1)
}

console.log('[smoke] V2 director multi-turn session passed')
