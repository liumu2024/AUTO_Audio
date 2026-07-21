import { existsSync } from 'node:fs'
import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'

import {
  getRenderPluginManifest,
  isKnownFallbackPreset,
  pluginIdForPreset,
  RENDER_PLUGIN_MANIFESTS,
  resolvePluginManifest,
} from '../../../../shared/lib/render-plugin-manifest.js'
import type {
  CapabilityLayerKind,
  CapabilityPluginBoundary,
  CapabilityPluginManifest,
} from '../../../../shared/types/capability-registry.v1.js'
import type {
  RenderAssetType,
  SceneEffects,
} from '../../../../shared/types/render-plan.v1.js'

export interface GeneratedComponentManifest {
  id: string
  label?: string
  status?: 'draft' | 'verified' | 'failed'
  description?: string
  capabilities?: string[]
  visual_grammar?: string[]
  supported_asset_types?: RenderAssetType[]
  props_contract?: Record<string, unknown>
  fallback_preset?: string
  target_layer?: 'effect' | 'overlay'
  layer_kind?: CapabilityLayerKind
  validation_summary?: ComponentValidationSummary
}

export interface ComponentValidationSummary {
  typecheck_ok?: boolean
  sample_render_ok?: boolean
  effect_validation_ok?: boolean
  layer_kind?: CapabilityLayerKind
  last_validated_at?: string
  last_task_id?: string
  failed_criteria?: string[]
  metrics?: Record<string, number | boolean>
}

export type ComponentKnowledgeSource = 'builtin_plugin' | 'generated_component'
export type ComponentKnowledgeStatus =
  | 'draft'
  | 'typechecked'
  | 'sample_validated'
  | 'integration_validated'
  | 'verified'
  | 'experimental'
  | 'failed'
  | 'blocked'
  | 'deprecated'

export interface ComponentKnowledgeItem {
  id: string
  source: ComponentKnowledgeSource
  label: string
  status: ComponentKnowledgeStatus
  targetLayer: 'effect' | 'overlay'
  layerKind: CapabilityLayerKind
  family?: string
  description?: string
  capabilities: string[]
  visualGrammar: string[]
  acceptedAssetTypes: RenderAssetType[]
  requiredParams: string[]
  defaultParams: Record<string, unknown>
  propsContract: Record<string, unknown>
  fallbackPreset?: SceneEffects['preset']
  boundary?: CapabilityPluginBoundary
  negativeKeywords: string[]
  sourcePath?: string
  manifestPath?: string
  componentSourcePath?: string
  validationSummary?: ComponentValidationSummary
}

export interface ComponentKnowledgeBase {
  schema_version: 'component_knowledge.v1'
  generated_at: string
  item_count: number
  items: ComponentKnowledgeItem[]
}

export interface GroundingMatchedPluginHint {
  plugin_id?: string
  preset?: string
  segment_ids?: string[]
  reason?: string
}

export interface ComponentRetrievalCandidate {
  item_id: string
  source: ComponentKnowledgeSource
  status: ComponentKnowledgeStatus
  decision: 'reuse' | 'adapt' | 'fallback'
  score: number
  targetLayer: 'effect' | 'overlay'
  layerKind: CapabilityLayerKind
  preset?: SceneEffects['preset']
  component_id?: string
  fallback_preset?: SceneEffects['preset']
  matched_by: string[]
  reason: string
}

export interface ComponentRetrievalRejectedCandidate {
  item_id: string
  source: ComponentKnowledgeSource
  layerKind: CapabilityLayerKind
  reasons: string[]
}

export interface ComponentRetrievalResult {
  schema_version: 'component_retrieval.v1'
  query: {
    capability_text: string
    target_layer_kind: CapabilityLayerKind
    segment_ids: string[]
  }
  thresholds: {
    manifest_reuse: number
    manifest_adapt: number
    preset_reuse: number
    preset_adapt: number
  }
  summary: {
    total_items: number
    viable_candidates: number
    rejected_candidates: number
    best_score: number
    selected_strategy: 'generated_reuse' | 'generated_adapt' | 'preset_reuse' | 'fallback'
  }
  generatedReuse?: ComponentRetrievalCandidate
  generatedAdapt?: ComponentRetrievalCandidate
  presetReuse?: ComponentRetrievalCandidate
  presetAdapt?: ComponentRetrievalCandidate
  fallback: ComponentRetrievalCandidate
  top_candidates: ComponentRetrievalCandidate[]
  rejected_candidates: ComponentRetrievalRejectedCandidate[]
}

