import { randomUUID } from 'node:crypto'
import { copyFile, mkdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { runV2TimelineLlmPlanner } from '../../src/pipeline-v2/remotion-timeline-llm-planner.js'
import type { MediaEvaluationCatalog } from './schema.js'

export function matchesMediaFact(value: string, expected: string) {
  const normalizedValue = value.normalize('NFKC').toLocaleLowerCase().replace(/\s+/g, '')
  const normalizedExpected = expected.normalize('NFKC').toLocaleLowerCase().replace(/\s+/g, '')
  if ([...normalizedExpected].length < 2) return false
  return normalizedValue.includes(normalizedExpected)
}

export function plannerReceivedImagePixels(
  report: { attached_image_input_count?: number; attached_material_ids?: string[] } | undefined,
  assetId: string,
) {
  return report?.attached_image_input_count === 1
    && report.attached_material_ids?.includes(assetId) === true
}

export async function evaluateMediaPlanning(input: {
  catalog: MediaEvaluationCatalog
  repositoryRoot: string
  backendRoot: string
  outputFile?: string
}) {
  const uploadDir = path.join(input.backendRoot, 'uploads')
  await mkdir(uploadDir, { recursive: true })
  const results = []
  for (const task of input.catalog.tasks) {
    const asset = input.catalog.assets.find((candidate) => candidate.id === task.assetId)
    if (!asset) throw new Error(`Missing media asset ${task.assetId}.`)
    const sourceFile = path.resolve(input.repositoryRoot, asset.repositoryPath)
    const extension = path.extname(sourceFile) || '.png'
    const filename = `evaluation-${randomUUID()}${extension}`
    const stagedFile = path.join(uploadDir, filename)
    await copyFile(sourceFile, stagedFile)
    try {
      const planner = await runV2TimelineLlmPlanner({
        taskId: `media_eval_${task.id}_${randomUUID().slice(0, 8)}`,
        prompt: task.prompt,
        creationMode: 'material_brief',
        materials: [{ id: asset.id, name: path.basename(sourceFile), type: 'image', src: `/uploads/${filename}` }],
        durationSec: 12,
        plannerMode: 'llm',
        allowPlannerFallback: false,
        canvas: { width: 1920, height: 1080, fps: 30 },
      })
      const imageReference = planner.spec.creative_brief?.image_references.find((item) => item.asset_id === asset.id)
      const observed = imageReference?.observed_facts.join('；') ?? ''
      const pixelInputAttached = plannerReceivedImagePixels(planner.visualInputReport, asset.id)
      const factChecks = task.expectedObservedFacts.map((fact) => ({
        id: fact.id,
        passed: pixelInputAttached && fact.aliases.some((alias) => matchesMediaFact(observed, alias)),
        interferenceArtifact: Boolean(fact.interferenceArtifact),
      }))
      const forbiddenChecks = (task.forbiddenObservedFacts ?? []).map((fact) => ({
        fact,
        passed: !matchesMediaFact(observed, fact),
      }))
      const jobs = planner.spec.material_jobs.filter((job) => job.input_asset_id === asset.id)
      const conditionedGeneration = jobs.some((job) => job.type === 'generate_video')
      results.push({
        id: task.id,
        assetId: asset.id,
        factChecks,
        forbiddenChecks,
        pixelInputAttached,
        authoritativeReferenceBound: Boolean(imageReference),
        conditionedGenerationMatched: task.requireConditionedGeneration ? conditionedGeneration : true,
        intendedUse: imageReference?.intended_use,
        sceneCount: planner.spec.scenes.length,
        visualInputReport: planner.visualInputReport,
        jsonRepair: Boolean(planner.jsonRepair),
        interference: task.interference,
      })
    } finally {
      await rm(stagedFile, { force: true })
    }
  }
  const report = {
    version: input.catalog.version,
    tasks: results.length,
    pixelInputsPassed: results.filter((item) => item.pixelInputAttached).length,
    factChecks: results.reduce((sum, item) => sum + item.factChecks.length, 0),
    factChecksPassed: results.reduce((sum, item) => sum + item.factChecks.filter((check) => check.passed).length, 0),
    forbiddenChecks: results.reduce((sum, item) => sum + item.forbiddenChecks.length, 0),
    forbiddenChecksPassed: results.reduce((sum, item) => sum + item.forbiddenChecks.filter((check) => check.passed).length, 0),
    referenceBindingsPassed: results.filter((item) => item.authoritativeReferenceBound).length,
    conditionedGenerationPassed: results.filter((item) => item.conditionedGenerationMatched).length,
    interferenceTasks: results.filter((item) => item.interference).length,
    interferenceTasksPassed: results.filter((item) => item.interference).filter((item) => {
      const contentFacts = item.factChecks.filter((check) => !check.interferenceArtifact)
      return contentFacts.length > 0 && contentFacts.every((check) => check.passed)
    }).length,
    results,
  }
  if (input.outputFile) await writeFile(input.outputFile, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  return report
}
