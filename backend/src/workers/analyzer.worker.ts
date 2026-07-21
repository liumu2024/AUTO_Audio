import { UnrecoverableError, Worker } from 'bullmq'

import { AnalyzerResponseError } from '../modules/video-understanding/errors.js'
import { arkVideoAnalyzer } from '../modules/video-understanding/ark-analyzer.service.js'
import { isUnderstandingConfigured } from '../modules/video-understanding/understanding-env.js'
import { getBullmqConnection, QUEUE_NAMES } from '../config/redis.js'
import { prisma } from '../shared/prisma.service.js'
import type { MigrationProtocolV12 } from '../../../shared/types/migration-protocol.v1.2.js'
import { TASK_STATUS } from '../shared/types.js'
import { broadcastTaskProgress } from '../modules/websocket/ws.gateway.js'
import { buildRenderPlanFromStructure } from '../../../shared/lib/render-plan-builder.js'
import { updateTaskRenderPlan } from '../modules/render-plan/render-plan.service.js'
import type { RenderPlanV1 } from '../../../shared/types/render-plan.v1.js'
import {
  applyComponentResolutionToRenderPlan,
  authorSeedPluginProposals,
  resolveRenderCapabilities,
} from '../modules/remotion-component-authoring/capability-resolver.js'
import { env } from '../config/env.js'
import type { DirectorGroundingResult } from '../modules/sample-understanding/director-grounding/director-grounding.schema.js'
import {
  buildEffectDebugArtifacts,
  writeEffectDebugArtifacts,
} from '../modules/effect-debug-artifacts/index.js'
import type { CompiledEffectLayersArtifact } from '../modules/effect-roadmap/roadmap-compiler.js'
import {
  applyCompiledEffectLayersToRenderPlan,
  buildRoadmapPluginRegistrySnapshot,
  compileEffectRoadmap,
  mapMissingAtomsWithSeed,
  matchAtomsToRegistry,
  resolveSeedAuthoringClient,
  type LocalRegistryMappingDecision,
} from '../modules/effect-roadmap/index.js'
import type { SeedPluginMapperOutput } from '../modules/effect-roadmap/seed-plugin-mapper.js'
import {
  applyEffectCompositionPipelineToRenderPlan,
} from '../modules/effect-composition/run-effect-composition-pipeline.js'
import { runRoadmapAgent, type RoadmapAgentRunStatus } from '../modules/effect-roadmap/roadmap-agent.service.js'
import type { EffectRoadmap } from '../../../shared/types/effect-roadmap.v1.js'

function isAuthFailure(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return (
    message.includes('401') ||
    message.includes('AuthenticationError') ||
    message.includes("API key doesn't exist") ||
    message.includes('Unauthorized')
  )
}

function isFileQuotaFailure(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return (
    message.includes('OperationDenied.FileQuotaExceeded') ||
    message.includes('file storage quota') ||
    message.includes('FileQuotaExceeded')
  )
}

function analyzerFailureMessage(error: unknown): string {
  if (isFileQuotaFailure(error)) {
    return 'Ark Files remote storage quota exceeded. Delete historical files in the Ark console, then retry. New uploads will be deleted automatically after each analysis run.'
  }
  if (isAuthFailure(error)) {
    return '视频理解 API Key 已失效或不存在。请更新 backend/.env 中的 ARK_API_KEY / VIDEO_UNDERSTANDING_API_KEY，然后重启 backend 和 analyzer.worker。'
  }
  if (error instanceof AnalyzerResponseError) {
    return error.message
  }
  return `视频理解 API 调用失败：${
    error instanceof Error ? error.message : String(error)
  }`
}

function isCancelledStatus(status: string | null | undefined): boolean {
  return status === TASK_STATUS.CANCELLED || status === TASK_STATUS.CANCELLING
}

