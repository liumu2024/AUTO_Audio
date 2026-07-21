import { Prisma } from '@prisma/client'

import type { RenderPlanV1 } from '../../../../shared/types/render-plan.v1.js'
import {
  formatRenderPlanValidationFailure,
  validateRenderPlanHard,
  type RenderPlanValidationPhase,
} from '../../../../shared/lib/render-plan-validator.js'
import { repairRenderPlanDeterministically } from '../../../../shared/lib/render-plan-repair.js'
import { getPipelineBundle } from '../pipeline/pipeline.service.js'
import { prisma } from '../../shared/prisma.service.js'
import { reviewRenderPlanWithOptionalLlm } from './render-plan-review.service.js'
import { writeAgentTraceArtifact } from '../agent-trace/writer.js'

export async function getTaskRenderPlan(
  taskId: string,
): Promise<RenderPlanV1 | null> {
  const bundle = await getPipelineBundle(taskId)
  return bundle?.render_plan ?? null
}

async function readPersistedRenderPlan(
  taskId: string,
): Promise<RenderPlanV1 | null> {
  const task = await prisma.replicationTask.findUnique({
    where: { id: taskId },
    select: { renderPlanJson: true },
  })
  const value = task?.renderPlanJson
  return value && typeof value === 'object'
    ? (value as unknown as RenderPlanV1)
    : null
}

function isServerAuthoredEffectSource(source: string | undefined): boolean {
  return (
    source === 'scene_recipe' ||
    source === 'component_resolution' ||
    source === 'composition_plan'
  )
}

function mergeScenePreservingServerLayers(
  persistedScene: RenderPlanV1['scenes'][number] | undefined,
  incomingScene: RenderPlanV1['scenes'][number],
): RenderPlanV1['scenes'][number] {
  if (!persistedScene) return incomingScene

  const incomingLayers = incomingScene.effect_layers ?? []
  const persistedLayers = persistedScene.effect_layers ?? []
  const incomingHasServerAuthoredLayers = incomingLayers.some((layer) =>
    isServerAuthoredEffectSource(layer.source),
  )
  const persistedHasServerAuthoredLayers = persistedLayers.some((layer) =>
    isServerAuthoredEffectSource(layer.source),
  )

  const mergedLayers =
    !incomingHasServerAuthoredLayers && persistedHasServerAuthoredLayers
      ? persistedLayers
      : incomingScene.effect_layers

  const primaryLayer = mergedLayers?.find((layer) => layer.is_primary)
  const nextEffects =
    !incomingHasServerAuthoredLayers && persistedHasServerAuthoredLayers && primaryLayer
      ? primaryLayer.effects
      : incomingScene.effects

  return {
    ...incomingScene,
    effects: nextEffects,
    effect_layers: mergedLayers,
    effect_binding: incomingScene.effect_binding ?? persistedScene.effect_binding,
    composition_status:
      incomingScene.composition_status ?? persistedScene.composition_status,
  }
}

async function mergeIncomingRenderPlanWithPersisted(
  taskId: string,
  renderPlan: RenderPlanV1,
): Promise<RenderPlanV1> {
  const persisted = await readPersistedRenderPlan(taskId)
  if (!persisted) return renderPlan

  const persistedSceneById = new Map(
    persisted.scenes.map((scene) => [scene.id, scene] as const),
  )

  const scenes = renderPlan.scenes.map((scene) =>
    mergeScenePreservingServerLayers(persistedSceneById.get(scene.id), scene),
  )

  return {
    ...renderPlan,
    scenes,
    component_resolution:
      renderPlan.component_resolution ?? persisted.component_resolution,
  }
}

async function reviewIfEnabled(
  taskId: string,
  renderPlan: RenderPlanV1,
  validation: NonNullable<ReturnType<typeof validateRenderPlanHard>['data']>,
): Promise<void> {
  const review = await reviewRenderPlanWithOptionalLlm({
    renderPlan,
    validation,
  })
  if (review.source !== 'disabled') {
    await writeAgentTraceArtifact({
      taskId,
      phase: 'render_plan',
      actor: review.source === 'llm' ? 'llm' : 'system',
      fileName: `render-plan-llm-review-${validation.phase}-r${renderPlan.plan_revision ?? 1}.json`,
      summary:
        review.source === 'llm'
          ? `RenderPlan LLM review verdict: ${review.review.verdict}.`
          : `RenderPlan LLM review skipped: ${review.error}`,
      json: review,
      status: review.source === 'llm_error' ? 'warning' : 'success',
      data: {
        phase: validation.phase,
        source: review.source,
      },
    })
  }
  if (review.source === 'llm_error') {
    console.warn(`[render-plan-review] skipped: ${review.error}`)
  }
  if (review.source === 'llm' && review.review.verdict !== 'accept') {
    console.warn(
      `[render-plan-review] ${renderPlan.task_id} verdict=${review.review.verdict} confidence=${review.review.confidence}`,
    )
  }
}

