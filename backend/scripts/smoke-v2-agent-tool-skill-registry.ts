import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

process.env.RENDER_COMPONENTS_DIR = mkdtempSync(path.join(os.tmpdir(), 'render-components-registry-'))

import { createDefaultDirectorSlots } from '../../shared/lib/director-understanding.js'
import { validateRemotionTimelineSpec } from '../../shared/lib/remotion-timeline-validator.js'
import {
  REMOTION_TIMELINE_TRANSITION_TYPES,
  type RemotionTimelineSpecV1,
} from '../../shared/types/remotion-timeline-spec.v1.js'
import { createDirectorWorkspaceState } from '../src/modules/director-agent/director-workspace-session.js'
import {
  listV2AgentSkillCards,
  resolveV2AgentExecutionPlan,
} from '../src/pipeline-v2/agent-skills/registry.js'
import {
  bindV2AgentToolArguments,
  evaluateV2AgentToolReadiness,
  findV2AgentTool,
  listV2AgentToolCards,
  validateV2AgentToolRequest,
} from '../src/pipeline-v2/agent-tools/registry.js'
import { dispatchV2AgentTool } from '../src/pipeline-v2/agent-tools/dispatcher.js'
import { buildV2TimelinePlannerPrompt } from '../src/pipeline-v2/remotion-timeline-llm-planner.js'

