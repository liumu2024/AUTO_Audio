import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

function argument(name: string) {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : undefined
}

function has(name: string) {
  return process.argv.includes(name)
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-')
}

async function sha256(file: string) {
  return createHash('sha256').update(await readFile(file)).digest('hex')
}

function wilson(successes: number, total: number) {
  if (!total) return null
  const z = 1.96
  const p = successes / total
  const denominator = 1 + z ** 2 / total
  const center = (p + z ** 2 / (2 * total)) / denominator
  const margin = z * Math.sqrt(p * (1 - p) / total + z ** 2 / (4 * total ** 2)) / denominator
  return { low: Math.max(0, center - margin), high: Math.min(1, center + margin) }
}

const outputDir = path.resolve(argument('--output') ?? path.join('tmp', 'v2-formal-regression', timestamp()))
const startedAt = new Date().toISOString()
const skipLive = has('--skip-live')
const skipRender = has('--skip-render')
await mkdir(outputDir, { recursive: true })
const memorySuiteFile = path.join(outputDir, 'memory-decisions.expanded.json')
const { writeMemoryDecisionSuite } = await import('../src/evaluation-v2/formal-dataset-builder.js')
const preparedMemory = await writeMemoryDecisionSuite({
  sourceFile: path.resolve('evals/v2-agent/memory-decisions.v1.json'),
  outputFile: memorySuiteFile,
})

const tsxCli = path.resolve('node_modules/tsx/dist/cli.mjs')
const commands: Array<{ id: string; script: string; args?: string[] }> = [
  { id: 'structured_protocol', script: 'scripts/smoke-v2-structured-model-protocol.ts' },
  { id: 'creative_memory_state', script: 'scripts/smoke-v2-creative-memory.ts' },
  { id: 'creative_memory_retrieval', script: 'scripts/smoke-v2-creative-memory-retrieval.ts' },
  { id: 'formal_datasets', script: 'scripts/smoke-v2-formal-evaluation-datasets.ts' },
  { id: 'director_action_isolation', script: 'scripts/smoke-v2-director-multiturn.ts' },
  { id: 'evaluation_metrics', script: 'scripts/smoke-v2-agent-evaluation.ts' },
]
if (!skipRender) commands.push({ id: 'remotion_delivery', script: 'scripts/smoke-v2-evaluation-remotion-render.ts' })

const commandResults = commands.map((command) => {
  const started = Date.now()
  const result = spawnSync(process.execPath, [tsxCli, command.script, ...(command.args ?? [])], {
    cwd: process.cwd(),
    encoding: 'utf8',
    timeout: command.id === 'remotion_delivery' ? 600_000 : 120_000,
  })
  return {
    id: command.id,
    ok: result.status === 0,
    status: result.status,
    durationMs: Date.now() - started,
    stdout: result.stdout?.trim() ?? '',
    stderr: result.stderr?.trim() ?? '',
  }
})

process.env.DPL304_LOCAL_MODE = 'true'
process.env.DPL304_LOCAL_DATA_DIR = path.join(outputDir, 'retrieval-local-data')
const { evaluateCreativeMemoryRetrieval } = await import(
  '../src/evaluation-v2/creative-memory-retrieval-evaluation.js'
)
const retrievalReportFile = path.join(outputDir, 'memory-retrieval-report.json')
const retrieval = await evaluateCreativeMemoryRetrieval({
  suiteFile: path.resolve('evals/v2-agent/memory-retrieval.v1.json'),
  outputFile: retrievalReportFile,
})
const retrievalHardReportFile = path.join(outputDir, 'memory-retrieval-hard-report.json')
const retrievalHard = await evaluateCreativeMemoryRetrieval({
  suiteFile: path.resolve('evals/v2-agent/memory-retrieval-hard.v1.json'),
  outputFile: retrievalHardReportFile,
})

const liveReports: Array<{ id: string; reportFile: string }> = []
if (!skipLive) {
  const keyCases = [
    'requirement_lifecycle', 'current_input_overrides_history', 'text_only_creation',
    'material_bound_creation', 'sample_bound_creation', 'semantic_subtitle_revision',
    'authorized_dry_render', 'tool_failure_then_recovery',
    'requirement_then_dependent_creation', 'history_does_not_reactivate_actions',
  ]
  const evaluations = [
    { id: 'core', suite: 'core.v2', runs: 1 },
    { id: 'memory', suiteFile: memorySuiteFile, runs: 1 },
    { id: 'artifact', suite: 'artifact-requirements.v1', runs: 1 },
    { id: 'key_stability', suite: 'core.v2', runs: 3, cases: keyCases.join(',') },
  ]
  for (const evaluation of evaluations) {
    const target = path.join(outputDir, evaluation.id)
    const args = ['scripts/run-v2-agent-evaluation.ts', '--output', target, '--runs', String(evaluation.runs)]
    if (evaluation.suiteFile) args.push('--suite-file', evaluation.suiteFile)
    else args.push('--suite', evaluation.suite!)
    if (evaluation.cases) args.push('--case', evaluation.cases)
    const result = spawnSync(process.execPath, [tsxCli, ...args], { cwd: process.cwd(), encoding: 'utf8', timeout: 3_600_000 })
    await writeFile(path.join(outputDir, `${evaluation.id}.log`), `${result.stdout ?? ''}\n${result.stderr ?? ''}`, 'utf8')
    const reportFile = path.join(target, 'report.json')
    if (result.status !== 0) {
      commandResults.push({
        id: `live_${evaluation.id}`, ok: false, status: result.status,
        durationMs: 0, stdout: result.stdout?.trim() ?? '', stderr: result.stderr?.trim() ?? '',
      })
      continue
    }
    liveReports.push({ id: evaluation.id, reportFile })
  }
}

