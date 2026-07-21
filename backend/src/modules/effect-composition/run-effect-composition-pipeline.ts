import type { EffectRoadmap } from '../../../../shared/types/effect-roadmap.v1.js'
import type { RenderEffectLayer, RenderPlanV1 } from '../../../../shared/types/render-plan.v1.js'
import type { EffectIntent } from '../../../../shared/types/effect-intent.v1.js'
import { resolveEffectIntents } from '../../../../shared/lib/effect-intent-resolver.js'
import type { LocalRegistryMappingDecision } from '../effect-roadmap/atom-registry-matcher.js'
import type { CompiledEffectLayersArtifact } from '../effect-roadmap/roadmap-compiler.js'
import { planCompositionFromIntents } from './capability-graph-planner.js'
import { validateComposition } from './composition-validator.js'
import {
  applyDeterministicRepairs,
  buildSceneCompositionStatuses,
  repairActionsRequiringAgent,
} from './composition-repair.js'
import { applyCompositionPlanToRenderPlan, layerSatisfiesProvides } from './composition-plan-compiler.js'
import type {
  CompositionPlanDocument,
  CompositionRepairAction,
  CompositionValidationDocument,
  SceneCompositionStatus,
} from '../../../../shared/types/composition-plan.v1.js'
import type { EffectIntentDocument } from '../../../../shared/types/effect-intent.v1.js'
import type { MigrationProtocolV12 } from '../../../../shared/types/migration-protocol.v1.2.js'

export interface EffectCompositionPipelineInput {
  taskId: string
  effectRoadmap?: EffectRoadmap | null
  groundingEffectIntents?: EffectIntent[]
  compiledEffectLayers: CompiledEffectLayersArtifact
  localMappingDecisions: LocalRegistryMappingDecision[]
  renderPlan?: RenderPlanV1 | null
}

export interface EffectCompositionPipelineResult {
  effectIntent: EffectIntentDocument
  compositionPlan: CompositionPlanDocument
  compositionValidation: CompositionValidationDocument
  sceneCompositionStatuses: SceneCompositionStatus[]
  agentRepairRequired: ReturnType<typeof repairActionsRequiringAgent>
}

export interface ApplyEffectCompositionPipelineResult extends EffectCompositionPipelineResult {
  plan: RenderPlanV1
}

function actualLayersBySegment(plan: RenderPlanV1): Record<string, RenderEffectLayer[]> {
  const bySegment: Record<string, RenderEffectLayer[]> = {}
  for (const scene of plan.scenes) {
    const layers = scene.effect_layers ?? []
    bySegment[scene.source_anchor_id] = layers
    bySegment[scene.id] = layers
  }
  return bySegment
}

function appliedRepairActions(input: {
  initialValidation: CompositionValidationDocument
  actualLayersBySegment: Record<string, RenderEffectLayer[]>
}): CompositionRepairAction[] {
  return input.initialValidation.repair_actions
    .filter((action) => action.kind === 'add_layer' && action.plugin_id)
    .map((action) => {
      const layers = input.actualLayersBySegment[action.segment_id] ?? []
      const wasApplied = layers.some(
        (layer) =>
          layer.source === 'composition_plan' &&
          layer.plugin_id === action.plugin_id &&
          layerSatisfiesProvides(layer, action.provides),
      )
      return wasApplied ? { ...action, auto_applied: true } : action
    })
    .filter((action) => action.auto_applied)
}

function mergeFinalValidation(input: {
  initialValidation: CompositionValidationDocument
  finalValidation: CompositionValidationDocument
  actualLayersBySegment: Record<string, RenderEffectLayer[]>
}): CompositionValidationDocument {
  const appliedActions = appliedRepairActions({
    initialValidation: input.initialValidation,
    actualLayersBySegment: input.actualLayersBySegment,
  })
  const appliedActionIds = new Set(appliedActions.map((action) => action.id))
  const repair_actions = [
    ...appliedActions,
    ...input.finalValidation.repair_actions.filter((action) => !appliedActionIds.has(action.id)),
  ]
  const status =
    input.finalValidation.status === 'complete' && appliedActions.length > 0
      ? 'auto_repaired'
      : input.finalValidation.status

  return {
    ...input.finalValidation,
    status,
    repair_actions,
  }
}

