import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

import {
  evaluateTimelineRequirements,
  summarizeEvaluation,
  type EvaluationTurnResult,
} from '../src/evaluation-v2/agent-evaluation.js'
import type { RemotionTimelineSpecV1 } from '../../shared/types/remotion-timeline-spec.v1.js'

const suite = JSON.parse(
  await readFile(new URL('../evaluation/datasets/source/agent-core.v1.json', import.meta.url), 'utf8'),
) as { cases: Array<{ id: string; category: string; turns: Array<{ expected: { actions?: unknown } }> }> }
assert.ok(suite.cases.length >= 10)
assert.ok(new Set(suite.cases.map((item) => item.category)).size >= 8)
assert.equal(suite.cases.flatMap((item) => item.turns).some((turn) => 'actions' in turn.expected), false)

const base: EvaluationTurnResult = {
  caseId: 'smoke',
  category: 'discussion',
  expectedKind: 'discussion',
  run: 1,
  turn: 1,
  prompt: 'test',
  assistantReply: 'ok',
  action: 'ASK_USER',
  skills: [],
  tools: [],
  toolResults: [],
  actionReceipts: [],
  source: 'llm',
  deterministicPass: true,
  deterministicFailures: [],
  judgePass: true,
  judgeRequested: true,
  expectedStateAction: 'add',
  expectedSkills: [],
  expectedToolSuccess: undefined,
  expectedCreationMode: undefined,
  expectedEffectiveAspectRatio: undefined,
  stateActionPassed: true,
  activeRequirementChecks: 1,
  activeRequirementChecksPassed: 1,
  conversationRecallChecks: 1,
  conversationRecallChecksPassed: 1,
  contextDecisionPassed: true,
  independentActionChecks: 1,
  independentActionChecksPassed: 1,
  dependencyChecks: 1,
  dependencyChecksPassed: 1,
  systemBindingIntegrityPassed: true,
  capabilityGroundedActionPassed: true,
  recoveryCheck: false,
  recoveryPassed: true,
  systemResourceOverride: false,
  crossDomainMutation: false,
  skillAligned: true,
  toolAligned: true,
  toolOutcomeAligned: true,
  creationModeAligned: true,
  configAligned: true,
  draftChanged: false,
  timelineValid: undefined,
  timelineRequirementChecks: 0,
  timelineRequirementChecksPassed: 0,
  plannerRequirementChecks: 0,
  plannerRequirementChecksPassed: 0,
  jsonRepair: false,
  fallback: false,
  falseSuccess: false,
  unauthorizedExecution: false,
  agentLatencyMs: 100,
  judgeLatencyMs: 50,
  directorUsage: { input: 10, output: 5, total: 15, calls: 1 },
  judgeUsage: { input: 4, output: 2, total: 6, calls: 1 },
  traceDir: 'smoke',
}
const summary = summarizeEvaluation([
  base,
  {
    ...base,
    turn: 2,
    deterministicPass: false,
    stateActionPassed: false,
    judgeRequested: false,
    judgePass: undefined,
    judgeLatencyMs: 0,
    judgeUsage: { input: 0, output: 0, total: 0, calls: 0 },
  },
  {
    ...base,
    turn: 3,
    judgePass: false,
    falseSuccess: true,
  },
])
assert.equal(summary.turns, 3)
assert.equal(summary.deterministicPassed, 2)
assert.equal(summary.hardBlockers.falseSuccessClaimCount, 1)
assert.equal(summary.releaseBlocked, true)
assert.equal(summary.stateActionSuccessRate, 2 / 3)
assert.equal(summary.judgeReplyQualityRate, 1 / 2)
assert.equal(summary.directorUsage.total, 45)
assert.equal(summary.judgeUsage.total, 12)
assert.equal(summary.combinedUsage.total, 57)

const noApplicableMetrics = summarizeEvaluation([{
  ...base,
  expectedStateAction: undefined,
  expectedSkills: undefined,
  judgeRequested: false,
  judgePass: undefined,
  activeRequirementChecks: 0,
  activeRequirementChecksPassed: 0,
  conversationRecallChecks: 0,
  conversationRecallChecksPassed: 0,
  judgeLatencyMs: 0,
  judgeUsage: { input: 0, output: 0, total: 0, calls: 0 },
}])
assert.equal(noApplicableMetrics.stateActionSuccessRate, null)
assert.equal(noApplicableMetrics.activeRequirementRetentionRate, null)
assert.equal(noApplicableMetrics.conversationRecallRate, null)
assert.equal(noApplicableMetrics.judgeReplyQualityRate, null)
assert.equal(noApplicableMetrics.skillSelectionAccuracyRate, null)
assert.equal(noApplicableMetrics.plannerRequirementInputRate, null)

