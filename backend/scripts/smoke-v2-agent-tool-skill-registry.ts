import assert from 'node:assert/strict'

import { createDefaultDirectorSlots } from '../../shared/lib/director-understanding.js'
import { validateRemotionTimelineSpec } from '../../shared/lib/remotion-timeline-validator.js'
import type { RemotionTimelineSpecV1 } from '../../shared/types/remotion-timeline-spec.v1.js'
import { createDirectorWorkspaceState } from '../src/modules/director-agent/director-workspace-session.js'
import {
  listV2AgentSkillCards,
  resolveV2AgentExecutionPlan,
} from '../src/pipeline-v2/agent-skills/registry.js'
import {
  findV2AgentTool,
  listV2AgentToolCards,
  validateV2AgentToolRequest,
} from '../src/pipeline-v2/agent-tools/registry.js'
import { dispatchV2AgentTool } from '../src/pipeline-v2/agent-tools/dispatcher.js'
import { buildV2TimelinePlannerPrompt } from '../src/pipeline-v2/remotion-timeline-llm-planner.js'

assert.deepEqual(listV2AgentToolCards().map((tool) => tool.id), [
  'sample.analyze', 'material.inspect', 'timeline.plan', 'timeline.patch', 'timeline.render',
])
assert.equal(findV2AgentTool('sample.analyze')?.requiresExplicitAuthorization, false)
assert.equal(findV2AgentTool('timeline.plan')?.requiresExplicitAuthorization, false)
assert.equal(findV2AgentTool('timeline.patch')?.requiresExplicitAuthorization, false)
assert.equal(findV2AgentTool('timeline.render')?.requiresExplicitAuthorization, true)
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
assert.equal(validateV2AgentToolRequest({ callId: 'subtitle_002', toolId: 'timeline.patch', skillId: 'subtitle-track-authoring', arguments: { scope: 'audio' }, requestedMode: 'preview' }).ok, false)
assert.equal(validateV2AgentToolRequest({ callId: 'unknown_001', toolId: 'audio.mix', skillId: 'subtitle-track-authoring', arguments: {}, requestedMode: 'execute' }).ok, false)
assert.equal(validateV2AgentToolRequest({ callId: 'plan_bad_001', toolId: 'timeline.plan', skillId: 'v2-timeline-authoring', arguments: { unknown: true }, requestedMode: 'preview' }).ok, false)
assert.equal(validateV2AgentToolRequest({ callId: 'render_bad_001', toolId: 'timeline.render', skillId: 'v2-render-delivery', arguments: {}, requestedMode: 'preview' }).ok, false)
assert.ok(listV2AgentToolCards().find((tool) => tool.id === 'timeline.patch')?.inputSchema)

const executionPlan = await resolveV2AgentExecutionPlan({
  skillRequests: [{ skillId: 'subtitle-track-authoring', purpose: '只修订当前字幕轨' }],
  toolRequests: [{
    callId: 'subtitle_003',
    toolId: 'timeline.patch',
    skillId: 'subtitle-track-authoring',
    arguments: { scope: 'subtitle', instruction: '把字幕改为两段顺序出现' },
    requestedMode: 'preview',
  }],
})
assert.equal(executionPlan.stages.length, 1)
assert.equal(executionPlan.stages[0]?.primarySkill.id, 'subtitle-track-authoring')
assert.ok(executionPlan.stages[0]?.primarySkill.content.includes('Audience-facing captions'))
assert.deepEqual(
  executionPlan.stages[0]?.references.map((item) => item.id),
  ['official.remotion-captions'],
)
assert.ok(executionPlan.stages[0]?.references[0]?.hash)
assert.equal(executionPlan.rejectedTools.length, 0)

const mismatchedPlan = await resolveV2AgentExecutionPlan({
  skillRequests: [{ skillId: 'v2-timeline-authoring', purpose: '创建方案' }],
  toolRequests: [{
    callId: 'subtitle_004',
    toolId: 'timeline.patch',
    skillId: 'subtitle-track-authoring',
    arguments: { scope: 'subtitle', instruction: '修改字幕' },
    requestedMode: 'preview',
  }],
})
assert.equal(mismatchedPlan.stages.length, 0)
assert.match(mismatchedPlan.rejectedTools[0]?.reason ?? '', /not selected/i)

const duplicatePlan = await resolveV2AgentExecutionPlan({
  skillRequests: [{ skillId: 'v2-timeline-authoring', purpose: '检查素材' }],
  toolRequests: [{
    callId: 'inspect_duplicate_001',
    toolId: 'material.inspect',
    skillId: 'v2-timeline-authoring',
    arguments: {},
    requestedMode: 'preview',
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
  workspace: {
    ...createDirectorWorkspaceState({ context: duplicateContext }),
    recentToolCallIds: ['inspect_duplicate_001'],
  },
})
assert.equal(duplicateResult.ok, false)
assert.match(duplicateResult.summary, /重复/)

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
assert.match(plannerPrompt, /subtitle_003/)

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
  audio: [], material_jobs: [], render_policy: { renderer: 'remotion_timeline', allow_custom_component: false },
}
assert.equal(validateRemotionTimelineSpec(base).ok, true)
const invalid = structuredClone(base)
invalid.overlays[1].start_sec = 1
assert.equal(validateRemotionTimelineSpec(invalid).ok, false)

console.log('V2 agent tool/skill registry smoke passed.')
