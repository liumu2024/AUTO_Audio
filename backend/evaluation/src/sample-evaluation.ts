import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

import type { V2SampleUnderstandingResult } from '../../../shared/types/v2-sample-understanding.js'
import { analyzeV2Sample } from '../../src/pipeline-v2/sample-understanding-service.js'
import type { SampleEvaluationCatalog } from './schema.js'

interface SampleThresholds {
  minMethodObservations: number
  minTransferableKnowledge: number
  expectedContentFacts?: Array<{
    id: string
    aliases: string[]
    evidenceRanges?: Array<{ startSec: number; endSec: number }>
  }>
  expectedMethodFacts?: Array<{
    id: string
    aliases: string[]
    evidenceRanges?: Array<{ startSec: number; endSec: number }>
  }>
  forbiddenClaims?: string[]
  minExpectedContentFacts?: number
  minExpectedMethodFacts?: number
}

function normalized(value: string) {
  return value.toLocaleLowerCase().replace(/\s+/g, '')
}

function overlaps(
  actual: Array<{ start_sec: number; end_sec: number }>,
  expected: Array<{ startSec: number; endSec: number }> | undefined,
) {
  if (!expected?.length) return true
  return actual.some((actualRange) => expected.some((expectedRange) => {
    const actualDuration = actualRange.end_sec - actualRange.start_sec
    const expectedDuration = expectedRange.endSec - expectedRange.startSec
    const intersection = Math.max(0, Math.min(actualRange.end_sec, expectedRange.endSec)
      - Math.max(actualRange.start_sec, expectedRange.startSec))
    return intersection / actualDuration >= 0.5 && actualDuration <= expectedDuration * 1.5
  }))
}

function observationFactHits(
  observations: Array<{ text: string; evidenceRanges: Array<{ start_sec: number; end_sec: number }> }>,
  facts: Array<{ aliases: string[]; evidenceRanges?: Array<{ startSec: number; endSec: number }> }>,
) {
  return facts.filter((fact) => observations.some((observation) => (
    fact.aliases.some((alias) => normalized(observation.text).includes(normalized(alias)))
    && overlaps(observation.evidenceRanges, fact.evidenceRanges)
  ))).length
}

export function evaluateSampleUnderstandingEvidence(
  understanding: V2SampleUnderstandingResult,
  thresholds: SampleThresholds,
) {
  const duration = understanding.sample.duration_sec
  const validRange = (range: { start_sec: number; end_sec: number }) => (
    Number.isFinite(range.start_sec)
    && Number.isFinite(range.end_sec)
    && range.start_sec >= 0
    && range.end_sec > range.start_sec
    && range.end_sec <= duration + 0.05
  )
  const semantic = understanding.source === 'llm'
    && Boolean(understanding.summary.trim())
    && understanding.content_observations.length > 0
    && understanding.content_observations.every((item) => (
      Boolean(item.statement.trim()) && item.evidence_ranges.length > 0 && item.evidence_ranges.every(validRange)
    ))
  const validMethods = understanding.method_observations.filter((item) => (
    Boolean(item.id && item.expression.trim() && item.purpose.trim() && item.timing_rationale.trim())
    && item.evidence_ranges.length > 0
    && item.evidence_ranges.every(validRange)
  ))
  const methodIds = new Set(validMethods.map((item) => item.id))
  const validKnowledge = understanding.transferable_knowledge.filter((item) => (
    Boolean(item.statement.trim() && item.applicability.trim())
    && item.evidence_method_ids.length > 0
    && item.evidence_method_ids.every((id) => methodIds.has(id))
  ))
  const contentText = [understanding.summary, ...understanding.content_observations.map((item) => item.statement)].join('\n')
  const methodText = validMethods.map((item) => `${item.expression}\n${item.purpose}\n${item.timing_rationale}`).join('\n')
  const allClaims = [contentText, methodText, ...validKnowledge.map((item) => `${item.statement}\n${item.applicability}`)].join('\n')
  const contentFactsPassed = observationFactHits(
    understanding.content_observations.map((item) => ({ text: item.statement, evidenceRanges: item.evidence_ranges })),
    thresholds.expectedContentFacts ?? [],
  )
    >= (thresholds.minExpectedContentFacts ?? 0)
  const methodFactsPassed = observationFactHits(
    validMethods.map((item) => ({
      text: `${item.expression}\n${item.purpose}\n${item.timing_rationale}`,
      evidenceRanges: item.evidence_ranges,
    })),
    thresholds.expectedMethodFacts ?? [],
  )
    >= (thresholds.minExpectedMethodFacts ?? 0)
  const forbiddenAvoided = !(thresholds.forbiddenClaims ?? []).some((claim) => normalized(allClaims).includes(normalized(claim)))
  const semanticPassed = semantic && contentFactsPassed && forbiddenAvoided
  return {
    semantic: semanticPassed,
    methodEvidence: semanticPassed && methodFactsPassed && validMethods.length >= thresholds.minMethodObservations,
    transferableKnowledge: semanticPassed && validKnowledge.length >= thresholds.minTransferableKnowledge,
  }
}

export async function evaluateSampleUnderstanding(input: {
  catalog: SampleEvaluationCatalog
  repositoryRoot: string
  outputFile: string
}) {
  const assets = new Map(input.catalog.assets.map((asset) => [asset.id, asset]))
  const results = []
  for (const task of input.catalog.tasks) {
    const asset = assets.get(task.assetId)
    if (!asset) throw new Error(`Sample evaluation asset not found: ${task.assetId}`)
    const sampleVideoPath = path.resolve(input.repositoryRoot, asset.repositoryPath)
    const analyzed = await analyzeV2Sample({
      taskId: `evaluation_${task.id}`,
      prompt: task.prompt,
      sampleVideoPath,
      sampleVideoName: path.basename(asset.repositoryPath),
    })
    results.push({
      taskId: task.id,
      assetId: task.assetId,
      source: analyzed.understanding.source,
      traceDir: analyzed.traceDir,
      ...evaluateSampleUnderstandingEvidence(analyzed.understanding, task),
      methodCount: analyzed.understanding.method_observations.length,
      knowledgeCount: analyzed.understanding.transferable_knowledge.length,
    })
  }
  const report = {
    version: input.catalog.version,
    tasks: results.length,
    semanticAnalysisPassed: results.filter((item) => item.semantic).length,
    methodEvidencePassed: results.filter((item) => item.methodEvidence).length,
    transferableKnowledgePassed: results.filter((item) => item.transferableKnowledge).length,
    results,
  }
  await mkdir(path.dirname(input.outputFile), { recursive: true })
  await writeFile(input.outputFile, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  return report
}
