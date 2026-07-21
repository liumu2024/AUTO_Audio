import type { CapabilityLayerKind } from '../../../../shared/types/capability-registry.v1.js'
import type {
  EffectAtom,
  EffectRoadmap,
  EffectRoadmapSegment,
  LossLedgerEntry,
  ParamBinding,
} from '../../../../shared/types/effect-roadmap.v1.js'
import type {
  GeneratedComponentEffects,
  RenderEffectLayer,
  RenderPlanV1,
  RenderSceneEffectBinding,
  SceneEffects,
} from '../../../../shared/types/render-plan.v1.js'
import type { RenderRecipeExtension } from '../../../../shared/types/migration-protocol.v1.2.js'
import type { SeedAuthoringByAtomEntry } from '../remotion-component-authoring/capability-resolver.js'
import { createDefaultEffect } from '../../../../shared/lib/effect-registry.js'
import { splitEffectLayer } from '../../../../shared/lib/legacy-preset-split.js'
import {
  getRenderPluginManifest,
  registerSeedPluginManifests,
} from '../../../../shared/lib/render-plugin-manifest.js'
import {
  hydrateSeedPluginManifest,
  inferFallbackPresetFromSeedManifest,
  resolveSeedCompilePluginId,
  resolveSeedManifestLayerKind,
} from '../../../../shared/lib/seed-manifest-bridge.js'
import type { LocalRegistryMappingDecision } from './atom-registry-matcher.js'
import type { MappingDecisionsSeedArtifact, SeedMappingDecision } from './seed-plugin-mapper.js'

export const COMPILED_EFFECT_LAYERS_SCHEMA_VERSION = 'compiled_effect_layers.v1' as const

export const LAYER_COMPILE_ORDER: CapabilityLayerKind[] = [
  'color_transform',
  'texture_grade',
  'layout',
  'mask_reveal',
  'distortion',
  'motion_driver',
  'overlay',
  'audio_driver',
]

const LEGACY_COMPOSITE_PRESETS = new Set<string>([
  'color_portal_spotlight',
  'kinetic_color_ripple',
])

const RUNTIME_COMPOSITE_PRESETS = new Set<string>([
  ...LEGACY_COMPOSITE_PRESETS,
  'cinematic_grade_pack',
  'cinematic_light_sweep',
  'editorial_split_collage',
  'ripple_displacement',
  'mask_slice_transition',
  'audio_reactive_cut_driver',
])

const BINDING_PATH_ALIASES: Record<string, string> = {
  'mask.center_path': 'mask.position_keyframes',
  'ring.center_path': 'mask.position_keyframes',
  'ring.radius_pct_keyframes': 'mask.radius_pct_keyframes',
}

export interface EffectSharedParamRef {
  $shared: string
}

export interface SharedParamEntry {
  source_atom_id: string
  source_path: string
  value: unknown
}

export interface MappingDecisionsLocalInput {
  local_registry_decisions: LocalRegistryMappingDecision[]
}

export interface CompiledSegmentEffectLayers {
  segment_id: string
  effect_layers: RenderEffectLayer[]
  shared_params: Record<string, SharedParamEntry>
  skipped_atom_ids: string[]
}

export interface CompiledEffectLayersArtifact {
  schema_version: typeof COMPILED_EFFECT_LAYERS_SCHEMA_VERSION
  task_id: string
  segments: CompiledSegmentEffectLayers[]
  loss_ledger: LossLedgerEntry[]
}

export interface RoadmapCompilerInput {
  taskId: string
  effectRoadmap: EffectRoadmap
  mappingDecisionsLocal: MappingDecisionsLocalInput
  mappingDecisionsSeed: MappingDecisionsSeedArtifact
  seedAuthoringByAtomId?: Map<string, SeedAuthoringByAtomEntry>
  lossLedger?: LossLedgerEntry[]
}