const reports = await Promise.all(liveReports.map(async (item) => ({
  id: item.id,
  report: JSON.parse(await readFile(item.reportFile, 'utf8')),
})))
const gitCommit = spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout?.trim() ?? 'unknown'
const gitDirty = Boolean(spawnSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).stdout?.trim())
const turns = reports.flatMap((item) => item.report.turns)
const summary = turns.length
  ? (await import('../src/evaluation-v2/agent-evaluation.js')).summarizeEvaluation(turns)
  : null
const keyReport = reports.find((item) => item.id === 'key_stability')?.report
const keyScenarioRuns = new Map<string, boolean[]>()
for (const turn of keyReport?.turns ?? []) {
  const key = `${turn.caseId}:${turn.run}`
  keyScenarioRuns.set(key, [...(keyScenarioRuns.get(key) ?? []), turn.deterministicPass && turn.judgePass !== false])
}
const keyStabilityPassed = keyScenarioRuns.size > 0
  && [...keyScenarioRuns.values()].every((values) => values.every(Boolean))
const renderResult = commandResults.find((item) => item.id === 'remotion_delivery')
const renderDeliverySuccessRate = renderResult ? (renderResult.ok ? 1 : 0) : null
let renderDetails: Record<string, unknown> | null = null
try {
  renderDetails = renderResult?.stdout ? JSON.parse(renderResult.stdout) as Record<string, unknown> : null
} catch {
  renderDetails = null
}
const datasetFiles = [
  path.resolve('evals/v2-agent/core.v2.json'),
  path.resolve('evals/v2-agent/memory-decisions.v1.json'),
  memorySuiteFile,
  path.resolve('evals/v2-agent/memory-retrieval.v1.json'),
  path.resolve('evals/v2-agent/memory-retrieval-hard.v1.json'),
  path.resolve('evals/v2-agent/artifact-requirements.v1.json'),
  path.resolve('evals/v2-agent/human-review.v1.json'),
]
const datasetHashes = Object.fromEntries(await Promise.all(datasetFiles.map(async (file) => [file, await sha256(file)])))
const failures = turns.filter((turn) => !turn.deterministicPass || turn.judgePass === false).map((turn) => ({
  caseId: turn.caseId,
  run: turn.run,
  turn: turn.turn,
  deterministicFailures: turn.deterministicFailures,
  judgeFailure: turn.judgeFailure,
  traceDir: turn.traceDir,
}))
const formal = {
  manifest: {
    startedAt,
    completedAt: new Date().toISOString(),
    mode: skipLive ? 'deterministic-only' : 'formal-live-agent-dry-media-plus-remotion',
    gitCommit,
    gitDirty,
    directorModel: reports[0]?.report.manifest?.directorModel ?? process.env.DIRECTOR_AGENT_MODEL ?? 'not-run',
    judgeModel: reports[0]?.report.manifest?.judgeModel ?? process.env.DIRECTOR_AGENT_MODEL ?? 'not-run',
    memoryDecisionSamples: preparedMemory.samples,
    memoryHoldoutCases: preparedMemory.holdoutCases,
    artifactScenarios: 20,
    remotionScenarios: skipRender ? 0 : 6,
    datasetHashes,
    sourceReports: liveReports,
  },
  smoke: commandResults,
  summary: summary ? { ...summary, renderDeliverySuccessRate } : { renderDeliverySuccessRate },
  retrieval,
  retrievalHard,
  render: renderDetails,
  keyStabilityPassed,
  confidenceIntervals95: summary ? {
    deterministicPassRate: wilson(summary.deterministicPassed, summary.turns),
    judgeReplyQualityRate: wilson(
      turns.filter((turn) => turn.judgePass).length,
      turns.filter((turn) => turn.judgeRequested && turn.judgePass !== undefined).length,
    ),
    renderDeliverySuccessRate: skipRender ? null : wilson(renderResult?.ok ? 6 : 0, 6),
  } : {},
  failures,
  uncovered: [
    'Seedance 生成内容的视觉质量；常规回归不调用生成 Provider。',
    '“可靠但不冰冷”等抽象审美要求仍需人工语义评分。',
    '没有匿名真实业务任务时，不能据此宣称生产场景泛化能力。',
  ],
}