async function throwIfCancelled(taskId: string): Promise<void> {
  const current = await prisma.replicationTask.findUnique({
    where: { id: taskId },
    select: { taskStatus: true },
  })
  if (isCancelledStatus(current?.taskStatus)) {
    broadcastTaskProgress(taskId, {
      progress: 100,
      stage: 'Cancelled',
      log: 'Analysis task was cancelled by user.',
    })
    throw new UnrecoverableError(`Task ${taskId} was cancelled.`)
  }
}

async function persistStructureCheckpoint(
  taskId: string,
  structure: MigrationProtocolV12,
  log: string,
): Promise<void> {
  await prisma.replicationTask.update({
    where: { id: taskId },
    data: {
      taskStatus: TASK_STATUS.WAITING_USER_EDIT,
      structureJson: structure as object,
    },
  })
  broadcastTaskProgress(taskId, {
    progress: 55,
    stage: 'Structure ready',
    log,
  })
}

interface SeedEffectEnrichmentContext {
  effectRoadmap: EffectRoadmap
  seedOutput: SeedPluginMapperOutput
  localMappingDecisions: LocalRegistryMappingDecision[]
  groundingEffectIntents: DirectorGroundingResult['effect_intents']
}

async function enrichRenderPlanWithSeedAuthoring(input: {
  taskId: string
  plan: RenderPlanV1
  structure: MigrationProtocolV12
  context: SeedEffectEnrichmentContext
}): Promise<void> {
  if (
    !env.enableSeedPluginAuthoring ||
    !env.enableRemotionComponentAuthoring ||
    input.context.seedOutput.mappingDecisionsSeed.decisions.every(
      (decision) => decision.decision !== 'generate_plugin',
    )
  ) {
    return
  }

  await throwIfCancelled(input.taskId)

  const seedAuthoring = await authorSeedPluginProposals({
    taskId: input.taskId,
    mappingDecisionsSeed: input.context.seedOutput.mappingDecisionsSeed,
    effectRoadmap: input.context.effectRoadmap,
  })

  if (seedAuthoring.byAtomId.size === 0) return

  await throwIfCancelled(input.taskId)

  let patchedPlan = input.plan
  const compiled = compileEffectRoadmap({
    taskId: input.taskId,
    effectRoadmap: input.context.effectRoadmap,
    mappingDecisionsLocal: {
      local_registry_decisions: input.context.localMappingDecisions,
    },
    mappingDecisionsSeed: input.context.seedOutput.mappingDecisionsSeed,
    seedAuthoringByAtomId: seedAuthoring.byAtomId,
  })

  if (env.enableRoadmapCompiledEffectLayers) {
    patchedPlan = applyCompiledEffectLayersToRenderPlan({
      plan: input.plan,
      compiled,
      effectRoadmap: input.context.effectRoadmap,
      renderRecipe: input.structure.render_recipe,
    })
  }

  const composition = applyEffectCompositionPipelineToRenderPlan({
    taskId: input.taskId,
    plan: patchedPlan,
    structure: input.structure,
    effectRoadmap: input.context.effectRoadmap,
    groundingEffectIntents: input.context.groundingEffectIntents,
    compiledEffectLayers: compiled,
    localMappingDecisions: input.context.localMappingDecisions,
  })

  await updateTaskRenderPlan(input.taskId, composition.plan)
  broadcastTaskProgress(input.taskId, {
    progress: 100,
    stage: 'Effects enriched',
    log: `Seed plugin components authored (${seedAuthoring.byAtomId.size}); RenderPlan effect layers updated.`,
  })
}