interface ResolvedAtomMapping {
  atom_id: string
  plugin_id: string
  preset: SceneEffects['preset']
  layerKind: EffectAtom['layerKind']
  source: 'local' | 'seed'
  reason: string
  component_id?: string
  component_props?: Record<string, unknown>
  fallback_preset?: SceneEffects['preset']
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isSharedParamRef(value: unknown): value is EffectSharedParamRef {
  return isRecord(value) && typeof value.$shared === 'string'
}

function layerOrderIndex(layerKind: CapabilityLayerKind): number {
  const index = LAYER_COMPILE_ORDER.indexOf(layerKind)
  return index === -1 ? LAYER_COMPILE_ORDER.length : index
}

function resolveBindingPath(path: string): string {
  return BINDING_PATH_ALIASES[path] ?? path
}

function splitPath(path: string): string[] {
  return path.split('.').flatMap((segment) => {
    const arrayMatch = /^(.+)\[\]$/.exec(segment)
    if (arrayMatch) return [arrayMatch[1]!, '[]']
    return [segment]
  })
}

function getAtPath(root: unknown, path: string): unknown {
  const segments = splitPath(resolveBindingPath(path))
  let current: unknown = root
  for (const segment of segments) {
    if (segment === '[]') {
      if (!Array.isArray(current) || current.length === 0) return undefined
      current = current[0]
      continue
    }
    if (!isRecord(current)) return undefined
    current = current[segment]
  }
  return current
}

function setAtPath(root: Record<string, unknown>, path: string, value: unknown): void {
  const normalized = resolveBindingPath(path)
  const arrayItemMatch = /^(.+)\[\]\.(.+)$/.exec(normalized)
  if (arrayItemMatch) {
    const [, arrayKey, restPath] = arrayItemMatch
    let array = root[arrayKey!]
    if (!Array.isArray(array)) {
      array = []
      root[arrayKey!] = array
    }
    const items = (Array.isArray(array) ? array : []) as unknown[]
    if (items.length === 0) {
      items.push({})
      root[arrayKey!] = items
    }
    const item = items[0]
    if (!isRecord(item)) return
    if (!restPath!.includes('.')) {
      item[restPath!] = value
      return
    }
    setAtPath(item, restPath!, value)
    return
  }

  const segments = normalized.split('.')
  let current: Record<string, unknown> = root

  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index]!
    const isLast = index === segments.length - 1

    if (isLast) {
      current[segment] = value
      return
    }

    const existing = current[segment]
    if (Array.isArray(existing)) {
      return
    }
    if (!isRecord(existing)) {
      current[segment] = {}
    }
    current = current[segment] as Record<string, unknown>
  }
}

function sharedParamKey(segmentId: string, binding: ParamBinding): string {
  const suffix =
    binding.id ??
    `${binding.source_atom_id}:${binding.source}->${binding.target_atom_id}:${binding.target}`
  return `${segmentId}:${suffix}`
}

function buildSharedParams(
  segment: EffectRoadmapSegment,
  atomEffects: Map<string, SceneEffects>,
): Record<string, SharedParamEntry> {
  const shared: Record<string, SharedParamEntry> = {}

  for (const binding of segment.bindings) {
    const sourceEffects = atomEffects.get(binding.source_atom_id)
    if (!sourceEffects) continue

    const sourcePath = resolveBindingPath(binding.source)
    const value = getAtPath(sourceEffects, sourcePath)
    if (value === undefined) continue

    shared[sharedParamKey(segment.segment_id, binding)] = {
      source_atom_id: binding.source_atom_id,
      source_path: binding.source,
      value: structuredClone(value),
    }
  }

  return shared
}

function applyBindingsToLayers(input: {
  segment: EffectRoadmapSegment
  layers: RenderEffectLayer[]
  sharedParams: Record<string, SharedParamEntry>
}): RenderEffectLayer[] {
  const layerByAtom = new Map<string, RenderEffectLayer>()
  for (const layer of input.layers) {
    const atomId = layer.id.split(':').pop()
    if (atomId) layerByAtom.set(atomId, layer)
  }

  for (const binding of input.segment.bindings) {
    const targetLayer = layerByAtom.get(binding.target_atom_id)
    if (!targetLayer) continue

    const key = sharedParamKey(input.segment.segment_id, binding)
    if (!(key in input.sharedParams)) continue

    const effects = structuredClone(targetLayer.effects) as unknown as Record<string, unknown>
    setAtPath(effects, binding.target, { $shared: key })
    targetLayer.effects = effects as unknown as SceneEffects
  }

  return input.layers
}

