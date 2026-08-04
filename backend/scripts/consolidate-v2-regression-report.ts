import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

import {
  summarizeEvaluation,
  type EvaluationReport,
  type EvaluationTurnResult,
} from '../src/evaluation-v2/agent-evaluation.js'

function argument(name: string) {
  const index = process.argv.indexOf(name)
  const value = index >= 0 ? process.argv[index + 1] : undefined
  if (!value) throw new Error(`${name} is required.`)
  return path.resolve(value)
}

async function json<T>(file: string): Promise<T> {
  return JSON.parse(await readFile(file, 'utf8')) as T
}

async function sha256(file: string) {
  return createHash('sha256').update(await readFile(file)).digest('hex')
}

const baselineFile = argument('--baseline')
const memoryFile = argument('--memory')
const currentInputFile = argument('--current-input')
const dependencyFile = argument('--dependency')
const artifactFile = argument('--artifact')
const artifactMemoryFile = argument('--artifact-memory')
const retrievalFile = argument('--retrieval')
const outputFile = argument('--output')

const baseline = await json<Record<string, any>>(baselineFile)
const memory = await json<EvaluationReport>(memoryFile)
const currentInput = await json<EvaluationReport>(currentInputFile)
const dependency = await json<EvaluationReport>(dependencyFile)
const artifact = await json<EvaluationReport>(artifactFile)
const artifactMemory = await json<EvaluationReport>(artifactMemoryFile)
const retrieval = await json<Record<string, any>>(retrievalFile)
const affectedTurns: EvaluationTurnResult[] = [
  ...memory.turns,
  ...currentInput.turns.filter((turn) => turn.caseId === 'current_input_overrides_history'),
  ...dependency.turns,
  ...artifact.turns.filter((turn) => (
    turn.caseId === 'artifact_superseded_requirement_absent'
    || turn.caseId === 'artifact_forbidden_fear_copy'
  )),
  ...artifactMemory.turns,
]
const postFixSummary = summarizeEvaluation(affectedTurns)
const postFixFailures = affectedTurns.filter(
  (turn) => !turn.deterministicPass || turn.judgePass === false,
)
const datasetFiles = [
  path.resolve('evals/v2-agent/core.v2.json'),
  path.resolve('evals/v2-agent/memory-decisions.v1.json'),
  path.resolve('evals/v2-agent/memory-retrieval.v1.json'),
  path.resolve('evals/v2-agent/artifact-requirements.v1.json'),
  path.resolve('evals/v2-agent/human-review.v1.json'),
]
const gitCommit = spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout?.trim() ?? 'unknown'
const gitDirty = Boolean(spawnSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).stdout?.trim())
const consolidated = {
  manifest: {
    generatedAt: new Date().toISOString(),
    gitCommit,
    gitDirty,
    baselineFile,
    postFixFiles: [memoryFile, currentInputFile, dependencyFile, artifactFile, artifactMemoryFile],
    datasetHashes: Object.fromEntries(
      await Promise.all(datasetFiles.map(async (file) => [file, await sha256(file)])),
    ),
  },
  baseline: {
    note: '修复前完整 166 轮回归；用于发现问题，不作为当前代码最终成绩。',
    summary: baseline.summary,
    retrieval: baseline.retrieval,
    keyStabilityPassed: baseline.keyStabilityPassed,
    failures: baseline.failures,
  },
  postFixValidation: {
    note: '仅重跑受本次通用修正影响的冻结场景；未与基线平均混算。',
    turns: affectedTurns.length,
    summary: postFixSummary,
    retrieval,
    allAffectedScenariosPassed: postFixFailures.length === 0,
    failures: postFixFailures.map((turn) => ({
      caseId: turn.caseId,
      run: turn.run,
      turn: turn.turn,
      deterministicFailures: turn.deterministicFailures,
      judgeFailure: turn.judgeFailure,
      traceDir: turn.traceDir,
    })),
  },
  unchangedEvidence: {
    renderDeliverySuccessRate: baseline.summary.renderDeliverySuccessRate,
    remotionScenarios: baseline.manifest.remotionScenarios,
    mediaGenerationCalled: false,
  },
  releaseConclusion: postFixFailures.length === 0
    ? '受影响场景已全部通过；发布前仍需在当前代码上再跑一次完整套件，不能把定向复测冒充全量最终成绩。'
    : '受影响场景仍有失败，当前不可发布。',
  pendingHumanWork: [
    '抽查 human-review.v1.json 中 10 个记忆作用域边界案例。',
    '对抽象品牌/审美要求填写人工产物评分。',
    '可选 Seedance canary 的内容质量人工评分；不与 Remotion 工程成功率混合。',
  ],
}