assert.deepEqual(listV2AgentToolCards().map((tool) => tool.id), [
  'sample.analyze', 'material.inspect', 'timeline.plan', 'timeline.patch', 'timeline.pending.dismiss', 'timeline.render', 'render.author',
])
assert.equal(findV2AgentTool('sample.analyze')?.requiresExplicitAuthorization, false)
assert.equal(findV2AgentTool('timeline.plan')?.requiresExplicitAuthorization, false)
assert.equal(findV2AgentTool('timeline.patch')?.requiresExplicitAuthorization, false)
assert.equal(findV2AgentTool('timeline.pending.dismiss')?.requiresExplicitAuthorization, true)
assert.equal(findV2AgentTool('timeline.render')?.requiresExplicitAuthorization, true)
assert.equal(listV2AgentToolCards().find((tool) => tool.id === 'timeline.patch')?.effectiveMode, 'preview')
assert.equal(listV2AgentToolCards().find((tool) => tool.id === 'timeline.render')?.effectiveMode, 'execute')
assert.deepEqual(REMOTION_TIMELINE_TRANSITION_TYPES, ['cut', 'fade', 'slide', 'wipe', 'light_flash', 'blur'])
const timelinePatchSummary = listV2AgentToolCards().find((tool) => tool.id === 'timeline.patch')?.summary ?? ''
assert.match(timelinePatchSummary, /structure/)
assert.match(timelinePatchSummary, /blur/)
assert.ok(listV2AgentSkillCards().some((skill) => skill.id === 'subtitle-track-authoring'))
for (const tool of listV2AgentToolCards()) {
  for (const skillId of tool.skills) {
    assert.ok(
      listV2AgentSkillCards().find((skill) => skill.id === skillId)?.allowedTools.includes(tool.id),
      `${skillId} manifest must allow ${tool.id}`,
    )
  }
}
assert.equal(validateV2AgentToolRequest({ callId: 'subtitle_001', toolId: 'timeline.patch', skillId: 'subtitle-track-authoring', arguments: { scope: 'subtitle' }, requestedMode: 'preview' }).ok, true)
const normalizedDraftMode = validateV2AgentToolRequest({
  callId: 'subtitle_history_001',
  toolId: 'timeline.patch',
  skillId: 'subtitle-track-authoring',
  arguments: { scope: 'subtitle', instruction: 'Add more audience-facing captions.' },
  requestedMode: 'execute',
})
assert.equal(normalizedDraftMode.ok, true)
assert.equal(normalizedDraftMode.ok ? normalizedDraftMode.effectiveMode : undefined, 'preview')
assert.equal(normalizedDraftMode.ok ? normalizedDraftMode.modeNormalized : undefined, true)
assert.equal(validateV2AgentToolRequest({ callId: 'subtitle_002', toolId: 'timeline.patch', skillId: 'subtitle-track-authoring', arguments: { scope: 'audio' }, requestedMode: 'preview' }).ok, false)
assert.equal(validateV2AgentToolRequest({ callId: 'unknown_001', toolId: 'audio.mix', skillId: 'subtitle-track-authoring', arguments: {}, requestedMode: 'execute' }).ok, false)
assert.equal(validateV2AgentToolRequest({ callId: 'plan_bad_001', toolId: 'timeline.plan', skillId: 'v2-timeline-authoring', arguments: { unknown: true }, requestedMode: 'preview' }).ok, false)
assert.equal(validateV2AgentToolRequest({ callId: 'render_bad_001', toolId: 'timeline.render', skillId: 'v2-render-delivery', arguments: {}, requestedMode: 'preview' }).ok, false)
assert.equal(validateV2AgentToolRequest({ callId: 'sample_bad_001', toolId: 'sample.analyze', skillId: 'sample-reference-analysis', arguments: { sampleId: 'foreign' }, requestedMode: 'preview' }).ok, false)
assert.equal(validateV2AgentToolRequest({ callId: 'render_bad_002', toolId: 'timeline.render', skillId: 'v2-render-delivery', arguments: { draftId: 'foreign', revision: 99 }, requestedMode: 'execute' }).ok, false)
assert.equal(validateV2AgentToolRequest({ callId: 'patch_bad_001', toolId: 'timeline.patch', skillId: 'subtitle-track-authoring', arguments: { scope: 'subtitle', targetIds: ['caption_1'] }, requestedMode: 'preview' }).ok, false)
assert.equal(validateV2AgentToolRequest({ callId: 'dismiss_001', toolId: 'timeline.pending.dismiss', skillId: 'v2-timeline-authoring', arguments: { callId: 'failed_patch_001' }, requestedMode: 'preview' }).ok, true)
assert.equal(validateV2AgentToolRequest({ callId: 'dismiss_bad_001', toolId: 'timeline.pending.dismiss', skillId: 'v2-timeline-authoring', arguments: {}, requestedMode: 'preview' }).ok, false)
assert.equal(validateV2AgentToolRequest({ callId: 'patch_scene_001', toolId: 'timeline.patch', skillId: 'subtitle-track-authoring', arguments: { scope: 'scene', sceneId: 'scene_2' }, requestedMode: 'preview' }).ok, true)
assert.equal(validateV2AgentToolRequest({ callId: 'patch_scene_002', toolId: 'timeline.patch', skillId: 'subtitle-track-authoring', arguments: { scope: 'scene' }, requestedMode: 'preview' }).ok, true)
assert.equal(validateV2AgentToolRequest({ callId: 'patch_global_001', toolId: 'timeline.patch', skillId: 'subtitle-track-authoring', arguments: { scope: 'global', mode: 'brief_update' }, requestedMode: 'preview' }).ok, true)
assert.equal(validateV2AgentToolRequest({ callId: 'patch_global_missing_mode', toolId: 'timeline.patch', skillId: 'subtitle-track-authoring', arguments: { scope: 'global' }, requestedMode: 'preview' }).ok, false)
assert.equal(validateV2AgentToolRequest({ callId: 'patch_bad_002', toolId: 'timeline.patch', skillId: 'subtitle-track-authoring', arguments: { scope: 'subtitle', sceneId: 'scene_2' }, requestedMode: 'preview' }).ok, true)
assert.equal(validateV2AgentToolRequest({
  callId: 'patch_caption_ids', toolId: 'timeline.patch', skillId: 'subtitle-track-authoring',
  arguments: { scope: 'subtitle', sceneId: 'scene_2', overlayIds: ['caption_dynamic_a'] }, requestedMode: 'preview',
}).ok, true)
assert.equal(validateV2AgentToolRequest({ callId: 'patch_vs_001', toolId: 'timeline.patch', skillId: 'subtitle-track-authoring', arguments: { scope: 'visual_strategy', sceneId: 'scene_2' }, requestedMode: 'preview' }).ok, true)
assert.equal(validateV2AgentToolRequest({
  callId: 'author_001',
  toolId: 'render.author',
  skillId: 'v2-render-delivery',
  arguments: {
    purpose: 'transition',
    displayName: '中心裂开',
    effectBrief: '画面从中心裂开并露出下一镜头',
    acceptanceCriteria: ['进入方向从闭合到完全展开', '退出方向从完全展开到闭合'],
  },
  requestedMode: 'preview',
}).ok, true)
assert.equal(validateV2AgentToolRequest({
  callId: 'author_bad_missing_name',
  toolId: 'render.author',
  skillId: 'v2-render-delivery',
  arguments: {
    purpose: 'transition',
    effectBrief: '画面从中心裂开并露出下一镜头',
    acceptanceCriteria: ['进入方向从闭合到完全展开'],
  },
  requestedMode: 'preview',
}).ok, false)
assert.equal(validateV2AgentToolRequest({
  callId: 'author_bad_001',
  toolId: 'render.author',
  skillId: 'v2-render-delivery',
  arguments: { purpose: 'transition', displayName: '', effectBrief: '', acceptanceCriteria: [] },
  requestedMode: 'preview',
}).ok, false)
assert.equal(validateV2AgentToolRequest({
  callId: 'author_bad_002',
  toolId: 'render.author',
  skillId: 'v2-render-delivery',
  arguments: {
    purpose: 'transition',
    displayName: '裂开展开',
    effectBrief: '裂开展开',
    acceptanceCriteria: ['画面从中心裂开'],
    source: 'export default function C() { return null }',
  },
  requestedMode: 'preview',
}).ok, false)
assert.equal(validateV2AgentToolRequest({ callId: 'patch_vs_002', toolId: 'timeline.patch', skillId: 'subtitle-track-authoring', arguments: { scope: 'visual_strategy' }, requestedMode: 'preview' }).ok, true)
assert.equal(validateV2AgentToolRequest({ callId: 'patch_bad_003', toolId: 'timeline.patch', skillId: 'subtitle-track-authoring', arguments: { scope: 'global', mode: 'full_replan', sceneId: 'scene_2' }, requestedMode: 'preview' }).ok, false)
assert.equal(validateV2AgentToolRequest({ callId: 'patch_transition_001', toolId: 'timeline.patch', skillId: 'v2-timeline-authoring', arguments: { scope: 'transition', transitionIds: ['transition_random_a', 'transition_random_b'], instruction: '只修改这两个转场' }, requestedMode: 'preview' }).ok, true)
assert.equal(validateV2AgentToolRequest({ callId: 'patch_transition_002', toolId: 'timeline.patch', skillId: 'v2-timeline-authoring', arguments: { scope: 'transition', transitionIds: [] }, requestedMode: 'preview' }).ok, false)
assert.equal(validateV2AgentToolRequest({
  callId: 'patch_resize_timeline', toolId: 'timeline.patch', skillId: 'v2-timeline-authoring',
  arguments: { scope: 'structure', sceneIds: ['scene_dynamic_a'], durationMode: 'resize_timeline' }, requestedMode: 'preview',
}).ok, true)
assert.equal(validateV2AgentToolRequest({ callId: 'patch_structure_001', toolId: 'timeline.patch', skillId: 'v2-timeline-authoring', arguments: { scope: 'structure', sceneIds: ['scene_random_a', 'scene_random_b'], instruction: '把这段连续镜头拆得更细' }, requestedMode: 'preview' }).ok, true)
assert.equal(validateV2AgentToolRequest({ callId: 'patch_structure_002', toolId: 'timeline.patch', skillId: 'v2-timeline-authoring', arguments: { scope: 'structure', sceneIds: ['scene_random_a', 'scene_random_a'] }, requestedMode: 'preview' }).ok, false)
assert.ok(listV2AgentToolCards().find((tool) => tool.id === 'timeline.patch')?.inputSchema)