const pct = (value: number | null | undefined) => value == null ? 'N/A' : `${(value * 100).toFixed(1)}%`
const markdown = [
  '# V2 Agent 正式统一回归报告', '',
  `- 模式：${formal.manifest.mode}`,
  `- 代码版本：${gitCommit}${gitDirty ? '（工作区有未提交改动）' : ''}`,
  `- 长期知识决策样本：${preparedMemory.samples}（holdout ${preparedMemory.holdoutCases * 5} 轮）`,
  `- 产物要求场景：20`,
  `- Remotion 场景：${formal.manifest.remotionScenarios}`, '',
  '## 核心结果', '',
  `- 场景目标完成率：${pct(summary?.scenarioGoalCompletionRate)}`,
  `- 上下文决策准确率：${pct(summary?.contextDecisionAccuracyRate)}`,
  `- 依赖执行准确率：${pct(summary?.dependencyExecutionAccuracyRate)}`,
  `- 产物要求落实率：${pct(summary?.artifactRequirementRealizationRate)}`,
  `- Remotion 交付成功率：${pct(renderDeliverySuccessRate)}`,
  `- Judge 回复质量率：${pct(summary?.judgeReplyQualityRate)}`,
  `- 关键场景连续三轮全部通过：${keyStabilityPassed ? '是' : '否或未运行'}`, '',
  '## 长期创作知识', '',
  `- 写入精确率 / 召回率：${pct(summary?.memoryWritePrecision)} / ${pct(summary?.memoryWriteRecall)}`,
  `- 作用域准确率：${pct(summary?.memoryScopeAccuracyRate)}`,
  `- 应用准确率 / 非干扰率：${pct(summary?.memoryApplicationAccuracyRate)} / ${pct(summary?.memoryNonInterferenceRate)}`,
  `- active Recall@8 / nDCG@8：${pct(retrieval.activeMemoryRecallAt8)} / ${pct(retrieval.activeMemoryNdcgAt8)}`,
  `- candidate Precision@3：${pct(retrieval.candidatePrecisionAt3)}`,
  `- 跨作用域召回 / 无关召回：${retrieval.crossScopeRetrievalCount} / ${retrieval.unrelatedRetrievalCount}`, '',
  '### Hard 检索集（同义改写 / 否定 / 冲突，只记录不门禁）', '',
  `- active Recall@8 / nDCG@8：${pct(retrievalHard.activeMemoryRecallAt8)} / ${pct(retrievalHard.activeMemoryNdcgAt8)}`,
  `- candidate Precision@3：${pct(retrievalHard.candidatePrecisionAt3)}`,
  `- 跨作用域 / 无关召回：${retrievalHard.crossScopeRetrievalCount} / ${retrievalHard.unrelatedRetrievalCount}`, '',
  '## 硬门禁', '',
  ...(summary ? Object.entries(summary.hardBlockers).map(([key, value]) => `- ${key}：${value}`) : ['- live Agent 未运行']), '',
  '## 失败与 Trace', '',
  ...(failures.length ? failures.map((item) => `- ${item.caseId} r${item.run} t${item.turn}：${item.traceDir}`) : ['- 无']), '',
  '## Remotion 产物与 Trace', '',
  ...(Array.isArray(renderDetails?.scenarios)
    ? renderDetails.scenarios.map((item) => {
        const scenario = item as { id?: string; outputPath?: string; traceDir?: string; expectedFailure?: string }
        return `- ${scenario.id ?? 'unknown'}：${scenario.traceDir ?? scenario.outputPath ?? (scenario.expectedFailure ? '按预期失败' : '无索引')}`
      })
    : ['- 未运行或没有可解析的渲染明细']), '',
  '## 未覆盖能力', '',
  ...formal.uncovered.map((item) => `- ${item}`), '',
  '## 口径', '',
  '- 本报告只汇总本次冻结代码与冻结数据集产生的结果；历史迭代报告不混入成绩。',
  '- 确定性状态、对象、依赖、参数绑定和时间线断言不由 Judge 决定。',
  '- 合成素材只证明素材解析、标准化与 Remotion 工程链路，不代表生成视频的审美质量。',
].join('\n')
await writeFile(path.join(outputDir, 'formal-report.json'), `${JSON.stringify(formal, null, 2)}\n`, 'utf8')
await writeFile(path.join(outputDir, 'formal-report.md'), `${markdown}\n`, 'utf8')
console.log(JSON.stringify({
  report: path.join(outputDir, 'formal-report.md'),
  json: path.join(outputDir, 'formal-report.json'),
  liveReports: liveReports.length,
  failures: failures.length,
}, null, 2))
if (commandResults.some((item) => !item.ok)
  || retrieval.crossScopeRetrievalCount > 0
  || retrieval.unrelatedRetrievalCount > 0) {
  process.exitCode = 1
}
