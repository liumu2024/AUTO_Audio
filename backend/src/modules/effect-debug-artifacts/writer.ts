import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

import type { EffectDebugArtifactFileName } from '../../../../shared/types/effect-debug-artifacts.v1.js'
import { EFFECT_DEBUG_ARTIFACT_FILES } from '../../../../shared/types/effect-debug-artifacts.v1.js'
import type { EffectDebugArtifactBundle } from './build-artifacts.js'
import { effectDebugTaskDir } from './paths.js'
import { artifactRefForPath, recordAgentTraceEvent } from '../agent-trace/writer.js'

export interface EffectDebugArtifactWriterOptions {
  taskId: string
  debugDir?: string
}

export interface WriteEffectDebugArtifactsResult {
  debugDir: string
  files: EffectDebugArtifactFileName[]
}

async function writeJson(filePath: string, payload: unknown): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
}

async function writeText(filePath: string, content: string): Promise<void> {
  await writeFile(filePath, content.endsWith('\n') ? content : `${content}\n`, 'utf8')
}

export class EffectDebugArtifactWriter {
  readonly debugDir: string

  constructor(options: EffectDebugArtifactWriterOptions) {
    this.debugDir = options.debugDir ?? effectDebugTaskDir(options.taskId)
  }

  async writeBundle(bundle: EffectDebugArtifactBundle): Promise<WriteEffectDebugArtifactsResult> {
    await mkdir(this.debugDir, { recursive: true })

    const files: EffectDebugArtifactFileName[] = [...EFFECT_DEBUG_ARTIFACT_FILES]

    await writeJson(path.join(this.debugDir, 'director-grounding.json'), bundle.directorGrounding)
    await writeJson(path.join(this.debugDir, 'effect-roadmap.json'), bundle.effectRoadmap)
    await writeJson(
      path.join(this.debugDir, 'effect-roadmap-projection.json'),
      bundle.effectRoadmapProjection,
    )
    await writeText(
      path.join(this.debugDir, 'roadmap-agent-raw-response.txt'),
      bundle.roadmapAgentRawResponse,
    )
    await writeText(
      path.join(this.debugDir, 'roadmap-agent-repair-raw-response.txt'),
      bundle.roadmapAgentRepairRawResponse,
    )
    await writeJson(path.join(this.debugDir, 'atom-plan.json'), bundle.atomPlan)
    await writeJson(path.join(this.debugDir, 'missing-atoms.todo.json'), bundle.missingAtomsTodo)
    await writeJson(
      path.join(this.debugDir, 'seed-plugin-authoring-request.json'),
      bundle.seedPluginAuthoringRequest,
    )
    await writeText(
      path.join(this.debugDir, 'seed-plugin-authoring-raw-response.txt'),
      bundle.seedPluginAuthoringRawResponse,
    )
    await writeJson(
      path.join(this.debugDir, 'seed-generated-plugins.json'),
      bundle.seedGeneratedPlugins,
    )
    await writeJson(path.join(this.debugDir, 'mapping-decisions.json'), bundle.mappingDecisions)
    await writeJson(
      path.join(this.debugDir, 'mapping-decisions.seed.json'),
      bundle.mappingDecisionsSeed,
    )
    await writeJson(
      path.join(this.debugDir, 'compiled-effect-layers.json'),
      bundle.compiledEffectLayers,
    )
    await writeJson(path.join(this.debugDir, 'effect-intent.json'), bundle.effectIntent)
    await writeJson(path.join(this.debugDir, 'composition-plan.json'), bundle.compositionPlan)
    await writeJson(
      path.join(this.debugDir, 'composition-validation.json'),
      bundle.compositionValidation,
    )
    await writeJson(path.join(this.debugDir, 'render-plan.json'), bundle.renderPlan)
    await writeJson(path.join(this.debugDir, 'doctor-report.json'), bundle.doctorReport)

    await writeJson(path.join(this.debugDir, 'effect-debug-manifest.json'), {
      schema_version: 'effect_debug_manifest.v1',
      task_id: bundle.taskId,
      debug_dir: this.debugDir,
      artifacts: files,
      loss_ledger: bundle.lossLedger,
    })

    const artifactRefs = await Promise.all(
      [...files, 'effect-debug-manifest.json'].map((fileName) =>
        artifactRefForPath({
          taskId: bundle.taskId,
          path: path.join(this.debugDir, fileName),
          label: fileName,
        }),
      ),
    )
    await recordAgentTraceEvent({
      taskId: bundle.taskId,
      phase: 'effect_planning',
      actor: 'system',
      event: 'artifact',
      status: 'success',
      summary: 'Effect planning debug bundle written.',
      artifactRefs,
      data: {
        loss_ledger_count: bundle.lossLedger.length,
      },
    })

    return {
      debugDir: this.debugDir,
      files,
    }
  }
}

export async function writeEffectDebugArtifacts(input: {
  taskId: string
  bundle: EffectDebugArtifactBundle
  debugDir?: string
}): Promise<WriteEffectDebugArtifactsResult> {
  const writer = new EffectDebugArtifactWriter({
    taskId: input.taskId,
    debugDir: input.debugDir,
  })
  return writer.writeBundle(input.bundle)
}
