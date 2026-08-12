import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { buildFrozenDataset } from '../src/build.js'
import { matchesMediaFact, plannerReceivedImagePixels } from '../src/media-evaluation.js'
import { evaluateSampleUnderstandingEvidence } from '../src/sample-evaluation.js'
import { evaluateHardGates, evaluateQualityGates, scoreEvaluationEvidence } from '../src/score.js'
import { sha256 } from '../src/schema.js'
import {
  blockingFailureLedgerForProfile,
  collectAgentEvidence,
  collectAgentFailures,
  collectMediaEvidence,
  countSuccessfulRenderRuns,
  createProviderSubmissionBudget,
  openFailureLedgerForProfile,
  readGitProvenance,
  readManualRatings,
  rescoreEvaluationReport,
  runDeterministicCheck,
  runEvaluation,
} from '../src/run.js'

const root = await mkdtemp(path.join(os.tmpdir(), 'v2-evaluation-package-'))

async function writeJson(file: string, value: unknown) {
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

const metricCatalog = [
  { id: 'deterministic_pass', scale: 'binary', label: '确定性检查', description: '规则检查是否通过', hardGate: true },
  { id: 'scenario_goal_completion_rate', scale: 'rate', label: '目标完成率', description: '完成的目标占比' },
  { id: 'active_memory_ndcg_at8', scale: 'mean', label: '排序质量', description: '连续值均值' },
  { id: 'reply_relevance_score10', scale: 'score10', label: '回复质量', description: '人工或 Judge 的 0–10 评分' },
  { id: 'plan_coherence_score10', scale: 'score10', label: '方案质量', description: '人工方案评分' },
  { id: 'visual_quality_score10', scale: 'score10', label: '成片质量', description: '人工成片评分' },
  { id: 'hard_blocker_count', scale: 'count', label: '硬失败', description: '必须为零', hardGate: true },
]

function manifest(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 'v2_evaluation_manifest.v1',
    datasetVersion: 'test-v1',
    metricCatalog,
    qualityGates: {
      live: [{ metricId: 'scenario_goal_completion_rate', minimum: 0.8 }],
      stability: [{ metricId: 'scenario_goal_completion_rate', minimum: 0.8 }],
      canary: [{ metricId: 'scenario_goal_completion_rate', minimum: 0.8 }],
    },
    deterministicChecks: [{
      id: 'check_protocol',
      label: '协议 smoke',
      command: ['node', '-e', 'process.exit(0)'],
      metricIds: ['deterministic_pass'],
    }],
    agentSuites: [{ id: 'core', file: 'agent.json', profiles: ['live'], split: 'development' }],
    retrievalSuites: [{ id: 'memory', file: 'retrieval.json' }],
    failureLedgerFile: 'failure-ledger.json',
    reviewRuleRegistryFile: 'review-rules.json',
    manualRubricFile: 'rubric.json',
    canary: { maxRenderRuns: 5, maxProviderSubmissions: 20, maxGeneratedSeconds: 60, cases: [] },
    ...overrides,
  }
}

const validAgent = {
  version: 'agent-test-v1',
  cases: [{
    id: 'case_a',
    category: 'discussion',
    fixture: 'empty',
    metricIds: ['scenario_goal_completion_rate', 'reply_relevance_score10', 'plan_coherence_score10', 'visual_quality_score10'],
    turns: [{ prompt: '只讨论方案，不执行。', expected: { tools: [], kind: 'discussion' } }],
  }],
}

const validRetrieval = {
  version: 'retrieval-test-v1',
  construction: {
    sourceType: 'synthetic', method: '人工构造检索边界', coverage: ['user active'], annotationGuide: '直接语义匹配标为相关',
  },
  drafts: [],
  memories: [{ key: 'm1', scopeType: 'user', status: 'active', statement: '偏好克制的转场' }],
  queries: [{ id: 'q1', query: '转场如何处理', rationale: '直接询问唯一转场偏好', activeRelevant: { m1: 3 } }],
}

const validRubric = {
  version: 'rubric-test-v1',
  dimensions: [
    { id: 'plan_coherence_score10', label: '方案质量', description: '方案是否连贯', min: 0, max: 10 },
    { id: 'visual_quality_score10', label: '成片质量', description: '成片是否完整', min: 0, max: 10 },
  ],
}