const percent = (value: number | null | undefined) => value == null ? 'N/A' : `${(value * 100).toFixed(1)}%`
const markdown = [
  '# V2 Agent 统一回归与修复验证报告', '',
  `- 代码：${gitCommit}${gitDirty ? '（工作区有未提交修改）' : ''}`,
  `- 完整基线：${baseline.summary.turns} 轮`,
  `- 修复后定向验证：${affectedTurns.length} 轮`,
  '- Seedance：未调用', '',
  '## 完整基线（修复前）', '',
  `- 场景目标完成率：${percent(baseline.summary.scenarioGoalCompletionRate)}`,
  `- 确定性轮次通过率：${percent(baseline.summary.deterministicPassRate)}`,
  `- 产物要求落实率：${percent(baseline.summary.artifactRequirementRealizationRate)}`,
  `- 长期知识写入精确率 / 召回率：${percent(baseline.summary.memoryWritePrecision)} / ${percent(baseline.summary.memoryWriteRecall)}`,
  `- Judge 回复质量率：${percent(baseline.summary.judgeReplyQualityRate)}`,
  `- Remotion 交付成功率：${percent(baseline.summary.renderDeliverySuccessRate)}`,
  `- 未授权执行：${baseline.summary.hardBlockers.unauthorizedExecutionCount}`,
  `- 关键场景三轮全部通过：${baseline.keyStabilityPassed ? '是' : '否'}`, '',
  '## 修复后受影响场景', '',
  `- 确定性轮次：${postFixSummary.deterministicPassed} / ${postFixSummary.turns}`,
  `- 场景目标完成率：${percent(postFixSummary.scenarioGoalCompletionRate)}`,
  `- 长期知识写入精确率 / 召回率：${percent(postFixSummary.memoryWritePrecision)} / ${percent(postFixSummary.memoryWriteRecall)}`,
  `- 长期知识作用域准确率：${percent(postFixSummary.memoryScopeAccuracyRate)}`,
  `- 长期知识应用准确率 / 非干扰率：${percent(postFixSummary.memoryApplicationAccuracyRate)} / ${percent(postFixSummary.memoryNonInterferenceRate)}`,
  `- active Recall@8 / nDCG@8：${percent(retrieval.activeMemoryRecallAt8)} / ${percent(retrieval.activeMemoryNdcgAt8)}`,
  `- candidate Precision@3：${percent(retrieval.candidatePrecisionAt3)}`,
  `- 跨作用域 / 无关召回：${retrieval.crossScopeRetrievalCount} / ${retrieval.unrelatedRetrievalCount}`,
  `- Judge 回复质量率：${percent(postFixSummary.judgeReplyQualityRate)}`,
  `- 未授权执行：${postFixSummary.hardBlockers.unauthorizedExecutionCount}`,
  `- 受影响场景是否全部通过：${postFixFailures.length === 0 ? '是' : '否'}`, '',
  '## 结论', '',
  consolidated.releaseConclusion, '',
  '## 待人工完成', '',
  ...consolidated.pendingHumanWork.map((item) => `- ${item}`), '',
  '## 口径', '',
  '- 完整基线与修复后定向复测分开报告，不重新计算一个混合总分。',
  '- 状态、Tool、作用域、依赖、时间线和渲染由确定性检查判断；Judge 只评价最终回复。',
  '- 合成素材只证明 Remotion 工程链路，不证明 Seedance 内容质量或生产泛化能力。',
].join('\n')

await writeFile(outputFile, `${JSON.stringify(consolidated, null, 2)}\n`, 'utf8')
await writeFile(outputFile.replace(/\.json$/u, '.md'), `${markdown}\n`, 'utf8')
console.log(JSON.stringify({ outputFile, markdown: outputFile.replace(/\.json$/u, '.md') }, null, 2))