export interface ComponentGapReport {
  schema_version: 'component_gap_report.v1'
  capability_id: string
  need_summary: string
  target_layer_kind: CapabilityLayerKind
  decision: 'reuse' | 'adapt' | 'generate' | 'fallback'
  retrieved_candidates: ComponentRetrievalCandidate[]
  reuse_rejection: string[]
  composition_rejection: string[]
  gap_type:
    | 'none'
    | 'visual_capability'
    | 'parameter_range'
    | 'timing_behavior'
    | 'asset_support'
    | 'unknown'
  new_component_scope: string[]
  out_of_scope: string[]
  validation_contract: {
    layerKind: CapabilityLayerKind
    sample_render: 'required'
    metrics: string[]
    acceptance_criteria: string[]
  }
  reasons: string[]
}

export const MANIFEST_REUSE_SCORE = 0.82
export const MANIFEST_ADAPT_SCORE = 0.72
export const PRESET_REUSE_SCORE = 0.78
export const PRESET_ADAPT_SCORE = 0.62
export const BUILTIN_FALLBACK_PRESET = 'primitive_ripple_displacement'

const LAYER_FALLBACK_PRESET: Record<CapabilityLayerKind, SceneEffects['preset']> = {
  motion_driver: 'primitive_orb_motion',
  mask_reveal: 'primitive_mask_reveal',
  distortion: 'primitive_ripple_displacement',
  color_transform: 'primitive_color_transform',
  texture_grade: 'primitive_texture_grade',
  color_grade: 'primitive_texture_grade',
  layout: 'primitive_collage_layout',
  overlay: 'primitive_vignette_overlay',
  audio_driver: 'primitive_beat_pulse',
  composite: BUILTIN_FALLBACK_PRESET,
}

export function fallbackPresetForLayer(layerKind: CapabilityLayerKind): SceneEffects['preset'] {
  return LAYER_FALLBACK_PRESET[layerKind]
}

interface GeneratedComponentEntry {
  manifest: GeneratedComponentManifest
  directoryName: string
  directoryPath: string
  manifestPath: string
  componentSourcePath: string
}

function generatedComponentsDir(remotionRoot: string): string {
  return path.join(remotionRoot, 'src', 'generated-components')
}

function resolveComponentSourcePath(componentDir: string, directoryName: string): string | undefined {
  const canonical = path.join(componentDir, 'component.tsx')
  if (existsSync(canonical)) return canonical
  const legacy = path.join(componentDir, `${directoryName}.tsx`)
  if (existsSync(legacy)) return legacy
  return undefined
}

export function normalizeLayerKind(value: unknown): CapabilityLayerKind | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim().toLowerCase()
  const aliases: Record<string, CapabilityLayerKind> = {
    motion: 'motion_driver',
    motion_driver: 'motion_driver',
    object_motion: 'motion_driver',
    orb_motion: 'motion_driver',
    reveal: 'mask_reveal',
    mask: 'mask_reveal',
    mask_reveal: 'mask_reveal',
    color_reveal: 'mask_reveal',
    transition: 'mask_reveal',
    distortion: 'distortion',
    ripple: 'distortion',
    water_ripple: 'distortion',
    wave: 'distortion',
    color: 'color_transform',
    color_transform: 'color_transform',
    texture: 'texture_grade',
    texture_grade: 'texture_grade',
    grade: 'texture_grade',
    color_grade: 'color_grade',
    layout: 'layout',
    collage: 'layout',
    split: 'layout',
    overlay: 'overlay',
    text: 'overlay',
    subtitle: 'overlay',
    audio: 'audio_driver',
    beat: 'audio_driver',
    audio_driver: 'audio_driver',
    composite: 'composite',
  }
  return aliases[normalized]
}

export function sameLayerOrComposite(
  manifestLayer: CapabilityLayerKind | undefined,
  targetLayer: CapabilityLayerKind,
): boolean {
  if (!manifestLayer) return targetLayer === 'composite'
  if (manifestLayer === targetLayer) return true
  return manifestLayer === 'composite' || targetLayer === 'composite'
}

