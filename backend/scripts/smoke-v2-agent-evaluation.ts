import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

import {
  summarizeEvaluation,
  type EvaluationTurnResult,
} from '../src/evaluation-v2/agent-evaluation.js'

const suite = JSON.parse(
  await readFile(new URL('../evals/v2-agent/core.v2.json', import.meta.url), 'utf8'),
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

console.log('V2 agent evaluation smoke passed.')
