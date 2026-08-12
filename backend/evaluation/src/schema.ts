import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { validateAllowedMutationRules } from '../../src/evaluation-v2/agent-evaluation-contract.js'

export type MetricScale = 'binary' | 'rate' | 'mean' | 'score10' | 'count'
export type EvaluationProfile = 'deterministic' | 'live' | 'stability' | 'canary'

export interface MetricDefinition {
  id: string
  scale: MetricScale
  label: string
  description: string
  hardGate?: boolean
}

export interface QualityGateDefinition {
  metricId: string
  minimum: number
}

export interface DeterministicCheckDefinition {
  id: string
  label: string
  command: string[]
  metricIds: string[]
  timeoutMs?: number
}

export interface AgentSuiteReference {
  id: string
  file: string
  profiles: EvaluationProfile[]
  split: 'development' | 'holdout' | 'canary'
  caseIds?: string[]
}

export interface RetrievalSuiteReference {
  id: string
  file: string
}

export interface EvaluationDatasetManifest {
  schemaVersion: 'v2_evaluation_manifest.v1'
  datasetVersion: string
  description?: string
  metricCatalog: MetricDefinition[]
  qualityGates: Record<Exclude<EvaluationProfile, 'deterministic'>, QualityGateDefinition[]>
  deterministicChecks: DeterministicCheckDefinition[]
  agentSuites: AgentSuiteReference[]
  retrievalSuites: RetrievalSuiteReference[]
  mediaCatalogFile?: string
  sampleCatalogFile?: string
  failureLedgerFile: string
  reviewRuleRegistryFile: string
  manualRubricFile: string
  canary: {
    maxRenderRuns: number
    maxProviderSubmissions: number
    maxGeneratedSeconds: number
    cases: Array<{ suiteId: string; caseId: string; expectedRenderCount: number }>
  }
}

export interface AgentEvaluationSuite {
  version: string
  cases: Array<{
    id: string
    category: string
    fixture: 'empty' | 'draft' | 'material' | 'sample' | 'scifi_draft'
    metricIds: string[]
    materials?: unknown[]
    ui?: unknown
    turns: Array<{
      prompt: string
      simulateFailure?: string
      expected: { tools: string[]; kind: 'create' | 'discussion' | 'revise' | 'execute'; [key: string]: unknown }
    }>
  }>
}

export interface RetrievalEvaluationSuite {
  version: string
  construction: {
    sourceType: 'synthetic' | 'historical' | 'mixed'
    method: string
    coverage: string[]
    annotationGuide: string
  }
  drafts: string[]
  memories: Array<{ key: string; statement: string; [key: string]: unknown }>
  queries: Array<{ id: string; query: string; rationale: string; [key: string]: unknown }>
}

export interface ManualRubric {
  version: string
  dimensions: Array<{
    id: string
    label: string
    description: string
    min: 0
    max: 10
    anchors: Record<'0' | '2' | '5' | '8' | '10', string>
  }>
}

export interface EvaluationFailureLedger {
  version: string
  entries: Array<{
    rootCause: string
    status: 'needs_live_rerun' | 'needs_real_media' | 'deferred' | 'resolved'
    verification: string
    references?: string[]
    [key: string]: unknown
  }>
}

export interface EvaluationReviewRuleRegistry {
  version: string
  rules: Array<{
    name: string
    layer: 'invariant' | 'protocol' | 'semantic'
    reverseCase: string
    verification: string
  }>
}

export interface MediaEvaluationCatalog {
  version: string
  assets: Array<{
    id: string
    type: 'image'
    repositoryPath: string
    contentHash?: string
  }>
  tasks: Array<{
    id: string
    assetId: string
    prompt: string
    expectedObservedFacts: Array<{ id: string; aliases: string[]; interferenceArtifact?: boolean }>
    forbiddenObservedFacts?: string[]
    requireConditionedGeneration: boolean
    blindObservation?: boolean
    interference?: 'watermark' | 'checkerboard' | 'watermark_and_checkerboard'
  }>
}

export interface SampleEvaluationCatalog {
  version: string
  assets: Array<{
    id: string
    type: 'video'
    repositoryPath: string
    contentHash?: string
  }>
  tasks: Array<{
    id: string
    assetId: string
    prompt: string
    minMethodObservations: number
    minTransferableKnowledge: number
    expectedContentFacts: Array<{
      id: string
      aliases: string[]
      evidenceRanges: Array<{ startSec: number; endSec: number }>
    }>
    expectedMethodFacts: Array<{
      id: string
      aliases: string[]
      evidenceRanges: Array<{ startSec: number; endSec: number }>
    }>
    forbiddenClaims?: string[]
    minExpectedContentFacts: number
    minExpectedMethodFacts: number
  }>
}

export interface FrozenEvaluationDataset {
  schemaVersion: 'v2_evaluation_frozen.v1'
  datasetVersion: string
  builtAt: string
  datasetHash: string
  sourceHashes: Record<string, string>
  manifest: EvaluationDatasetManifest
  agentSuites: Array<{ definition: AgentSuiteReference; suite: AgentEvaluationSuite }>
  retrievalSuites: Array<{ definition: RetrievalSuiteReference; suite: RetrievalEvaluationSuite }>
  mediaCatalog?: MediaEvaluationCatalog
  sampleCatalog?: SampleEvaluationCatalog
  failureLedger: EvaluationFailureLedger
  reviewRuleRegistry: EvaluationReviewRuleRegistry
  manualRubric: ManualRubric
  summary: {
    agentSuites: number
    agentCases: number
    agentTurns: number
    retrievalSuites: number
    retrievalQueries: number
    mediaTasks: number
    sampleTasks: number
    deterministicChecks: number
    canaryRenderRuns: number
    maxProviderSubmissions: number
    maxGeneratedSeconds: number
  }
}