export function manifestLayerKind(manifest: GeneratedComponentManifest): CapabilityLayerKind | undefined {
  return (
    manifest.layer_kind ??
    normalizeLayerKind((manifest as { layerKind?: unknown }).layerKind) ??
    normalizeLayerKind(manifest.target_layer) ??
    normalizeLayerKind((manifest as { targetLayer?: unknown }).targetLayer)
  )
}

function stringFromUnknown(value: unknown): string | null {
  if (typeof value === 'string') return value
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const recordValue = value as Record<string, unknown>
  const description = recordValue.description
  if (typeof description === 'string' && description.trim()) return description
  const id = recordValue.id
  if (typeof id === 'string' && id.trim()) return id
  return null
}

export function componentStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .map(stringFromUnknown)
    .filter((item): item is string => Boolean(item))
}

export function normalizeGeneratedComponentManifest(
  value: GeneratedComponentManifest,
): GeneratedComponentManifest {
  return {
    ...value,
    capabilities: componentStringArray(value.capabilities),
    visual_grammar: componentStringArray(value.visual_grammar),
  }
}

function stringArray(value: unknown): string[] {
  return componentStringArray(value)
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

function renderAssetTypes(value: unknown): RenderAssetType[] {
  return stringArray(value).filter((item): item is RenderAssetType =>
    ['image', 'video', 'generated_video', 'audio'].includes(item),
  )
}

function normalizeGeneratedStatus(status: GeneratedComponentManifest['status']): ComponentKnowledgeStatus {
  if (status === 'draft' || status === 'failed' || status === 'verified') return status
  return 'draft'
}

function builtinManifestToGeneratedManifest(manifest: CapabilityPluginManifest): GeneratedComponentManifest {
  return {
    id: manifest.id,
    label: manifest.label,
    status: 'verified',
    description: manifest.description,
    capabilities: manifest.capabilities,
    visual_grammar: [
      manifest.family,
      manifest.layerKind,
      ...(manifest.boundary?.cannotSupport ?? []),
      ...Object.entries(manifest.boundary?.supports ?? {}).map(
        ([key, value]) => `${key}:${JSON.stringify(value)}`,
      ),
    ].filter((item): item is string => Boolean(item)),
    supported_asset_types: manifest.acceptedAssetTypes.filter(
      (item): item is RenderAssetType => item !== 'text',
    ),
    props_contract: {
      requiredParams: manifest.requiredParams,
      defaultParams: manifest.defaultParams,
      boundary: manifest.boundary,
    },
    fallback_preset: manifest.fallbackPreset,
    target_layer: manifest.targetLayer,
    layer_kind: manifest.layerKind,
  }
}

function builtinManifestToKnowledgeItem(manifest: CapabilityPluginManifest): ComponentKnowledgeItem {
  return {
    id: manifest.id,
    source: 'builtin_plugin',
    label: manifest.label,
    status: manifest.status === 'experimental' ? 'experimental' : 'verified',
    targetLayer: manifest.targetLayer,
    layerKind: manifest.layerKind,
    family: manifest.family,
    description: manifest.description,
    capabilities: manifest.capabilities,
    visualGrammar: [
      manifest.family,
      manifest.layerKind,
      ...(manifest.boundary?.cannotSupport ?? []),
      ...Object.entries(manifest.boundary?.supports ?? {}).map(
        ([key, value]) => `${key}:${JSON.stringify(value)}`,
      ),
    ].filter((item): item is string => Boolean(item)),
    acceptedAssetTypes: manifest.acceptedAssetTypes.filter(
      (item): item is RenderAssetType => item !== 'text',
    ),
    requiredParams: manifest.requiredParams,
    defaultParams: manifest.defaultParams,
    propsContract: {
      requiredParams: manifest.requiredParams,
      defaultParams: manifest.defaultParams,
      boundary: manifest.boundary,
    },
    fallbackPreset: isKnownFallbackPreset(manifest.fallbackPreset)
      ? manifest.fallbackPreset
      : undefined,
    boundary: manifest.boundary,
    negativeKeywords: manifest.negativeKeywords ?? [],
  }
}

function generatedEntryToKnowledgeItem(entry: GeneratedComponentEntry): ComponentKnowledgeItem {
  const manifest = entry.manifest
  const propsContract = record(manifest.props_contract)
  const boundary = record(propsContract.boundary) as CapabilityPluginBoundary
  const layerKind =
    manifestLayerKind(manifest) ??
    normalizeLayerKind(propsContract.layer_kind) ??
    normalizeLayerKind(propsContract.target_layer) ??
    'composite'
  const fallbackPreset = isKnownFallbackPreset(manifest.fallback_preset)
    ? manifest.fallback_preset
    : undefined

  return {
    id: manifest.id,
    source: 'generated_component',
    label: manifest.label ?? manifest.id,
    status: normalizeGeneratedStatus(manifest.status),
    targetLayer: manifest.target_layer ?? 'effect',
    layerKind,
    description: manifest.description,
    capabilities: manifest.capabilities ?? [],
    visualGrammar: manifest.visual_grammar ?? [],
    acceptedAssetTypes: renderAssetTypes(manifest.supported_asset_types),
    requiredParams: stringArray(propsContract.requiredParams ?? propsContract.required_params),
    defaultParams: record(propsContract.defaultParams ?? propsContract.default_params),
    propsContract,
    fallbackPreset,
    boundary,
    negativeKeywords: stringArray(
      (manifest as { negativeKeywords?: unknown; negative_keywords?: unknown }).negativeKeywords ??
        (manifest as { negativeKeywords?: unknown; negative_keywords?: unknown }).negative_keywords,
    ),
    sourcePath: entry.directoryPath,
    manifestPath: entry.manifestPath,
    componentSourcePath: entry.componentSourcePath,
    validationSummary: manifest.validation_summary,
  }
}

async function readGeneratedComponentEntries(remotionRoot: string): Promise<GeneratedComponentEntry[]> {
  const dir = generatedComponentsDir(remotionRoot)
  if (!existsSync(dir)) return []

  const entries = await readdir(dir, { withFileTypes: true })
  const manifests: GeneratedComponentEntry[] = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const directoryPath = path.join(dir, entry.name)
    const manifestPath = path.join(directoryPath, 'manifest.json')
    if (!existsSync(manifestPath)) continue
    const componentSourcePath = resolveComponentSourcePath(directoryPath, entry.name)
    if (!componentSourcePath) continue
    try {
      const raw = await readFile(manifestPath, 'utf8')
      const manifest = normalizeGeneratedComponentManifest(
        JSON.parse(raw) as GeneratedComponentManifest,
      )
      if (manifest.id) {
        manifests.push({
          manifest,
          directoryName: entry.name,
          directoryPath,
          manifestPath,
          componentSourcePath,
        })
      }
    } catch {
      // Ignore malformed generated component manifests; validation keeps them unregistered.
    }
  }
  return manifests
}