function applySharedGeometry(
  effects: SceneEffects,
  segment: EffectRoadmapSegment,
): SceneEffects {
  const origin = segment.motif.shared_geometry?.origin
  if (!origin) return effects

  const cloned = structuredClone(effects) as unknown as Record<string, unknown>
  const mask = cloned.mask
  if (isRecord(mask) && Array.isArray(mask.position_keyframes) && mask.position_keyframes.length > 0) {
    mask.position_keyframes = [{ time: 0, x_pct: origin.x_pct, y_pct: origin.y_pct }]
  }

  const orb = cloned.orb
  if (isRecord(orb) && Array.isArray(orb.path_keyframes) && orb.path_keyframes.length > 0) {
    orb.path_keyframes = [{ time: 0, x_pct: origin.x_pct, y_pct: origin.y_pct }]
  }

  return cloned as unknown as SceneEffects
}

function resolveSeedMapping(
  decision: SeedMappingDecision,
  atomLayerKind: CapabilityLayerKind | undefined,
  seedAuthoringByAtomId?: Map<string, SeedAuthoringByAtomEntry>,
): ResolvedAtomMapping | null {
  if (decision.decision !== 'generate_plugin') return null
  const proposal = decision.proposal
  if (!proposal?.plugin_id || !proposal.manifest) return null

  const authored = seedAuthoringByAtomId?.get(decision.atom_id)
  if (authored?.ok && authored.component_id) {
    return {
      atom_id: decision.atom_id,
      plugin_id: authored.component_id,
      preset: 'generated_component',
      layerKind: authored.layerKind,
      source: 'seed',
      reason: authored.reason,
      component_id: authored.component_id,
      component_props: authored.component_props,
      fallback_preset: authored.fallback_preset,
    }
  }

  const manifestRecord = hydrateSeedPluginManifest(
    proposal.manifest as Record<string, unknown>,
    atomLayerKind,
  )
  if (!manifestRecord) return null

  const preset = inferFallbackPresetFromSeedManifest({
    manifest: manifestRecord,
    atomLayerKind,
  })
  if (!preset || !createDefaultEffect(preset)) return null

  registerSeedPluginManifests([manifestRecord])

  const pluginId = resolveSeedCompilePluginId({
    proposalPluginId: proposal.plugin_id,
    preset,
  })

  return {
    atom_id: decision.atom_id,
    plugin_id: pluginId,
    preset,
    layerKind: resolveSeedManifestLayerKind(manifestRecord, atomLayerKind),
    source: 'seed',
    reason: `Seed proposal ${proposal.plugin_id} compiled via ${preset}${pluginId !== proposal.plugin_id ? ` (registry ${pluginId})` : ''}.`,
  }
}

function resolveLocalMapping(decision: LocalRegistryMappingDecision): ResolvedAtomMapping | null {
  if (decision.decision === 'missing' || !decision.plugin_id || !decision.preset) {
    return null
  }
  return {
    atom_id: decision.atom_id,
    plugin_id: decision.plugin_id,
    preset: decision.preset as SceneEffects['preset'],
    layerKind: decision.layerKind,
    source: 'local',
    reason: decision.reason,
  }
}

function resolveAtomMappings(input: RoadmapCompilerInput): Map<string, ResolvedAtomMapping> {
  const resolved = new Map<string, ResolvedAtomMapping>()
  const atomById = new Map<string, EffectAtom>()
  for (const segment of input.effectRoadmap.segments) {
    for (const atom of segment.atoms) {
      atomById.set(atom.id, atom)
    }
  }

  for (const decision of input.mappingDecisionsLocal.local_registry_decisions) {
    const mapping = resolveLocalMapping(decision)
    if (mapping) resolved.set(mapping.atom_id, mapping)
  }

  for (const decision of input.mappingDecisionsSeed.decisions) {
    if (resolved.has(decision.atom_id)) continue
    const mapping = resolveSeedMapping(
      decision,
      atomById.get(decision.atom_id)?.layerKind,
      input.seedAuthoringByAtomId,
    )
    if (mapping) resolved.set(mapping.atom_id, mapping)
  }

  return resolved
}

