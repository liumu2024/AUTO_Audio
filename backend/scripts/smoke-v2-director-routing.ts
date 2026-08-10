import assert from 'node:assert/strict'

import {
  createDefaultDirectorSlots,
  summarizeDirectorReference,
  type DirectorConversationRuntime,
} from '../../shared/lib/director-understanding.js'
import type { DirectorContext } from '../../shared/types/director-context.js'
import {
  buildDirectorContextFallback,
  buildDirectorModelPrompt,
  compactDirectorContextForPrompt,
  parseDirectorModelDecision,
} from '../src/modules/director-agent/llm-intent-router.ts'

const context: DirectorContext = {
  materials: [],
  userIntent: { goal: 'generate_timeline' },
  slots: createDefaultDirectorSlots(),
}
const runtime = (overrides: Partial<DirectorConversationRuntime> = {}): DirectorConversationRuntime => ({
  backendEnabled: true,
  sampleUrl: '',
  isSampleParsed: false,
  hasV2Timeline: false,
  hasVisualMaterial: false,
  materialCount: 0,
  ...overrides,
})

const prompt = buildDirectorModelPrompt({
  prompt: '继续按刚才的方向调整第二段。',
  context,
  runtime: runtime(),
  confirmedRequirements: [
    { id: 'req_active', statement: '画面使用中性低饱和色调', status: 'active', sourceTurnId: 'turn_2' },
    { id: 'req_old', statement: '画面使用暖色调', status: 'superseded', sourceTurnId: 'turn_1', supersededBy: 'req_active' },
  ],
})
assert.match(prompt, /当前输入决定本轮目标/)
assert.match(prompt, /历史摘要和最近对话只帮助理解/)
assert.match(prompt, /targetRequirementId/)
assert.doesNotMatch(prompt, /nextAction|executionEffect|conversationIntent|slotsPatch/)
assert.match(prompt, /req_active/)
assert.match(prompt, /req_old/)
assert.doesNotMatch(prompt, /cmp_blur_dissolve/)

const withComponents = buildDirectorModelPrompt({
  prompt: '给第五段加一个粒子消散效果。',
  context,
  runtime: runtime(),
  promotedComponents: [{ id: 'cmp_blur_dissolve', purpose: 'transition', displayName: '模糊溶解', effectSummary: '模糊溶解转场' }],
})
assert.match(withComponents, /renderedComponents/)
assert.match(withComponents, /cmp_blur_dissolve/)
assert.match(withComponents, /render\.author 创作组件/)
assert.match(withComponents, /image_motion.*不能生成原图中不存在的内容/i)
assert.match(withComponents, /generate_video/i)

const reference = summarizeDirectorReference({
  schema_version: 'v2_sample_understanding.v1', task_id: 'sample_many_shots', source: 'llm',
  sample: { duration_sec: 12 }, summary_zh: 'continuous action sample', story_zh: 'story arc',
  atmosphere_zh: 'tense', editing_zh: 'rapid cuts', rhythm_zh: 'accelerating',
  reusable_style_zh: 'match cuts', not_reusable_zh: '', segments: [{
    id: 'chapter_1', title_zh: 'conflict', start_sec: 0, end_sec: 12,
    visual_content_zh: 'chase', characters_objects_zh: 'people and vehicles', atmosphere_zh: 'tense',
    camera_zh: 'varied shots', motion_zh: 'fast', editing_zh: 'continuous cuts', rhythm_zh: 'accelerating',
    reusable_style_zh: 'match cuts', material_hint_zh: 'action material',
  }],
  shot_evidence: Array.from({ length: 6 }, (_, index) => ({
    id: `shot_${index + 1}`, start_sec: index * 2, end_sec: (index + 1) * 2,
    boundary: index === 5 ? 'end' as const : 'hard_cut' as const, confidence: 0.9,
  })),
  questions_for_user_zh: [], warnings_zh: [],
})
assert.equal(reference.segmentCount, 1)
assert.equal(reference.shotCount, 6)
const withReference = compactDirectorContextForPrompt({
  prompt: 'follow the reference structure',
  context: { ...context, sampleVideo: { id: 'sample_1', url: '/uploads/sample.mp4', reference } },
  runtime: runtime({ sampleUrl: '/uploads/sample.mp4', isSampleParsed: true }),
})
assert.equal(withReference.sampleVideo?.reference?.segmentCount, 1)
assert.equal(withReference.sampleVideo?.reference?.shotCount, 6)
assert.equal(withReference.sampleVideo?.reference?.editing, 'rapid cuts')