export function readBuiltinComponentManifests(): GeneratedComponentManifest[] {
  return RENDER_PLUGIN_MANIFESTS.map((manifest) => builtinManifestToGeneratedManifest(manifest))
}

export async function readGeneratedComponentManifests(
  remotionRoot: string,
): Promise<GeneratedComponentManifest[]> {
  return (await readGeneratedComponentEntries(remotionRoot)).map((entry) => entry.manifest)
}

export async function buildComponentKnowledgeBase(input: {
  remotionRoot: string
}): Promise<ComponentKnowledgeBase> {
  const generatedEntries = await readGeneratedComponentEntries(input.remotionRoot)
  const items = [
    ...RENDER_PLUGIN_MANIFESTS.map((manifest) => builtinManifestToKnowledgeItem(manifest)),
    ...generatedEntries.map((entry) => generatedEntryToKnowledgeItem(entry)),
  ]
  return {
    schema_version: 'component_knowledge.v1',
    generated_at: new Date().toISOString(),
    item_count: items.length,
    items,
  }
}

function tokenize(value: string): Set<string> {
  return new Set(
    value
      .toLowerCase()
      .replace(/[^a-z0-9_\u4e00-\u9fa5]+/g, ' ')
      .split(/\s+/)
      .filter((item) => item.length >= 2),
  )
}

export function scoreText(query: string, candidate: string): number {
  const queryTokens = tokenize(query)
  if (!queryTokens.size) return 0
  const candidateText = candidate.toLowerCase()
  let score = 0
  for (const token of queryTokens) {
    if (candidateText.includes(token)) score += 1
  }
  return score / queryTokens.size
}

