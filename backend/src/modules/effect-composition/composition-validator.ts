import type { RenderEffectLayer } from '../../../../shared/types/render-plan.v1.js'
import type { EffectIntent } from '../../../../shared/types/effect-intent.v1.js'
import type {
  CompositionPlanDocument,
  CompositionRepairAction,
  CompositionStatusKind,
  CompositionValidationDocument,
  CompositionValidationFinding,
} from '../../../../shared/types/composition-plan.v1.js'
import { COMPOSITION_VALIDATION_SCHEMA_VERSION } from '../../../../shared/types/composition-plan.v1.js'
import type { CompiledEffectLayersArtifact } from '../effect-roadmap/roadmap-compiler.js'
import { recipeForIntent } from '../../../../shared/lib/composition-recipes.js'

export interface CompositionValidatorInput {
  taskId: string
  intents: EffectIntent[]
  plan: CompositionPlanDocument
  compiled?: CompiledEffectLayersArtifact
  actualLayersBySegment?: Record<string, RenderEffectLayer[]>
}

function actualLayersForSegment(input: CompositionValidatorInput, segmentId: string): RenderEffectLayer[] {
  if (input.actualLayersBySegment?.[segmentId]) return input.actualLayersBySegment[segmentId]!
  const compiledSegment = input.compiled?.segments.find((seg) => seg.segment_id === segmentId)
  return compiledSegment?.effect_layers ?? []
}

function layerProvides(preset: string, pluginId: string): string[] {
  const provides: string[] = [preset, pluginId]
  if (preset.includes('color_transform')) provides.push('grayscale_base', 'color_transform_base')
  if (preset.includes('mask_reveal')) provides.push('color_reveal', 'localized_color_reveal')
  if (preset.includes('directional_wave')) provides.push('directional_wave', 'directional_wave_reveal')
  if (preset.includes('orb_motion')) provides.push('orb_motion', 'motion_subject_orb')
  if (preset.includes('ring')) provides.push('ring_overlay', 'ring_motion')
  if (preset.includes('collage')) provides.push('collage_layout', 'layout_collage')
  if (preset.includes('beat')) provides.push('beat_sync', 'audio_driver')
  if (preset.includes('texture_grade')) provides.push('cinematic_grade')
  if (preset.includes('beat_color_unlock')) {
    provides.push('color_reveal', 'localized_color_reveal', 'grayscale_base', 'color_transform_base')
  }
  if (preset.includes('color_hint_overlay')) provides.push('color_hint_overlay', 'swatch_label_overlay')
  if (preset.includes('fade_overlay')) provides.push('fade_to_black', 'segment_fade')
  if (preset.includes('transition_accent_overlay')) {
    provides.push('transition_accent', 'light_leak_transition', 'flash_transition')
  }
  return provides
}

function hasProvides(actual: RenderEffectLayer[], provides: string): boolean {
  const needle = provides.toLowerCase()
  return actual.some((layer) =>
    layerProvides(layer.preset, layer.plugin_id).some(
      (item) => item.toLowerCase() === needle || item.toLowerCase().includes(needle),
    ),
  )
}

export function validateComposition(input: CompositionValidatorInput): CompositionValidationDocument {
  const findings: CompositionValidationFinding[] = []
  const repair_actions: CompositionRepairAction[] = []

  for (const intent of input.intents) {
    const segmentPlan = input.plan.segments.find((seg) => seg.segment_id === intent.segment_id)
    const recipe = recipeForIntent(intent.intent_id)
    const actual = actualLayersForSegment(input, intent.segment_id)
    const cellShape = intent.geometry?.cell_shape

    if (!recipe) {
      findings.push({
        id: `missing_recipe_${intent.segment_id}`,
        segment_id: intent.segment_id,
        rule: 'recipe_exists',
        severity: 'error',
        message: `No composition recipe registered for intent ${intent.intent_id}`,
      })
      continue
    }

    for (const required of recipe.required_layers) {
      if (!hasProvides(actual, required.provides)) {
        const planned = segmentPlan?.planned_layers.find((layer) => layer.provides === required.provides)
        findings.push({
          id: `missing_${intent.segment_id}_${required.provides}`,
          segment_id: intent.segment_id,
          rule: 'must_have_layer',
          severity: 'error',
          message: `Missing required layer providing ${required.provides}`,
          missing_provides: required.provides,
          suggested_repair: planned?.plugin_id ?? undefined,
        })

        if (planned?.plugin_id) {
          repair_actions.push({
            id: `repair_add_${intent.segment_id}_${required.provides}`,
            segment_id: intent.segment_id,
            kind: 'add_layer',
            provides: required.provides,
            layer: required.layer,
            plugin_id: planned.plugin_id,
            reason: `Recipe ${recipe.recipe_id} requires ${required.provides}`,
            auto_applied: false,
          })
        }
      }
    }

    if (cellShape === 'triangle' && hasProvides(actual, 'collage_layout')) {
      const usesRectangleOnly = actual.some((layer) => layer.plugin_id === 'split_collage_layout')
      if (usesRectangleOnly) {
        findings.push({
          id: `forbidden_fallback_${intent.segment_id}`,
          segment_id: intent.segment_id,
          rule: 'geometry_shape_supported',
          severity: 'error',
          message: 'Triangle collage must not fallback to rectangle collage layout',
        })
      }
    }

    if (cellShape === 'triangle' && !hasProvides(actual, 'collage_layout')) {
      findings.push({
        id: `missing_capability_${intent.segment_id}`,
        segment_id: intent.segment_id,
        rule: 'geometry_shape_supported',
        severity: 'error',
        message: 'Missing capability: triangular_collage_layout',
        missing_provides: 'collage_layout',
      })
      repair_actions.push({
        id: `repair_generate_${intent.segment_id}_triangle`,
        segment_id: intent.segment_id,
        kind: 'generate_plugin',
        provides: 'collage_layout',
        layer: 'layout',
        plugin_id: null,
        reason: 'Triangle collage requested but registry lacks triangle layout plugin',
        auto_applied: false,
        missing_capability: 'triangular_collage_layout',
      })
    }
  }

  let status: CompositionStatusKind = 'complete'
  if (findings.some((f) => f.severity === 'error')) {
    const hasMissingCapability = findings.some((f) => f.rule === 'geometry_shape_supported' && f.message.includes('Missing capability'))
    status = hasMissingCapability ? 'missing_capability' : 'invalid'
  }

  return {
    schema_version: COMPOSITION_VALIDATION_SCHEMA_VERSION,
    task_id: input.taskId,
    status,
    findings,
    repair_actions,
  }
}
