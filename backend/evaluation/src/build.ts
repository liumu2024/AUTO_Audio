import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  canonicalJson,
  readJsonFile,
  resolveSourceFile,
  sha256,
  validateAgentSuite,
  validateMetricCatalog,
  validateRetrievalSuite,
  type AgentEvaluationSuite,
  type EvaluationFailureLedger,
  type EvaluationDatasetManifest,
  type EvaluationReviewRuleRegistry,
  type FrozenEvaluationDataset,
  type ManualRubric,
  type MediaEvaluationCatalog,
  type RetrievalEvaluationSuite,
  type SampleEvaluationCatalog,
} from './schema.js'

const MAX_CANARY_RENDER_RUNS = 7
const MAX_CANARY_PROVIDER_SUBMISSIONS = 28
const MAX_CANARY_GENERATED_SECONDS = 84

export async function buildFrozenDataset(input: {
  sourceDir: string
  outputFile: string
  manifestFile?: string
}): Promise<FrozenEvaluationDataset> {
  const sourceDir = path.resolve(input.sourceDir)
  const manifestPath = resolveSourceFile(sourceDir, input.manifestFile ?? 'manifest.v1.json')
  const manifestSource = await readJsonFile<EvaluationDatasetManifest>(manifestPath)
  const manifest = manifestSource.value
  if (manifest.schemaVersion !== 'v2_evaluation_manifest.v1' || !manifest.datasetVersion) {
    throw new Error(`${manifestPath}: unsupported manifest schema or missing dataset version.`)
  }
  const knownMetrics = validateMetricCatalog(manifest.metricCatalog)
  for (const requiredProfile of ['live', 'stability', 'canary'] as const) {
    if (!Array.isArray(manifest.qualityGates?.[requiredProfile]) || manifest.qualityGates[requiredProfile].length === 0) {
      throw new Error(`Missing quality gates for profile ${requiredProfile}.`)
    }
  }
  for (const [profile, gates] of Object.entries(manifest.qualityGates)) {
    if (!['live', 'stability', 'canary'].includes(profile) || !Array.isArray(gates) || gates.length === 0) {
      throw new Error(`Invalid quality gates for profile ${profile}.`)
    }
    const seen = new Set<string>()
    for (const gate of gates) {
      const metric = manifest.metricCatalog.find((item) => item.id === gate.metricId)
      if (seen.has(gate.metricId) || !metric || metric.scale !== 'rate' || !Number.isFinite(gate.minimum) || gate.minimum < 0 || gate.minimum > 1) {
        throw new Error(`Invalid quality gate ${profile}/${gate.metricId}.`)
      }
      seen.add(gate.metricId)
    }
  }
  const metricEvidence = new Set<string>()
  const sourceHashes: Record<string, string> = {
    [path.relative(sourceDir, manifestPath).replaceAll('\\', '/')]: sha256(manifestSource.raw),
  }
  const globalCaseIds = new Set<string>()
  const agentSuites: FrozenEvaluationDataset['agentSuites'] = []
  const suiteIds = new Set<string>()
  for (const definition of manifest.agentSuites) {
    if (!definition.id || suiteIds.has(definition.id)) throw new Error(`Duplicate agent suite id: ${definition.id}`)
    const file = resolveSourceFile(sourceDir, definition.file)
    const source = await readJsonFile<AgentEvaluationSuite>(file)
    validateAgentSuite(source.value, definition.id, knownMetrics, globalCaseIds)
    source.value.cases.forEach((testCase) => testCase.metricIds.forEach((metricId) => metricEvidence.add(metricId)))
    sourceHashes[definition.file.replaceAll('\\', '/')] = sha256(source.raw)
    suiteIds.add(definition.id)
    agentSuites.push({ definition, suite: source.value })
  }

  const retrievalSuites: FrozenEvaluationDataset['retrievalSuites'] = []
  const globalQueryIds = new Set<string>()
  const retrievalIds = new Set<string>()
  for (const definition of manifest.retrievalSuites) {
    if (!definition.id || retrievalIds.has(definition.id)) throw new Error(`Duplicate retrieval suite id: ${definition.id}`)
    const file = resolveSourceFile(sourceDir, definition.file)
    const source = await readJsonFile<RetrievalEvaluationSuite>(file)
    validateRetrievalSuite(source.value, definition.id, globalQueryIds)
    sourceHashes[definition.file.replaceAll('\\', '/')] = sha256(source.raw)
    retrievalIds.add(definition.id)
    retrievalSuites.push({ definition, suite: source.value })
  }

  let mediaCatalog: MediaEvaluationCatalog | undefined
  if (manifest.mediaCatalogFile) {
    const mediaFile = resolveSourceFile(sourceDir, manifest.mediaCatalogFile)
    const mediaSource = await readJsonFile<MediaEvaluationCatalog>(mediaFile)
    mediaCatalog = mediaSource.value
    if (!mediaCatalog.version || !Array.isArray(mediaCatalog.assets) || !Array.isArray(mediaCatalog.tasks)) {
      throw new Error('Invalid media evaluation catalog.')
    }
    const assetIds = new Set<string>()
    const repositoryRoot = path.resolve(sourceDir, '..', '..', '..', '..')
    for (const asset of mediaCatalog.assets) {
      if (!asset.id || assetIds.has(asset.id) || asset.type !== 'image' || !asset.repositoryPath) {
        throw new Error(`Invalid or duplicate media asset: ${asset.id}`)
      }
      const assetFile = path.resolve(repositoryRoot, asset.repositoryPath)
      if (assetFile !== repositoryRoot && !assetFile.startsWith(`${repositoryRoot}${path.sep}`)) {
        throw new Error(`Media asset escapes repository: ${asset.repositoryPath}`)
      }
      const assetSource = await readFile(assetFile)
      const contentHash = sha256(assetSource)
      if (asset.contentHash && asset.contentHash !== contentHash) {
        throw new Error(`Media asset hash mismatch: ${asset.id}`)
      }
      asset.contentHash = contentHash
      sourceHashes[`media:${asset.repositoryPath.replaceAll('\\', '/')}`] = contentHash
      assetIds.add(asset.id)
    }
    const taskIds = new Set<string>()
    for (const task of mediaCatalog.tasks) {
      if (!task.id || taskIds.has(task.id) || !assetIds.has(task.assetId) || !task.prompt || !task.expectedObservedFacts.length
        || task.expectedObservedFacts.some((fact) => !fact.id || !fact.aliases.length
          || fact.aliases.some((alias) => [...alias.normalize('NFKC').replace(/\s+/g, '')].length < 2))) {
        throw new Error(`Invalid media task: ${task.id}`)
      }
      if (task.blindObservation) {
        const prompt = task.prompt.toLocaleLowerCase().replace(/\s+/g, '')
        const leakedAlias = task.expectedObservedFacts
          .flatMap((fact) => fact.aliases)
          .find((alias) => prompt.includes(alias.toLocaleLowerCase().replace(/\s+/g, '')))
        if (leakedAlias) throw new Error(`Blind media task ${task.id} leaks expected fact alias: ${leakedAlias}`)
        const interferenceHint = task.interference && [
          '水印', '来源标记', '来源文字', '干扰文字', '棋盘格', '背景网格', '透明背景',
        ].find((hint) => prompt.includes(hint))
        if (interferenceHint) throw new Error(`Blind media task ${task.id} leaks interference hint: ${interferenceHint}`)
      }
      taskIds.add(task.id)
    }
    sourceHashes[manifest.mediaCatalogFile.replaceAll('\\', '/')] = sha256(mediaSource.raw)
    if (mediaCatalog.tasks.length > 0) {
      ;['image_observation_fact_rate', 'image_pixel_delivery_rate', 'image_hallucination_avoidance_rate',
        'image_reference_binding_rate', 'conditioned_generation_plan_rate',
        'image_interference_robustness_rate'].forEach((metricId) => metricEvidence.add(metricId))
    }
  }

  let sampleCatalog: SampleEvaluationCatalog | undefined
  if (manifest.sampleCatalogFile) {
    const sampleFile = resolveSourceFile(sourceDir, manifest.sampleCatalogFile)
    const sampleSource = await readJsonFile<SampleEvaluationCatalog>(sampleFile)
    sampleCatalog = sampleSource.value
    if (!sampleCatalog.version || !Array.isArray(sampleCatalog.assets) || !Array.isArray(sampleCatalog.tasks)) {
      throw new Error('Invalid sample evaluation catalog.')
    }
    const assetIds = new Set<string>()
    const repositoryRoot = path.resolve(sourceDir, '..', '..', '..', '..')
    for (const asset of sampleCatalog.assets) {
      if (!asset.id || assetIds.has(asset.id) || asset.type !== 'video' || !asset.repositoryPath) {
        throw new Error(`Invalid or duplicate sample asset: ${asset.id}`)
      }
      const assetFile = path.resolve(repositoryRoot, asset.repositoryPath)
      if (assetFile !== repositoryRoot && !assetFile.startsWith(`${repositoryRoot}${path.sep}`)) {
        throw new Error(`Sample asset escapes repository: ${asset.repositoryPath}`)
      }
      const contentHash = sha256(await readFile(assetFile))
      if (asset.contentHash && asset.contentHash !== contentHash) throw new Error(`Sample asset hash mismatch: ${asset.id}`)
      asset.contentHash = contentHash
      sourceHashes[`sample:${asset.repositoryPath.replaceAll('\\', '/')}`] = contentHash
      assetIds.add(asset.id)
    }
    const taskIds = new Set<string>()
    for (const task of sampleCatalog.tasks) {
      if (!task.id || taskIds.has(task.id) || !assetIds.has(task.assetId) || !task.prompt
        || !Number.isInteger(task.minMethodObservations) || task.minMethodObservations < 1
        || !Number.isInteger(task.minTransferableKnowledge) || task.minTransferableKnowledge < 1
        || !Array.isArray(task.expectedContentFacts) || task.expectedContentFacts.length === 0
        || !Array.isArray(task.expectedMethodFacts) || task.expectedMethodFacts.length === 0
        || task.expectedContentFacts.some((fact) => !fact.id || !fact.aliases.length || !fact.evidenceRanges.length
          || fact.evidenceRanges.some((range) => range.startSec < 0 || range.endSec <= range.startSec))
        || task.expectedMethodFacts.some((fact) => !fact.id || !fact.aliases.length || !fact.evidenceRanges.length
          || fact.evidenceRanges.some((range) => range.startSec < 0 || range.endSec <= range.startSec))
        || !Number.isInteger(task.minExpectedContentFacts) || task.minExpectedContentFacts < 1
        || task.minExpectedContentFacts > task.expectedContentFacts.length
        || !Number.isInteger(task.minExpectedMethodFacts) || task.minExpectedMethodFacts < 1
        || task.minExpectedMethodFacts > task.expectedMethodFacts.length) {
        throw new Error(`Invalid sample task: ${task.id}`)
      }
      const normalizedPrompt = task.prompt.toLocaleLowerCase().replace(/\s+/g, '')
      const leakedAliases = [...task.expectedContentFacts, ...task.expectedMethodFacts]
        .flatMap((fact) => fact.aliases)
        .filter((alias) => normalizedPrompt.includes(alias.toLocaleLowerCase().replace(/\s+/g, '')))
      if (leakedAliases.length > 0) throw new Error(`Sample task prompt leaks expected facts: ${task.id}`)
      taskIds.add(task.id)
    }
    sourceHashes[manifest.sampleCatalogFile.replaceAll('\\', '/')] = sha256(sampleSource.raw)
    if (sampleCatalog.tasks.length > 0) {
      ;['sample_semantic_analysis_rate', 'sample_method_evidence_rate', 'sample_transferable_knowledge_rate']
        .forEach((metricId) => metricEvidence.add(metricId))
    }
  }

  const deterministicIds = new Set(manifest.deterministicChecks.map((check) => check.id))
  if (deterministicIds.size !== manifest.deterministicChecks.length) {
    throw new Error('Deterministic check ids must be unique.')
  }
  const allowedLedgerProfiles = new Set(['profile:live', 'profile:stability', 'profile:canary', 'profile:memory_retrieval'])

  const failureLedgerFile = resolveSourceFile(sourceDir, manifest.failureLedgerFile)
  const failureLedgerSource = await readJsonFile<EvaluationFailureLedger>(failureLedgerFile)
  const failureLedger = failureLedgerSource.value
  if (!failureLedger.version || !Array.isArray(failureLedger.entries)) {
    throw new Error('Invalid evaluation failure ledger.')
  }
  const ledgerRootCauses = new Set<string>()
  for (const entry of failureLedger.entries) {
    if (!/^[a-z0-9_]+$/.test(entry.rootCause)
      || !['needs_live_rerun', 'needs_real_media', 'deferred', 'resolved'].includes(entry.status)
      || (!deterministicIds.has(entry.verification) && !allowedLedgerProfiles.has(entry.verification))) {
      throw new Error(`Invalid evaluation failure ledger entry: ${entry.rootCause || '<missing>'}.`)
    }
    if (!Array.isArray(entry.references) || entry.references.length === 0 || entry.references.some((reference) => {
      const [kind, id, ...extra] = reference.split(':')
      if (!id || extra.length > 0) return true
      if (kind === 'case') return !globalCaseIds.has(id)
      if (kind === 'query') return !globalQueryIds.has(id)
      if (kind === 'check') return !deterministicIds.has(id)
      return true
    })) {
      throw new Error(`Failure ledger entry has stale or missing references: ${entry.rootCause}.`)
    }
    if (ledgerRootCauses.has(entry.rootCause)) throw new Error(`Duplicate failure ledger root cause: ${entry.rootCause}`)
    ledgerRootCauses.add(entry.rootCause)
  }
  sourceHashes[manifest.failureLedgerFile.replaceAll('\\', '/')] = sha256(failureLedgerSource.raw)

  const reviewRuleFile = resolveSourceFile(sourceDir, manifest.reviewRuleRegistryFile)
  const reviewRuleSource = await readJsonFile<EvaluationReviewRuleRegistry>(reviewRuleFile)
  const reviewRuleRegistry = reviewRuleSource.value
  if (!reviewRuleRegistry.version || !Array.isArray(reviewRuleRegistry.rules)) {
    throw new Error('Invalid evaluation review rule registry.')
  }
  const reviewRuleNames = new Set<string>()
  for (const rule of reviewRuleRegistry.rules) {
    if (!rule.name || !rule.reverseCase || !deterministicIds.has(rule.verification)
      || !['invariant', 'protocol', 'semantic'].includes(rule.layer)) {
      throw new Error(`Invalid evaluation review rule: ${rule.name || '<missing>'}.`)
    }
    if (reviewRuleNames.has(rule.name)) throw new Error(`Duplicate evaluation review rule: ${rule.name}`)
    reviewRuleNames.add(rule.name)
  }
  sourceHashes[manifest.reviewRuleRegistryFile.replaceAll('\\', '/')] = sha256(reviewRuleSource.raw)

  for (const check of manifest.deterministicChecks) {
    if (!check.id || !check.label || !Array.isArray(check.command) || check.command.length === 0
      || !Array.isArray(check.metricIds) || check.metricIds.length === 0) {
      throw new Error('Every deterministic check needs id, label and command.')
    }
    for (const metricId of check.metricIds) {
      if (!knownMetrics.has(metricId)) throw new Error(`Deterministic check ${check.id} uses unknown metric ${metricId}.`)
      metricEvidence.add(metricId)
    }
  }
  if (agentSuites.length > 0) metricEvidence.add('hard_blocker_count')
  if (retrievalSuites.length > 0) {
    ;['active_memory_recall_at8', 'active_memory_ndcg_at8', 'candidate_memory_precision_at3',
      'cross_scope_retrieval_count', 'unrelated_retrieval_count'].forEach((metricId) => metricEvidence.add(metricId))
  }

  const rubricFile = resolveSourceFile(sourceDir, manifest.manualRubricFile)
  const rubricSource = await readJsonFile<ManualRubric>(rubricFile)
  const manualRubric = rubricSource.value
  if (!manualRubric.version || !Array.isArray(manualRubric.dimensions)) throw new Error('Invalid manual rubric.')
  const rubricIds = new Set<string>()
  for (const dimension of manualRubric.dimensions) {
    if (!dimension.id || rubricIds.has(dimension.id) || dimension.min !== 0 || dimension.max !== 10) {
      throw new Error(`Invalid manual rubric dimension: ${dimension.id}`)
    }
    if (!dimension.anchors || Object.keys(dimension.anchors).sort().join(',') !== '0,10,2,5,8') {
      throw new Error(`Manual rubric anchors must define 0/2/5/8/10: ${dimension.id}`)
    }
    const metric = manifest.metricCatalog.find((candidate) => candidate.id === dimension.id)
    if (!metric || metric.scale !== 'score10') throw new Error(`Manual rubric dimension is not a score10 metric: ${dimension.id}`)
    rubricIds.add(dimension.id)
  }
  sourceHashes[manifest.manualRubricFile.replaceAll('\\', '/')] = sha256(rubricSource.raw)

  if (!Number.isInteger(manifest.canary.maxRenderRuns)
    || manifest.canary.maxRenderRuns < 0
    || manifest.canary.maxRenderRuns > MAX_CANARY_RENDER_RUNS) {
    throw new Error('Canary render run budget must be an integer between 0 and 7.')
  }
  if (!Number.isInteger(manifest.canary.maxProviderSubmissions)
    || manifest.canary.maxProviderSubmissions < 0
    || manifest.canary.maxProviderSubmissions > MAX_CANARY_PROVIDER_SUBMISSIONS) {
    throw new Error('Canary Provider submission budget must be a non-negative integer.')
  }
  if (!Number.isFinite(manifest.canary.maxGeneratedSeconds)
    || manifest.canary.maxGeneratedSeconds < 0
    || manifest.canary.maxGeneratedSeconds > MAX_CANARY_GENERATED_SECONDS) {
    throw new Error(`Canary generated-seconds budget must be between 0 and ${MAX_CANARY_GENERATED_SECONDS}.`)
  }
  let canaryRenderRuns = 0
  for (const item of manifest.canary.cases) {
    const suite = agentSuites.find((candidate) => candidate.definition.id === item.suiteId)
    if (!suite || !suite.suite.cases.some((candidate) => candidate.id === item.caseId)) {
      throw new Error(`Canary case does not exist: ${item.suiteId}/${item.caseId}`)
    }
    if (!Number.isInteger(item.expectedRenderCount) || item.expectedRenderCount < 1) {
      throw new Error(`Canary case ${item.caseId} needs a positive render count.`)
    }
    canaryRenderRuns += item.expectedRenderCount
  }

  const metricsWithoutEvidence = manifest.metricCatalog
    .filter((metric) => !metricEvidence.has(metric.id))
    .map((metric) => metric.id)
  if (metricsWithoutEvidence.length > 0) {
    throw new Error(`Metrics have no declared evidence source: ${metricsWithoutEvidence.join(', ')}`)
  }
  if (canaryRenderRuns > manifest.canary.maxRenderRuns) {
    throw new Error(`Canary render run budget ${canaryRenderRuns} exceeds cap ${manifest.canary.maxRenderRuns}.`)
  }
  const canaryKeys = new Set<string>()
  for (const item of manifest.canary.cases) {
    const key = `${item.suiteId}/${item.caseId}`
    if (canaryKeys.has(key)) throw new Error(`Duplicate canary case: ${key}`)
    canaryKeys.add(key)
    const suite = agentSuites.find((candidate) => candidate.definition.id === item.suiteId)!
    if (!suite.definition.profiles.includes('canary')) throw new Error(`Canary suite is not enabled for canary profile: ${item.suiteId}`)
    const testCase = suite.suite.cases.find((candidate) => candidate.id === item.caseId)!
    const renderTurns = testCase.turns.filter((turn) => turn.expected.tools.includes('timeline.render')).length
    if (renderTurns !== item.expectedRenderCount) {
      throw new Error(`Canary render count mismatch for ${key}: manifest=${item.expectedRenderCount}, suite=${renderTurns}.`)
    }
  }

  const stableContent = {
    schemaVersion: 'v2_evaluation_frozen.v1' as const,
    datasetVersion: manifest.datasetVersion,
    sourceHashes,
    manifest,
    agentSuites,
    retrievalSuites,
    ...(mediaCatalog ? { mediaCatalog } : {}),
    ...(sampleCatalog ? { sampleCatalog } : {}),
    failureLedger,
    reviewRuleRegistry,
    manualRubric,
    summary: {
      agentSuites: agentSuites.length,
      agentCases: agentSuites.reduce((sum, item) => sum + item.suite.cases.length, 0),
      agentTurns: agentSuites.reduce(
        (sum, item) => sum + item.suite.cases.reduce((caseSum, testCase) => caseSum + testCase.turns.length, 0),
        0,
      ),
      retrievalSuites: retrievalSuites.length,
      retrievalQueries: retrievalSuites.reduce((sum, item) => sum + item.suite.queries.length, 0),
      mediaTasks: mediaCatalog?.tasks.length ?? 0,
      sampleTasks: sampleCatalog?.tasks.length ?? 0,
      deterministicChecks: manifest.deterministicChecks.length,
      canaryRenderRuns,
      maxProviderSubmissions: manifest.canary.maxProviderSubmissions,
      maxGeneratedSeconds: manifest.canary.maxGeneratedSeconds,
    },
  }
  const datasetHash = sha256(canonicalJson(stableContent))
  const frozen: FrozenEvaluationDataset = {
    ...stableContent,
    builtAt: new Date().toISOString(),
    datasetHash,
  }
  await mkdir(path.dirname(input.outputFile), { recursive: true })
  await writeFile(input.outputFile, `${JSON.stringify(frozen, null, 2)}\n`, 'utf8')
  await writeFile(`${input.outputFile}.sha256`, `${datasetHash}  ${path.basename(input.outputFile)}\n`, 'utf8')
  return frozen
}

function argument(name: string) {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : undefined
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  const sourceDir = path.resolve(argument('--source') ?? 'evaluation/datasets/source')
  const outputFile = path.resolve(argument('--output') ?? 'evaluation/datasets/frozen/current.v1.json')
  const result = await buildFrozenDataset({ sourceDir, outputFile })
  console.log(JSON.stringify({ outputFile, datasetHash: result.datasetHash, summary: result.summary }, null, 2))
}