const artifactSpec: RemotionTimelineSpecV1 = {
  schema_version: 'remotion_timeline_spec.v1', task_id: 'artifact-check',
  creative_brief: { direction: '全片轻松幽默，以生活反差推进', image_references: [], sample_methods: [] },
  canvas: { width: 1920, height: 1080, fps: 30, duration_sec: 4 }, assets: [],
  scenes: [{
    id: 'scene_2', type: 'remotion_card', start_sec: 0, duration_sec: 4,
    body: '主人在电梯里通过手机确认门锁状态', background: '冷蓝低照度', motion: 'slow_zoom_in',
  }], transitions: [], material_jobs: [], audio: [], render_policy: { renderer: 'remotion_timeline' },
  overlays: [{
    id: 'caption_1', type: 'caption', scene_id: 'scene_2', start_sec: 0.2, end_sec: 3.8,
    text: '状态已确认', x_pct: 50, y_pct: 82, background: 'rgba(15, 23, 42, 0.65)',
  }],
}
const artifactCheck = evaluateTimelineRequirements(artifactSpec, {
  requiredSceneFacts: [{ sceneId: 'scene_2', facts: ['电梯', '手机', '门锁', '冷蓝'] }],
  requiredSceneMotions: [{ sceneId: 'scene_2', motion: 'slow_zoom_in' }],
  requiredOverlayStyles: [{ type: 'caption', backgroundAlpha: 0.65 }],
  requiredCreativeBriefFacts: ['轻松', '幽默'],
})
assert.equal(artifactCheck.checks, 8)
assert.equal(artifactCheck.passed, 8)
assert.equal(evaluateTimelineRequirements(artifactSpec, {
  requiredSceneFacts: [{ sceneId: 'scene_2', facts: ['御书房'] }],
}).passed, 0)

const subtitleBase = structuredClone(artifactSpec)
subtitleBase.overlays.push({
  ...subtitleBase.overlays[0]!, id: 'caption_2', text: '保持不变', start_sec: 1, end_sec: 2,
})
const subtitleRevision = structuredClone(subtitleBase)
subtitleRevision.overlays[0]!.text = '只改目标字幕'
const subtitleMutationRule = {
  allowedMutations: [{ object: 'overlay' as const, ids: ['caption_1'], fields: ['text'] }],
}
assert.equal(evaluateTimelineRequirements(subtitleRevision, subtitleMutationRule, subtitleBase).passed, 1)
subtitleRevision.overlays[1]!.text = '不应被修改'
assert.equal(evaluateTimelineRequirements(subtitleRevision, subtitleMutationRule, subtitleBase).passed, 0)

const visualRevision = structuredClone(artifactSpec)
visualRevision.scenes[0]!.background = '冷蓝低照度'
visualRevision.scenes[0]!.motion = 'slow_zoom_in'
const visualMutationRule = {
  allowedMutations: [{ object: 'scene' as const, ids: ['scene_2'], fields: ['background', 'motion'] }],
}
assert.equal(evaluateTimelineRequirements(visualRevision, visualMutationRule, artifactSpec).passed, 1)
visualRevision.scenes[0]!.asset_id = 'unrelated_asset'
assert.equal(evaluateTimelineRequirements(visualRevision, visualMutationRule, artifactSpec).passed, 0)

const originalWithUntargetedScene = structuredClone(artifactSpec)
originalWithUntargetedScene.scenes.push({
  id: 'scene_3', type: 'remotion_card', start_sec: 4, duration_sec: 1, body: '保持不变',
})
const briefRevision = structuredClone(originalWithUntargetedScene)
briefRevision.creative_brief!.direction = '轻松幽默'
assert.equal(evaluateTimelineRequirements(briefRevision, {
  allowedMutations: [{ object: 'creative_brief', fields: ['direction'] }],
}, originalWithUntargetedScene).passed, 1)
briefRevision.scenes[1]!.body = '意外变化'
assert.equal(evaluateTimelineRequirements(briefRevision, {
  allowedMutations: [{ object: 'creative_brief', fields: ['direction'] }],
}, originalWithUntargetedScene).passed, 0)

console.log('V2 agent evaluation smoke passed.')