const callIdContext = {
  workspaceSessionId: 'workspace_registry_smoke',
  turnRequestId: 'turn_registry_smoke',
}
const shortModelCallIdPlan = await resolveV2AgentExecutionPlan({
  intent: 'create',
  callIdContext,
  skillRequests: [{ skillId: 'v2-timeline-authoring', purpose: 'Create a V2 draft.' }],
  toolRequests: [{
    ref: 'gen_1',
    toolId: 'timeline.plan',
    skillId: 'v2-timeline-authoring',
    arguments: {},
    requestedMode: 'preview',
    dependsOn: [],
  }],
})
assert.equal(shortModelCallIdPlan.stages.length, 1)
assert.match(shortModelCallIdPlan.stages[0]!.toolRequest.callId, /^v2call_[a-f0-9]{24}$/)
assert.equal(shortModelCallIdPlan.stages[0]!.toolRequest.ref, 'gen_1')
const repeatedAliasPlan = await resolveV2AgentExecutionPlan({
  intent: 'create',
  callIdContext,
  skillRequests: [{ skillId: 'v2-timeline-authoring', purpose: 'Inspect then create.' }],
  toolRequests: [
    { ref: 'gen_1', toolId: 'material.inspect', skillId: 'v2-timeline-authoring', arguments: {}, requestedMode: 'preview', dependsOn: [] },
    { ref: 'gen_1', toolId: 'timeline.plan', skillId: 'v2-timeline-authoring', arguments: {}, requestedMode: 'preview', dependsOn: [] },
  ],
})
assert.equal(repeatedAliasPlan.stages.length, 1)
assert.match(repeatedAliasPlan.rejectedTools[0]?.reason ?? '', /duplicate action ref/)
const missingAliasPlan = await resolveV2AgentExecutionPlan({
  intent: 'execute',
  callIdContext: { ...callIdContext, turnRequestId: 'turn_missing_alias' },
  skillRequests: [{ skillId: 'v2-timeline-authoring', purpose: 'Inspect materials.' }],
  toolRequests: [{
    ref: 'inspect_materials',
    toolId: 'material.inspect',
    skillId: 'v2-timeline-authoring',
    arguments: {},
    requestedMode: 'preview',
    dependsOn: [],
  }],
})
assert.equal(missingAliasPlan.stages.length, 1)
const replayedMissingAliasPlan = await resolveV2AgentExecutionPlan({
  intent: 'execute',
  callIdContext: { ...callIdContext, turnRequestId: 'turn_missing_alias' },
  skillRequests: [{ skillId: 'v2-timeline-authoring', purpose: 'Inspect materials.' }],
  toolRequests: [{
    ref: 'inspect_materials',
    toolId: 'material.inspect',
    skillId: 'v2-timeline-authoring',
    arguments: {},
    requestedMode: 'preview',
    dependsOn: [],
  }],
})
assert.equal(
  replayedMissingAliasPlan.stages[0]!.toolRequest.callId,
  missingAliasPlan.stages[0]!.toolRequest.callId,
)

