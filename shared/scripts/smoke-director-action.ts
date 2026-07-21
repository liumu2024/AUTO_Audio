import assert from 'node:assert/strict'

import {
  mapNextActionToDirectorActionType,
  resolveDirectorAction,
} from '../lib/director-action-engine.js'
import { renderActionsFromSlotsPatch, applyRenderActionBatch } from '../lib/render-action-engine.js'
import {
  createDefaultDirectorSlots,
  routeDirectorConversation,
} from '../lib/director-understanding.js'
import type { DirectorContext } from '../types/director-context.js'
import type { RenderPlanV1 } from '../types/render-plan.v1.js'

const parsedRuntime = {
  backendEnabled: true,
  sampleUrl: 'https://example.com/sample.mp4',
  sampleName: '3.mp4',
  isSampleParsed: true,
  hasPipeline: true,
  activeTaskId: 'task_ana_1',
  hasVisualMaterial: true,
  materialCount: 2,
}

const baseContext: DirectorContext = {
  materials: [],
  userIntent: { goal: 'analyze_sample', aspectRatio: '9:16', styleIntensity: 'medium' },
  slots: createDefaultDirectorSlots({
    sampleVideoStatus: 'parsed',
    materialStatus: 'ready',
    aspectRatio: '16:9',
  }),
}

const generateAction = resolveDirectorAction({
  prompt: '生成成片',
  context: baseContext,
  runtime: parsedRuntime,
})
assert.equal(generateAction.type, 'GENERATE_RENDER_PLAN', `generate -> ${generateAction.type}`)
assert.notEqual(generateAction.type, 'RENDER_VIDEO')

const renderAction = resolveDirectorAction({
  prompt: '渲染导出',
  context: baseContext,
  runtime: parsedRuntime,
})
assert.equal(renderAction.type, 'RENDER_VIDEO', `render -> ${renderAction.type}`)

const reviseAction = resolveDirectorAction({
  prompt: '改成 9:16，不要字幕',
  context: baseContext,
  runtime: parsedRuntime,
})
assert.equal(reviseAction.type, 'REVISE_RENDER_PLAN', `revise -> ${reviseAction.type}`)

const convo = routeDirectorConversation({
  prompt: '生成成片',
  slots: createDefaultDirectorSlots({ sampleVideoStatus: 'parsed', materialStatus: 'ready' }),
  runtime: parsedRuntime,
})
assert.equal(convo.nextAction, 'GENERATE_VIDEO')
assert.equal(mapNextActionToDirectorActionType(convo), 'GENERATE_RENDER_PLAN')

const miniPlan: RenderPlanV1 = {
  version: '1.0',
  task_id: 'task_test',
  strategy: 'montage',
  duration_sec: 4,
  canvas: { width: 1080, height: 1920, fps: 30, ratio: '9:16' },
  scenes: [],
  assets: [],
}

const canvasActions = renderActionsFromSlotsPatch({ aspectRatio: '16:9' }, miniPlan)
assert.equal(canvasActions.length, 1)
assert.equal(canvasActions[0]?.type, 'SET_CANVAS')

const revised = applyRenderActionBatch(miniPlan, { actions: canvasActions })
assert.equal(revised.canvas.ratio, '16:9')

console.log('[smoke-director-action] OK')
