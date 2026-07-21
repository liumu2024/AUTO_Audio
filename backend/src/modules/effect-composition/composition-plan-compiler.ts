import type { CompositionPlanDocument, PlannedCompositionLayer } from '../../../../shared/types/composition-plan.v1.js'
import type { MigrationProtocolV12 } from '../../../../shared/types/migration-protocol.v1.2.js'
import type {
  RenderEffectLayer,
  RenderPlanV1,
  SceneEffects,
} from '../../../../shared/types/render-plan.v1.js'
import type { CapabilityLayerKind } from '../../../../shared/types/capability-registry.v1.js'
import { createDefaultEffect } from '../../../../shared/lib/effect-registry.js'
import { getRenderPluginManifest } from '../../../../shared/lib/render-plugin-manifest.js'
import {
  detailPrimitiveEffectForAnchor,
  normalizePrimitiveEffectForAnchor,
} from '../../../../shared/lib/primitive-effect-detail.js'
import { LAYER_COMPILE_ORDER } from '../effect-roadmap/roadmap-compiler.js'

const PROVIDES_BY_PRESET: Record<string, string[]> = {
  primitive_color_transform: ['grayscale_base', 'color_transform_base'],
  primitive_mask_reveal: ['color_reveal', 'localized_color_reveal'],
  primitive_directional_wave_reveal: ['directional_wave', 'directional_wave_reveal'],
  primitive_orb_motion: ['orb_motion', 'motion_subject_orb'],
  primitive_ring_overlay: ['ring_overlay', 'ring_motion'],
  primitive_orb_ring_overlay: ['ring_overlay', 'ring_motion'],
  primitive_collage_layout: ['collage_layout', 'layout_collage'],
  primitive_beat_pulse: ['beat_sync', 'audio_driver'],
  primitive_texture_grade: ['cinematic_grade'],
  primitive_beat_color_unlock: ['color_reveal', 'localized_color_reveal', 'grayscale_base', 'color_transform_base'],
  primitive_color_hint_overlay: ['color_hint_overlay', 'swatch_label_overlay'],
  primitive_fade_overlay: ['fade_to_black', 'segment_fade'],
  primitive_transition_accent_overlay: ['transition_accent', 'light_leak_transition', 'flash_transition'],
}

function layerProvides(preset: string, pluginId: string): string[] {
  const provides = new Set<string>([preset, pluginId])
  for (const item of PROVIDES_BY_PRESET[preset] ?? []) provides.add(item)
  if (preset.includes('color_transform')) {
    provides.add('grayscale_base')
    provides.add('color_transform_base')
  }
  if (preset.includes('mask_reveal')) {
    provides.add('color_reveal')
    provides.add('localized_color_reveal')
  }
  return [...provides]
}

export function layerSatisfiesProvides(layer: RenderEffectLayer, provides: string): boolean {
  const needle = provides.toLowerCase()
  return layerProvides(layer.preset, layer.plugin_id).some(
    (item) => item.toLowerCase() === needle || item.toLowerCase().includes(needle),
  )
}

