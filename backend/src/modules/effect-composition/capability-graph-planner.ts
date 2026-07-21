import type { EffectIntent } from '../../../../shared/types/effect-intent.v1.js'
import type {
  CompositionPlanDocument,
  PlannedCompositionLayer,
  SegmentCompositionPlan,
} from '../../../../shared/types/composition-plan.v1.js'
import { COMPOSITION_PLAN_SCHEMA_VERSION } from '../../../../shared/types/composition-plan.v1.js'
import {
  buildCapabilityGraph,
  findGraphNodesProviding,
  graphNodeViolatesIntentGeometry,
  type CapabilityGraph,
} from '../../../../shared/lib/capability-graph.js'
import { recipeForIntent } from '../../../../shared/lib/composition-recipes.js'
import type { LocalRegistryMappingDecision } from '../effect-roadmap/atom-registry-matcher.js'

export interface CapabilityGraphPlannerInput {
  taskId: string
  intents: EffectIntent[]
  localDecisions?: LocalRegistryMappingDecision[]
  graph?: CapabilityGraph
}

function decisionForProvides(
  provides: string,
  segmentId: string,
  localDecisions: LocalRegistryMappingDecision[],
): LocalRegistryMappingDecision | undefined {
  const layerHints: Record<string, string[]> = {
    grayscale_base: ['color_transform'],
    color_reveal: ['mask_reveal'],
    directional_wave: ['mask_reveal'],
    orb_motion: ['motion_driver'],
    ring_overlay: ['motion_driver'],
    collage_layout: ['layout'],
    beat_sync: ['audio_driver'],
    cinematic_grade: ['texture_grade'],
  }
  const layers = layerHints[provides] ?? []
  return localDecisions.find(
    (decision) =>
      decision.segment_id === segmentId &&
      (layers.includes(decision.layerKind) ||
        decision.plugin_id?.includes(provides.replace(/_/g, ''))),
  )
}

function planLayerFromGraph(input: {
  intent: EffectIntent
  provides: string
  layer: string
  optional: boolean
  graph: CapabilityGraph
  localDecisions: LocalRegistryMappingDecision[]
}): PlannedCompositionLayer {
  const localMatch = decisionForProvides(input.provides, input.intent.segment_id, input.localDecisions)
  if (localMatch?.plugin_id && localMatch.decision !== 'missing') {
    return {
      layer: input.layer,
      provides: input.provides,
      plugin_id: localMatch.plugin_id,
      preset: localMatch.preset,
      optional: input.optional,
      match_score: localMatch.match_score,
      reason: `Matched local registry decision for ${localMatch.atom_id}`,
    }
  }

  const candidates = findGraphNodesProviding(input.graph, input.provides, input.intent.intent_id)
  for (const node of candidates) {
    const violation = graphNodeViolatesIntentGeometry(node, {
      ...input.intent.geometry,
      'geometry.cell_shape': input.intent.geometry?.cell_shape,
    })
    if (violation) continue
    return {
      layer: input.layer,
      provides: input.provides,
      plugin_id: node.plugin_id,
      preset: node.fallback_preset,
      optional: input.optional,
      match_score: node.quality_score[input.intent.intent_id] ?? null,
      reason: `Capability graph selected ${node.plugin_id} for ${input.provides}`,
    }
  }

  return {
    layer: input.layer,
    provides: input.provides,
    plugin_id: null,
    preset: null,
    optional: input.optional,
    match_score: null,
    reason: `No capability graph node provides ${input.provides}`,
  }
}

export function planCompositionFromIntents(input: CapabilityGraphPlannerInput): CompositionPlanDocument {
  const graph = input.graph ?? buildCapabilityGraph()
  const localDecisions = input.localDecisions ?? []

  const segments: SegmentCompositionPlan[] = input.intents.map((intent) => {
    const recipe = recipeForIntent(intent.intent_id)
    if (!recipe) {
      return {
        segment_id: intent.segment_id,
        intent_id: intent.intent_id,
        recipe_id: `${intent.intent_id}.unknown`,
        planned_layers: [],
      }
    }

    const planned_layers: PlannedCompositionLayer[] = [
      ...recipe.required_layers.map((spec) =>
        planLayerFromGraph({
          intent,
          provides: spec.provides,
          layer: spec.layer,
          optional: false,
          graph,
          localDecisions,
        }),
      ),
      ...recipe.optional_layers.map((spec) =>
        planLayerFromGraph({
          intent,
          provides: spec.provides,
          layer: spec.layer,
          optional: spec.optional ?? true,
          graph,
          localDecisions,
        }),
      ),
    ]

    return {
      segment_id: intent.segment_id,
      intent_id: intent.intent_id,
      recipe_id: recipe.recipe_id,
      planned_layers,
    }
  })

  return {
    schema_version: COMPOSITION_PLAN_SCHEMA_VERSION,
    task_id: input.taskId,
    segments,
  }
}