const executionPlan = await resolveV2AgentExecutionPlan({
  intent: 'revise',
  callIdContext: { ...callIdContext, turnRequestId: 'turn_subtitle_smoke' },
  skillRequests: [{ skillId: 'subtitle-track-authoring', purpose: '只修订当前字幕轨' }],
  toolRequests: [{
    ref: 'subtitle_003',
    toolId: 'timeline.patch',
    skillId: 'subtitle-track-authoring',
    arguments: { scope: 'subtitle', instruction: '把字幕改为两段顺序出现' },
    requestedMode: 'execute',
    dependsOn: [],
  }],
})
assert.equal(executionPlan.stages.length, 1)
assert.equal(executionPlan.stages[0]?.primarySkill.id, 'subtitle-track-authoring')
assert.equal(executionPlan.stages[0]?.toolRequest.requestedMode, 'preview')
assert.equal(executionPlan.stages[0]?.modeResolution.requestedMode, 'execute')
assert.equal(executionPlan.stages[0]?.modeResolution.effectiveMode, 'preview')
assert.equal(executionPlan.stages[0]?.modeResolution.normalized, true)
assert.ok(executionPlan.stages[0]?.primarySkill.content.includes('Audience-facing captions'))
assert.deepEqual(
  executionPlan.stages[0]?.references.map((item) => item.id),
  ['official.remotion-captions'],
)
assert.ok(executionPlan.stages[0]?.references[0]?.hash)
assert.equal(executionPlan.rejectedTools.length, 0)