function normalizedText(value: unknown): string {
  if (typeof value === 'string') return value.toLowerCase().replace(/[_-]+/g, ' ')
  if (value == null) return ''
  return String(value).toLowerCase().replace(/[_-]+/g, ' ')
}

function itemHasRoutingConflict(input: {
  capabilityText: string
  item: ComponentKnowledgeItem
  targetLayer: CapabilityLayerKind
}): boolean {
  const item = input.item
  if (item.boundary?.forbiddenLayers?.includes(input.targetLayer)) return true

  const text = normalizedText(input.capabilityText)
  if (item.negativeKeywords.some((keyword) => text.includes(normalizedText(keyword)))) {
    return true
  }

  const conflictHints: Record<string, string[]> = {
    'geometry.primitive_sides=3': ['triangle', 'triangular', '三角'],
    'geometry.primitive=triangle': ['triangle', 'triangular', '三角'],
    'geometry.primitive=circle': ['circle collage', 'circular panel', '圆形拼贴'],
    'geometry.arrangement.type=radial': ['radial', '放射', '径向'],
    'geometry.arrangement.type=polygon_mosaic': ['polygon mosaic', '多边形拼贴'],
    'geometry.layout=collage': ['collage', 'split screen', '拼贴', '分屏'],
    'geometry.mask_shape=circle': ['circle', 'circular', 'portal', '圆形', '圆环'],
    'style.color_transform=grayscale_to_color': [
      'grayscale to color',
      'gray to color',
      'black white',
      'black-and-white',
      '黑白',
      '灰度',
      '转彩',
    ],
    'motion.object=orb': ['orb', 'ball', 'sphere', '光球', '小球'],
    'distortion.family=water_ripple': ['water ripple', 'ripple', '水波', '波纹', '涟漪'],
  }

  return (item.boundary?.cannotSupport ?? []).some((constraint) =>
    (conflictHints[constraint] ?? [constraint]).some((hint) =>
      text.includes(normalizedText(hint)),
    ),
  )
}

function candidateText(item: ComponentKnowledgeItem): string {
  return [
    item.id,
    item.label,
    item.description,
    item.family,
    item.layerKind,
    ...item.capabilities,
    ...item.visualGrammar,
    ...item.requiredParams,
    JSON.stringify(item.defaultParams),
    JSON.stringify(item.propsContract),
  ]
    .filter(Boolean)
    .join(' ')
}

function groundingHintForItem(input: {
  item: ComponentKnowledgeItem
  segmentIds: string[]
  matchedPlugins: GroundingMatchedPluginHint[]
}): GroundingMatchedPluginHint | undefined {
  for (const plugin of input.matchedPlugins) {
    const overlaps =
      !input.segmentIds.length ||
      !plugin.segment_ids?.length ||
      plugin.segment_ids.some((segmentId) => input.segmentIds.includes(segmentId))
    if (!overlaps) continue

    const manifest = resolvePluginManifest({
      plugin_id: plugin.plugin_id,
      preset: plugin.preset,
    })
    const pluginId = manifest?.id ?? plugin.plugin_id
    const preset = manifest?.fallbackPreset ?? plugin.preset
    if (pluginId === input.item.id || preset === input.item.fallbackPreset) return plugin
  }
  return undefined
}

function scoreKnowledgeCandidate(input: {
  item: ComponentKnowledgeItem
  capabilityText: string
  groundingHint?: GroundingMatchedPluginHint
}): { score: number; matchedBy: string[] } {
  let score = scoreText(input.capabilityText, candidateText(input.item))
  const matchedBy: string[] = []
  const normalizedCapability = normalizedText(input.capabilityText)
  if (normalizedCapability.includes(normalizedText(input.item.id))) {
    score += 0.2
    matchedBy.push('id')
  }
  if (input.item.capabilities.some((capability) => normalizedCapability.includes(normalizedText(capability)))) {
    score += 0.12
    matchedBy.push('capability_phrase')
  }
  if (input.groundingHint) {
    score += 0.12
    matchedBy.push('director_grounding')
  }
  if (input.item.source === 'generated_component') {
    const summary = input.item.validationSummary
    if (summary?.typecheck_ok && summary.sample_render_ok && summary.effect_validation_ok) {
      score += 0.08
      matchedBy.push('validation_history')
    } else if (summary?.effect_validation_ok === false) {
      score -= 0.16
      matchedBy.push('effect_validation_failed')
    } else if (!summary) {
      score -= 0.04
      matchedBy.push('missing_validation_history')
    }
  }
  return {
    score: Math.max(0, Math.min(1, Number(score.toFixed(4)))),
    matchedBy,
  }
}

