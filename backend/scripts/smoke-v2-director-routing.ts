import assert from 'node:assert/strict'

import {
  buildDirectorContextFallback,
  finalizeModelDecision,
  parseDirectorModelDecision,
} from '../src/modules/director-agent/llm-intent-router.ts'
import { createDefaultDirectorSlots, type DirectorConversationRuntime } from '../../shared/lib/director-understanding.js'
import { buildV2TimelineRequestShape } from '../../shared/lib/v2-timeline-request-shape.js'
import type { DirectorContext, DirectorIntentResult } from '../../shared/types/director-context.js'

const context: DirectorContext = {
  materials: [],
  userIntent: { goal: 'generate_timeline' },
  slots: createDefaultDirectorSlots(),
}

function runtime(overrides: Partial<DirectorConversationRuntime> = {}): DirectorConversationRuntime {
  return {
    backendEnabled: true,
    sampleUrl: '',
    isSampleParsed: false,
    hasV2Timeline: false,
    hasVisualMaterial: false,
    materialCount: 0,
    ...overrides,
  }
}

function decision(overrides: Partial<DirectorIntentResult> = {}): DirectorIntentResult {
  return {
    intent: 'clarify',
    confidence: 0.9,
    contentDomain: 'general',
    slotsPatch: {},
    missingSlots: [],
    requiresConfirmation: false,
    nextAction: 'ACKNOWLEDGE',
    executionEffect: 'none',
    assistantMessage: '自然回复。',
    ...overrides,
  }
}

// A non-executing answer may serialize the optional execution-only evidence as
// an empty string. It must still reach the user as the model's own answer.
const freeConversation = parseDirectorModelDecision(
  JSON.stringify({
    intent: 'clarify',
    confidence: 0.82,
    contentDomain: 'general',
    slotsPatch: {},
    missingSlots: [],
    requiresConfirmation: false,
    executionEffect: 'none',
    authorizationEvidence: '',
    nextAction: 'ACKNOWLEDGE',
    assistantMessage: '我会先根据画面内容设计字幕的语气、位置和节奏，再给出几个可选方向。',
    publicThoughts: [],
  }),
)
assert.equal(freeConversation.authorizationEvidence, undefined)
assert.equal(freeConversation.assistantMessage, '我会先根据画面内容设计字幕的语气、位置和节奏，再给出几个可选方向。')

// Older model prompts sometimes put the V2 branch in the retired UI field.
// It remains auditable as v2CreationMode, but cannot poison V2 slots or
// invalidate an otherwise valid create decision.
const compatibleCreationMode = parseDirectorModelDecision(
  JSON.stringify({
    intent: 'generate_timeline', confidence: 0.91, contentDomain: 'general',
    slotsPatch: { generationMode: 'text_to_video' }, missingSlots: [],
    requiresConfirmation: false, executionEffect: 'draft_change',
    authorizationEvidence: '请生成一版无素材文生视频方案', nextAction: 'GENERATE_TIMELINE',
    assistantMessage: '我会创建一版可编辑的 V2 文生视频方案。', publicThoughts: [],
    statePatch: {}, requirements: [],
  }),
)
assert.equal(compatibleCreationMode.v2CreationMode, 'text_to_video')
assert.deepEqual(compatibleCreationMode.slotsPatch, {})

// A question may contain production vocabulary, but the model's no-effect
// decision remains authoritative. No keyword matcher may turn it into work.
const discussion = finalizeModelDecision({
  llmResult: decision({
    nextAction: 'RENDER',
    executionEffect: 'none',
    assistantMessage: '我会先解释字幕和节奏的取舍。',
  }),
  context,
  runtime: runtime({ hasV2Timeline: true, v2SceneCount: 3 }),
})
assert.equal(discussion.executionEffect, 'none')
assert.equal(discussion.nextAction, 'ACKNOWLEDGE')