const chat = parseDirectorModelDecision(JSON.stringify({
  replyDraft: '这版可以继续沿用中性低饱和。',
  intent: 'chat',
  creativeConfigDelta: {},
  stateActions: [],
  skillRequests: [],
  toolRequests: [],
  missingInformation: [],
}))
assert.equal(chat.intent, 'chat')
assert.equal(chat.stateActions.length, 0)

const requirementAndRevision = parseDirectorModelDecision(JSON.stringify({
  replyDraft: '我会更新要求并调整字幕。',
  intent: 'revise',
  creativeConfigDelta: {},
  stateActions: [{
    ref: 'requirements',
    kind: 'requirements.update',
    operations: [{ operation: 'replace', targetRequirementId: 'req_active', statement: '画面使用低饱和蓝灰色' }],
  }],
  skillRequests: [{ skillId: 'subtitle-track-authoring', purpose: '修订字幕' }],
  toolRequests: [{
    ref: 'patch', toolId: 'timeline.patch', skillId: 'subtitle-track-authoring',
    arguments: { scope: 'subtitle' }, requestedMode: 'preview', dependsOn: ['requirements'],
  }],
  missingInformation: [],
}))
assert.equal(requirementAndRevision.toolRequests[0]?.dependsOn[0], 'requirements')

const capabilityContext = compactDirectorContextForPrompt({
  prompt: '渲染当前版本',
  context,
  runtime: runtime(),
})
const renderReadiness = capabilityContext.capabilitySnapshot.find((item) => item.toolId === 'timeline.render')
assert.equal(renderReadiness?.status, 'blocked')
assert.equal(renderReadiness?.missing[0]?.code, 'draft_missing')
const savedResourceReadiness = compactDirectorContextForPrompt({
  prompt: 'render the saved draft',
  context: {
    ...context,
    currentTimeline: { kind: 'v2_timeline', status: 'saved', draftId: 'draft_resource_gap', currentRevision: 1 },
  },
  runtime: runtime({ hasV2Timeline: true }),
  timelineSpec: {
    schema_version: 'remotion_timeline_spec.v1', task_id: 'resource_gap',
    canvas: { width: 1080, height: 1920, fps: 30, duration_sec: 3 }, assets: [],
    scenes: [{ id: 'scene_1', type: 'remotion_card', start_sec: 0, duration_sec: 3 }],
    transitions: [], overlays: [], audio: [], render_policy: { renderer: 'remotion_timeline' },
    material_jobs: [{
      id: 'need_material', scene_id: 'scene_1', type: 'request_user_material', status: 'planned',
      prompt: 'supply source material',
    }],
  },
})
const savedRenderReadiness = savedResourceReadiness.capabilitySnapshot.find((item) => item.toolId === 'timeline.render')
assert.equal(savedRenderReadiness?.status, 'blocked')
assert.equal(savedRenderReadiness?.missing[0]?.code, 'user_material_required')

const fallback = buildDirectorContextFallback({
  prompt: '字幕和转场怎么调整？',
  context: {
    ...context,
    currentTimeline: { kind: 'v2_timeline', status: 'draft', draftId: 'draft_random', currentRevision: 4 },
  },
  runtime: runtime({ hasV2Timeline: true }),
  reason: 'test outage',
})
assert.equal(fallback.result.executionEffect, 'none')
assert.equal(fallback.result.nextAction, 'ACKNOWLEDGE')
assert.deepEqual(fallback.stateActions, [])
assert.match(fallback.result.assistantMessage, /字幕和转场/)
assert.match(fallback.result.assistantMessage, /修订 4/)

console.info('[smoke-v2-director-routing] OK')