function candidateDecision(input: {
  item: ComponentKnowledgeItem
  score: number
}): 'reuse' | 'adapt' | 'fallback' {
  if (input.item.source === 'generated_component') {
    if (input.score >= MANIFEST_REUSE_SCORE) return 'reuse'
    if (input.score >= MANIFEST_ADAPT_SCORE) return 'adapt'
    return 'fallback'
  }
  if (input.score >= PRESET_REUSE_SCORE) return 'reuse'
  if (input.score >= PRESET_ADAPT_SCORE) return 'adapt'
  return 'fallback'
}

function toCandidate(input: {
  item: ComponentKnowledgeItem
  decision: 'reuse' | 'adapt' | 'fallback'
  score: number
  matchedBy: string[]
  reason: string
}): ComponentRetrievalCandidate {
  return {
    item_id: input.item.id,
    source: input.item.source,
    status: input.item.status,
    decision: input.decision,
    score: input.score,
    targetLayer: input.item.targetLayer,
    layerKind: input.item.layerKind,
    ...(input.item.fallbackPreset ? { preset: input.item.fallbackPreset } : {}),
    ...(input.item.source === 'generated_component' ? { component_id: input.item.id } : {}),
    ...(input.item.fallbackPreset ? { fallback_preset: input.item.fallbackPreset } : {}),
    matched_by: input.matchedBy,
    reason: input.reason,
  }
}

function defaultFallbackCandidate(targetLayer: CapabilityLayerKind): ComponentRetrievalCandidate {
  const fallbackPreset = LAYER_FALLBACK_PRESET[targetLayer]
  const manifest = getRenderPluginManifest(pluginIdForPreset(fallbackPreset))
  return {
    item_id: manifest?.id ?? fallbackPreset,
    source: 'builtin_plugin',
    status: manifest?.status === 'experimental' ? 'experimental' : 'verified',
    decision: 'fallback',
    score: 0,
    targetLayer: manifest?.targetLayer ?? 'effect',
    layerKind: manifest?.layerKind ?? targetLayer,
    preset: fallbackPreset,
    fallback_preset: fallbackPreset,
    matched_by: ['layer_default'],
    reason: `No reliable same-layer component match; use layer default ${fallbackPreset}.`,
  }
}

