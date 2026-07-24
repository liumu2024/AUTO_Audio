import assert from 'node:assert/strict'

import { applyDirectorIntentHardGuards } from '../src/modules/director-agent/llm-intent-router.ts'
import { directorActionFromIntentResult } from '../../shared/lib/director-action-engine.js'
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
    hasPipeline: false,
    hasV2Timeline: false,
    hasVisualMaterial: false,
    materialCount: 0,
    ...overrides,
  }
}

function generationResult(): DirectorIntentResult {
  return {
    intent: 'generate_timeline',
    confidence: 0.9,
    contentDomain: 'general',
    slotsPatch: {},
    missingSlots: [],
    requiresConfirmation: false,
    nextAction: 'GENERATE_TIMELINE',
    assistantMessage: '生成一版方案。',
  }
}

const textOnly = applyDirectorIntentHardGuards({
  llmResult: generationResult(),
  prompt: '生成一支 15 秒的雨后城市氛围视频',
  context,
  runtime: runtime(),
})
assert.equal(textOnly.nextAction, 'GENERATE_TIMELINE')
assert.deepEqual(textOnly.missingSlots, [])
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

const singleVideoMaterial = applyDirectorIntentHardGuards({
  llmResult: generationResult(),
  prompt: '用我上传的视频做一支 15 秒的产品短片',
  context: {
    ...context,
    materials: [{ id: 'video_material', type: 'video', url: 'file:///material.mp4' }],
  },
  runtime: runtime({ hasVisualMaterial: true, materialCount: 1 }),
})
assert.equal(singleVideoMaterial.nextAction, 'GENERATE_TIMELINE')
assert.deepEqual(singleVideoMaterial.missingSlots, [])
const videoMaterial = {
  id: 'video_material',
  name: 'material.mp4',
  type: 'video' as const,
  src: 'https://cdn.example.test/material.mp4',
}
const materialRequest = buildV2TimelineRequestShape({
  sampleVideoPath: undefined,
  materials: [videoMaterial],
})
assert.equal(materialRequest.creationMode, 'material_brief')
assert.equal(materialRequest.referenceVideoPath, undefined)
assert.deepEqual(materialRequest.materials, [videoMaterial])

const sampleAndMaterialRequest = buildV2TimelineRequestShape({
  sampleVideoPath: 'https://cdn.example.test/sample.mp4',
  materials: [videoMaterial],
})
assert.equal(sampleAndMaterialRequest.creationMode, 'sample_replicate')
assert.equal(sampleAndMaterialRequest.referenceVideoPath, 'https://cdn.example.test/sample.mp4')
assert.deepEqual(sampleAndMaterialRequest.materials, [videoMaterial])

const explicitSampleWithoutVideo = applyDirectorIntentHardGuards({
  llmResult: generationResult(),
  prompt: '复刻这条样例视频的镜头和节奏',
  context,
  runtime: runtime(),
})
assert.equal(explicitSampleWithoutVideo.nextAction, 'NEED_SAMPLE')
assert.deepEqual(explicitSampleWithoutVideo.missingSlots, ['sampleVideoStatus'])
const blockedSampleAction = directorActionFromIntentResult({
  prompt: '复刻这条样例视频的镜头和节奏',
  context,
  runtime: runtime(),
  result: explicitSampleWithoutVideo,
})
assert.equal(blockedSampleAction.type, 'ASK_USER')
assert.ok(
  blockedSampleAction.payload?.executionPlan?.steps.every(
    (step) => step.tool !== 'timeline.plan' && step.tool !== 'video.render',
  ),
)

// A concrete edit request can omit words such as "modify". When a V2 timeline
// is already open, edit constraints must not be upgraded to a render merely
// because the intent model returned RENDER.
const timelineEditWithoutDeliveryCommand = applyDirectorIntentHardGuards({
  llmResult: {
    intent: 'render',
    confidence: 0.86,
    contentDomain: 'general',
    slotsPatch: {},
    missingSlots: [],
    requiresConfirmation: false,
    nextAction: 'RENDER',
    assistantMessage: '渲染当前方案',
  },
  prompt: '请让声音和镜头之间的过渡更平顺，并统一字幕的呈现方式。',
  context,
  runtime: runtime({ hasPipeline: true, hasV2Timeline: true, v2SceneCount: 3 }),
})
assert.equal(timelineEditWithoutDeliveryCommand.nextAction, 'REVISE_TIMELINE')

const modelRenderWithoutDeliveryCommand = applyDirectorIntentHardGuards({
  llmResult: {
    ...timelineEditWithoutDeliveryCommand,
    intent: 'render',
    nextAction: 'RENDER',
  },
  prompt: '就这样继续。',
  context,
  runtime: runtime({ hasPipeline: true, hasV2Timeline: true, v2SceneCount: 3 }),
})
assert.equal(modelRenderWithoutDeliveryCommand.nextAction, 'ASK_USER')
assert.equal(modelRenderWithoutDeliveryCommand.requiresConfirmation, true)

const explicitEditThenRender = applyDirectorIntentHardGuards({
  llmResult: {
    ...timelineEditWithoutDeliveryCommand,
    intent: 'render',
    nextAction: 'RENDER',
  },
  prompt: '先把字幕改成透明，再渲染。',
  context,
  runtime: runtime({ hasPipeline: true, hasV2Timeline: true, v2SceneCount: 3 }),
})
assert.equal(explicitEditThenRender.nextAction, 'RENDER')

console.info('[smoke-v2-director-routing] OK')