async function seed(target: string, value = manifest()) {
  await writeJson(path.join(target, 'manifest.v1.json'), value)
  await writeJson(path.join(target, 'agent.json'), validAgent)
  await writeJson(path.join(target, 'retrieval.json'), validRetrieval)
  await writeJson(path.join(target, 'rubric.json'), {
    ...validRubric,
    dimensions: validRubric.dimensions.map((dimension) => ({
      ...dimension,
      anchors: { 0: 'zero', 2: 'weak', 5: 'usable', 8: 'strong', 10: 'excellent' },
    })),
  })
  await writeJson(path.join(target, 'failure-ledger.json'), { version: 'test.v1', entries: [] })
  await writeJson(path.join(target, 'review-rules.json'), { version: 'test.v1', rules: [] })
}

try {
  const source = path.join(root, 'source')
  const frozenFile = path.join(root, 'frozen', 'current.v1.json')
  await seed(source)
  const built = await buildFrozenDataset({ sourceDir: source, outputFile: frozenFile })
  assert.equal(built.summary.agentCases, 1)
  assert.equal(built.summary.agentTurns, 1)
  assert.equal(built.summary.retrievalQueries, 1)
  assert.equal(built.summary.canaryRenderRuns, 0)
  assert.equal(built.summary.maxProviderSubmissions, 20)
  assert.equal(built.summary.maxGeneratedSeconds, 60)
  assert.equal(Object.keys(built.sourceHashes).length, 6)
  assert.equal(JSON.parse(await readFile(frozenFile, 'utf8')).datasetHash, built.datasetHash)
  const rebuilt = await buildFrozenDataset({ sourceDir: source, outputFile: path.join(root, 'frozen', 'rebuilt.v1.json') })
  assert.equal(rebuilt.datasetHash, built.datasetHash)

  const originalAgentSource = await readFile(path.join(source, 'agent.json'), 'utf8')
  await writeJson(path.join(source, 'agent.json'), { ...validAgent, version: 'changed-without-freeze' })
  await assert.rejects(
    runEvaluation({
      frozenFile,
      outputDir: path.join(root, 'stale-source-report'),
      profile: 'deterministic',
      executeCommand: async () => ({ ok: true, durationMs: 1, stdout: '', stderr: '' }),
    }),
    /source drift/i,
  )
  await writeFile(path.join(source, 'agent.json'), originalAgentSource, 'utf8')

  const duplicate = path.join(root, 'duplicate')
  await seed(duplicate)
  const duplicatedAgent = structuredClone(validAgent)
  duplicatedAgent.cases.push(structuredClone(duplicatedAgent.cases[0]!))
  await writeJson(path.join(duplicate, 'agent.json'), duplicatedAgent)
  await assert.rejects(
    buildFrozenDataset({ sourceDir: duplicate, outputFile: path.join(root, 'duplicate.json') }),
    /duplicate case id/i,
  )

  const damaged = path.join(root, 'damaged')
  await seed(damaged)
  const damagedAgent = structuredClone(validAgent)
  damagedAgent.cases[0]!.turns[0]!.prompt = '损坏\uFFFD文本'
  await writeJson(path.join(damaged, 'agent.json'), damagedAgent)
  await assert.rejects(
    buildFrozenDataset({ sourceDir: damaged, outputFile: path.join(root, 'damaged.json') }),
    /invalid text/i,
  )

  const invalidMutation = path.join(root, 'invalid-mutation')
  await seed(invalidMutation)
  const invalidMutationAgent = structuredClone(validAgent)
  invalidMutationAgent.cases[0]!.turns[0]!.expected = {
    tools: ['timeline.patch'], kind: 'revise',
    timeline: { allowedMutations: [{ object: 'scene', fields: ['asset_id'] }] },
  }
  await writeJson(path.join(invalidMutation, 'agent.json'), invalidMutationAgent)
  await assert.rejects(
    buildFrozenDataset({ sourceDir: invalidMutation, outputFile: path.join(root, 'invalid-mutation.json') }),
    /mutation needs non-empty ids/i,
  )

  const unknownMetric = path.join(root, 'unknown-metric')
  await seed(unknownMetric)
  const unknownMetricAgent = structuredClone(validAgent)
  unknownMetricAgent.cases[0]!.metricIds = ['missing_metric']
  await writeJson(path.join(unknownMetric, 'agent.json'), unknownMetricAgent)
  await assert.rejects(
    buildFrozenDataset({ sourceDir: unknownMetric, outputFile: path.join(root, 'unknown.json') }),
    /unknown metric/i,
  )

  const emptyMetrics = path.join(root, 'empty-metrics')
  await seed(emptyMetrics)
  const emptyMetricsAgent = structuredClone(validAgent)
  emptyMetricsAgent.cases[0]!.metricIds = []
  await writeJson(path.join(emptyMetrics, 'agent.json'), emptyMetricsAgent)
  await assert.rejects(
    buildFrozenDataset({ sourceDir: emptyMetrics, outputFile: path.join(root, 'empty-metrics.json') }),
    /metricIds.*must not be empty/i,
  )

  const duplicateLedger = path.join(root, 'duplicate-ledger')
  await seed(duplicateLedger)
  await writeJson(path.join(duplicateLedger, 'failure-ledger.json'), {
    version: 'test.v1',
    entries: [
      { rootCause: 'same_root', status: 'resolved', verification: 'check_protocol', references: ['case:case_a'] },
      { rootCause: 'same_root', status: 'resolved', verification: 'check_protocol', references: ['case:case_a'] },
    ],
  })
  await assert.rejects(
    buildFrozenDataset({ sourceDir: duplicateLedger, outputFile: path.join(root, 'duplicate-ledger.json') }),
    /duplicate.*root cause/i,
  )

  const staleLedger = path.join(root, 'stale-ledger')
  await seed(staleLedger)
  await writeJson(path.join(staleLedger, 'failure-ledger.json'), {
    version: 'test.v1',
    entries: [{ rootCause: 'stale', status: 'needs_live_rerun', verification: 'profile:live', references: ['legacy:removed_case'] }],
  })
  await assert.rejects(
    buildFrozenDataset({ sourceDir: staleLedger, outputFile: path.join(root, 'stale-ledger.json') }),
    /stale or missing references/i,
  )

  const expensive = path.join(root, 'expensive')
  await seed(expensive, manifest({
    canary: {
      maxRenderRuns: 5,
      maxProviderSubmissions: 20,
      maxGeneratedSeconds: 60,
      cases: [{ suiteId: 'core', caseId: 'case_a', expectedRenderCount: 6 }],
    },
  }))
  await assert.rejects(
    buildFrozenDataset({ sourceDir: expensive, outputFile: path.join(root, 'expensive.json') }),
    /render run budget/i,
  )

  const scores = scoreEvaluationEvidence({
    metricCatalog,
    binary: [{ metricId: 'deterministic_pass', passed: true, evidence: 'smoke passed' }],
    rates: [{ metricId: 'scenario_goal_completion_rate', numerator: 7, denominator: 8 }],
    means: [{ metricId: 'active_memory_ndcg_at8', total: 1.6, observations: 2 }],
    score10: [{ metricId: 'reply_relevance_score10', value: 8.5, evidence: '人工复核' }],
    counts: [{ metricId: 'hard_blocker_count', value: 1 }],
  })
  assert.equal(scores.metrics.find((item) => item.id === 'deterministic_pass')?.value, 1)
  assert.equal(scores.metrics.find((item) => item.id === 'scenario_goal_completion_rate')?.value, 0.875)
  assert.equal(scores.metrics.find((item) => item.id === 'reply_relevance_score10')?.value, 8.5)
  assert.equal(scores.metrics.find((item) => item.id === 'active_memory_ndcg_at8')?.value, 0.8)
  assert.deepEqual(
    evaluateHardGates(metricCatalog, scores.metrics, ['deterministic_pass', 'hard_blocker_count']).failures,
    ['hard_blocker_count=1'],
  )
  assert.deepEqual(evaluateHardGates(metricCatalog, scores.metrics, ['missing_gate']).failures, [
    'missing_gate=invalid_gate_definition',
  ])
  assert.deepEqual(evaluateQualityGates(metricCatalog, scores.metrics, [
    { metricId: 'scenario_goal_completion_rate', minimum: 0.9 },
  ]).failures, ['scenario_goal_completion_rate=0.875<0.9'])
  const clusteredScores = scoreEvaluationEvidence({
    metricCatalog, binary: [], means: [], score10: [], counts: [],
    rates: [
      { metricId: 'scenario_goal_completion_rate', numerator: 1, denominator: 1, evidence: 'case-1' },
      { metricId: 'scenario_goal_completion_rate', numerator: 0, denominator: 4, evidence: 'case-2' },
    ],
  })
  const clusteredRate = clusteredScores.metrics.find((item) => item.id === 'scenario_goal_completion_rate')
  assert.equal(clusteredRate?.value, 0.2)
  assert.equal(clusteredRate?.sampleSize, 2)

  const unrated = scoreEvaluationEvidence({ metricCatalog, binary: [], rates: [], means: [], score10: [] })
  assert.equal(unrated.metrics.find((item) => item.id === 'reply_relevance_score10')?.status, 'unrated')

  const evidence = { rates: [], score10: [], counts: [] } as {
    rates: Array<{ metricId: string; numerator: number; denominator: number; evidence?: string }>
    score10: Array<{ metricId: string; value: number; evidence?: string }>
    counts: Array<{ metricId: string; value: number; evidence?: string }>
  }
  collectAgentEvidence({
    turns: [
      { caseId: 'measured', run: 1, deterministicPass: true, contextDecisionPassed: true, relevanceScore: 0.9 },
      { caseId: 'not_measured', run: 1, deterministicPass: false, contextDecisionPassed: false, relevanceScore: 0.1 },
    ],
  }, new Map([
    ['measured', new Set(['scenario_goal_completion_rate', 'reply_relevance_score10'])],
    ['not_measured', new Set<string>()],
  ]), evidence.rates, evidence.score10, evidence.counts)
  assert.deepEqual(evidence.rates.find((item) => item.metricId === 'scenario_goal_completion_rate'), {
    metricId: 'scenario_goal_completion_rate', numerator: 1, denominator: 1,
    clusters: [{ numerator: 1, denominator: 1 }], evidence: 'agent suite',
  })
  assert.equal(evidence.score10.length, 1)

  assert.equal(plannerReceivedImagePixels({
    attached_image_input_count: 1,
    attached_material_ids: ['mat_image'],
  }, 'mat_image'), true)
  assert.equal(plannerReceivedImagePixels({
    attached_image_input_count: 0,
    attached_material_ids: ['mat_image'],
  }, 'mat_image'), false)
  assert.equal(matchesMediaFact('画面角落有来源标记', '角'), false)
  assert.equal(matchesMediaFact('主体具有金色龙角', '金色龙角'), true)
  assert.equal(matchesMediaFact('蓝色汽车停在路边', '蓝色龙'), false)
  const mediaRates: Array<{ metricId: string; numerator: number; denominator: number; evidence?: string }> = []
  collectMediaEvidence({
    version: 'media-test.v1', tasks: 2, pixelInputsPassed: 2,
    factChecks: 7, factChecksPassed: 6, forbiddenChecks: 4, forbiddenChecksPassed: 4,
    referenceBindingsPassed: 2, conditionedGenerationPassed: 2,
    interferenceTasks: 4, interferenceTasksPassed: 3,
  }, mediaRates)
  assert.deepEqual(mediaRates.find((item) => item.metricId === 'image_interference_robustness_rate'), {
    metricId: 'image_interference_robustness_rate', numerator: 3, denominator: 4, evidence: 'media-test.v1',
  })

  let providerCalls = 0
  const budget = createProviderSubmissionBudget({
    maxSubmissions: 2,
    maxGeneratedSeconds: 10,
    adapter: { async generate(request) {
      providerCalls += 1
      return { ok: false, submissionState: 'not_submitted' as const, error: request.jobId }
    } },
  })
  const request = { jobId: 'job', shotId: 'shot', type: 'generate_video' as const, prompt: 'x', outputAssetId: 'out', durationSec: 2 }
  await budget.adapter.generate(request)
  await budget.adapter.generate({ ...request, jobId: 'job_2' })
  const rejected = await budget.adapter.generate({ ...request, jobId: 'job_3', durationSec: 2 })
  assert.equal(providerCalls, 2)
  assert.equal(rejected.metadata?.evaluationFailureCode, 'provider_budget_exceeded')
  assert.deepEqual(budget.usage(), {
    submissions: 2,
    maxSubmissions: 2,
    generatedSeconds: 4,
    maxGeneratedSeconds: 10,
    rejected: 1,
  })

  const secondsBudget = createProviderSubmissionBudget({
    maxSubmissions: 10,
    maxGeneratedSeconds: 3,
    adapter: { async generate(input) {
      return { ok: false, submissionState: 'not_submitted' as const, error: input.jobId }
    } },
  })
  await secondsBudget.adapter.generate(request)
  const secondsRejected = await secondsBudget.adapter.generate({ ...request, jobId: 'seconds_2' })
  assert.equal(secondsRejected.metadata?.evaluationFailureCode, 'provider_duration_budget_exceeded')
  assert.equal(secondsBudget.usage().submissions, 1)

  assert.equal(countSuccessfulRenderRuns([{ turns: [{
    caseId: 'case_a',
    toolResults: [
      { toolId: 'timeline.render', ok: true, result: { renderRunId: 'run_1', outputPath: 'one.mp4' } },
      { toolId: 'timeline.render', ok: true, result: { renderRunId: 'run_1', outputPath: 'one.mp4' } },
      { toolId: 'timeline.render', ok: false },
    ],
  }] }]), 1)

  const renderedArtifact = path.join(root, 'rendered.mp4')
  await writeFile(renderedArtifact, 'video', 'utf8')
  const ratingsFile = path.join(root, 'ratings.json')
  await writeJson(ratingsFile, { ratings: [{
    caseId: 'case_a',
    renderIndex: 1,
    scores: { visual_quality_score10: 8 },
  }] })
  const renderManual = await readManualRatings(ratingsFile, built, [{ turns: [{
    caseId: 'case_a',
    toolResults: [{
      toolId: 'timeline.render', ok: true,
      result: { renderRunId: 'run_real', outputPath: renderedArtifact },
    }],
  }] }])
  assert.equal(renderManual[0]?.value, 8)
  await writeJson(ratingsFile, { ratings: [{
    caseId: 'case_a',
    renderIndex: 1,
    scores: { plan_coherence_score10: 8 },
  }] })
  await assert.rejects(readManualRatings(ratingsFile, built, [{ turns: [{
    caseId: 'case_a',
    toolResults: [{
      toolId: 'timeline.render', ok: true,
      result: { renderRunId: 'run_real', outputPath: renderedArtifact },
    }],
  }] }]), /requires runIndex and turnIndex/i)

  const turnTraceDir = path.join(root, 'turn-trace')
  const originalTurnResult = { reply: 'plan generated' }
  await writeJson(path.join(turnTraceDir, '00-director-turn', 'turn-result.json'), originalTurnResult)
  await writeJson(ratingsFile, { ratings: [{
    caseId: 'case_a',
    runIndex: 1,
    turnIndex: 1,
    scores: { plan_coherence_score10: 7.5 },
  }] })
  const turnManual = await readManualRatings(ratingsFile, built, [{ turns: [{
    caseId: 'case_a', run: 1, turn: 1, traceDir: turnTraceDir, toolResults: [],
  }] }])
  assert.equal(turnManual[0]?.value, 7.5)
  assert.match(turnManual[0]?.evidence ?? '', /^case_a\/run-1\/turn-1:[a-f0-9]{64}$/)
  await writeJson(ratingsFile, { ratings: [{ caseId: 'missing', scores: { reply_relevance_score10: 8 } }] })
  await assert.rejects(readManualRatings(ratingsFile, built, []), /unknown case/i)

  await writeJson(ratingsFile, { ratings: [{
    caseId: 'case_a', runIndex: 1, turnIndex: 1,
    scores: { plan_coherence_score10: 8.5 },
  }] })
  const baseReportFile = path.join(root, 'paid-canary', 'report.json')
  const baseReport = {
    schemaVersion: 'v2_evaluation_report.v1',
    manifest: {
      datasetVersion: built.datasetVersion, datasetHash: built.datasetHash, profile: 'canary',
      startedAt: '2026-08-12T00:00:00.000Z', completedAt: '2026-08-12T00:01:00.000Z',
      providerCallsAllowed: true, canaryRenderRuns: 1, renderRunRequests: 1,
      maxProviderSubmissions: 4, providerSubmissions: 1, maxGeneratedSeconds: 12,
      generatedSeconds: 12, successfulRenderRuns: 1, gitCommit: 'abc123', gitDirty: false,
      gitProvenanceValid: true, worktreeDiffHash: '0'.repeat(64), worktreeChangedDuringRun: false,
    },
    datasetSummary: built.summary,
    deterministicChecks: [],
    agentReports: [{ turns: [{
      caseId: 'case_a', run: 1, turn: 1, traceDir: turnTraceDir, toolResults: [],
    }] }],
    retrievalReports: [],
    evidenceArtifacts: [{
      id: 'case_a/run-1/turn-1', kind: 'turn', path: path.join(turnTraceDir, '00-director-turn', 'turn-result.json'),
      sha256: sha256(await readFile(path.join(turnTraceDir, '00-director-turn', 'turn-result.json'))),
    }],
    scores: { metrics: [
      { id: 'deterministic_pass', label: '确定性检查', scale: 'binary', value: 1, status: 'measured', evidence: ['base'] },
      { id: 'plan_coherence_score10', label: '方案质量', scale: 'score10', value: null, status: 'unrated', evidence: [] },
      { id: 'reply_relevance_score10', label: '回复质量', scale: 'score10', value: 9, status: 'measured', evidence: ['judge'] },
    ] },
    executionValidityPassed: true, qualityQualified: true, qualityGateFailures: [],
    releaseBlocked: false, hardGateFailures: [], failures: [], openFailureLedger: [], limitations: ['base limitation'],
  }
  await writeJson(baseReportFile, baseReport)
  const rescoredDir = path.join(root, 'rescored')
  await assert.rejects(rescoreEvaluationReport({
    reportFile: baseReportFile, frozenFile, ratingsFile, outputDir: rescoredDir,
  }), /integrity sidecar/i)
  await writeFile(
    path.join(path.dirname(baseReportFile), 'report.sha256'),
    `${sha256(await readFile(baseReportFile))}\n`,
    'utf8',
  )
  await writeJson(path.join(turnTraceDir, '00-director-turn', 'turn-result.json'), { reply: 'changed after the run' })
  await assert.rejects(rescoreEvaluationReport({
    reportFile: baseReportFile, frozenFile, ratingsFile, outputDir: rescoredDir,
  }), /evidence.*changed/i)
  await writeJson(path.join(turnTraceDir, '00-director-turn', 'turn-result.json'), originalTurnResult)
  await writeJson(baseReportFile, { ...baseReport, evidenceArtifacts: [] })
  await writeFile(
    path.join(path.dirname(baseReportFile), 'report.sha256'),
    `${sha256(await readFile(baseReportFile))}\n`,
    'utf8',
  )
  await assert.rejects(rescoreEvaluationReport({
    reportFile: baseReportFile, frozenFile, ratingsFile, outputDir: rescoredDir,
  }), /baseline is not unique/i)
  await writeJson(baseReportFile, baseReport)
  await writeFile(
    path.join(path.dirname(baseReportFile), 'report.sha256'),
    `${sha256(await readFile(baseReportFile))}\n`,
    'utf8',
  )
  await writeJson(ratingsFile, { ratings: [
    {
      caseId: 'case_a', runIndex: 1, turnIndex: 1,
      scores: { plan_coherence_score10: 8.5 },
    },
    {
      caseId: 'case_a', runIndex: 1, turnIndex: 1,
      scores: { plan_coherence_score10: 7.5 },
    },
  ] })
  await assert.rejects(rescoreEvaluationReport({
    reportFile: baseReportFile, frozenFile, ratingsFile, outputDir: rescoredDir,
  }), /duplicates metric evidence/i)
  await writeJson(ratingsFile, { ratings: [{
    caseId: 'case_a', runIndex: 1, turnIndex: 1,
    scores: { plan_coherence_score10: 8.5 },
  }] })
  const rescored = await rescoreEvaluationReport({
    reportFile: baseReportFile, frozenFile, ratingsFile, outputDir: rescoredDir,
  })
  assert.equal(rescored.manifest.providerSubmissions, 1)
  assert.equal(rescored.manifest.successfulRenderRuns, 1)
  assert.equal(rescored.scores.metrics.find((item) => item.id === 'deterministic_pass')?.value, 1)
  assert.equal(rescored.scores.metrics.find((item) => item.id === 'reply_relevance_score10')?.value, 9)
  assert.equal(rescored.scores.metrics.find((item) => item.id === 'plan_coherence_score10')?.value, 8.5)
  assert.match(rescored.manualScoring?.baseReportSha256 ?? '', /^[a-f0-9]{64}$/)
  assert.match(rescored.manualScoring?.ratingsSha256 ?? '', /^[a-f0-9]{64}$/)
  assert.equal(JSON.parse(await readFile(baseReportFile, 'utf8')).scores.metrics[1].status, 'unrated')
  assert.equal(JSON.parse(await readFile(path.join(rescoredDir, 'report.json'), 'utf8')).manualScoring.ratingsCount, 1)
  assert.equal(
    (await readFile(path.join(rescoredDir, 'report.sha256'), 'utf8')).trim(),
    sha256(await readFile(path.join(rescoredDir, 'report.json'))),
  )

  await writeJson(path.join(root, 'wrong-dataset-report.json'), {
    ...baseReport, manifest: { ...baseReport.manifest, datasetHash: 'wrong' },
  })
  await writeFile(
    path.join(root, 'wrong-dataset-report.sha256'),
    `${sha256(await readFile(path.join(root, 'wrong-dataset-report.json')))}\n`,
    'utf8',
  )
  await assert.rejects(rescoreEvaluationReport({
    reportFile: path.join(root, 'wrong-dataset-report.json'), frozenFile, ratingsFile,
    outputDir: path.join(root, 'wrong-dataset-score'),
  }), /dataset hash/i)

  const sampleEvidence = evaluateSampleUnderstandingEvidence({
    schema_version: 'v2_sample_understanding.v2',
    task_id: 'sample_1',
    source: 'llm',
    sample: { duration_sec: 8 },
    summary: '通过运动与节奏建立注意力。',
    content_observations: [{ statement: '人物进入画面', evidence_ranges: [{ start_sec: 0, end_sec: 2 }] }],
    method_observations: [{
      id: 'method_1', expression: '先远后近', purpose: '建立注意力', timing_rationale: '开场先交代环境',
      evidence_ranges: [{ start_sec: 0, end_sec: 3 }],
    }],
    transferable_knowledge: [{ statement: '开场先建立环境再揭示主体', applicability: '需要建立空间关系时', evidence_method_ids: ['method_1'] }],
    shot_evidence: [], questions: [], warnings: [],
  }, { minMethodObservations: 1, minTransferableKnowledge: 1 })
  assert.deepEqual(sampleEvidence, { semantic: true, methodEvidence: true, transferableKnowledge: true })
  assert.equal(evaluateSampleUnderstandingEvidence({
    schema_version: 'v2_sample_understanding.v2', task_id: 'fallback', source: 'llm_fallback',
    sample: { duration_sec: 8 }, summary: 'fallback', content_observations: [], method_observations: [],
    transferable_knowledge: [], shot_evidence: [], questions: [], warnings: [],
  }, { minMethodObservations: 1, minTransferableKnowledge: 1 }).semantic, false)
  assert.equal(evaluateSampleUnderstandingEvidence({
    schema_version: 'v2_sample_understanding.v2', task_id: 'wrong_semantics', source: 'llm',
    sample: { duration_sec: 8 }, summary: '室内会议与人物访谈。',
    content_observations: [{ statement: '人物在会议室交谈', evidence_ranges: [{ start_sec: 0, end_sec: 2 }] }],
    method_observations: [{
      id: 'method_wrong', expression: '固定机位', purpose: '记录对话', timing_rationale: '全程保持稳定',
      evidence_ranges: [{ start_sec: 0, end_sec: 8 }],
    }],
    transferable_knowledge: [{ statement: '固定机位适合访谈', applicability: '室内访谈', evidence_method_ids: ['method_wrong'] }],
    shot_evidence: [], questions: [], warnings: [],
  }, {
    minMethodObservations: 1,
    minTransferableKnowledge: 1,
    expectedContentFacts: [{ id: 'mountain', aliases: ['山峰'] }],
    expectedMethodFacts: [{ id: 'wide', aliases: ['全景'] }],
    forbiddenClaims: ['室内访谈'],
    minExpectedContentFacts: 1,
    minExpectedMethodFacts: 1,
  }).semantic, false)
  assert.equal(evaluateSampleUnderstandingEvidence({
    schema_version: 'v2_sample_understanding.v2', task_id: 'overbroad_time', source: 'llm',
    sample: { duration_sec: 8 }, summary: '山峰以全景建立环境。',
    content_observations: [{ statement: '画面出现山峰', evidence_ranges: [{ start_sec: 0, end_sec: 8 }] }],
    method_observations: [{
      id: 'method_wide', expression: '全景', purpose: '建立环境', timing_rationale: '开场交代空间',
      evidence_ranges: [{ start_sec: 0, end_sec: 8 }],
    }],
    transferable_knowledge: [{ statement: '先用全景建立环境', applicability: '空间叙事', evidence_method_ids: ['method_wide'] }],
    shot_evidence: [], questions: [], warnings: [],
  }, {
    minMethodObservations: 1,
    minTransferableKnowledge: 1,
    expectedContentFacts: [{ id: 'mountain', aliases: ['山峰'], evidenceRanges: [{ startSec: 0, endSec: 2 }] }],
    expectedMethodFacts: [{ id: 'wide', aliases: ['全景'], evidenceRanges: [{ startSec: 0, endSec: 2 }] }],
    minExpectedContentFacts: 1,
    minExpectedMethodFacts: 1,
  }).semantic, false)
  assert.equal(evaluateSampleUnderstandingEvidence({
    schema_version: 'v2_sample_understanding.v2', task_id: 'wrong_time', source: 'llm',
    sample: { duration_sec: 8 }, summary: '山峰以全景建立环境。',
    content_observations: [{ statement: '画面出现山峰', evidence_ranges: [{ start_sec: 6, end_sec: 8 }] }],
    method_observations: [{
      id: 'method_wide', expression: '全景', purpose: '建立环境', timing_rationale: '开场交代空间',
      evidence_ranges: [{ start_sec: 6, end_sec: 8 }],
    }],
    transferable_knowledge: [{ statement: '先用全景建立环境', applicability: '空间叙事', evidence_method_ids: ['method_wide'] }],
    shot_evidence: [], questions: [], warnings: [],
  }, {
    minMethodObservations: 1,
    minTransferableKnowledge: 1,
    expectedContentFacts: [{ id: 'mountain', aliases: ['山峰'], evidenceRanges: [{ startSec: 0, endSec: 2 }] }],
    expectedMethodFacts: [{ id: 'wide', aliases: ['全景'], evidenceRanges: [{ startSec: 0, endSec: 2 }] }],
    minExpectedContentFacts: 1,
    minExpectedMethodFacts: 1,
  }).semantic, false)

  assert.deepEqual(collectAgentFailures([{ turns: [
    { caseId: 'case_a', run: 1, turn: 1, deterministicPass: false, deterministicFailures: ['工具结果不一致'] },
    { caseId: 'case_a', run: 1, turn: 2, deterministicPass: true, deterministicFailures: [], judgePass: false, judgeFailure: '回复遗漏' },
  ] }]), [
    'agent: case_a/run-1/turn-1: 工具结果不一致',
  ])
  assert.deepEqual(openFailureLedgerForProfile([
    { rootCause: 'live_only', status: 'needs_live_rerun', verification: 'profile:live', references: [] },
    { rootCause: 'memory_open', status: 'deferred', verification: 'profile:memory_retrieval', references: [] },
    { rootCause: 'resolved', status: 'resolved', verification: 'profile:live', references: [] },
  ], 'live').map((entry) => entry.rootCause), ['live_only', 'memory_open'])
  assert.deepEqual(blockingFailureLedgerForProfile([
    { rootCause: 'live_only', status: 'needs_live_rerun', verification: 'profile:live', references: [] },
    { rootCause: 'memory_open', status: 'deferred', verification: 'profile:memory_retrieval', references: [] },
  ], 'live').map((entry) => entry.rootCause), ['live_only'])

  const leakMarker = path.join(root, 'child-process-leak.txt')
  const childScript = `setTimeout(() => require('node:fs').writeFileSync(${JSON.stringify(leakMarker)}, 'leaked'), 800)`
  const hanging = await runDeterministicCheck({
    id: 'timeout_tree',
    label: 'timeout tree',
    command: ['node', '-e', `require('node:child_process').spawn(process.execPath, ['-e', ${JSON.stringify(childScript)}], {stdio:'ignore'}); setInterval(()=>{}, 1000)`],
    metricIds: ['deterministic_pass'],
    timeoutMs: 100,
  }, path.resolve('.'))
  assert.equal(hanging.ok, false)
  await new Promise((resolve) => setTimeout(resolve, 1_000))
  await assert.rejects(readFile(leakMarker, 'utf8'))

  const commands: string[] = []
  const provenanceBeforeRun = await readGitProvenance(path.resolve('.'))
  assert.deepEqual(await readGitProvenance(path.resolve('.')), provenanceBeforeRun)
  const report = await runEvaluation({
    frozenFile,
    outputDir: path.join(root, 'report'),
    profile: 'deterministic',
    executeCommand: async (check) => {
      commands.push(check.id)
      return { ok: true, durationMs: 1, stdout: 'ok', stderr: '' }
    },
  })
  assert.deepEqual(commands, ['check_protocol'])
  assert.equal(report.manifest.providerCallsAllowed, false)
  assert.equal(typeof report.manifest.gitDirty, 'boolean')
  assert.equal(report.manifest.gitProvenanceValid, true)
  const provenanceAfterRun = await readGitProvenance(path.resolve('.'))
  assert.deepEqual(provenanceAfterRun, provenanceBeforeRun)
  assert.equal(report.manifest.worktreeChangedDuringRun, false)
  assert.match(report.manifest.worktreeDiffHash, /^[a-f0-9]{64}$/)
  assert.equal(report.scores.metrics.find((item) => item.id === 'deterministic_pass')?.value, 1)
  assert.deepEqual(report.openFailureLedger, [])

  await assert.rejects(
    runEvaluation({
      frozenFile,
      outputDir: path.join(root, 'canary-report'),
      profile: 'canary',
      executeCommand: async () => ({ ok: true, durationMs: 1, stdout: '', stderr: '' }),
    }),
    /--allow-provider/i,
  )

  console.log('V2 evaluation package smoke passed.')
} finally {
  await rm(root, { recursive: true, force: true })
}
