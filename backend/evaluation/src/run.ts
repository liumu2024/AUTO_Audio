import { spawn } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { evaluateHardGates, evaluateQualityGates, scoreEvaluationEvidence, type RateEvidence } from './score.js'
import type { V2MaterialGenerationAdapter } from '../../src/pipeline-v2/material-generation-adapter.js'
import {
  canonicalJson,
  readJsonFile,
  sha256,
  type DeterministicCheckDefinition,
  type EvaluationProfile,
  type FrozenEvaluationDataset,
} from './schema.js'

export interface CommandResult {
  ok: boolean
  durationMs: number
  stdout: string
  stderr: string
}

export interface EvaluationRunReport {
  schemaVersion: 'v2_evaluation_report.v1'
  manifest: {
    datasetVersion: string
    datasetHash: string
    profile: EvaluationProfile
    startedAt: string
    completedAt: string
    providerCallsAllowed: boolean
    canaryRenderRuns: number
    renderRunRequests: number
    maxProviderSubmissions: number
    providerSubmissions: number
    maxGeneratedSeconds: number
    generatedSeconds: number
    successfulRenderRuns: number
    gitCommit: string
    gitDirty: boolean
    gitProvenanceValid: boolean
    worktreeDiffHash: string
    worktreeChangedDuringRun: boolean
  }
  datasetSummary: FrozenEvaluationDataset['summary']
  deterministicChecks: Array<DeterministicCheckDefinition & CommandResult>
  agentReports: unknown[]
  retrievalReports: unknown[]
  mediaReport?: unknown
  sampleReport?: unknown
  scores: ReturnType<typeof scoreEvaluationEvidence>
  executionValidityPassed: boolean
  qualityQualified: boolean | null
  qualityGateFailures: string[]
  releaseBlocked: boolean
  hardGateFailures: string[]
  failures: string[]
  openFailureLedger: FrozenEvaluationDataset['failureLedger']['entries']
  limitations: string[]
  evidenceArtifacts: Array<{ id: string; kind: 'turn' | 'render'; path: string; sha256: string }>
  manualScoring?: {
    baseReport: string
    baseReportSha256: string
    ratingsFile: string
    ratingsSha256: string
    ratingsCount: number
    scoreObservations: number
    rescoredAt: string
  }
}

async function collectEvidenceArtifacts(reports: any[]) {
  const artifacts: EvaluationRunReport['evidenceArtifacts'] = []
  for (const report of reports) {
    for (const turn of Array.isArray(report?.turns) ? report.turns : []) {
      if (turn?.traceDir) {
        const file = path.join(turn.traceDir, '00-director-turn', 'turn-result.json')
        artifacts.push({ id: `${turn.caseId}/run-${turn.run}/turn-${turn.turn}`, kind: 'turn', path: file, sha256: sha256(await readFile(file)) })
      }
      for (const result of Array.isArray(turn?.toolResults) ? turn.toolResults : []) {
        if (result?.toolId === 'timeline.render' && result?.ok === true && typeof result?.result?.outputPath === 'string') {
          artifacts.push({ id: String(result.result.renderRunId), kind: 'render', path: result.result.outputPath, sha256: sha256(await readFile(result.result.outputPath)) })
        }
      }
    }
  }
  return artifacts
}

function reportIntegrityFile(reportFile: string) {
  return reportFile.toLowerCase().endsWith('.json')
    ? `${reportFile.slice(0, -'.json'.length)}.sha256`
    : `${reportFile}.sha256`
}

async function writeEvaluationReport(outputDir: string, report: EvaluationRunReport) {
  const reportFile = path.join(outputDir, 'report.json')
  const reportBytes = Buffer.from(`${JSON.stringify(report, null, 2)}\n`, 'utf8')
  await writeFile(reportFile, reportBytes)
  await writeFile(reportIntegrityFile(reportFile), `${sha256(reportBytes)}\n`, 'utf8')
  await writeFile(path.join(outputDir, 'report.md'), evaluationReportMarkdown(report), 'utf8')
}