async function applyEffectCompositionToRenderPlan(input: {
  taskId: string
  plan: RenderPlanV1
  structure: MigrationProtocolV12
  effectRoadmap: EffectRoadmap | null
  skipSeedAuthoring?: boolean
}): Promise<{
  plan: RenderPlanV1
  seedEnrichmentContext: SeedEffectEnrichmentContext | null
}> {
  const grounding =
    input.structure.director_grounding &&
    typeof input.structure.director_grounding === 'object' &&
    (input.structure.director_grounding as { schema_version?: string }).schema_version ===
      'director_grounding.v1'
      ? (input.structure.director_grounding as DirectorGroundingResult)
      : null
  const groundingEffectIntents = grounding?.effect_intents ?? []
  const hasRoadmapSegments = (input.effectRoadmap?.segments.length ?? 0) > 0
  const hasCompositionInput = hasRoadmapSegments || groundingEffectIntents.length > 0

  if (!hasCompositionInput) {
    return { plan: input.plan, seedEnrichmentContext: null }
  }

  let patchedPlan = input.plan
  let compiled: CompiledEffectLayersArtifact = {
    schema_version: 'compiled_effect_layers.v1',
    task_id: input.taskId,
    segments: [],
    loss_ledger: [],
  }
  let localMappingDecisions: LocalRegistryMappingDecision[] = []
  let seedOutput: SeedPluginMapperOutput | null = null

  if (hasRoadmapSegments) {
    const registrySnapshot = buildRoadmapPluginRegistrySnapshot()
    const matcherResult = matchAtomsToRegistry({
      taskId: input.taskId,
      effectRoadmap: input.effectRoadmap!,
      registrySnapshot,
      structure: input.structure,
    })
    localMappingDecisions = matcherResult.localMappingDecisions
    seedOutput = await mapMissingAtomsWithSeed({
      taskId: input.taskId,
      atomPlan: matcherResult.atomPlan,
      missingAtomsTodo: matcherResult.missingAtomsTodo,
      directorGrounding: {
        schema_version: 'director_grounding.v1',
        task_id: input.taskId,
        data: grounding,
      },
      registrySnapshot,
      seedClient: resolveSeedAuthoringClient(),
    })

    let seedAuthoringByAtomId: Awaited<
      ReturnType<typeof authorSeedPluginProposals>
    >['byAtomId'] | undefined
    if (!input.skipSeedAuthoring) {
      const seedAuthoring = await authorSeedPluginProposals({
        taskId: input.taskId,
        mappingDecisionsSeed: seedOutput.mappingDecisionsSeed,
        effectRoadmap: input.effectRoadmap!,
      })
      seedAuthoringByAtomId = seedAuthoring.byAtomId
    }

    compiled = compileEffectRoadmap({
      taskId: input.taskId,
      effectRoadmap: input.effectRoadmap!,
      mappingDecisionsLocal: {
        local_registry_decisions: matcherResult.localMappingDecisions,
      },
      mappingDecisionsSeed: seedOutput.mappingDecisionsSeed,
      seedAuthoringByAtomId,
    })

    if (env.enableRoadmapCompiledEffectLayers) {
      patchedPlan = applyCompiledEffectLayersToRenderPlan({
        plan: input.plan,
        compiled,
        effectRoadmap: input.effectRoadmap,
        renderRecipe: input.structure.render_recipe,
      })
    }
  }

  const composition = applyEffectCompositionPipelineToRenderPlan({
    taskId: input.taskId,
    plan: patchedPlan,
    structure: input.structure,
    effectRoadmap: input.effectRoadmap,
    groundingEffectIntents,
    compiledEffectLayers: compiled,
    localMappingDecisions,
  })

  const seedEnrichmentContext =
    input.skipSeedAuthoring && hasRoadmapSegments && seedOutput && input.effectRoadmap
      ? {
          effectRoadmap: input.effectRoadmap,
          seedOutput,
          localMappingDecisions,
          groundingEffectIntents,
        }
      : null

  return { plan: composition.plan, seedEnrichmentContext }
}

export interface AnalyzerJobData {
  taskId: string
  videoUrl: string
  sampleVideo?: import('../../../shared/types/analyze-request.js').SampleVideoInputDto
  referenceMaterials?: import('../../../shared/types/analyze-request.js').ReferenceMaterialInputDto[]
  creativeIntent?: import('../../../shared/types/template-schema.v1.js').ParsedCreativeIntent
  directorIntent?: import('../../../shared/types/director-context.js').DirectorUserIntent
  globalPrompt?: string
  materials?: import('../../../shared/types/pipeline.js').UserMaterialDto[]
}