const mismatchedPlan = await resolveV2AgentExecutionPlan({
  intent: 'revise',
  callIdContext: { ...callIdContext, turnRequestId: 'turn_mismatch_smoke' },
  skillRequests: [{ skillId: 'v2-timeline-authoring', purpose: '创建方案' }],
  toolRequests: [{
    ref: 'subtitle_004',
    toolId: 'timeline.patch',
    skillId: 'subtitle-track-authoring',
    arguments: { scope: 'subtitle', instruction: '修改字幕' },
    requestedMode: 'preview',
    dependsOn: [],
  }],
})
assert.equal(mismatchedPlan.stages.length, 1)
assert.equal(mismatchedPlan.stages[0]?.primarySkill.id, 'subtitle-track-authoring')

const duplicatePlan = await resolveV2AgentExecutionPlan({
  intent: 'execute',
  callIdContext: { ...callIdContext, turnRequestId: 'turn_duplicate_smoke' },
  skillRequests: [{ skillId: 'v2-timeline-authoring', purpose: '检查素材' }],
  toolRequests: [{
    ref: 'inspect_duplicate_001',
    toolId: 'material.inspect',
    skillId: 'v2-timeline-authoring',
    arguments: {},
    requestedMode: 'preview',
    dependsOn: [],
  }],
})
const duplicateContext = {
  materials: [],
  userIntent: {},
  slots: createDefaultDirectorSlots(),
}
const duplicateResult = await dispatchV2AgentTool({
  stage: duplicatePlan.stages[0]!,
  prompt: '检查当前素材',
  userId: 1,
  context: duplicateContext,
  runtime: {
    backendEnabled: true, sampleUrl: '', isSampleParsed: false,
    hasVisualMaterial: false, materialCount: 0,
  },
  workspace: {
    ...createDirectorWorkspaceState({ context: duplicateContext }),
    recentToolCallIds: [duplicatePlan.stages[0]!.toolRequest.callId],
  },
})
assert.equal(duplicateResult.ok, false)
assert.match(duplicateResult.summary, /重复/)