export function retrieveComponentCapabilities(input: {
  capabilityText: string
  targetLayer: CapabilityLayerKind
  segmentIds: string[]
  knowledgeBase: ComponentKnowledgeBase
  matchedPlugins?: GroundingMatchedPluginHint[]
  topK?: number
}): ComponentRetrievalResult {
  const matchedPlugins = input.matchedPlugins ?? []
  const candidates: ComponentRetrievalCandidate[] = []
  const rejected: ComponentRetrievalRejectedCandidate[] = []

  for (const item of input.knowledgeBase.items) {
    const rejectReasons: string[] = []
    if (item.source === 'generated_component' && item.status !== 'verified') {
      rejectReasons.push(`generated component status is ${item.status}`)
    }
    if (!sameLayerOrComposite(item.layerKind, input.targetLayer)) {
      rejectReasons.push(`layer ${item.layerKind} does not satisfy requested ${input.targetLayer}`)
    }
    if (itemHasRoutingConflict({
      capabilityText: input.capabilityText,
      item,
      targetLayer: input.targetLayer,
    })) {
      rejectReasons.push('component boundary conflicts with requested visual grammar')
    }
    if (item.source === 'builtin_plugin' && !item.fallbackPreset) {
      rejectReasons.push('builtin plugin has no known render fallback preset')
    }

    if (rejectReasons.length) {
      rejected.push({
        item_id: item.id,
        source: item.source,
        layerKind: item.layerKind,
        reasons: rejectReasons,
      })
      continue
    }

    const groundingHint = groundingHintForItem({
      item,
      segmentIds: input.segmentIds,
      matchedPlugins,
    })
    const scored = scoreKnowledgeCandidate({
      item,
      capabilityText: input.capabilityText,
      groundingHint,
    })
    if (scored.score <= 0 && !groundingHint) continue

    const decision = candidateDecision({
      item,
      score: scored.score,
    })
    candidates.push(
      toCandidate({
        item,
        decision,
        score: scored.score,
        matchedBy: scored.matchedBy.length ? scored.matchedBy : ['text'],
        reason: groundingHint?.reason
          ? `Matched by component knowledge and director hint: ${groundingHint.reason}`
          : `Matched by component knowledge with score ${scored.score.toFixed(2)}.`,
      }),
    )
  }

  candidates.sort((left, right) => right.score - left.score || left.item_id.localeCompare(right.item_id))

  const generatedReuse = candidates.find(
    (candidate) => candidate.source === 'generated_component' && candidate.decision === 'reuse',
  )
  const generatedAdapt = candidates.find(
    (candidate) => candidate.source === 'generated_component' && candidate.decision === 'adapt',
  )
  const presetReuse = candidates.find(
    (candidate) => candidate.source === 'builtin_plugin' && candidate.decision === 'reuse',
  )
  const presetAdapt = candidates.find(
    (candidate) => candidate.source === 'builtin_plugin' && candidate.decision === 'adapt',
  )
  const fallback = defaultFallbackCandidate(input.targetLayer)
  const selectedStrategy = generatedReuse
    ? 'generated_reuse'
    : generatedAdapt
      ? 'generated_adapt'
      : presetReuse
        ? 'preset_reuse'
        : 'fallback'

  return {
    schema_version: 'component_retrieval.v1',
    query: {
      capability_text: input.capabilityText,
      target_layer_kind: input.targetLayer,
      segment_ids: input.segmentIds,
    },
    thresholds: {
      manifest_reuse: MANIFEST_REUSE_SCORE,
      manifest_adapt: MANIFEST_ADAPT_SCORE,
      preset_reuse: PRESET_REUSE_SCORE,
      preset_adapt: PRESET_ADAPT_SCORE,
    },
    summary: {
      total_items: input.knowledgeBase.item_count,
      viable_candidates: candidates.length,
      rejected_candidates: rejected.length,
      best_score: candidates[0]?.score ?? 0,
      selected_strategy: selectedStrategy,
    },
    ...(generatedReuse ? { generatedReuse } : {}),
    ...(generatedAdapt ? { generatedAdapt } : {}),
    ...(presetReuse ? { presetReuse } : {}),
    ...(presetAdapt ? { presetAdapt } : {}),
    fallback,
    top_candidates: candidates.slice(0, input.topK ?? 8),
    rejected_candidates: rejected,
  }
}

export function compactComponentRetrievalResult(result: ComponentRetrievalResult): Record<string, unknown> {
  return {
    schema_version: result.schema_version,
    query: {
      target_layer_kind: result.query.target_layer_kind,
      segment_ids: result.query.segment_ids,
    },
    thresholds: result.thresholds,
    summary: result.summary,
    selected: result.generatedReuse ?? result.generatedAdapt ?? result.presetReuse ?? result.fallback,
    top_candidates: result.top_candidates.slice(0, 3).map((candidate) => ({
      item_id: candidate.item_id,
      source: candidate.source,
      decision: candidate.decision,
      score: candidate.score,
      preset: candidate.preset,
      component_id: candidate.component_id,
      reason: candidate.reason,
    })),
  }
}

function validationMetricsForLayer(layerKind: CapabilityLayerKind): string[] {
  const metrics: Record<CapabilityLayerKind, string[]> = {
    motion_driver: ['frame_delta_motion', 'position_or_scale_change', 'motion_intensity_range'],
    mask_reveal: ['visible_area_curve', 'reveal_progression', 'edge_softness_or_shape'],
    distortion: ['grid_displacement_delta', 'local_pixel_warp', 'non_color_only_change'],
    color_transform: ['saturation_delta', 'brightness_delta', 'grayscale_to_color_delta'],
    texture_grade: ['grain_or_vignette_presence', 'contrast_delta', 'texture_overlay_opacity'],
    color_grade: ['color_curve_delta', 'contrast_delta', 'highlight_shadow_shift'],
    layout: ['region_count', 'asset_coverage', 'stable_panel_geometry'],
    overlay: ['overlay_area', 'opacity_range', 'position_and_readability'],
    audio_driver: ['beat_window_alignment', 'parameter_modulation', 'cut_or_pulse_density'],
    composite: ['multi_metric_frame_delta', 'non_blank_change', 'layer_boundary_check'],
  }
  return metrics[layerKind]
}