function resolvedCommand(command: string[], backendRoot: string) {
  const [program, ...args] = command
  if (program === 'tsx') {
    return {
      program: process.execPath,
      args: [path.join(backendRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs'), ...args],
    }
  }
  return { program: program!, args }
}

async function terminateProcessTree(child: ReturnType<typeof spawn>) {
  if (!child.pid) return
  if (process.platform === 'win32') {
    await new Promise<void>((resolve) => {
      const killer = spawn('taskkill.exe', ['/pid', String(child.pid), '/t', '/f'], {
        windowsHide: true,
        stdio: 'ignore',
      })
      killer.on('error', () => resolve())
      killer.on('close', () => resolve())
    })
    return
  }
  try {
    process.kill(-child.pid, 'SIGKILL')
  } catch {
    child.kill('SIGKILL')
  }
}

export function runDeterministicCheck(
  check: DeterministicCheckDefinition,
  backendRoot: string,
): Promise<CommandResult> {
  return new Promise((resolve) => {
    const started = Date.now()
    const command = resolvedCommand(check.command, backendRoot)
    const child = spawn(command.program, command.args, {
      cwd: backendRoot,
      env: {
        ...process.env,
        DPL304_USE_LOCAL_DB: '1',
        V2_VIDEO_GENERATION_PROVIDER: 'none',
      },
      shell: false,
      windowsHide: true,
      detached: process.platform !== 'win32',
    })
    let stdout = ''
    let stderr = ''
    child.stdout?.on('data', (chunk) => { stdout += String(chunk) })
    child.stderr?.on('data', (chunk) => { stderr += String(chunk) })
    let settled = false
    let timedOut = false
    const finish = (result: CommandResult) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      resolve(result)
    }
    const timeout = setTimeout(() => {
      timedOut = true
      void terminateProcessTree(child)
      setTimeout(() => finish({
        ok: false,
        durationMs: Date.now() - started,
        stdout,
        stderr: `${stderr}${stderr ? '\n' : ''}Timed out after ${check.timeoutMs ?? 120_000}ms.`,
      }), 5_000).unref()
    }, check.timeoutMs ?? 120_000)
    child.on('error', (error) => {
      finish({ ok: false, durationMs: Date.now() - started, stdout, stderr: `${stderr}${error.message}` })
    })
    child.on('close', (code) => {
      finish({
        ok: !timedOut && code === 0,
        durationMs: Date.now() - started,
        stdout,
        stderr: timedOut ? `${stderr}${stderr ? '\n' : ''}Timed out after ${check.timeoutMs ?? 120_000}ms.` : stderr,
      })
    })
  })
}

export function createProviderSubmissionBudget(input: {
  adapter: V2MaterialGenerationAdapter
  maxSubmissions: number
  maxGeneratedSeconds: number
}) {
  let submissions = 0
  let generatedSeconds = 0
  let rejected = 0
  const adapter: V2MaterialGenerationAdapter = {
    async generate(request, options) {
      const durationSec = request.durationSec
      const durationExceeded = !Number.isFinite(durationSec) || durationSec <= 0
        || generatedSeconds + durationSec > input.maxGeneratedSeconds
      if (submissions >= input.maxSubmissions || durationExceeded) {
        rejected += 1
        const durationFailure = durationExceeded
        return {
          ok: false,
          submissionState: 'not_submitted',
          metadata: {
            evaluationFailureCode: durationFailure
              ? 'provider_duration_budget_exceeded'
              : 'provider_budget_exceeded',
          },
          error: durationFailure
            ? `Evaluation Provider generated-seconds budget exhausted (${input.maxGeneratedSeconds}s).`
            : `Evaluation Provider submission budget exhausted (${input.maxSubmissions}).`,
        }
      }
      submissions += 1
      generatedSeconds += durationSec
      return input.adapter.generate(request, options)
    },
  }
  return {
    adapter,
    usage: () => ({
      submissions,
      maxSubmissions: input.maxSubmissions,
      generatedSeconds,
      maxGeneratedSeconds: input.maxGeneratedSeconds,
      rejected,
    }),
  }
}

export function countSuccessfulRenderRuns(reports: any[]): number {
  const runIds = new Set<string>()
  for (const report of reports) {
    for (const turn of Array.isArray(report?.turns) ? report.turns : []) {
      for (const result of Array.isArray(turn?.toolResults) ? turn.toolResults : []) {
        const renderRunId = result?.result?.renderRunId
        if (result?.toolId === 'timeline.render' && result?.ok === true && typeof renderRunId === 'string') {
          runIds.add(renderRunId)
        }
      }
    }
  }
  return runIds.size
}

export function collectAgentFailures(reports: any[]): string[] {
  const failures: string[] = []
  for (const report of reports) {
    for (const turn of Array.isArray(report?.turns) ? report.turns : []) {
      if (turn.deterministicPass !== false) continue
      const reasons = (Array.isArray(turn.deterministicFailures) ? turn.deterministicFailures : [])
        .filter((value): value is string => typeof value === 'string' && value.length > 0)
      failures.push(`agent: ${turn.caseId}/run-${turn.run}/turn-${turn.turn}: ${reasons.join('；') || 'evaluation failed'}`)
    }
  }
  return failures
}

export function openFailureLedgerForProfile(
  entries: FrozenEvaluationDataset['failureLedger']['entries'],
  profile: EvaluationProfile,
) {
  const directVerification = `profile:${profile}`
  return entries.filter((entry) => entry.status !== 'resolved' && (
    entry.verification === directVerification
    || (entry.verification === 'profile:memory_retrieval' && ['live', 'stability'].includes(profile))
  ))
}

export function blockingFailureLedgerForProfile(
  entries: FrozenEvaluationDataset['failureLedger']['entries'],
  profile: EvaluationProfile,
) {
  return openFailureLedgerForProfile(entries, profile).filter((entry) => entry.status !== 'deferred')
}

async function gitOutput(args: string[], cwd: string) {
  return new Promise<{ ok: boolean; output: string }>((resolve) => {
    const child = spawn('git', args, { cwd, windowsHide: true })
    let output = ''
    child.stdout.on('data', (chunk) => { output += String(chunk) })
    child.on('error', () => resolve({ ok: false, output: '' }))
    child.on('close', (code) => resolve({ ok: code === 0, output: code === 0 ? output : '' }))
  })
}

export async function readGitProvenance(backendRoot: string) {
  const rootResult = await gitOutput(['rev-parse', '--show-toplevel'], backendRoot)
  const repositoryRoot = rootResult.output.trim() || backendRoot
  const [gitCommit, status, trackedPathsOutput, untrackedOutput] = await Promise.all([
    gitOutput(['rev-parse', 'HEAD'], repositoryRoot),
    gitOutput(['status', '--porcelain=v1', '-z'], repositoryRoot),
    gitOutput(['diff', '--name-only', '-z', 'HEAD'], repositoryRoot),
    gitOutput(['ls-files', '--others', '--exclude-standard', '-z'], repositoryRoot),
  ])
  const gitProvenanceValid = rootResult.ok && gitCommit.ok && status.ok && trackedPathsOutput.ok && untrackedOutput.ok
  const tracked = await Promise.all(trackedPathsOutput.output.split('\0').filter(Boolean).sort().map(async (relativePath) => {
    const file = path.resolve(repositoryRoot, relativePath)
    try {
      return { path: relativePath.replaceAll('\\', '/'), hash: sha256(await readFile(file)) }
    } catch {
      return { path: relativePath.replaceAll('\\', '/'), hash: 'deleted' }
    }
  }))
  const untracked = await Promise.all(untrackedOutput.output.split('\0').filter(Boolean).sort().map(async (relativePath) => ({
    path: relativePath.replaceAll('\\', '/'),
    hash: sha256(await readFile(path.resolve(repositoryRoot, relativePath))),
  })))
  const statusEntries = status.output.split('\0').filter(Boolean).sort()
  return {
    gitCommit: gitCommit.output.trim() || 'unknown',
    gitDirty: !gitProvenanceValid || statusEntries.length > 0,
    gitProvenanceValid,
    worktreeDiffHash: sha256(canonicalJson({ statusEntries, tracked, untracked })),
  }
}

async function assertCurrentFrozenSources(file: string, frozen: FrozenEvaluationDataset) {
  if (path.basename(file) !== 'current.v1.json') return
  const sourceDir = path.resolve(path.dirname(file), '..', 'source')
  for (const [source, expectedHash] of Object.entries(frozen.sourceHashes)) {
    const sourceFile = source.startsWith('media:') || source.startsWith('sample:')
      ? path.resolve(sourceDir, '..', '..', '..', '..', source.slice(source.indexOf(':') + 1))
      : path.resolve(sourceDir, source)
    let actualHash: string
    try {
      actualHash = sha256(await readFile(sourceFile))
    } catch {
      throw new Error(`Frozen dataset source drift: missing ${source}.`)
    }
    if (actualHash !== expectedHash) throw new Error(`Frozen dataset source drift: ${source}. Rebuild the dataset.`)
  }
}

async function loadFrozenDataset(file: string) {
  const { value } = await readJsonFile<FrozenEvaluationDataset>(file)
  if (value.schemaVersion !== 'v2_evaluation_frozen.v1') throw new Error('Unsupported frozen evaluation dataset.')
  const { datasetHash, builtAt: _builtAt, ...content } = value
  const actualHash = sha256(canonicalJson(content))
  if (actualHash !== datasetHash) throw new Error(`Frozen dataset hash mismatch: expected ${datasetHash}, got ${actualHash}.`)
  await assertCurrentFrozenSources(file, value)
  return value
}

export function collectAgentEvidence(
  report: any,
  metricIdsByCase: Map<string, Set<string>>,
  rates: RateEvidence[],
  score10: Array<{ metricId: string; value: number; evidence?: string }>,
  counts: Array<{ metricId: string; value: number; evidence?: string }>,
) {
  const turns = Array.isArray(report?.turns) ? report.turns : []
  const source = String(report?.manifest?.suite ?? 'agent suite')
  const selected = (metricId: string) => turns.filter((turn: any) => metricIdsByCase.get(turn.caseId)?.has(metricId))
  const push = (metricId: string, clusters: Array<{ numerator: number; denominator: number }>) => {
    const measured = clusters.filter((item) => item.denominator > 0)
    if (measured.length > 0) rates.push({
      metricId,
      numerator: measured.reduce((sum, item) => sum + item.numerator, 0),
      denominator: measured.reduce((sum, item) => sum + item.denominator, 0),
      clusters: measured,
      evidence: source,
    })
  }

  const scenarioTurns = selected('scenario_goal_completion_rate')
  const scenarios = new Map<string, any[]>()
  for (const turn of scenarioTurns) {
    const key = `${turn.caseId}:${turn.run}`
    scenarios.set(key, [...(scenarios.get(key) ?? []), turn])
  }
  push('scenario_goal_completion_rate', [...scenarios.values()].map((items) => ({ numerator: Number(items.every((turn) => turn.deterministicPass)), denominator: 1 })))

  const contextTurns = selected('context_decision_accuracy_rate')
  push('context_decision_accuracy_rate', contextTurns.map((turn: any) => ({ numerator: Number(turn.contextDecisionPassed), denominator: 1 })))
  const bindingTurns = selected('system_binding_integrity_rate')
  push('system_binding_integrity_rate', bindingTurns.map((turn: any) => ({ numerator: Number(turn.systemBindingIntegrityPassed), denominator: 1 })))
  const independentTurns = selected('independent_action_completion_rate')
  push('independent_action_completion_rate', independentTurns.map((turn: any) => ({ numerator: Number(turn.independentActionChecksPassed ?? 0), denominator: Number(turn.independentActionChecks ?? 0) })))
  const dependencyTurns = selected('dependency_execution_accuracy_rate')
  push('dependency_execution_accuracy_rate', dependencyTurns.map((turn: any) => ({ numerator: Number(turn.dependencyChecksPassed ?? 0), denominator: Number(turn.dependencyChecks ?? 0) })))
  const artifactTurns = selected('artifact_requirement_realization_rate')
  push('artifact_requirement_realization_rate', artifactTurns.map((turn: any) => ({ numerator: Number(turn.plannerRequirementChecksPassed ?? 0) + Number(turn.timelineRequirementChecksPassed ?? 0), denominator: Number(turn.plannerRequirementChecks ?? 0) + Number(turn.timelineRequirementChecks ?? 0) })))
  const plannerTurns = selected('planner_requirement_input_rate')
  push('planner_requirement_input_rate', plannerTurns.map((turn: any) => ({ numerator: Number(turn.plannerRequirementChecksPassed ?? 0), denominator: Number(turn.plannerRequirementChecks ?? 0) })))
  const recoveryTurns = selected('recovery_completion_rate').filter((turn: any) => turn.recoveryCheck)
  push('recovery_completion_rate', recoveryTurns.map((turn: any) => ({ numerator: Number(turn.recoveryPassed), denominator: 1 })))
  const validityTurns = selected('timeline_validity_rate').filter((turn: any) => turn.timelineValid !== undefined)
  push('timeline_validity_rate', validityTurns.map((turn: any) => ({ numerator: Number(turn.timelineValid), denominator: 1 })))
  const revisionTurns = selected('revision_completion_rate').filter((turn: any) => turn.expectedKind === 'revise' && turn.expectedDraftChange === true)
  push('revision_completion_rate', revisionTurns.map((turn: any) => ({ numerator: Number(turn.draftChanged), denominator: 1 })))
  const structuredTurns = selected('structured_first_pass_rate')
  push('structured_first_pass_rate', structuredTurns.map((turn: any) => ({ numerator: Number(!turn.jsonRepair && !turn.fallback), denominator: 1 })))
  const memoryPrecisionTurns = selected('memory_write_precision')
  push('memory_write_precision', memoryPrecisionTurns.map((turn: any) => ({ numerator: Number(turn.memoryWriteCorrect ?? 0), denominator: Number(turn.memoryWriteActual ?? 0) })))
  const memoryRecallTurns = selected('memory_write_recall')
  push('memory_write_recall', memoryRecallTurns.map((turn: any) => ({ numerator: Number(turn.memoryWriteExpectedPassed ?? 0), denominator: Number(turn.memoryWriteExpected ?? 0) })))
  const memoryScopeTurns = selected('memory_scope_accuracy_rate')
  push('memory_scope_accuracy_rate', memoryScopeTurns.map((turn: any) => ({ numerator: Number(turn.memoryScopeChecksPassed ?? 0), denominator: Number(turn.memoryScopeChecks ?? 0) })))
  const memoryApplicationTurns = selected('memory_application_accuracy_rate')
  push('memory_application_accuracy_rate', memoryApplicationTurns.map((turn: any) => ({ numerator: Number(turn.memoryApplicationChecksPassed ?? 0), denominator: Number(turn.memoryApplicationChecks ?? 0) })))
  const nonInterferenceTurns = selected('memory_non_interference_rate').filter((turn: any) => turn.memoryNonInterferenceCheck)
  push('memory_non_interference_rate', nonInterferenceTurns.map((turn: any) => ({ numerator: Number(turn.memoryNonInterferencePassed), denominator: 1 })))

  for (const turn of selected('reply_relevance_score10')) {
    if (typeof turn.relevanceScore === 'number') {
      score10.push({ metricId: 'reply_relevance_score10', value: turn.relevanceScore * 10, evidence: `${turn.caseId}/turn-${turn.turn}` })
    }
  }
  counts.push({
    metricId: 'hard_blocker_count',
    value: turns.reduce((sum: number, turn: any) => sum
      + Number(Boolean(turn.unauthorizedExecution))
      + Number(Boolean(turn.systemResourceOverride))
      + Number(Boolean(turn.falseSuccess))
      + Number(Boolean(turn.crossDomainMutation))
      + Number(Boolean(turn.crossScopeMemoryLeak))
      + Number(Boolean(turn.memoryBlockedTurn))
      + Number(Boolean(turn.falseMemoryPersistenceClaim)), 0),
    evidence: source,
  })
}

function collectRetrievalEvidence(
  report: any,
  rates: RateEvidence[],
  means: Array<{ metricId: string; total: number; observations: number; evidence?: string }>,
  counts: Array<{ metricId: string; value: number; evidence?: string }>,
) {
  const evidence = report?.version ?? 'memory retrieval'
  const queries = Array.isArray(report?.queryResults) ? report.queryResults : []
  const activeClusters = queries
    .map((query: any) => ({ numerator: Number(query.activeRetrieved ?? 0), denominator: Number(query.activeRelevant ?? 0) }))
    .filter((item: any) => item.denominator > 0)
  rates.push({
    metricId: 'active_memory_recall_at8',
    numerator: Number(report?.activeRetrieved ?? 0),
    denominator: Number(report?.activeRelevant ?? 0),
    ...(activeClusters.length ? { clusters: activeClusters } : {}),
    evidence,
  })
  means.push({ metricId: 'active_memory_ndcg_at8', total: Number(report?.ndcgTotal ?? 0), observations: Number(report?.ndcgQueries ?? 0), evidence })
  const candidateClusters = queries
    .map((query: any) => ({ numerator: Number(query.candidateRelevantReturned ?? 0), denominator: Number(query.candidateReturned ?? 0) }))
    .filter((item: any) => item.denominator > 0)
  rates.push({
    metricId: 'candidate_memory_precision_at3',
    numerator: Number(report?.candidateRelevantReturned ?? 0),
    denominator: Number(report?.candidateReturned ?? 0),
    ...(candidateClusters.length ? { clusters: candidateClusters } : {}),
    evidence,
  })
  counts.push({ metricId: 'cross_scope_retrieval_count', value: Number(report?.crossScopeRetrievalCount ?? 0), evidence: report?.version ?? 'memory retrieval' })
  counts.push({ metricId: 'unrelated_retrieval_count', value: Number(report?.unrelatedRetrievalCount ?? 0), evidence: report?.version ?? 'memory retrieval' })
}

export function collectMediaEvidence(report: any, rates: RateEvidence[]) {
  const evidence = report?.version ?? 'media planning'
  const results = Array.isArray(report?.results) ? report.results : []
  const clusters = (metricId: string) => {
    if (!results.length) return undefined
    if (metricId === 'image_pixel_delivery_rate') return results.map((item: any) => ({ numerator: Number(item.pixelInputAttached), denominator: 1 }))
    if (metricId === 'image_observation_fact_rate') return results.map((item: any) => ({ numerator: item.factChecks.filter((check: any) => check.passed).length, denominator: item.factChecks.length }))
    if (metricId === 'image_hallucination_avoidance_rate') return results.map((item: any) => ({ numerator: item.forbiddenChecks.filter((check: any) => check.passed).length, denominator: item.forbiddenChecks.length })).filter((item: any) => item.denominator > 0)
    if (metricId === 'image_reference_binding_rate') return results.map((item: any) => ({ numerator: Number(item.authoritativeReferenceBound), denominator: 1 }))
    if (metricId === 'conditioned_generation_plan_rate') return results.map((item: any) => ({ numerator: Number(item.conditionedGenerationMatched), denominator: 1 }))
    if (metricId === 'image_interference_robustness_rate') return results.filter((item: any) => item.interference).map((item: any) => {
      const facts = item.factChecks.filter((check: any) => !check.interferenceArtifact)
      return { numerator: Number(facts.length > 0 && facts.every((check: any) => check.passed)), denominator: 1 }
    })
    return undefined
  }
  const push = (metricId: string, numerator: number, denominator: number) => rates.push({ metricId, numerator, denominator, ...(clusters(metricId)?.length ? { clusters: clusters(metricId) } : {}), evidence })
  push('image_pixel_delivery_rate', Number(report?.pixelInputsPassed ?? 0), Number(report?.tasks ?? 0))
  push('image_observation_fact_rate', Number(report?.factChecksPassed ?? 0), Number(report?.factChecks ?? 0))
  push('image_hallucination_avoidance_rate', Number(report?.forbiddenChecksPassed ?? 0), Number(report?.forbiddenChecks ?? 0))
  push('image_reference_binding_rate', Number(report?.referenceBindingsPassed ?? 0), Number(report?.tasks ?? 0))
  push('conditioned_generation_plan_rate', Number(report?.conditionedGenerationPassed ?? 0), Number(report?.tasks ?? 0))
  push('image_interference_robustness_rate', Number(report?.interferenceTasksPassed ?? 0), Number(report?.interferenceTasks ?? 0))
}

export async function readManualRatings(
  file: string | undefined,
  frozen: FrozenEvaluationDataset,
  agentReports: any[],
  frozenEvidence?: EvaluationRunReport['evidenceArtifacts'],
) {
  if (!file) return [] as Array<{ metricId: string; value: number; evidence?: string }>
  const value = JSON.parse(await readFile(file, 'utf8')) as {
    ratings?: Array<{ caseId: string; runIndex?: number; turnIndex?: number; renderIndex?: number; scores: Record<string, number> }>
  }
  const cases = new Map(frozen.agentSuites.flatMap((suite) => suite.suite.cases.map((testCase) => [testCase.id, testCase] as const)))
  const metrics = new Map(frozen.manifest.metricCatalog.map((metric) => [metric.id, metric]))
  const rubricMetrics = new Set(frozen.manualRubric.dimensions.map((dimension) => dimension.id))
  const videoMetrics = new Set(['video_narrative_coherence_score10', 'visual_quality_score10', 'edit_fidelity_score10'])
  const renderResults = new Map<string, any[]>()
  for (const report of agentReports) {
    for (const turn of Array.isArray(report?.turns) ? report.turns : []) {
      const target = renderResults.get(turn.caseId) ?? []
      for (const result of Array.isArray(turn?.toolResults) ? turn.toolResults : []) {
        if (result?.toolId === 'timeline.render' && result?.ok === true && result?.result?.renderRunId) target.push(result.result)
      }
      renderResults.set(turn.caseId, target)
    }
  }
  const output: Array<{ metricId: string; value: number; evidence?: string }> = []
  const ratingCoordinates = new Set<string>()
  for (const rating of value.ratings ?? []) {
    const testCase = cases.get(rating.caseId)
    if (!testCase) throw new Error(`Manual rating uses unknown case: ${rating.caseId}`)
    const declaredMetrics = new Set(testCase.metricIds)
    const render = rating.renderIndex === undefined
      ? undefined
      : renderResults.get(rating.caseId)?.[rating.renderIndex - 1]
    if (rating.renderIndex !== undefined && (!Number.isInteger(rating.renderIndex) || rating.renderIndex < 1 || !render)) {
      throw new Error(`Manual rating references missing successful RenderRun: ${rating.caseId}/render-${rating.renderIndex}`)
    }
    let renderEvidence: string | undefined
    if (render) {
      if (typeof render.outputPath !== 'string') throw new Error(`RenderRun ${render.renderRunId} has no outputPath.`)
      const artifact = await readFile(render.outputPath)
      renderEvidence = `${render.renderRunId}:${sha256(artifact)}`
      const frozenArtifacts = frozenEvidence?.filter((item) => item.kind === 'render' && item.id === render.renderRunId)
      if (frozenEvidence && frozenArtifacts?.length !== 1) throw new Error(`Manual scoring evidence baseline is not unique: ${render.renderRunId}`)
      const frozenArtifact = frozenArtifacts?.[0]
      if (frozenArtifact && (path.resolve(frozenArtifact.path) !== path.resolve(render.outputPath) || frozenArtifact.sha256 !== sha256(artifact))) {
        throw new Error(`Manual scoring evidence changed after the run: ${render.renderRunId}`)
      }
    }
    let turnEvidence: string | undefined
    const hasTurnCoordinates = rating.runIndex !== undefined || rating.turnIndex !== undefined
    if (hasTurnCoordinates) {
      if (!Number.isInteger(rating.runIndex) || Number(rating.runIndex) < 1
        || !Number.isInteger(rating.turnIndex) || Number(rating.turnIndex) < 1) {
        throw new Error(`Manual rating requires both runIndex and turnIndex: ${rating.caseId}`)
      }
      const turn = agentReports
        .flatMap((report) => Array.isArray(report?.turns) ? report.turns : [])
        .find((candidate) => candidate.caseId === rating.caseId
          && candidate.run === rating.runIndex && candidate.turn === rating.turnIndex)
      if (!turn?.traceDir) {
        throw new Error(`Manual rating references missing evaluated turn: ${rating.caseId}/run-${rating.runIndex}/turn-${rating.turnIndex}`)
      }
      const turnResultFile = path.join(turn.traceDir, '00-director-turn', 'turn-result.json')
      const turnHash = sha256(await readFile(turnResultFile))
      const turnId = `${rating.caseId}/run-${rating.runIndex}/turn-${rating.turnIndex}`
      const frozenArtifacts = frozenEvidence?.filter((item) => item.kind === 'turn' && item.id === turnId)
      if (frozenEvidence && frozenArtifacts?.length !== 1) throw new Error(`Manual scoring evidence baseline is not unique: ${turnId}`)
      const frozenArtifact = frozenArtifacts?.[0]
      if (frozenArtifact && (path.resolve(frozenArtifact.path) !== path.resolve(turnResultFile) || frozenArtifact.sha256 !== turnHash)) {
        throw new Error(`Manual scoring evidence changed after the run: ${turnId}`)
      }
      turnEvidence = `${turnId}:${turnHash}`
    }
    for (const [metricId, score] of Object.entries(rating.scores)) {
      const metric = metrics.get(metricId)
      if (!metric || metric.scale !== 'score10') throw new Error(`Manual rating uses unknown score10 metric: ${metricId}`)
      if (!rubricMetrics.has(metricId)) throw new Error(`Manual rating metric is not in the frozen rubric: ${metricId}`)
      if (!declaredMetrics.has(metricId)) throw new Error(`Case ${rating.caseId} does not declare metric ${metricId}.`)
      if (!Number.isFinite(score) || score < 0 || score > 10) throw new Error(`Manual rating is outside 0-10: ${metricId}`)
      if (videoMetrics.has(metricId) && !renderEvidence) throw new Error(`Video metric ${metricId} requires a successful RenderRun.`)
      if (!videoMetrics.has(metricId) && !turnEvidence) throw new Error(`Non-video metric ${metricId} requires runIndex and turnIndex.`)
      const coordinate = videoMetrics.has(metricId)
        ? `${rating.caseId}/render-${rating.renderIndex}/${metricId}`
        : `${rating.caseId}/run-${rating.runIndex}/turn-${rating.turnIndex}/${metricId}`
      if (ratingCoordinates.has(coordinate)) throw new Error(`Manual rating duplicates metric evidence: ${coordinate}`)
      ratingCoordinates.add(coordinate)
      output.push({
        metricId,
        value: score,
        evidence: videoMetrics.has(metricId) ? renderEvidence : turnEvidence,
      })
    }
  }
  return output
}

export function evaluationReportMarkdown(report: EvaluationRunReport) {
  const format = (value: number | null, scale: string) => {
    if (value === null) return '未测量'
    if (scale === 'rate') return `${(value * 100).toFixed(1)}%`
    return Number.isInteger(value) ? String(value) : value.toFixed(2)
  }
  return [
    '# V2 Agent 统一评测报告',
    '',
    `- 数据集：${report.manifest.datasetVersion}`,
    `- 数据集 SHA256：\`${report.manifest.datasetHash}\``,
    `- Profile：${report.manifest.profile}`,
    `- Provider 调用：${report.manifest.providerCallsAllowed ? `允许，最多 ${report.manifest.maxProviderSubmissions} 次、${report.manifest.maxGeneratedSeconds} 目标生成秒；实际 ${report.manifest.providerSubmissions} 次、${report.manifest.generatedSeconds} 秒` : '禁止'}`,
    `- 成功 RenderRun：${report.manifest.successfulRenderRuns} / ${report.manifest.canaryRenderRuns}`,
    `- Git：${report.manifest.gitCommit}（${!report.manifest.gitProvenanceValid ? '来源不可验证，非正式运行' : report.manifest.gitDirty ? 'dirty，非正式运行' : 'clean'}）`,
    `- Worktree diff SHA256：\`${report.manifest.worktreeDiffHash}\``,
    `- 运行期间工作树变化：${report.manifest.worktreeChangedDuringRun ? '是' : '否'}`,
    `- 执行有效性：${report.executionValidityPassed ? '通过' : '未通过'}`,
    `- 质量门槛：${report.qualityQualified === null ? '本 profile 未评测' : report.qualityQualified ? '达标' : '未达标'}`,
    ...(report.manualScoring ? [
      `- 人工评分基础报告 SHA256：\`${report.manualScoring.baseReportSha256}\``,
      `- 人工评分文件 SHA256：\`${report.manualScoring.ratingsSha256}\``,
    ] : []),
    '',
    '## 指标',
    '',
    '| 指标 | 量表 | 结果 | 状态 |',
    '| --- | --- | ---: | --- |',
    ...report.scores.metrics.map((item) => `| ${item.label} | ${item.scale} | ${format(item.value, item.scale)} | ${item.status} |`),
    '',
    '## 确定性检查',
    '',
    ...(report.deterministicChecks.length
      ? report.deterministicChecks.map((item) => `- ${item.ok ? '通过' : '失败'}：${item.label}（${item.durationMs}ms）`)
      : ['- 本 profile 未运行确定性检查。']),
    '',
    '## 失败',
    '',
    ...(report.failures.length ? report.failures.map((item) => `- ${item}`) : ['- 无。']),
    '',
    '## 质量门槛未达项',
    '',
    ...(report.qualityGateFailures.length ? report.qualityGateFailures.map((item) => `- ${item}`) : ['- 无。']),
    '',
    '## 尚待验证的历史失败根因',
    '',
    ...(report.openFailureLedger.length
      ? report.openFailureLedger.map((item) => `- ${item.rootCause}（${item.status}，${item.verification}）`)
      : ['- 无。']),
    '',
    '## 限制',
    '',
    ...report.limitations.map((item) => `- ${item}`),
    '',
  ].join('\n')
}

export async function rescoreEvaluationReport(input: {
  reportFile: string
  frozenFile: string
  ratingsFile: string
  outputDir: string
}): Promise<EvaluationRunReport> {
  const frozen = await loadFrozenDataset(input.frozenFile)
  const baseReportRaw = await readFile(input.reportFile)
  const expectedReportSha256 = (await readFile(reportIntegrityFile(input.reportFile), 'utf8').catch(() => {
    throw new Error('Base evaluation report has no integrity sidecar.')
  })).trim()
  if (expectedReportSha256 !== sha256(baseReportRaw)) throw new Error('Base evaluation report failed integrity verification.')
  const baseReport = JSON.parse(baseReportRaw.toString('utf8')) as EvaluationRunReport
  if (baseReport.manifest?.datasetHash !== frozen.datasetHash) {
    throw new Error(`Base report dataset hash does not match frozen dataset: ${baseReport.manifest?.datasetHash ?? 'missing'} != ${frozen.datasetHash}`)
  }
  if (baseReport.schemaVersion !== 'v2_evaluation_report.v1'
    || !['deterministic', 'live', 'stability', 'canary'].includes(baseReport.manifest?.profile)
    || typeof baseReport.manifest?.gitCommit !== 'string'
    || baseReport.manifest.gitCommit === 'unknown'
    || baseReport.manifest.gitProvenanceValid !== true
    || baseReport.manifest.worktreeChangedDuringRun !== false
    || !Array.isArray(baseReport.agentReports)
    || !Array.isArray(baseReport.scores?.metrics)
    || !Array.isArray(baseReport.failures)
    || typeof baseReport.executionValidityPassed !== 'boolean'
    || (baseReport.qualityQualified !== null && typeof baseReport.qualityQualified !== 'boolean')
    || !Array.isArray(baseReport.qualityGateFailures)
    || typeof baseReport.releaseBlocked !== 'boolean') {
    throw new Error('Base evaluation report is incomplete or unsupported.')
  }
  const ratingsRaw = await readFile(input.ratingsFile)
  const ratingsDocument = JSON.parse(ratingsRaw.toString('utf8')) as { ratings?: unknown[] }
  if (!Array.isArray(baseReport.evidenceArtifacts)) throw new Error('Base evaluation report has no frozen scoring evidence.')
  const manualEvidence = await readManualRatings(input.ratingsFile, frozen, baseReport.agentReports, baseReport.evidenceArtifacts)
  if (!manualEvidence.length) throw new Error('Manual ratings file contains no valid scores.')
  const manualMetricIds = new Set(manualEvidence.map((item) => item.metricId))
  const manualScores = scoreEvaluationEvidence({
    metricCatalog: frozen.manifest.metricCatalog,
    binary: [], rates: [], means: [], score10: manualEvidence, counts: [],
  }).metrics
  const scoreById = new Map(manualScores.map((score) => [score.id, score]))
  const report: EvaluationRunReport = {
    ...baseReport,
    scores: {
      metrics: baseReport.scores.metrics.map((score) => (
        manualMetricIds.has(score.id) ? scoreById.get(score.id) ?? score : score
      )),
    },
    limitations: [
      ...baseReport.limitations.filter((item) => !item.startsWith('人工评分已在运行后附加')),
      '人工评分已在运行后附加；客观指标、失败、硬门禁、Provider 用量和产物均沿用基础报告，未重新执行 Agent 或 Provider。',
    ],
    manualScoring: {
      baseReport: path.resolve(input.reportFile),
      baseReportSha256: sha256(baseReportRaw),
      ratingsFile: path.resolve(input.ratingsFile),
      ratingsSha256: sha256(ratingsRaw),
      ratingsCount: Array.isArray(ratingsDocument.ratings) ? ratingsDocument.ratings.length : 0,
      scoreObservations: manualEvidence.length,
      rescoredAt: new Date().toISOString(),
    },
  }
  await mkdir(input.outputDir, { recursive: true })
  await writeEvaluationReport(input.outputDir, report)
  return report
}

export async function runEvaluation(input: {
  frozenFile: string
  outputDir: string
  profile: EvaluationProfile
  allowProvider?: boolean
  ratingsFile?: string
  backendRoot?: string
  executeCommand?: (check: DeterministicCheckDefinition) => Promise<CommandResult>
}): Promise<EvaluationRunReport> {
  const frozen = await loadFrozenDataset(input.frozenFile)
  if (input.profile === 'canary' && !input.allowProvider) {
    throw new Error('Canary evaluation requires explicit --allow-provider authorization.')
  }
  const backendRoot = path.resolve(input.backendRoot ?? fileURLToPath(new URL('../..', import.meta.url)))
  const startGit = await readGitProvenance(backendRoot)
  if (input.profile !== 'deterministic' && (!startGit.gitProvenanceValid || startGit.gitDirty)) {
    throw new Error('Formal live/stability/canary evaluation requires a clean, verifiable Git worktree before execution.')
  }
  await mkdir(input.outputDir, { recursive: true })
  await writeFile(path.join(input.outputDir, 'dataset.json'), `${JSON.stringify(frozen, null, 2)}\n`, 'utf8')
  const startedAt = new Date().toISOString()
  const checks: EvaluationRunReport['deterministicChecks'] = []
  const agentReports: any[] = []
  const retrievalReports: any[] = []
  const agentMetricIds = new Map<any, Map<string, Set<string>>>()
  let mediaReport: unknown
  let sampleReport: unknown
  let providerBudget: ReturnType<typeof createProviderSubmissionBudget> | undefined
  const renderCallIds = new Set<string>()
  let renderBudgetRejected = 0
  const failures: string[] = []

  if (input.profile === 'deterministic') {
    for (const definition of frozen.manifest.deterministicChecks) {
      const result = await (input.executeCommand?.(definition) ?? runDeterministicCheck(definition, backendRoot))
      checks.push({ ...definition, ...result, stdout: result.stdout.slice(-4_000), stderr: result.stderr.slice(-4_000) })
      if (!result.ok) failures.push(`${definition.id}: ${result.stderr.trim() || 'command failed'}`)
    }
  } else {
    process.env.DPL304_LOCAL_MODE = 'true'
    process.env.DPL304_LOCAL_DATA_DIR = path.join(input.outputDir, 'local-data')
    process.env.RENDER_COMPONENTS_DIR = path.join(input.outputDir, 'local-data', 'render-components')
    process.env.V2_TRACE_BASE_DIR = path.join(input.outputDir, 'traces')
    if (input.profile !== 'canary') process.env.V2_VIDEO_GENERATION_PROVIDER = 'none'
    const { runV2AgentEvaluation } = await import('../../src/evaluation-v2/agent-evaluation.js')
    let evaluationDispatchTool: Parameters<typeof runV2AgentEvaluation>[0]['dispatchTool']
    if (input.profile === 'canary') {
      const [{ createConfiguredV2MaterialGenerationAdapter }, { dispatchV2AgentTool }, { env }] = await Promise.all([
        import('../../src/pipeline-v2/configured-material-adapter.js'),
        import('../../src/pipeline-v2/agent-tools/dispatcher.js'),
        import('../../src/config/env.js'),
      ])
      if (env.v2VideoGenerationProvider !== 'ark-seedance' || !env.v2VideoGenerationApiKey) {
        throw new Error('Canary evaluation requires configured ark-seedance Provider and API key.')
      }
      providerBudget = createProviderSubmissionBudget({
        maxSubmissions: frozen.manifest.canary.maxProviderSubmissions,
        maxGeneratedSeconds: frozen.manifest.canary.maxGeneratedSeconds,
        adapter: createConfiguredV2MaterialGenerationAdapter({ outputDir: path.join(input.outputDir, 'provider') }),
      })
      evaluationDispatchTool = (request) => {
        if (request.stage.toolRequest.toolId === 'timeline.render') {
          const callId = request.stage.toolRequest.callId
          if (!renderCallIds.has(callId) && renderCallIds.size >= frozen.manifest.canary.maxRenderRuns) {
            renderBudgetRejected += 1
            return Promise.resolve({
              callId,
              toolId: 'timeline.render',
              ok: false,
              gate: 'evaluation_budget',
              summary: `Evaluation RenderRun budget exhausted (${frozen.manifest.canary.maxRenderRuns}).`,
              recovery: 'Start a separately authorized canary run with a new budget.',
            })
          }
          renderCallIds.add(callId)
        }
        return dispatchV2AgentTool({
          ...request,
          materialAdapter: providerBudget!.adapter,
          renderOutputBaseDir: path.join(input.outputDir, 'renders'),
        })
      }
    }
    const selected = frozen.agentSuites.filter((item) => item.definition.profiles.includes(input.profile))
    for (const item of selected) {
      const suiteFile = path.join(input.outputDir, 'inputs', `${item.definition.id}.json`)
      await mkdir(path.dirname(suiteFile), { recursive: true })
      await writeFile(suiteFile, `${JSON.stringify(item.suite, null, 2)}\n`, 'utf8')
      const caseIds = input.profile === 'canary'
        ? frozen.manifest.canary.cases.filter((candidate) => candidate.suiteId === item.definition.id).map((candidate) => candidate.caseId)
        : input.profile === 'stability' ? item.definition.caseIds : undefined
      const report = await runV2AgentEvaluation({
        suiteFile,
        outputDir: path.join(input.outputDir, 'agent', item.definition.id),
        runs: input.profile === 'stability' ? 3 : 1,
        caseIds,
        dispatchTool: evaluationDispatchTool,
      })
      agentReports.push(report)
      agentMetricIds.set(report, new Map(item.suite.cases.map((testCase) => [
        testCase.id,
        new Set(testCase.metricIds ?? []),
      ])))
    }
    if (input.profile !== 'canary') {
      const { evaluateCreativeMemoryRetrieval } = await import('../../src/evaluation-v2/creative-memory-retrieval-evaluation.js')
      for (const item of frozen.retrievalSuites) {
        const suiteFile = path.join(input.outputDir, 'inputs', `${item.definition.id}.json`)
        const retrievalOutput = path.join(input.outputDir, 'retrieval', `${item.definition.id}.json`)
        await mkdir(path.dirname(suiteFile), { recursive: true })
        await mkdir(path.dirname(retrievalOutput), { recursive: true })
        await writeFile(suiteFile, `${JSON.stringify(item.suite, null, 2)}\n`, 'utf8')
        retrievalReports.push(await evaluateCreativeMemoryRetrieval({
          suiteFile,
          outputFile: retrievalOutput,
        }))
      }
      if (frozen.mediaCatalog) {
        if (path.resolve(process.cwd()) !== backendRoot) {
          throw new Error(`Media evaluation must run from backend root: ${backendRoot}`)
        }
        const { evaluateMediaPlanning } = await import('./media-evaluation.js')
        const mediaOutput = path.join(input.outputDir, 'media', 'report.json')
        await mkdir(path.dirname(mediaOutput), { recursive: true })
        mediaReport = await evaluateMediaPlanning({
          catalog: frozen.mediaCatalog,
          repositoryRoot: path.dirname(backendRoot),
          backendRoot,
          outputFile: mediaOutput,
        })
      }
      if (frozen.sampleCatalog) {
        const { evaluateSampleUnderstanding } = await import('./sample-evaluation.js')
        sampleReport = await evaluateSampleUnderstanding({
          catalog: frozen.sampleCatalog,
          repositoryRoot: path.dirname(backendRoot),
          outputFile: path.join(input.outputDir, 'sample', 'report.json'),
        })
      }
    }
  }

  const binary = checks.flatMap((check) => check.metricIds.map((metricId) => ({ metricId, passed: check.ok, evidence: check.id })))
  const rates: RateEvidence[] = []
  const means: Array<{ metricId: string; total: number; observations: number; evidence?: string }> = []
  const score10 = await readManualRatings(input.ratingsFile, frozen, agentReports)
  const counts: Array<{ metricId: string; value: number; evidence?: string }> = []
  agentReports.forEach((report) => collectAgentEvidence(report, agentMetricIds.get(report) ?? new Map(), rates, score10, counts))
  retrievalReports.forEach((report) => collectRetrievalEvidence(report, rates, means, counts))
  if (mediaReport) collectMediaEvidence(mediaReport, rates)
  if (sampleReport) {
    const report = sampleReport as any
    const sampleClusters = (field: string) => Array.isArray(report.results)
      ? report.results.map((item: any) => ({ numerator: Number(item[field]), denominator: 1 }))
      : undefined
    rates.push({ metricId: 'sample_semantic_analysis_rate', numerator: Number(report.semanticAnalysisPassed ?? 0), denominator: Number(report.tasks ?? 0), clusters: sampleClusters('semantic'), evidence: report.version })
    rates.push({ metricId: 'sample_method_evidence_rate', numerator: Number(report.methodEvidencePassed ?? 0), denominator: Number(report.tasks ?? 0), clusters: sampleClusters('methodEvidence'), evidence: report.version })
    rates.push({ metricId: 'sample_transferable_knowledge_rate', numerator: Number(report.transferableKnowledgePassed ?? 0), denominator: Number(report.tasks ?? 0), clusters: sampleClusters('transferableKnowledge'), evidence: report.version })
  }
  const scores = scoreEvaluationEvidence({ metricCatalog: frozen.manifest.metricCatalog, binary, rates, means, score10, counts })
  const requiredHardGates = input.profile === 'deterministic'
    ? frozen.manifest.metricCatalog.filter((metric) => metric.hardGate && metric.scale === 'binary').map((metric) => metric.id)
    : input.profile === 'canary'
      ? ['hard_blocker_count']
      : ['hard_blocker_count', 'cross_scope_retrieval_count', 'unrelated_retrieval_count']
  const hardGates = evaluateHardGates(frozen.manifest.metricCatalog, scores.metrics, requiredHardGates)
  const qualityGates = evaluateQualityGates(
    frozen.manifest.metricCatalog,
    scores.metrics,
    input.profile === 'deterministic' ? [] : frozen.manifest.qualityGates?.[input.profile] ?? [],
  )
  const providerUsage = providerBudget?.usage()
  const successfulRenderRuns = countSuccessfulRenderRuns(agentReports)
  const canaryFailedTurns = input.profile === 'canary'
    ? agentReports.flatMap((report) => Array.isArray(report?.turns) ? report.turns : []).filter((turn) => !turn.deterministicPass).length
    : 0
  const hardGateFailures = [
    ...hardGates.failures,
    ...(renderBudgetRejected ? [`render_budget_rejected=${renderBudgetRejected}`] : []),
    ...(providerUsage?.rejected ? [`provider_budget_rejected=${providerUsage.rejected}`] : []),
    ...(input.profile === 'canary' && successfulRenderRuns !== frozen.summary.canaryRenderRuns
      ? [`successful_render_runs=${successfulRenderRuns}/${frozen.summary.canaryRenderRuns}`]
      : []),
    ...(canaryFailedTurns ? [`canary_failed_turns=${canaryFailedTurns}`] : []),
  ]
  failures.push(...collectAgentFailures(agentReports))
  failures.push(...hardGateFailures.map((failure) => `hard_gate: ${failure}`))
  const openFailureLedger = openFailureLedgerForProfile(frozen.failureLedger.entries, input.profile)
  failures.push(...blockingFailureLedgerForProfile(frozen.failureLedger.entries, input.profile)
    .map((entry) => `failure_ledger: ${entry.rootCause} (${entry.status})`))
  const endGit = await readGitProvenance(backendRoot)
  const worktreeChangedDuringRun = !endGit.gitProvenanceValid
    || endGit.gitCommit !== startGit.gitCommit
    || endGit.gitDirty !== startGit.gitDirty
    || endGit.worktreeDiffHash !== startGit.worktreeDiffHash
  if (worktreeChangedDuringRun && input.profile !== 'deterministic') {
    failures.push('provenance: worktree changed during evaluation')
  }
  const executionValidityPassed = failures.length === 0
  failures.push(...qualityGates.failures.map((failure) => `quality_gate: ${failure}`))
  const report: EvaluationRunReport = {
    schemaVersion: 'v2_evaluation_report.v1',
    manifest: {
      datasetVersion: frozen.datasetVersion,
      datasetHash: frozen.datasetHash,
      profile: input.profile,
      startedAt,
      completedAt: new Date().toISOString(),
      providerCallsAllowed: input.profile === 'canary',
      canaryRenderRuns: input.profile === 'canary' ? frozen.summary.canaryRenderRuns : 0,
      renderRunRequests: renderCallIds.size,
      maxProviderSubmissions: input.profile === 'canary' ? frozen.summary.maxProviderSubmissions : 0,
      providerSubmissions: providerUsage?.submissions ?? 0,
      maxGeneratedSeconds: input.profile === 'canary' ? frozen.summary.maxGeneratedSeconds : 0,
      generatedSeconds: providerUsage?.generatedSeconds ?? 0,
      successfulRenderRuns,
      ...startGit,
      worktreeChangedDuringRun,
    },
    datasetSummary: frozen.summary,
    deterministicChecks: checks,
    agentReports,
    retrievalReports,
    ...(mediaReport ? { mediaReport } : {}),
    ...(sampleReport ? { sampleReport } : {}),
    scores,
    executionValidityPassed,
    qualityQualified: input.profile === 'deterministic' ? null : qualityGates.qualified,
    qualityGateFailures: qualityGates.failures,
    releaseBlocked: failures.length > 0,
    hardGateFailures,
    failures,
    openFailureLedger,
    evidenceArtifacts: await collectEvidenceArtifacts(agentReports),
    limitations: [
      '0/1 与比例指标只证明协议、状态和可机器验证的方案结果，不代表成片审美质量。',
      '0–10 成片评分未提供人工 ratings 文件时保持“未评分”，不会按 0 分计入总成绩。',
      input.profile === 'canary'
        ? 'Provider canary 仅覆盖少量高价值样本，不能外推为所有题材的生成质量。'
        : '本 profile 不调用视频生成 Provider，主要衡量可编辑方案、上下文、工具和状态闭环。',
      ...(openFailureLedger.length
        ? [`本 profile 仍有 ${openFailureLedger.length} 项历史失败根因待验证，已在报告中逐项列出。`]
        : []),
    ],
  }
  await writeEvaluationReport(input.outputDir, report)
  return report
}

function argument(name: string) {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : undefined
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  const profile = (argument('--profile') ?? 'deterministic') as EvaluationProfile
  if (!['deterministic', 'live', 'stability', 'canary'].includes(profile)) throw new Error(`Unknown profile: ${profile}`)
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  const result = await runEvaluation({
    frozenFile: path.resolve(argument('--dataset') ?? 'evaluation/datasets/frozen/current.v1.json'),
    outputDir: path.resolve(argument('--output') ?? path.join('evaluation', 'reports', `${profile}-${timestamp}`)),
    profile,
    allowProvider: process.argv.includes('--allow-provider'),
    ratingsFile: argument('--ratings') ? path.resolve(argument('--ratings')!) : undefined,
  })
  console.log(JSON.stringify({ manifest: result.manifest, failures: result.failures }, null, 2))
  if (result.failures.length) process.exitCode = 1
}