export function sha256(value: string | Buffer) {
  return createHash('sha256').update(value).digest('hex')
}

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

export function assertTextIntegrity(value: unknown, label: string): void {
  if (typeof value === 'string') {
    if (value.includes('\uFFFD') || /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/u.test(value)) {
      throw new Error(`${label}: invalid text encoding or control character.`)
    }
    return
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertTextIntegrity(item, `${label}[${index}]`))
    return
  }
  if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) assertTextIntegrity(item, `${label}.${key}`)
  }
}

export async function readJsonFile<T>(file: string): Promise<{ raw: string; value: T }> {
  const raw = await readFile(file, 'utf8')
  let value: T
  try {
    value = JSON.parse(raw) as T
  } catch (error) {
    throw new Error(`${file}: invalid JSON: ${error instanceof Error ? error.message : String(error)}`)
  }
  assertTextIntegrity(value, file)
  return { raw, value }
}

export function resolveSourceFile(sourceDir: string, relativeFile: string) {
  if (!relativeFile || path.isAbsolute(relativeFile)) throw new Error(`Source file must be relative: ${relativeFile}`)
  const sourceRoot = path.resolve(sourceDir)
  const resolved = path.resolve(sourceRoot, relativeFile)
  if (resolved !== sourceRoot && !resolved.startsWith(`${sourceRoot}${path.sep}`)) {
    throw new Error(`Source file escapes evaluation source directory: ${relativeFile}`)
  }
  return resolved
}

export function validateMetricCatalog(metrics: MetricDefinition[]) {
  if (!Array.isArray(metrics) || metrics.length === 0) throw new Error('metricCatalog must not be empty.')
  const ids = new Set<string>()
  for (const metric of metrics) {
    if (!metric.id || ids.has(metric.id)) throw new Error(`Duplicate metric id: ${metric.id}`)
    if (!['binary', 'rate', 'mean', 'score10', 'count'].includes(metric.scale)) {
      throw new Error(`Unsupported metric scale for ${metric.id}: ${metric.scale}`)
    }
    if (!metric.label || !metric.description) throw new Error(`Metric ${metric.id} needs label and description.`)
    ids.add(metric.id)
  }
  return ids
}

export function validateAgentSuite(
  suite: AgentEvaluationSuite,
  label: string,
  knownMetrics: Set<string>,
  globalCaseIds: Set<string>,
) {
  if (!suite?.version || !Array.isArray(suite.cases) || suite.cases.length === 0) {
    throw new Error(`${label}: agent suite needs version and cases.`)
  }
  for (const item of suite.cases) {
    if (!item.id || globalCaseIds.has(item.id)) throw new Error(`${label}: duplicate case id ${item.id}.`)
    if (!item.category || !Array.isArray(item.turns) || item.turns.length === 0) {
      throw new Error(`${label}: case ${item.id} needs category and turns.`)
    }
    if (!Array.isArray(item.metricIds) || item.metricIds.length === 0) {
      throw new Error(`${label}: case ${item.id} metricIds must not be empty.`)
    }
    for (const metricId of item.metricIds) {
      if (!knownMetrics.has(metricId)) throw new Error(`${label}: unknown metric ${metricId}.`)
    }
    item.turns.forEach((turn, index) => {
      if (!turn.prompt || !turn.expected || !Array.isArray(turn.expected.tools)
        || !['create', 'discussion', 'revise', 'execute'].includes(turn.expected.kind)) {
        throw new Error(`${label}: invalid turn ${index + 1} in ${item.id}.`)
      }
      validateAllowedMutationRules(
        (turn.expected.timeline as { allowedMutations?: unknown } | undefined)?.allowedMutations,
        `${label}: ${item.id} turn ${index + 1}`,
      )
    })
    globalCaseIds.add(item.id)
  }
}

export function validateRetrievalSuite(
  suite: RetrievalEvaluationSuite,
  label: string,
  globalQueryIds: Set<string>,
) {
  if (!suite?.version || !suite.construction?.sourceType || !suite.construction.method
    || !suite.construction.annotationGuide || !suite.construction.coverage?.length
    || !Array.isArray(suite.memories) || !Array.isArray(suite.queries)) {
    throw new Error(`${label}: invalid retrieval suite.`)
  }
  const memoryKeys = new Set<string>()
  for (const memory of suite.memories) {
    if (!memory.key || memoryKeys.has(memory.key) || !memory.statement) {
      throw new Error(`${label}: duplicate or invalid memory key ${memory.key}.`)
    }
    memoryKeys.add(memory.key)
  }
  for (const query of suite.queries) {
    if (!query.id || globalQueryIds.has(query.id) || !query.query || !query.rationale) {
      throw new Error(`${label}: duplicate or invalid query id ${query.id}.`)
    }
    globalQueryIds.add(query.id)
  }
}