async function validateAndRepairServerRenderPlan(input: {
  taskId: string
  renderPlan: RenderPlanV1
  phase: RenderPlanValidationPhase
}): Promise<RenderPlanV1> {
  const validation = validateRenderPlanHard({
    renderPlan: input.renderPlan,
    phase: input.phase,
  })
  if (validation.ok) {
    await writeAgentTraceArtifact({
      taskId: input.taskId,
      phase: 'render_plan',
      actor: 'validator',
      fileName: `render-plan-validation-${input.phase}-r${input.renderPlan.plan_revision ?? 1}.json`,
      summary: `RenderPlan ${input.phase} validation passed.`,
      json: validation.data,
      status: 'success',
      data: {
        phase: input.phase,
        repaired: false,
      },
    })
    await reviewIfEnabled(input.taskId, input.renderPlan, validation.data!)
    return input.renderPlan
  }

  const repaired = repairRenderPlanDeterministically({
    renderPlan: input.renderPlan,
    phase: input.phase,
    validation,
  })
  if (repaired.plan && repaired.validation.ok) {
    await writeAgentTraceArtifact({
      taskId: input.taskId,
      phase: 'render_plan',
      actor: 'validator',
      fileName: `render-plan-repair-${input.phase}-r${input.renderPlan.plan_revision ?? 1}.json`,
      summary: `RenderPlan ${input.phase} validation repaired deterministically.`,
      json: repaired.report,
      status: 'fallback',
      data: {
        phase: input.phase,
        action_count: repaired.report.actions.length,
      },
    })
    await reviewIfEnabled(input.taskId, repaired.plan, repaired.validation.data!)
    return repaired.plan
  }

  await writeAgentTraceArtifact({
    taskId: input.taskId,
    phase: 'render_plan',
    actor: 'validator',
    fileName: `render-plan-validation-failed-${input.phase}-r${input.renderPlan.plan_revision ?? 1}.json`,
    summary: `RenderPlan ${input.phase} validation failed.`,
    json: repaired.report,
    status: 'failed',
    data: {
      phase: input.phase,
      action_count: repaired.report.actions.length,
    },
  })
  throw new Error(formatRenderPlanValidationFailure(repaired.validation))
}

export async function updateTaskRenderPlan(
  taskId: string,
  renderPlan: RenderPlanV1,
): Promise<RenderPlanV1> {
  const mergedRenderPlan = await mergeIncomingRenderPlanWithPersisted(
    taskId,
    renderPlan,
  )
  const nextRenderPlan: RenderPlanV1 = {
    ...mergedRenderPlan,
    task_id: taskId,
    plan_revision: mergedRenderPlan.plan_revision ?? 1,
    updated_at: mergedRenderPlan.updated_at ?? new Date().toISOString(),
  }
  const checkedRenderPlan = await validateAndRepairServerRenderPlan({
    taskId,
    renderPlan: nextRenderPlan,
    phase: 'before_save',
  })
  await prisma.replicationTask.update({
    where: { id: taskId },
    data: {
      renderPlanJson: checkedRenderPlan as unknown as Prisma.InputJsonValue,
    },
  })

  return checkedRenderPlan
}

export async function prepareRenderPlanForRender(
  taskId: string,
  renderPlan: RenderPlanV1,
): Promise<RenderPlanV1> {
  const checkedRenderPlan = await validateAndRepairServerRenderPlan({
    taskId,
    renderPlan: {
      ...renderPlan,
      task_id: taskId,
    },
    phase: 'before_render',
  })
  if (checkedRenderPlan !== renderPlan) {
    await prisma.replicationTask.update({
      where: { id: taskId },
      data: {
        renderPlanJson: checkedRenderPlan as unknown as Prisma.InputJsonValue,
      },
    })
  }
  return checkedRenderPlan
}