export async function processAnalyzerJobData(
  jobData: AnalyzerJobData,
): Promise<void> {
    const {
      taskId,
      videoUrl,
      sampleVideo,
      referenceMaterials,
      creativeIntent,
      directorIntent,
      globalPrompt,
      materials,
    } = jobData

    const existingTask = await prisma.replicationTask.findUnique({
      where: { id: taskId },
    })
    if (!existingTask) {
      const message = `ReplicationTask ${taskId} not found (stale analyzer queue job?). Re-submit analyze or drain video-analyzer-queue.`
      console.warn(`[analyzer.worker] ${message}`)
      throw new UnrecoverableError(message)
    }

    if (isCancelledStatus(existingTask.taskStatus)) {
      throw new UnrecoverableError(`Task ${taskId} was cancelled.`)
    }

    await prisma.replicationTask.update({
      where: { id: taskId },
      data: { taskStatus: TASK_STATUS.ANALYZING },
    })

    try {
      let resultJson: MigrationProtocolV12

      if (!isUnderstandingConfigured()) {
        throw new Error(
          '视频理解 API Key 未配置。请在 backend/.env 配置 ARK_API_KEY 或 VIDEO_UNDERSTANDING_API_KEY。',
        )
      }

      const analyzeOutput = await arkVideoAnalyzer.analyze({
        taskId,
        videoUrl,
        sampleVideo,
        referenceMaterials,
        creativeIntent,
        globalPrompt,
        materials,
      })
      resultJson = analyzeOutput.structure
      const sampleHints = analyzeOutput.sampleHints

      await throwIfCancelled(taskId)

      await persistStructureCheckpoint(
        taskId,
        resultJson,
        'Director grounding complete. Sample structure outline is ready; effect enrichment continues in background.',
      )

      const capabilityResolution = await resolveRenderCapabilities({
        taskId,
        structure: resultJson,
      })
      resultJson = capabilityResolution.structure

      await throwIfCancelled(taskId)

      let effectRoadmap: EffectRoadmap | null = null
      let roadmapAgentStatus: RoadmapAgentRunStatus | null = null
      let roadmapAgentError: string | null = null
      let roadmapAgentInitialRawResponse: string | null = null
      let roadmapAgentRepairRawResponse: string | null = null
      const grounding = resultJson.director_grounding
      if (
        grounding &&
        typeof grounding === 'object' &&
        (grounding as { schema_version?: string }).schema_version === 'director_grounding.v1'
      ) {
        const roadmapResult = await runRoadmapAgent({
          taskId,
          directorGrounding: grounding as DirectorGroundingResult,
          sampleHints,
        })
        effectRoadmap = roadmapResult.roadmap
        roadmapAgentStatus = roadmapResult.status
        roadmapAgentError = roadmapResult.error ?? null
        roadmapAgentInitialRawResponse = roadmapResult.initialRawResponse
        roadmapAgentRepairRawResponse = roadmapResult.repairRawResponse
        if (roadmapResult.status === 'failed') {
          console.warn(
            `[analyzer.worker] ${taskId} roadmap agent failed:`,
            roadmapResult.error ?? 'unknown error',
          )
        }
      }

      await throwIfCancelled(taskId)

      let finalRenderPlan:
        | ReturnType<typeof buildRenderPlanFromStructure>
        | undefined
      let seedEnrichmentContext: SeedEffectEnrichmentContext | null = null

      if (materials?.length || directorIntent?.aspectRatio || resultJson.render_recipe) {
        const renderPlan = buildRenderPlanFromStructure({
          taskId,
          structure: resultJson,
          materials: materials ?? [],
          aspectRatio: directorIntent?.aspectRatio,
          sampleReference: {
            id: sampleVideo?.id ?? resultJson.metadata.video_id,
            name: sampleVideo?.name ?? 'sample video audio reference',
            url: sampleVideo?.url ?? videoUrl,
            duration_sec: resultJson.metadata.duration_sec,
          },
        })
        finalRenderPlan = applyComponentResolutionToRenderPlan(
          renderPlan,
          capabilityResolution.componentResolution,
        )
        try {
          const compositionResult = await applyEffectCompositionToRenderPlan({
            taskId,
            plan: finalRenderPlan,
            structure: resultJson,
            effectRoadmap,
            skipSeedAuthoring: true,
          })
          finalRenderPlan = compositionResult.plan
          seedEnrichmentContext = compositionResult.seedEnrichmentContext
        } catch (roadmapCompileError) {
          console.warn(
            `[analyzer.worker] ${taskId} roadmap compiled effect layers skipped:`,
            roadmapCompileError instanceof Error
              ? roadmapCompileError.message
              : roadmapCompileError,
          )
        }
        await updateTaskRenderPlan(taskId, finalRenderPlan)
      }

      await prisma.replicationTask.update({
        where: { id: taskId },
        data: {
          taskStatus: TASK_STATUS.WAITING_USER_EDIT,
          structureJson: resultJson as object,
        },
      })
      broadcastTaskProgress(taskId, {
        progress: 100,
        stage: 'Analysis complete',
        log: finalRenderPlan
          ? 'Sample understanding completed. Structure JSON and RenderPlan are ready.'
          : 'Sample understanding completed. Structure JSON is ready.',
      })

      if (seedEnrichmentContext && finalRenderPlan) {
        void enrichRenderPlanWithSeedAuthoring({
          taskId,
          plan: finalRenderPlan,
          structure: resultJson,
          context: seedEnrichmentContext,
        }).catch((enrichmentError) => {
          console.warn(
            `[analyzer.worker] ${taskId} async seed effect enrichment failed:`,
            enrichmentError instanceof Error ? enrichmentError.message : enrichmentError,
          )
        })
      }

      if (env.enableEffectDebugArtifacts) {
        try {
          const bundle = await buildEffectDebugArtifacts({
            taskId,
            structure: resultJson,
            renderPlan: finalRenderPlan ?? null,
            componentResolution: capabilityResolution.componentResolution,
            effectRoadmap,
            roadmapAgentStatus,
            roadmapAgentError,
            roadmapAgentInitialRawResponse,
            roadmapAgentRepairRawResponse,
            seedClient: resolveSeedAuthoringClient(),
          })
          await writeEffectDebugArtifacts({ taskId, bundle })
        } catch (artifactError) {
          console.warn(
            `[analyzer.worker] ${taskId} effect debug artifacts skipped:`,
            artifactError instanceof Error ? artifactError.message : artifactError,
          )
        }
      }
    } catch (error) {
      const message = analyzerFailureMessage(error)
      console.error(`[analyzer.worker] ${taskId} ${message}`, error)
      const current = await prisma.replicationTask.findUnique({
        where: { id: taskId },
        select: { taskStatus: true },
      })
      if (!isCancelledStatus(current?.taskStatus)) {
        await prisma.replicationTask.updateMany({
          where: { id: taskId },
          data: { taskStatus: TASK_STATUS.FAILED },
        })
      }
      broadcastTaskProgress(taskId, {
        progress: 100,
        stage: isCancelledStatus(current?.taskStatus) ? 'Cancelled' : 'Failed',
        log: isCancelledStatus(current?.taskStatus)
          ? 'Analysis task was cancelled by user.'
          : message,
      })
      throw error
    }
}

if (process.env.DPL304_LOCAL_MODE !== 'true') {
  const worker = new Worker(
    QUEUE_NAMES.ANALYZER,
    async (job) => processAnalyzerJobData(job.data as AnalyzerJobData),
    { connection: getBullmqConnection() },
  )

  worker.on('failed', (job, err) => {
    console.error(`[analyzer.worker] job ${job?.id} failed:`, err)
  })

  console.info('[analyzer.worker] listening on', QUEUE_NAMES.ANALYZER)
  console.info(
    '[analyzer.worker] mode:',
    isUnderstandingConfigured() ? 'ark (real)' : 'api key missing',
  )
}
