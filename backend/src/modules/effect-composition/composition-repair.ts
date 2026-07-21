import type {
  CompositionRepairAction,
  CompositionStatusKind,
  CompositionValidationDocument,
  SceneCompositionStatus,
} from '../../../../shared/types/composition-plan.v1.js'
import type { CompositionPlanDocument } from '../../../../shared/types/composition-plan.v1.js'
import type { EffectIntent } from '../../../../shared/types/effect-intent.v1.js'
import { recipeLabel } from '../../../../shared/lib/composition-recipes.js'
import type { CompiledEffectLayersArtifact } from '../effect-roadmap/roadmap-compiler.js'
import type { RenderEffectLayer, RenderPlanV1 } from '../../../../shared/types/render-plan.v1.js'
import { layerSatisfiesProvides } from './composition-plan-compiler.js'

const PRESET_LABELS: Record<string, string> = {
  primitive_color_transform: '灰度底图',
  primitive_mask_reveal: '圆形揭示',
  primitive_ring_overlay: '发光圆环',
  primitive_orb_motion: '光球运动',
  primitive_orb_ring_overlay: '光球拖尾环',
  primitive_directional_wave_reveal: '方向波纹',
  primitive_collage_layout: '拼贴布局',
  primitive_beat_pulse: '节拍缩放',
  primitive_texture_grade: '电影调色',
}

function layerLabel(preset: string): string {
  return PRESET_LABELS[preset] ?? preset.replace(/^primitive_/, '').replaceAll('_', ' ')
}

export function applyDeterministicRepairs(input: {
  validation: CompositionValidationDocument
}): CompositionValidationDocument {
  const repair_actions = input.validation.repair_actions.map((action) => {
    if (action.kind === 'add_layer' && action.plugin_id) {
      return { ...action, auto_applied: true }
    }
    return action
  })

  const autoRepaired = repair_actions.some((action) => action.auto_applied)
  let status = input.validation.status
  if (autoRepaired && status === 'invalid') {
    status = 'auto_repaired'
  }

  return {
    ...input.validation,
    status,
    repair_actions,
  }
}

export function buildSceneCompositionStatuses(input: {
  intents: EffectIntent[]
  plan: CompositionPlanDocument
  validation: CompositionValidationDocument
  compiled?: CompiledEffectLayersArtifact
  renderPlan?: RenderPlanV1 | null
}): SceneCompositionStatus[] {
  return input.intents.map((intent) => {
    const segmentPlan = input.plan.segments.find((seg) => seg.segment_id === intent.segment_id)
    const compiledSegment = input.compiled?.segments.find((seg) => seg.segment_id === intent.segment_id)
    const scene = input.renderPlan?.scenes.find(
      (item) => item.source_anchor_id === intent.segment_id || item.id === intent.segment_id,
    )
    const layers: RenderEffectLayer[] =
      scene?.effect_layers?.length
        ? scene.effect_layers
        : (compiledSegment?.effect_layers ?? [])
    const segmentFindings = input.validation.findings.filter((f) => f.segment_id === intent.segment_id)
    const segmentRepairs = input.validation.repair_actions.filter((a) => a.segment_id === intent.segment_id)

    let status: CompositionStatusKind = 'complete'
    let status_label = '完整'

    if (segmentFindings.some((f) => f.message.includes('Missing capability'))) {
      status = 'missing_capability'
      status_label = '缺插件'
    } else if (
      segmentRepairs.some((a) => a.auto_applied) ||
      layers.some((layer) => layer.source === 'composition_plan')
    ) {
      status = 'auto_repaired'
      status_label = '已自动补齐'
    } else if (segmentFindings.some((f) => f.severity === 'error')) {
      status = 'invalid'
      status_label = '不完整'
    } else if (layers.length === 0) {
      status = 'pending'
      status_label = '待编译'
    }

    const missing = segmentFindings
      .filter((f) => f.missing_provides)
      .map((f) => f.missing_provides!)
    const repairs = segmentRepairs
      .filter((a) => a.auto_applied)
      .map((a) => `补充 ${a.plugin_id ?? a.provides}`)
    const planRepairs = (segmentPlan?.planned_layers ?? [])
      .filter(
        (planned) =>
          !planned.optional &&
          planned.plugin_id &&
          layers.some(
            (layer) =>
              layer.source === 'composition_plan' && layerSatisfiesProvides(layer, planned.provides),
          ),
      )
      .map((planned) => `补充 ${planned.plugin_id}`)
    const mergedRepairs = [...new Set([...repairs, ...planRepairs])]
    const missing_capabilities = segmentRepairs
      .filter((a) => a.missing_capability)
      .map((a) => a.missing_capability!)
    const suggestions =
      status === 'missing_capability'
        ? ['生成新插件', '使用矩形拼贴近似（需要用户确认）']
        : undefined

    return {
      segment_id: intent.segment_id,
      intent_id: intent.intent_id,
      intent_label: recipeLabel(intent.intent_id),
      recipe_id: segmentPlan?.recipe_id ?? `${intent.intent_id}.unknown`,
      status,
      status_label,
      layers: layers.map((layer) => ({
        label: layerLabel(layer.preset),
        plugin_id: layer.plugin_id,
        preset: layer.preset,
        layer_kind: layer.layerKind,
      })),
      missing: missing.length ? missing : undefined,
      repairs: mergedRepairs.length ? mergedRepairs : undefined,
      missing_capabilities: missing_capabilities.length ? missing_capabilities : undefined,
      suggestions,
    }
  })
}

export function repairActionsRequiringAgent(
  validation: CompositionValidationDocument,
): CompositionRepairAction[] {
  return validation.repair_actions.filter(
    (action) => !action.auto_applied && (action.kind === 'generate_plugin' || action.kind === 'ask_user'),
  )
}