function isForbiddenRectangleCollageFallback(
  segment: EffectRoadmapSegment,
  mapping: ResolvedAtomMapping,
): boolean {
  if (segment.motif.must_match['geometry.cell_shape'] !== 'triangle') return false
  return (
    mapping.plugin_id === 'split_collage_layout' ||
    mapping.preset === 'editorial_split_collage'
  )
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

function buildAtomLayerDraft(input: {
  segment: EffectRoadmapSegment
  atom: EffectAtom
  mapping: ResolvedAtomMapping
}): RenderEffectLayer[] {
  if (input.mapping.preset === 'generated_component' && input.mapping.component_id) {
    const effects: GeneratedComponentEffects = {
      preset: 'generated_component',
      component_id: input.mapping.component_id,
      props: {
        ...(input.mapping.component_props ?? {}),
        atom_id: input.atom.id,
        segment_id: input.segment.segment_id,
      },
      fallback_preset: input.mapping.fallback_preset,
    }
    return [
      {
        id: `effect_${input.segment.segment_id}:${input.atom.id}`,
        layerKind: input.mapping.layerKind,
        kind: input.mapping.layerKind,
        plugin_id: input.mapping.component_id,
        preset: 'generated_component',
        effects,
        source: 'scene_recipe',
        is_primary: false,
        resolution: 'compiled',
        reason: `Compiled ${input.atom.id} via ${input.mapping.source} mapping (${input.mapping.reason}).`,
      },
    ]
  }

  const defaultEffect = createDefaultEffect(input.mapping.preset)
  if (!defaultEffect) return []

  const manifest = getRenderPluginManifest(input.mapping.plugin_id)
  const effects = applySharedGeometry(
    mergeRecords(defaultEffect as unknown as Record<string, unknown>, manifest?.defaultParams) as unknown as SceneEffects,
    input.segment,
  )
  const baseLayer: RenderEffectLayer = {
    id: `effect_${input.segment.segment_id}:${input.atom.id}`,
    layerKind: input.mapping.layerKind,
    kind: input.mapping.layerKind,
    plugin_id: input.mapping.plugin_id,
    preset: effects.preset,
    effects,
    source: 'scene_recipe',
    is_primary: false,
    resolution: 'compiled',
    reason: `Compiled ${input.atom.id} via ${input.mapping.source} mapping (${input.mapping.reason}).`,
  }

  if (LEGACY_COMPOSITE_PRESETS.has(input.mapping.preset)) {
    return splitEffectLayer({
      ...baseLayer,
      reason: `Legacy adapter for ${input.mapping.preset}; split to primitives.`,
    })
  }

  if (manifest?.atomicity === 'composite_legacy') {
    return splitEffectLayer(baseLayer)
  }

  return [baseLayer]
}

function sortCompiledLayers(layers: RenderEffectLayer[]): RenderEffectLayer[] {
  return [...layers].sort(
    (left, right) => layerOrderIndex(left.layerKind) - layerOrderIndex(right.layerKind),
  )
}

function assertPrimitiveOnlyLayers(layers: RenderEffectLayer[]): RenderEffectLayer[] {
  return layers.map((layer) => {
    if (RUNTIME_COMPOSITE_PRESETS.has(layer.preset)) {
      return splitEffectLayer(layer)
    }
    return [layer]
  }).flat()
}

function compileSegment(input: {
  segment: EffectRoadmapSegment
  atomMappings: Map<string, ResolvedAtomMapping>
  lossLedger: LossLedgerEntry[]
  taskId: string
}): CompiledSegmentEffectLayers {
  const skippedAtomIds: string[] = []
  const draftLayers: RenderEffectLayer[] = []
  const atomEffects = new Map<string, SceneEffects>()

  for (const atom of input.segment.atoms) {
    const mapping = input.atomMappings.get(atom.id)
    if (!mapping) {
      skippedAtomIds.push(atom.id)
      input.lossLedger.push({
        id: `compile_missing_${input.segment.segment_id}_${atom.id}`,
        source_stage: 'roadmap_compile',
        reason: `Atom ${atom.id} (${input.segment.motif.family}) has no available plugin mapping; segment layer omitted.`,
        evidence_refs: input.segment.motif.evidence_refs,
        fallback_used: null,
        severity: 'high',
      })
      continue
    }

    if (isForbiddenRectangleCollageFallback(input.segment, mapping)) {
      skippedAtomIds.push(atom.id)
      input.lossLedger.push({
        id: `compile_forbidden_fallback_${input.segment.segment_id}_${atom.id}`,
        source_stage: 'roadmap_compile',
        reason:
          'Triangle collage requested but only rectangle collage plugins are available; refusing rectangle fallback.',
        evidence_refs: input.segment.motif.evidence_refs,
        fallback_used: mapping.plugin_id,
        severity: 'high',
      })
      continue
    }

    const layers = buildAtomLayerDraft({
      segment: input.segment,
      atom,
      mapping,
    })

    if (layers.length === 0) {
      skippedAtomIds.push(atom.id)
      input.lossLedger.push({
        id: `compile_empty_${input.segment.segment_id}_${atom.id}`,
        source_stage: 'roadmap_compile',
        reason: `Atom ${atom.id} mapping ${mapping.plugin_id} did not produce primitive layers.`,
        evidence_refs: input.segment.motif.evidence_refs,
        fallback_used: null,
        severity: 'medium',
      })
      continue
    }

    draftLayers.push(...layers)
    atomEffects.set(atom.id, layers[0]!.effects)
  }

  const sharedParams = buildSharedParams(input.segment, atomEffects)
  const boundLayers = applyBindingsToLayers({
    segment: input.segment,
    layers: draftLayers,
    sharedParams,
  })

  const effectLayers = sortCompiledLayers(assertPrimitiveOnlyLayers(boundLayers))

  return {
    segment_id: input.segment.segment_id,
    effect_layers: effectLayers,
    shared_params: sharedParams,
    skipped_atom_ids: skippedAtomIds,
  }
}

export function compileEffectRoadmap(input: RoadmapCompilerInput): CompiledEffectLayersArtifact {
  const atomMappings = resolveAtomMappings(input)
  const lossLedger = [...(input.lossLedger ?? []), ...(input.effectRoadmap.loss_ledger ?? [])]

  const segments = input.effectRoadmap.segments.map((segment) =>
    compileSegment({
      segment,
      atomMappings,
      lossLedger,
      taskId: input.taskId,
    }),
  )

  return {
    schema_version: COMPILED_EFFECT_LAYERS_SCHEMA_VERSION,
    task_id: input.taskId,
    segments,
    loss_ledger: lossLedger,
  }
}

export function buildRenderPlanEffectLayersPatch(
  compiled: CompiledEffectLayersArtifact,
): Record<string, RenderEffectLayer[]> {
  return Object.fromEntries(
    compiled.segments.map((segment) => [segment.segment_id, segment.effect_layers]),
  )
}

function primaryEffectPriority(layerKind: CapabilityLayerKind): number {
  const scores: Record<CapabilityLayerKind, number> = {
    composite: 100,
    motion_driver: 92,
    mask_reveal: 86,
    distortion: 82,
    layout: 76,
    color_transform: 42,
    texture_grade: 30,
    color_grade: 30,
    audio_driver: 24,
    overlay: 0,
  }
  return scores[layerKind] ?? 0
}

function markPrimaryLayer(layers: RenderEffectLayer[]): RenderEffectLayer[] {
  if (layers.length === 0) return layers
  const primaryIndex =
    layers
      .map((layer, index) => ({ index, score: primaryEffectPriority(layer.layerKind) }))
      .sort((left, right) => right.score - left.score)[0]?.index ?? 0

  return layers.map((layer, index) => ({
    ...layer,
    is_primary: index === primaryIndex,
    reason:
      index === primaryIndex
        ? `${layer.reason ?? ''} Selected as roadmap-compiled primary effect.`.trim()
        : layer.reason,
  }))
}

export function buildSceneEffectBinding(input: {
  compiledSegment?: CompiledSegmentEffectLayers
  roadmapSegment?: EffectRoadmapSegment
  beatTimes?: number[]
}): RenderSceneEffectBinding | undefined {
  const sharedParams = input.compiledSegment?.shared_params
  const hasSharedParams = sharedParams && Object.keys(sharedParams).length > 0
  const sharedTimeline = input.roadmapSegment?.motif.shared_timeline
  const sharedGeometry = input.roadmapSegment?.motif.shared_geometry
  const beatTimes = input.beatTimes?.length ? input.beatTimes : undefined

  if (!hasSharedParams && !sharedTimeline && !sharedGeometry && !beatTimes) {
    return undefined
  }

  return {
    ...(hasSharedParams ? { sharedParams } : {}),
    ...(sharedTimeline ? { sharedTimeline } : {}),
    ...(sharedGeometry ? { sharedGeometry } : {}),
    ...(beatTimes ? { beatTimes } : {}),
  }
}

function beatTimesForSegment(
  segmentId: string,
  roadmap?: EffectRoadmap | null,
  renderRecipe?: RenderRecipeExtension | null,
): number[] | undefined {
  const segment = roadmap?.segments.find((item) => item.segment_id === segmentId)
  const start = segment?.start_sec
  const end = segment?.end_sec
  const driver = renderRecipe?.audio_driver
  if (!driver) return undefined

  const candidates = [
    ...(driver.strong_beats ?? []),
    ...driver.beat_times,
    ...(driver.energy_peaks ?? []).map((peak) => peak.time),
  ]
  const unique = [...new Set(candidates)]
  if (start === undefined || end === undefined) return unique.length ? unique : undefined
  const inRange = unique.filter((time) => time >= start && time <= end)
  return inRange.length ? inRange : unique.length ? unique : undefined
}

export function applyCompiledEffectLayersToRenderPlan(input: {
  plan: RenderPlanV1
  compiled: CompiledEffectLayersArtifact
  effectRoadmap?: EffectRoadmap | null
  renderRecipe?: RenderRecipeExtension | null
}): RenderPlanV1 {
  const patchBySegment = buildRenderPlanEffectLayersPatch(input.compiled)
  const updatedScenes = input.plan.scenes.map((scene) => {
    const segmentId = scene.source_anchor_id
    const compiledSegment = input.compiled.segments.find(
      (segment) => segment.segment_id === segmentId || segment.segment_id === scene.id,
    )
    const compiledLayers =
      patchBySegment[segmentId] ?? patchBySegment[scene.id]
    const roadmapSegment = input.effectRoadmap?.segments.find(
      (segment) => segment.segment_id === segmentId || segment.segment_id === scene.id,
    )
    const effect_binding =
      buildSceneEffectBinding({
        compiledSegment,
        roadmapSegment,
        beatTimes: beatTimesForSegment(segmentId, input.effectRoadmap, input.renderRecipe),
      }) ?? scene.effect_binding

    if (!compiledLayers?.length) {
      return effect_binding ? { ...scene, effect_binding } : scene
    }

    const preservedLayers = (scene.effect_layers ?? []).filter(
      (layer) => layer.source !== 'scene_recipe',
    )
    const nextLayers = markPrimaryLayer([
      ...compiledLayers.map((layer) => ({
        ...layer,
        id: `${scene.id}_${layer.id}`,
        reason: `${layer.reason ?? ''} Applied from EffectRoadmap compiler.`.trim(),
      })),
      ...preservedLayers,
    ])
    const primary = nextLayers.find((layer) => layer.is_primary)

    return {
      ...scene,
      effects: primary?.effects,
      effect_layers: nextLayers,
      ...(effect_binding ? { effect_binding } : {}),
    }
  })

  return {
    ...input.plan,
    scenes: updatedScenes,
    component_resolution: {
      enabled: input.plan.component_resolution?.enabled ?? true,
      authoring_enabled: input.plan.component_resolution?.authoring_enabled ?? false,
      decisions: [
        ...(input.plan.component_resolution?.decisions ?? []),
        ...input.compiled.segments
          .filter((segment) => segment.effect_layers.length > 0)
          .map((segment) => ({
            capability_id: 'effect_roadmap_compiler',
            segment_ids: [segment.segment_id],
            decision: 'reuse' as const,
            reason: `Applied ${segment.effect_layers.length} roadmap-compiled primitive effect layers.`,
          })),
      ],
      ...(input.plan.component_resolution?.debug_dir
        ? { debug_dir: input.plan.component_resolution.debug_dir }
        : {}),
    },
  }
}

export function layersShareBinding(
  sharedParams: Record<string, SharedParamEntry>,
  leftAtomId: string,
  rightAtomId: string,
): boolean {
  const entries = Object.values(sharedParams)
  const leftSources = entries.filter((entry) => entry.source_atom_id === leftAtomId)
  return leftSources.some((entry) =>
    entries.some(
      (candidate) =>
        candidate.source_atom_id === rightAtomId &&
        JSON.stringify(candidate.value) === JSON.stringify(entry.value),
    ),
  )
}

export function layerHasSharedBinding(
  layer: RenderEffectLayer,
  sharedKey: string,
): boolean {
  const serialized = JSON.stringify(layer.effects)
  return serialized.includes(`"$shared":"${sharedKey}"`) || serialized.includes(`"$shared": "${sharedKey}"`)
}

export { isSharedParamRef }