export function runEffectCompositionPipeline(
  input: EffectCompositionPipelineInput,
): EffectCompositionPipelineResult {
  const effectIntent = resolveEffectIntents({
    taskId: input.taskId,
    effectRoadmap: input.effectRoadmap,
    groundingEffectIntents: input.groundingEffectIntents,
  })

  if (effectIntent.intents.length === 0) {
    return {
      effectIntent,
      compositionPlan: {
        schema_version: 'composition_plan.v1',
        task_id: input.taskId,
        segments: [],
      },
      compositionValidation: {
        schema_version: 'composition_validation.v1',
        task_id: input.taskId,
        status: 'pending',
        findings: [],
        repair_actions: [],
      },
      sceneCompositionStatuses: [],
      agentRepairRequired: [],
    }
  }

  const compositionPlan = planCompositionFromIntents({
    taskId: input.taskId,
    intents: effectIntent.intents,
    localDecisions: input.localMappingDecisions,
  })

  const rawValidation = validateComposition({
    taskId: input.taskId,
    intents: effectIntent.intents,
    plan: compositionPlan,
    compiled: input.compiledEffectLayers,
  })

  const compositionValidation = applyDeterministicRepairs({ validation: rawValidation })
  const sceneCompositionStatuses = buildSceneCompositionStatuses({
    intents: effectIntent.intents,
    plan: compositionPlan,
    validation: compositionValidation,
    compiled: input.compiledEffectLayers,
  })

  return {
    effectIntent,
    compositionPlan,
    compositionValidation,
    sceneCompositionStatuses,
    agentRepairRequired: repairActionsRequiringAgent(compositionValidation),
  }
}

export function attachCompositionStatusToRenderPlan(input: {
  plan: RenderPlanV1
  statuses: SceneCompositionStatus[]
}): RenderPlanV1 {
  const statuses = [...input.statuses]
  return {
    ...input.plan,
    scenes: input.plan.scenes.map((scene, index) => ({
      ...scene,
      composition_status:
        statuses.find((status) => status.segment_id === scene.source_anchor_id) ??
        statuses.find((status) => status.segment_id === scene.id) ??
        statuses[index],
    })),
  }
}

export function applyEffectCompositionPipelineToRenderPlan(input: {
  taskId: string
  plan: RenderPlanV1
  structure: MigrationProtocolV12
  effectRoadmap?: EffectRoadmap | null
  groundingEffectIntents?: EffectIntent[]
  compiledEffectLayers: CompiledEffectLayersArtifact
  localMappingDecisions: LocalRegistryMappingDecision[]
}): ApplyEffectCompositionPipelineResult {
  const initial = runEffectCompositionPipeline({
    taskId: input.taskId,
    effectRoadmap: input.effectRoadmap,
    groundingEffectIntents: input.groundingEffectIntents,
    compiledEffectLayers: input.compiledEffectLayers,
    localMappingDecisions: input.localMappingDecisions,
    renderPlan: input.plan,
  })

  if (initial.effectIntent.intents.length === 0) {
    return {
      ...initial,
      plan: input.plan,
    }
  }

  const repairedPlan = applyCompositionPlanToRenderPlan({
    plan: input.plan,
    structure: input.structure,
    compositionPlan: initial.compositionPlan,
  })
  const finalActualLayers = actualLayersBySegment(repairedPlan)
  const finalValidationRaw = validateComposition({
    taskId: input.taskId,
    intents: initial.effectIntent.intents,
    plan: initial.compositionPlan,
    compiled: input.compiledEffectLayers,
    actualLayersBySegment: finalActualLayers,
  })
  const compositionValidation = mergeFinalValidation({
    initialValidation: initial.compositionValidation,
    finalValidation: finalValidationRaw,
    actualLayersBySegment: finalActualLayers,
  })
  const sceneCompositionStatuses = buildSceneCompositionStatuses({
    intents: initial.effectIntent.intents,
    plan: initial.compositionPlan,
    validation: compositionValidation,
    compiled: input.compiledEffectLayers,
    renderPlan: repairedPlan,
  })
  const plan = attachCompositionStatusToRenderPlan({
    plan: repairedPlan,
    statuses: sceneCompositionStatuses,
  })

  return {
    effectIntent: initial.effectIntent,
    compositionPlan: initial.compositionPlan,
    compositionValidation,
    sceneCompositionStatuses,
    agentRepairRequired: repairActionsRequiringAgent(compositionValidation),
    plan,
  }
}