assert.equal(evaluateV2AgentToolReadiness({
  toolId: 'timeline.render', context: duplicateContext,
  runtime: { backendEnabled: true, sampleUrl: '', isSampleParsed: false, hasVisualMaterial: false, materialCount: 0 },
}).status, 'blocked')
const pendingRevisionReadiness = evaluateV2AgentToolReadiness({
  toolId: 'timeline.render', context: duplicateContext,
  runtime: { backendEnabled: true, sampleUrl: '', isSampleParsed: false, hasVisualMaterial: false, materialCount: 0 },
  workspace: {
    draftId: 'draft_pending_revision', baseRevision: 1,
    pendingTimelineRevisions: [{ instruction: 'apply a requested timeline edit', callId: 'patch_pending', baseRevision: 1 }],
  },
  authorizationGranted: true,
})
assert.equal(pendingRevisionReadiness.status, 'blocked')
assert.ok(pendingRevisionReadiness.missing.some((item) => item.code === 'timeline_revision_pending'))
const uniqueSampleCandidateReadiness = evaluateV2AgentToolReadiness({
  toolId: 'sample.analyze',
  context: {
    ...duplicateContext,
    materials: [{
      id: 'material_sample_candidate', type: 'video' as const,
      url: 'https://cdn.example.com/sample.mp4', name: 'sample.mp4',
    }],
  },
  runtime: {
    backendEnabled: true, sampleUrl: '', isSampleParsed: false,
    hasVisualMaterial: true, materialCount: 1,
    sampleCandidates: [{ id: 'material_sample_candidate', url: 'https://cdn.example.com/sample.mp4', name: 'sample.mp4' }],
  },
})
assert.equal(
  uniqueSampleCandidateReadiness.status,
  'ready',
  'the model may choose sample.analyze when the server can bind one unambiguous video candidate',
)
const activeDraftPlanReadiness = evaluateV2AgentToolReadiness({
  toolId: 'timeline.plan',
  context: duplicateContext,
  runtime: { backendEnabled: true, sampleUrl: '', isSampleParsed: false, hasVisualMaterial: false, materialCount: 0 },
  workspace: { draftId: 'draft_registry_active', baseRevision: 2 },
})
assert.equal(activeDraftPlanReadiness.status, 'blocked')
assert.equal(activeDraftPlanReadiness.missing[0]?.code, 'draft_already_exists')
assert.deepEqual(activeDraftPlanReadiness.alternatives, ['timeline.patch'])
assert.deepEqual(bindV2AgentToolArguments({
  modelArguments: {}, context: duplicateContext,
  workspace: { ...createDirectorWorkspaceState({ context: duplicateContext }), draftId: 'draft_server', baseRevision: 3 },
  userId: 7,
}).system, {
  userId: 7, sampleId: undefined, materialIds: [], draftId: 'draft_server', revision: 3,
})

const plannerPrompt = buildV2TimelinePlannerPrompt({
  taskId: 'skill_prompt_smoke',
  prompt: '把字幕改为两段顺序出现',
  creationMode: 'text_to_video',
  agentSkillContext: {
    primary: executionPlan.stages[0]!.primarySkill,
    references: executionPlan.stages[0]!.references,
  },
  agentToolContext: {
    callId: executionPlan.stages[0]!.toolRequest.callId,
    toolId: executionPlan.stages[0]!.toolRequest.toolId,
    arguments: executionPlan.stages[0]!.toolRequest.arguments,
  },
})
assert.match(plannerPrompt, /Audience-facing captions/)
assert.match(plannerPrompt, /official\.remotion-captions/)
assert.match(plannerPrompt, new RegExp(executionPlan.stages[0]!.toolRequest.callId))
assert.match(plannerPrompt, /Allowed transition types: cut, fade, slide, wipe, light_flash, blur\./)
assert.match(plannerPrompt, /image_motion cannot invent new visual elements/i)
assert.match(plannerPrompt, /remotion_card is an intentional typography or motion-graphics scene/i)
assert.match(plannerPrompt, /ai_video.*generate_video/i)