// A model outage must preserve the actual question and V2 facts, but must not
// infer a side effect from any words in that question.
const contextualFallback = buildDirectorContextFallback({
  prompt: '字幕和转场怎么才能更像一支呼吸感强的音乐短片？',
  context: {
    ...context,
    materials: [{ id: 'img_1', type: 'image', url: 'https://example.test/1.png', name: '海边.png' }],
    currentTimeline: {
      kind: 'v2_timeline',
      status: 'draft',
      draftId: 'draft_1',
      currentRevision: 4,
    },
  },
  runtime: runtime({ hasV2Timeline: true, v2SceneCount: 3 }),
  reason: 'test outage',
})
assert.equal(contextualFallback.source, 'context_fallback')
assert.equal(contextualFallback.result.executionEffect, 'none')
assert.equal(contextualFallback.result.nextAction, 'ACKNOWLEDGE')
assert.match(contextualFallback.result.assistantMessage, /字幕和转场/)
assert.match(contextualFallback.result.assistantMessage, /修订 4/)

const revision = finalizeModelDecision({
  llmResult: decision({
    intent: 'revise_timeline',
    nextAction: 'REVISE_TIMELINE',
    executionEffect: 'draft_change',
    authorizationEvidence: '把第二段改得更克制，并生成一版新方案',
  }),
  context,
  runtime: runtime({ hasV2Timeline: true, v2SceneCount: 3 }),
})
assert.equal(revision.executionEffect, 'draft_change')
assert.equal(revision.nextAction, 'REVISE_TIMELINE')

const createWithoutQuotedEvidence = finalizeModelDecision({
  llmResult: decision({
    intent: 'generate_timeline',
    nextAction: 'GENERATE_TIMELINE',
    executionEffect: 'draft_change',
    authorizationEvidence: undefined,
  }),
  context,
  runtime: runtime(),
})
assert.equal(createWithoutQuotedEvidence.executionEffect, 'draft_change')
assert.equal(createWithoutQuotedEvidence.nextAction, 'GENERATE_TIMELINE')

// An uploaded video is not automatically a sample. The director may select a
// declared candidate only through its structured id, and code verifies it.
const selectedSampleCandidate = finalizeModelDecision({
  llmResult: decision({
    intent: 'analyze_sample',
    nextAction: 'ANALYZE_SAMPLE',
    executionEffect: 'workspace_change',
    authorizationEvidence: '把刚上传的视频作为样例拆解。',
    slotsPatch: { sampleMaterialId: 'video_material_1' },
  }),
  context,
  runtime: runtime({
    sampleCandidates: [
      { id: 'video_material_1', url: 'https://example.test/sample.mp4', name: 'sample.mp4' },
    ],
  }),
})
assert.equal(selectedSampleCandidate.executionEffect, 'workspace_change')
assert.equal(selectedSampleCandidate.nextAction, 'ANALYZE_SAMPLE')

const unknownSampleCandidate = finalizeModelDecision({
  llmResult: decision({
    intent: 'analyze_sample',
    nextAction: 'ANALYZE_SAMPLE',
    executionEffect: 'workspace_change',
    authorizationEvidence: '把刚上传的视频作为样例拆解。',
    slotsPatch: { sampleMaterialId: 'not_in_context' },
  }),
  context,
  runtime: runtime(),
})
assert.equal(unknownSampleCandidate.executionEffect, 'none')
assert.equal(unknownSampleCandidate.nextAction, 'NEED_SAMPLE')

const ungroundedOperation = finalizeModelDecision({
  llmResult: decision({
    intent: 'render',
    nextAction: 'RENDER',
    executionEffect: 'delivery',
  }),
  context,
  runtime: runtime({ hasV2Timeline: true, v2SceneCount: 3 }),
})
assert.equal(ungroundedOperation.executionEffect, 'none')
assert.equal(ungroundedOperation.nextAction, 'ASK_USER')

const missingTimelineDelivery = finalizeModelDecision({
  llmResult: decision({
    intent: 'render',
    nextAction: 'RENDER',
    executionEffect: 'delivery',
    authorizationEvidence: '请渲染当前版本',
  }),
  context,
  runtime: runtime(),
})
assert.equal(missingTimelineDelivery.executionEffect, 'none')
assert.deepEqual(missingTimelineDelivery.missingSlots, ['timeline'])

assert.deepEqual(
  buildV2TimelineRequestShape({ sampleVideoPath: undefined, materials: [] }),
  {
    creationMode: 'text_to_video',
    mainVideoPath: undefined,
    referenceVideoPath: undefined,
    imageSrc: undefined,
    inputImageUrl: undefined,
    materials: [],
    sourceUrl: '',
  },
)

console.info('[smoke-v2-director-routing] OK')