function gapTypeForLayer(layerKind: CapabilityLayerKind): ComponentGapReport['gap_type'] {
  if (layerKind === 'audio_driver') return 'timing_behavior'
  if (layerKind === 'layout') return 'visual_capability'
  if (layerKind === 'motion_driver' || layerKind === 'mask_reveal' || layerKind === 'distortion') {
    return 'visual_capability'
  }
  if (layerKind === 'color_transform' || layerKind === 'texture_grade' || layerKind === 'color_grade') {
    return 'parameter_range'
  }
  return 'unknown'
}

export function buildComponentGapReport(input: {
  capability: {
    id: string
    description: string
    suggested_contract: Record<string, unknown>
  }
  targetLayer: CapabilityLayerKind
  retrieval: ComponentRetrievalResult
  authoringEnabled: boolean
}): ComponentGapReport {
  const selectedReuse = input.retrieval.generatedReuse ?? input.retrieval.presetReuse
  const selectedAdapt = input.retrieval.generatedAdapt
  const decision: ComponentGapReport['decision'] = selectedReuse
    ? 'reuse'
    : selectedAdapt
      ? 'adapt'
      : input.authoringEnabled
        ? 'generate'
        : 'fallback'
  const retrievedCandidates = input.retrieval.top_candidates.slice(0, 5)
  const closest = retrievedCandidates[0]
  const reuseRejection = selectedReuse
    ? []
    : retrievedCandidates.length
      ? retrievedCandidates.map((candidate) =>
          `${candidate.item_id} scored ${candidate.score.toFixed(2)}, below required reuse threshold for ${candidate.source}.`,
        )
      : ['No viable same-layer component candidate was retrieved.']
  const compositionRejection = selectedReuse
    ? []
    : [
        'No existing single component proves full coverage of the requested capability.',
        'No component composition rule currently proves that multiple existing components cover all required clauses.',
      ]
  const reasons = selectedReuse
    ? [`Strong existing component match: ${selectedReuse.item_id}.`]
    : selectedAdapt
      ? [`Verified generated component can be adapted: ${selectedAdapt.item_id}.`]
      : input.authoringEnabled
        ? [
            'Component authoring is enabled.',
            closest
              ? `Closest candidate is ${closest.item_id} with score ${closest.score.toFixed(2)}, so generation requires this gap report.`
              : 'No viable existing candidate was found.',
          ]
        : [
            'Component authoring is disabled.',
            `Fallback will use ${input.retrieval.fallback.preset ?? input.retrieval.fallback.item_id}.`,
          ]

  return {
    schema_version: 'component_gap_report.v1',
    capability_id: input.capability.id,
    need_summary: input.capability.description,
    target_layer_kind: input.targetLayer,
    decision,
    retrieved_candidates: retrievedCandidates,
    reuse_rejection: reuseRejection,
    composition_rejection: compositionRejection,
    gap_type: decision === 'reuse' || decision === 'adapt' ? 'none' : gapTypeForLayer(input.targetLayer),
    new_component_scope: [
      `Implement exactly one ${input.targetLayer} behavior for capability ${input.capability.id}.`,
      'Render existing image/video media full-frame and add only the missing visual effect.',
      'Expose tunable props required by the suggested contract.',
    ],
    out_of_scope: [
      'Do not generate new source media.',
      'Do not create text overlays, captions, or watermarks inside the component.',
      'Do not add network, filesystem, package, or browser-global dependencies.',
      'Do not combine unrelated layer responsibilities.',
    ],
    validation_contract: {
      layerKind: input.targetLayer,
      sample_render: 'required',
      metrics: validationMetricsForLayer(input.targetLayer),
      acceptance_criteria: [
        'TypeScript compilation succeeds.',
        'Sample render is non-blank.',
        'Pre-rendered key frames show measurable change for the requested layer kind.',
        'Manifest capabilities and boundary fields match the implemented effect.',
      ],
    },
    reasons,
  }
}