const base: RemotionTimelineSpecV1 = {
  schema_version: 'remotion_timeline_spec.v1', task_id: 'subtitle_track_smoke',
  canvas: { width: 1080, height: 1920, fps: 30, duration_sec: 4 }, assets: [],
  scenes: [{ id: 'scene_1', type: 'remotion_card', start_sec: 0, duration_sec: 4, title: 'test' }],
  transitions: [],
  caption_tracks: [{ id: 'caption_main', x_pct: 50, y_pct: 82, max_lines: 2, overlap_policy: 'allow_crossfade', enter_animation: 'fade', exit_animation: 'fade' }],
  overlays: [
    { id: 'caption_1', type: 'caption', scene_id: 'scene_1', track_id: 'caption_main', text: '第一句', start_sec: 0.5, end_sec: 1.8, x_pct: 50, y_pct: 82, max_lines: 2 },
    { id: 'caption_2', type: 'caption', scene_id: 'scene_1', track_id: 'caption_main', text: '第二句', start_sec: 1.65, end_sec: 3, x_pct: 50, y_pct: 82, max_lines: 2 },
  ],
  audio: [], material_jobs: [], render_policy: { renderer: 'remotion_timeline' },
}
assert.equal(validateRemotionTimelineSpec(base).ok, true)
const localImageGenerationSpec: RemotionTimelineSpecV1 = {
  ...base,
  assets: [{ id: 'local_input', type: 'image', source: 'user_asset', src: 'http://localhost:3001/uploads/local.png' }],
  scenes: [{
    ...base.scenes[0]!,
    type: 'ai_video',
    asset_id: 'generated_scene_1',
    creative_intent: { description: 'Use the supplied image as the generation composition.' },
  }],
  material_jobs: [{
    id: 'generate_scene_1', scene_id: 'scene_1', type: 'generate_video', status: 'planned',
    prompt: 'add natural motion', input_asset_id: 'local_input', output_asset_id: 'generated_scene_1',
  }],
}
const localImageReadiness = evaluateV2AgentToolReadiness({
  toolId: 'timeline.render',
  context: duplicateContext,
  runtime: { backendEnabled: true, sampleUrl: '', isSampleParsed: false, hasVisualMaterial: true, materialCount: 1 },
  workspace: { draftId: 'draft_local_image', baseRevision: 1 },
  authorizationGranted: true,
  timelineSpec: localImageGenerationSpec,
})
assert.equal(localImageReadiness.status, 'blocked')
assert.ok(localImageReadiness.missing.some((item) => item.code === 'generation_input_unreachable'))
const localImageFallbackSpec: RemotionTimelineSpecV1 = {
  ...localImageGenerationSpec,
  assets: [
    ...localImageGenerationSpec.assets,
    { id: 'local_fallback', type: 'image', source: 'generated_asset', src: 'https://cdn.example.com/fallback.png' },
  ],
  material_jobs: localImageGenerationSpec.material_jobs.map((job) => ({
    ...job,
    fallback_asset_id: 'local_fallback',
    fallback_kind: 'static_image' as const,
  })),
}
assert.equal(validateRemotionTimelineSpec(localImageFallbackSpec).ok, true)
const localImageFallbackReadiness = evaluateV2AgentToolReadiness({
  toolId: 'timeline.render',
  context: duplicateContext,
  runtime: { backendEnabled: true, sampleUrl: '', isSampleParsed: false, hasVisualMaterial: true, materialCount: 1 },
  workspace: { draftId: 'draft_local_image_fallback', baseRevision: 1 },
  authorizationGranted: true,
  timelineSpec: localImageFallbackSpec,
})
assert.equal(
  localImageFallbackReadiness.status,
  'blocked',
  'a visual fallback may keep a draft reviewable, but it cannot satisfy formal generated-video delivery readiness',
)
assert.ok(localImageFallbackReadiness.missing.some((item) => item.code === 'generation_input_unreachable'))
const fallbackWithoutOutputSpec: RemotionTimelineSpecV1 = {
  ...localImageFallbackSpec,
  material_jobs: localImageFallbackSpec.material_jobs.map((job) => ({
    ...job,
    output_asset_id: undefined,
  })),
}
const fallbackWithoutOutputValidation = validateRemotionTimelineSpec(fallbackWithoutOutputSpec)
assert.equal(
  fallbackWithoutOutputValidation.ok,
  false,
  'generate_video needs an output asset id even when a fallback is available',
)
assert.ok(fallbackWithoutOutputValidation.issues.some((issue) => issue.path === 'material_jobs[0].output_asset_id'))
const fallbackWithoutOutputReadiness = evaluateV2AgentToolReadiness({
  toolId: 'timeline.render',
  context: duplicateContext,
  runtime: { backendEnabled: true, sampleUrl: '', isSampleParsed: false, hasVisualMaterial: true, materialCount: 1 },
  workspace: { draftId: 'draft_fallback_without_output', baseRevision: 1 },
  authorizationGranted: true,
  timelineSpec: fallbackWithoutOutputSpec,
})
assert.equal(fallbackWithoutOutputReadiness.status, 'blocked')
assert.ok(fallbackWithoutOutputReadiness.missing.some((item) => item.code === 'material_output_missing'))
const failedBlankCardSpec: RemotionTimelineSpecV1 = {
  ...base,
  material_jobs: [{
    id: 'failed_blank_card',
    scene_id: 'scene_1',
    type: 'generate_video',
    status: 'failed',
    prompt: 'generation failed and the scene was converted to a card',
    fallback_kind: 'blank_card',
  }],
}
assert.equal(
  validateRemotionTimelineSpec(failedBlankCardSpec).ok,
  true,
  'a terminal blank-card fallback no longer requires a generated output asset',
)
const failedBlankCardReadiness = evaluateV2AgentToolReadiness({
  toolId: 'timeline.render',
  context: duplicateContext,
  runtime: { backendEnabled: true, sampleUrl: '', isSampleParsed: false, hasVisualMaterial: false, materialCount: 0 },
  workspace: { draftId: 'draft_failed_blank_card', baseRevision: 1 },
  authorizationGranted: true,
  timelineSpec: failedBlankCardSpec,
})
assert.equal(failedBlankCardReadiness.status, 'blocked')
assert.ok(failedBlankCardReadiness.missing.some((item) => item.code === 'material_generation_failed'))
const staleFulfilledSpec: RemotionTimelineSpecV1 = {
  ...base,
  scenes: [{ ...base.scenes[0]!, type: 'ai_video', asset_id: 'missing_generated_asset' }],
  material_jobs: [{
    id: 'stale_fulfilled_job', scene_id: 'scene_1', type: 'request_user_material', status: 'fulfilled',
    prompt: 'request missing footage', output_asset_id: 'missing_generated_asset',
  }],
}
const staleFulfilledReadiness = evaluateV2AgentToolReadiness({
  toolId: 'timeline.render',
  context: duplicateContext,
  runtime: { backendEnabled: true, sampleUrl: '', isSampleParsed: false, hasVisualMaterial: false, materialCount: 0 },
  workspace: { draftId: 'draft_stale_fulfilled', baseRevision: 1 },
  authorizationGranted: true,
  timelineSpec: staleFulfilledSpec,
})
assert.equal(staleFulfilledReadiness.status, 'blocked')
assert.ok(staleFulfilledReadiness.missing.some((item) => item.code === 'material_output_missing'))
const incompleteReuseSpec: RemotionTimelineSpecV1 = {
  ...base,
  material_jobs: [{
    id: 'reuse_without_output', scene_id: 'scene_1', type: 'reuse_asset', status: 'planned',
  }],
}
assert.equal(
  validateRemotionTimelineSpec(incompleteReuseSpec).ok,
  false,
  'reuse_asset is never executable without a real output asset',
)
const incompleteReuseReadiness = evaluateV2AgentToolReadiness({
  toolId: 'timeline.render',
  context: duplicateContext,
  runtime: { backendEnabled: true, sampleUrl: '', isSampleParsed: false, hasVisualMaterial: false, materialCount: 0 },
  workspace: { draftId: 'draft_incomplete_reuse', baseRevision: 1 },
  authorizationGranted: true,
  timelineSpec: incompleteReuseSpec,
})
assert.equal(incompleteReuseReadiness.status, 'blocked')
assert.ok(incompleteReuseReadiness.missing.some((item) => item.code === 'material_output_missing'))
const invalid = structuredClone(base)
invalid.overlays[1].start_sec = 1
assert.equal(validateRemotionTimelineSpec(invalid).ok, false)

console.log('V2 agent tool/skill registry smoke passed.')
rmSync(process.env.RENDER_COMPONENTS_DIR!, { recursive: true, force: true })