function sceneHasProvides(layers: RenderEffectLayer[], provides: string): boolean {
  return layers.some((layer) => layerSatisfiesProvides(layer, provides))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function mergeRecords<T extends Record<string, unknown>>(
  base: T,
  patch: Record<string, unknown> | undefined,
): T {
  if (!patch) return structuredClone(base) as T
  const next: Record<string, unknown> = structuredClone(base)
  for (const [key, value] of Object.entries(patch)) {
    const current = next[key]
    if (isRecord(current) && isRecord(value)) {
      next[key] = mergeRecords(current, value)
    } else {
      next[key] = value
    }
  }
  return next as T
}

function shouldCompilePlannedLayer(planned: PlannedCompositionLayer): boolean {
  if (!planned.plugin_id || !planned.preset) return false
  if (!planned.optional) return true
  const manifest = getRenderPluginManifest(planned.plugin_id)
  return manifest?.targetLayer === 'overlay' && Boolean(manifest.fallbackPreset)
}

function sortCompiledLayers(layers: RenderEffectLayer[]): RenderEffectLayer[] {
  return [...layers].sort((left, right) => {
    const leftIndex = LAYER_COMPILE_ORDER.indexOf(left.layerKind as CapabilityLayerKind)
    const rightIndex = LAYER_COMPILE_ORDER.indexOf(right.layerKind as CapabilityLayerKind)
    return (leftIndex === -1 ? 99 : leftIndex) - (rightIndex === -1 ? 99 : rightIndex)
  })
}

function anchorForScene(
  structure: MigrationProtocolV12,
  scene: RenderPlanV1['scenes'][number],
) {
  return structure.semantic_anchors.find(
    (anchor) => anchor.anchor_id === scene.source_anchor_id || anchor.anchor_id === scene.id,
  )
}

function sceneWindowAssetIds(input: {
  plan: RenderPlanV1
  scene: RenderPlanV1['scenes'][number]
  minCount: number
}): string[] {
  const validAssetIds = new Set(input.plan.assets.map((asset) => asset.id))
  const sceneIndex = input.plan.scenes.findIndex((scene) => scene.id === input.scene.id)
  const orderedScenes =
    sceneIndex >= 0
      ? [
          input.plan.scenes[sceneIndex],
          input.plan.scenes[sceneIndex + 1],
          input.plan.scenes[sceneIndex - 1],
          input.plan.scenes[sceneIndex + 2],
          input.plan.scenes[sceneIndex - 2],
          ...input.plan.scenes,
        ]
      : input.plan.scenes
  const ids: string[] = []
  for (const scene of orderedScenes) {
    const assetId = scene?.visual.asset_id
    if (!assetId || !validAssetIds.has(assetId) || ids.includes(assetId)) continue
    ids.push(assetId)
    if (ids.length >= input.minCount) break
  }
  return ids
}

function bindCollagePanelsToSceneAssets(input: {
  effect: SceneEffects
  plan: RenderPlanV1
  scene: RenderPlanV1['scenes'][number]
}): SceneEffects {
  if (input.effect.preset !== 'primitive_collage_layout') return input.effect

  const validAssetIds = new Set(input.plan.assets.map((asset) => asset.id))
  const effect = input.effect as unknown as Record<string, unknown>
  const rawPanels = Array.isArray(effect.panels)
    ? (effect.panels as Array<Record<string, unknown>>)
    : []
  const neededCount = Math.max(3, rawPanels.length)
  const assetIds = sceneWindowAssetIds({
    plan: input.plan,
    scene: input.scene,
    minCount: neededCount,
  })
  if (assetIds.length === 0) return input.effect

  const fallbackPanels: Array<Record<string, unknown>> = [
    {
      id: 'panel_left',
      x_pct: 28,
      y_pct: 50,
      width_pct: 42,
      height_pct: 86,
      entrance: 'slide_left',
    },
    {
      id: 'panel_center',
      x_pct: 50,
      y_pct: 50,
      width_pct: 38,
      height_pct: 90,
      entrance: 'zoom',
    },
    {
      id: 'panel_right',
      x_pct: 72,
      y_pct: 50,
      width_pct: 42,
      height_pct: 86,
      entrance: 'slide_right',
    },
  ]
  const sourcePanels = rawPanels.length >= 3 ? rawPanels : fallbackPanels
  const panels = sourcePanels.map((panel, index) => {
    const currentAssetId = typeof panel.asset_id === 'string' ? panel.asset_id : undefined
    return {
      ...panel,
      id: typeof panel.id === 'string' ? panel.id : `panel_${index + 1}`,
      asset_id:
        currentAssetId && validAssetIds.has(currentAssetId)
          ? currentAssetId
          : assetIds[index % assetIds.length],
      start_sec: typeof panel.start_sec === 'number' ? panel.start_sec : 0,
      end_sec:
        typeof panel.end_sec === 'number'
          ? panel.end_sec
          : Math.max(0.8, input.scene.end_sec - input.scene.start_sec),
      fit: panel.fit === 'contain' ? 'contain' : 'cover',
      scale_from: typeof panel.scale_from === 'number' ? panel.scale_from : 0.96,
      scale_to: typeof panel.scale_to === 'number' ? panel.scale_to : 1,
    }
  })

  return {
    ...(input.effect as unknown as Record<string, unknown>),
    panels,
  } as unknown as SceneEffects
}

function buildLayerFromPlanned(input: {
  anchor: MigrationProtocolV12['semantic_anchors'][number]
  plan: RenderPlanV1
  scene: RenderPlanV1['scenes'][number]
  structure: MigrationProtocolV12
  planned: PlannedCompositionLayer
  index: number
}): RenderEffectLayer | null {
  if (!input.planned.plugin_id || !input.planned.preset) return null
  const manifest = getRenderPluginManifest(input.planned.plugin_id)
  if (!manifest?.fallbackPreset) return null

  const baseEffectRaw = createDefaultEffect(input.planned.preset as SceneEffects['preset'])
  const baseEffect = baseEffectRaw
    ? mergeRecords(
        baseEffectRaw as unknown as Record<string, unknown>,
        manifest.defaultParams,
      ) as unknown as SceneEffects
    : undefined
  const effect = detailPrimitiveEffectForAnchor({
    effect: normalizePrimitiveEffectForAnchor(baseEffect, input.anchor),
    anchor: input.anchor,
    recipe: input.structure.render_recipe,
  })
  if (!effect) return null
  const boundEffect = bindCollagePanelsToSceneAssets({
    effect,
    plan: input.plan,
    scene: input.scene,
  })

  return {
    id: `effect_${input.anchor.anchor_id}_composition_plan_${input.planned.provides}_${input.index}`,
    layerKind: manifest.layerKind,
    kind: manifest.layerKind,
    plugin_id: manifest.id,
    preset: boundEffect.preset,
    effects: boundEffect,
    source: 'composition_plan',
    is_primary: false,
    resolution: 'compiled',
    reason: `Composition plan compiled ${input.planned.plugin_id} for ${input.planned.provides}. ${input.planned.reason}`,
  }
}

/**
 * Fill missing required layers from composition plan planned_layers.
 * Roadmap / existing scene layers take precedence; only gaps are compiled.
 */
export function applyCompositionPlanToRenderPlan(input: {
  plan: RenderPlanV1
  structure: MigrationProtocolV12
  compositionPlan: CompositionPlanDocument
}): RenderPlanV1 {
  return {
    ...input.plan,
    scenes: input.plan.scenes.map((scene) => {
      const segmentPlan = input.compositionPlan.segments.find(
        (segment) =>
          segment.segment_id === scene.source_anchor_id || segment.segment_id === scene.id,
      )
      if (!segmentPlan) return scene

      const anchor = anchorForScene(input.structure, scene)
      if (!anchor) return scene

      const existingLayers = scene.effect_layers ?? []
      const plannedLayers = segmentPlan.planned_layers.filter(shouldCompilePlannedLayer)

      const addedLayers: RenderEffectLayer[] = []
      const workingLayers = [...existingLayers]

      plannedLayers.forEach((planned, index) => {
        if (sceneHasProvides(workingLayers, planned.provides)) return
        const layer = buildLayerFromPlanned({
          anchor,
          plan: input.plan,
          scene,
          structure: input.structure,
          planned,
          index: index + 1,
        })
        if (!layer) return
        addedLayers.push(layer)
        workingLayers.push(layer)
      })

      if (addedLayers.length === 0) return scene

      const nextLayers = sortCompiledLayers([...existingLayers, ...addedLayers])
      const primary =
        nextLayers.find((layer) => layer.is_primary) ??
        nextLayers.find((layer) => layer.layerKind === 'mask_reveal') ??
        nextLayers.find((layer) => layer.layerKind === 'motion_driver') ??
        nextLayers[0]

      return {
        ...scene,
        effect_layers: nextLayers.map((layer) => ({
          ...layer,
          is_primary: layer.id === primary?.id,
        })),
        effects: scene.effects ?? primary?.effects,
      }
    }),
  }
}
