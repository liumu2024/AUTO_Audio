import type { CapabilityPluginManifest, CapabilitySupportValue } from '../../../../shared/types/capability-registry.v1.js'
import type {
  EffectAtom,
  EffectMotifCanAdapt,
  EffectMotifLossRisk,
  EffectMotifMustMatch,
  EffectMotifMustMatchValue,
  EffectRoadmap,
  EffectRoadmapSegment,
  LossLedgerEntry,
} from '../../../../shared/types/effect-roadmap.v1.js'
import type { MigrationProtocolV12 } from '../../../../shared/types/migration-protocol.v1.2.js'
import { RENDER_PLUGIN_MANIFESTS } from '../../../../shared/lib/render-plugin-manifest.js'
import type { RoadmapPluginRegistrySnapshot } from './roadmap-plugin-registry-snapshot.js'
import type { AtomPlanArtifact, MissingAtomTodoItem } from './seed-plugin-mapper.js'

export const ATOM_PLAN_SCHEMA_VERSION = 'atom_plan.v1' as const
export const MISSING_ATOMS_TODO_SCHEMA_VERSION = 'missing_atoms_todo.v1' as const

export type LocalRegistryMappingDecisionKind = 'reuse' | 'adapt' | 'missing'

export interface LocalRegistryMappingDecision {
  atom_id: string
  segment_id: string
  decision: LocalRegistryMappingDecisionKind
  layerKind: EffectAtom['layerKind']
  plugin_id: string | null
  preset: string | null
  target_layer: 'effect' | 'overlay'
  plugin_family: string
  must_match: EffectMotifMustMatch
  can_adapt: EffectMotifCanAdapt
  fallback: null
  loss_risk: EffectMotifLossRisk[]
  reason: string
  match_score: number | null
}

export interface AtomPlanEntry {
  atom_id: string
  atom_key: string
  layerKind: EffectAtom['layerKind']
  capability_query: string
  mapping_status: 'matched' | 'missing'
  plugin_id: string | null
  preset: string | null
  layer: EffectAtom['layerKind']
  segment_id: string
  motif_id: string | null
  motif_family: string | null
  time_range: {
    start_sec: number | null
    end_sec: number | null
    segment_id: string
  }
  must_match: EffectMotifMustMatch
  can_adapt: EffectMotifCanAdapt
  evidence: {
    evidence_refs: string[]
    confidence: number | null
  }
  sequence: number
}

export interface AtomRegistryMatcherResult {
  atomPlan: AtomPlanArtifact & {
    source: 'effect_roadmap' | 'render_recipe_projection'
    atom_count: number
    loss_ledger: LossLedgerEntry[]
  }
  missingAtomsTodo: {
    schema_version: typeof MISSING_ATOMS_TODO_SCHEMA_VERSION
    task_id: string
    data: MissingAtomTodoItem[] | null
    items: MissingAtomTodoItem[]
    loss_ledger: LossLedgerEntry[]
  }
  localMappingDecisions: LocalRegistryMappingDecision[]
}

export interface AtomRegistryMatcherInput {
  taskId: string
  effectRoadmap: EffectRoadmap
  registrySnapshot?: RoadmapPluginRegistrySnapshot
  manifests?: CapabilityPluginManifest[]
  structure?: MigrationProtocolV12
  lossLedger?: LossLedgerEntry[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function expandMustMatchClause(key: string, value: EffectMotifMustMatchValue): string[] {
  const clauses = [`${key}=${String(value)}`]
  if (key === 'geometry.cell_shape') {
    if (value === 'triangle') {
      clauses.push('geometry.primitive=triangle', 'geometry.primitive_sides=3')
    }
    if (value === 'circle') {
      clauses.push('geometry.primitive=circle', 'geometry.mask_shape=circle')
    }
    if (value === 'rectangle') {
      clauses.push('geometry.primitive=rectangle')
    }
  }
  if (key === 'geometry.mask_shape' && value === 'circle') {
    clauses.push('geometry.primitive=circle')
  }
  return clauses
}

function mapMustMatchKeyToSupportKey(key: string): string {
  if (key === 'geometry.cell_shape') return 'geometry.primitive'
  if (key === 'geometry.reveal_mode') return 'mask.motion'
  return key
}

function mapMustMatchValueToSupportValue(
  key: string,
  value: EffectMotifMustMatchValue,
): string | number | boolean {
  if (key === 'geometry.cell_shape' && value === 'triangle') return 'triangle'
  if (key === 'geometry.cell_shape' && value === 'rectangle') return 'rectangle'
  if (key === 'geometry.cell_shape' && value === 'circle') return 'circle'
  if (key === 'geometry.reveal_mode' && value === 'directional_wave') return 'directional_wave'
  return value as string | number | boolean
}

function valueWithinSupportRange(value: number, supported: CapabilitySupportValue): boolean {
  if (!isRecord(supported)) return false
  const min = typeof supported.min === 'number' ? supported.min : Number.NEGATIVE_INFINITY
  const max = typeof supported.max === 'number' ? supported.max : Number.POSITIVE_INFINITY
  return value >= min && value <= max
}

function valueMatchesSupport(
  key: string,
  value: EffectMotifMustMatchValue,
  supported: CapabilitySupportValue,
): boolean {
  const mappedValue = mapMustMatchValueToSupportValue(key, value)

  if (Array.isArray(supported)) {
    if (Array.isArray(mappedValue)) {
      return mappedValue.every((item) => (supported as unknown[]).includes(item))
    }
    return (supported as unknown[]).includes(mappedValue)
  }

  if (typeof mappedValue === 'number' && isRecord(supported)) {
    return valueWithinSupportRange(mappedValue, supported)
  }

  return supported === mappedValue
}

function pluginViolatesCannotSupport(
  plugin: CapabilityPluginManifest,
  mustMatch: EffectMotifMustMatch,
): string | null {
  const cannotSupport = plugin.boundary?.cannotSupport ?? []
  for (const [key, value] of Object.entries(mustMatch)) {
    for (const clause of expandMustMatchClause(key, value)) {
      if (cannotSupport.includes(clause)) {
        return `${plugin.id} cannotSupport includes ${clause}`
      }
    }
  }
  return null
}

function pluginViolatesNegativeKeywords(
  plugin: CapabilityPluginManifest,
  mustMatch: EffectMotifMustMatch,
  capabilityQuery?: string,
): string | null {
  const keywords = plugin.negativeKeywords ?? []
  if (!keywords.length) return null

  const haystack = [
    capabilityQuery ?? '',
    ...Object.entries(mustMatch).flatMap(([key, value]) => [
      key,
      String(value),
      `${key}=${String(value)}`,
    ]),
  ]
    .join(' ')
    .toLowerCase()

  for (const keyword of keywords) {
    const normalized = keyword.trim().toLowerCase()
    if (normalized && haystack.includes(normalized)) {
      return `${plugin.id} negativeKeywords includes "${keyword}"`
    }
  }

  return null
}

function pluginSupportsMustMatch(
  plugin: CapabilityPluginManifest,
  mustMatch: EffectMotifMustMatch,
): { ok: true } | { ok: false; reason: string } {
  if (Object.keys(mustMatch).length === 0) {
    return { ok: true }
  }

  const supports = plugin.boundary?.supports ?? {}

  for (const [key, value] of Object.entries(mustMatch)) {
    const supportKey = mapMustMatchKeyToSupportKey(key)
    if (!(supportKey in supports)) {
      return {
        ok: false,
        reason: `${plugin.id} does not declare supports.${supportKey} required by ${key}=${String(value)}`,
      }
    }

    if (!valueMatchesSupport(key, value, supports[supportKey] as CapabilitySupportValue)) {
      return {
        ok: false,
        reason: `${plugin.id} supports.${supportKey} does not include ${String(value)}`,
      }
    }
  }

  return { ok: true }
}

function scoreRequiredParamsMatch(
  atom: EffectAtom,
  plugin: CapabilityPluginManifest,
): number {
  const required = normalizeStringList((atom as { required_params?: unknown }).required_params)
  if (required.length === 0) return 0

  const pluginRequired = normalizeStringList((plugin as { requiredParams?: unknown }).requiredParams)
  let score = 0

  for (const param of required) {
    if (pluginRequired.includes(param)) {
      score += 4
      continue
    }

    const root = param.split('.')[0] ?? param
    if (pluginRequired.some((candidate) => candidate === root || candidate.startsWith(`${root}.`))) {
      score += 3
      continue
    }

    if (root === 'ring' && pluginRequired.includes('ring')) {
      score += 3
    }
    if (root === 'orb' && pluginRequired.some((candidate) => candidate.startsWith('orb.'))) {
      score += 3
    }
    if (root === 'mask' && pluginRequired.some((candidate) => candidate.startsWith('mask.'))) {
      score += 2
    }
  }

  const wantsRing = required.some((param) => param.startsWith('ring.'))
  const wantsOrb = required.some((param) => param.startsWith('orb.'))
  const pluginWantsOrb = pluginRequired.some((param) => param.startsWith('orb.'))
  const pluginWantsRing =
    pluginRequired.includes('ring') || pluginRequired.some((param) => param.startsWith('ring.'))

  if (wantsRing && !wantsOrb && pluginWantsOrb && !pluginWantsRing) {
    score -= 5
  }
  if (wantsOrb && !wantsRing && pluginWantsRing && !pluginWantsOrb) {
    score -= 5
  }
  if (wantsRing && !wantsOrb && plugin.id === 'portal_ring_overlay') {
    score += 4
  }
  if (wantsRing && !wantsOrb && plugin.id === 'orb_ring_follow_overlay') {
    score -= 4
  }

  return score
}

function normalizeStringList(value: unknown): string[] {
  if (value == null) return []
  if (Array.isArray(value)) {
    return value
      .flatMap((item) => normalizeStringList(item))
      .map((item) => item.trim())
      .filter(Boolean)
  }
  if (typeof value === 'number' && Number.isFinite(value)) return [String(value)]
  if (typeof value !== 'string') return []

  const trimmed = value.trim()
  if (!trimmed) return []
  if (trimmed.startsWith('[')) {
    try {
      return normalizeStringList(JSON.parse(trimmed) as unknown)
    } catch {
      // Treat malformed array-like text as a plain token below.
    }
  }
  if (/[,;，；]/.test(trimmed)) {
    return trimmed
      .split(/[,;，；]/)
      .map((item) => item.trim())
      .filter(Boolean)
  }
  return [trimmed]
}

function scorePluginMatch(
  plugin: CapabilityPluginManifest,
  mustMatch: EffectMotifMustMatch,
  atom: EffectAtom,
): number {
  const supports = plugin.boundary?.supports ?? {}
  let score = plugin.status === 'verified' ? 1 : 0.5
  for (const key of Object.keys(mustMatch)) {
    const supportKey = mapMustMatchKeyToSupportKey(key)
    if (supportKey in supports) score += 1
  }
  score += scoreRequiredParamsMatch(atom, plugin)
  return score
}

function filterMustMatchForAtom(
  atom: EffectAtom,
  mustMatch: EffectMotifMustMatch,
): EffectMotifMustMatch {
  const layerRules: Partial<Record<EffectAtom['layerKind'], (key: string) => boolean>> = {
    color_transform: (key) => key.startsWith('style.') || key.startsWith('color.'),
    mask_reveal: (key) =>
      key.startsWith('geometry.mask') ||
      key.startsWith('geometry.reveal') ||
      key.startsWith('geometry.primitive'),
    motion_driver: (key) =>
      key.startsWith('motion.') ||
      key.startsWith('geometry.origin'),
    layout: (key) =>
      key.startsWith('geometry.panel') ||
      key.startsWith('geometry.arrangement') ||
      key.startsWith('geometry.cell') ||
      key.startsWith('geometry.layout'),
    texture_grade: (key) => key.startsWith('style.') || key.startsWith('texture.'),
    color_grade: (key) => key.startsWith('style.') || key.startsWith('color.'),
  }

  const predicate = layerRules[atom.layerKind]
  if (!predicate) return mustMatch

  const filtered: EffectMotifMustMatch = {}
  for (const [key, value] of Object.entries(mustMatch)) {
    if (predicate(key)) filtered[key] = value
  }
  return filtered
}

function findBestPlugin(
  atom: EffectAtom,
  mustMatch: EffectMotifMustMatch,
  manifests: CapabilityPluginManifest[],
): { plugin: CapabilityPluginManifest; decision: 'reuse' | 'adapt'; score: number } | null {
  const candidates = manifests.filter((plugin) => plugin.layerKind === atom.layerKind)
  const viable: Array<{ plugin: CapabilityPluginManifest; decision: 'reuse' | 'adapt'; score: number }> = []

  for (const plugin of candidates) {
    if (pluginViolatesCannotSupport(plugin, mustMatch)) continue
    if (pluginViolatesNegativeKeywords(plugin, mustMatch, atom.capability_query)) continue

    const support = pluginSupportsMustMatch(plugin, mustMatch)
    if (!support.ok) continue

    const score = scorePluginMatch(plugin, mustMatch, atom)
    viable.push({
      plugin,
      decision: score >= 2 ? 'reuse' : 'adapt',
      score,
    })
  }

  viable.sort((left, right) => right.score - left.score || left.plugin.id.localeCompare(right.plugin.id))
  return viable[0] ?? null
}

function buildMissingTodoItem(input: {
  atom: EffectAtom
  segment: EffectRoadmapSegment
}): MissingAtomTodoItem {
  return {
    id: `missing_${input.atom.id}`,
    atom_id: input.atom.id,
    description: `No local registry plugin satisfies must_match for atom ${input.atom.id} (${input.segment.motif.family})`,
    status: 'open',
    plugin_family: input.segment.motif.family,
    layerKind: input.atom.layerKind,
    target_layer: 'effect',
    segment_ids: [input.segment.segment_id],
    must_match: input.segment.motif.must_match,
    can_adapt: input.segment.motif.can_adapt,
    loss_risk: input.segment.motif.loss_risk ?? [],
    capability_query: input.atom.capability_query,
    suggested_contract: {
      target_layer: 'effect',
      segment_ids: [input.segment.segment_id],
      layerKind: input.atom.layerKind,
      must_match: input.segment.motif.must_match,
      can_adapt: input.segment.motif.can_adapt,
    },
  }
}

function buildAtomPlanEntry(input: {
  atom: EffectAtom
  segment: EffectRoadmapSegment
  sequence: number
  mapping: LocalRegistryMappingDecision
}): AtomPlanEntry {
  return {
    atom_id: input.atom.id,
    atom_key: input.atom.id,
    layerKind: input.atom.layerKind,
    capability_query: input.atom.capability_query,
    mapping_status: input.mapping.decision === 'missing' ? 'missing' : 'matched',
    plugin_id: input.mapping.plugin_id,
    preset: input.mapping.preset,
    layer: input.atom.layerKind,
    segment_id: input.segment.segment_id,
    motif_id: input.segment.motif.id,
    motif_family: input.segment.motif.family,
    time_range: {
      start_sec: input.segment.start_sec ?? null,
      end_sec: input.segment.end_sec ?? null,
      segment_id: input.segment.segment_id,
    },
    must_match: input.mapping.must_match,
    can_adapt: input.mapping.can_adapt,
    evidence: {
      evidence_refs: input.atom.evidence_refs ?? input.segment.motif.evidence_refs,
      confidence: input.segment.motif.confidence,
    },
    sequence: input.sequence,
  }
}

function matchRoadmapSegments(input: AtomRegistryMatcherInput): AtomRegistryMatcherResult {
  const manifests = input.manifests ?? RENDER_PLUGIN_MANIFESTS
  const lossLedger = input.lossLedger ?? []
  const atomEntries: AtomPlanEntry[] = []
  const missingItems: MissingAtomTodoItem[] = []
  const localDecisions: LocalRegistryMappingDecision[] = []
  let sequence = 0

  for (const segment of input.effectRoadmap.segments) {
    for (const atom of segment.atoms) {
      sequence += 1
      const mustMatch = filterMustMatchForAtom(atom, segment.motif.must_match)
      const match = findBestPlugin(atom, mustMatch, manifests)

      const decision: LocalRegistryMappingDecision = match
        ? {
            atom_id: atom.id,
            segment_id: segment.segment_id,
            decision: match.decision,
            layerKind: atom.layerKind,
            plugin_id: match.plugin.id,
            preset: match.plugin.fallbackPreset ?? null,
            target_layer: match.plugin.targetLayer,
            plugin_family: match.plugin.family ?? segment.motif.family,
            must_match: mustMatch,
            can_adapt: segment.motif.can_adapt,
            fallback: null,
            loss_risk: segment.motif.loss_risk ?? [],
            reason: `Matched ${match.plugin.id} via hard-constraint registry matcher`,
            match_score: match.score,
          }
        : {
            atom_id: atom.id,
            segment_id: segment.segment_id,
            decision: 'missing',
            layerKind: atom.layerKind,
            plugin_id: null,
            preset: null,
            target_layer: 'effect',
            plugin_family: segment.motif.family,
            must_match: mustMatch,
            can_adapt: segment.motif.can_adapt,
            fallback: null,
            loss_risk: segment.motif.loss_risk ?? [],
            reason: 'No local registry plugin satisfies motif must_match hard constraints',
            match_score: null,
          }

      localDecisions.push(decision)
      atomEntries.push(
        buildAtomPlanEntry({
          atom,
          segment,
          sequence,
          mapping: decision,
        }),
      )

      if (decision.decision === 'missing') {
        missingItems.push(buildMissingTodoItem({ atom, segment }))
      }
    }
  }

  return {
    atomPlan: {
      schema_version: ATOM_PLAN_SCHEMA_VERSION,
      task_id: input.taskId,
      source: 'effect_roadmap',
      data: atomEntries.length ? atomEntries : null,
      atom_count: atomEntries.length,
      loss_ledger: lossLedger.filter((entry) =>
        ['effect_roadmap', 'plugin_mapping'].includes(entry.source_stage),
      ),
    },
    missingAtomsTodo: {
      schema_version: MISSING_ATOMS_TODO_SCHEMA_VERSION,
      task_id: input.taskId,
      data: missingItems.length ? missingItems : null,
      items: missingItems,
      loss_ledger: lossLedger.filter((entry) => entry.source_stage === 'plugin_mapping'),
    },
    localMappingDecisions: localDecisions,
  }
}

function atomKeyFromSceneEffect(
  effect: NonNullable<
    NonNullable<MigrationProtocolV12['render_recipe']>['scene_effects']
  >[number],
): string {
  return effect.plugin_id ?? effect.effect_id ?? effect.preset ?? 'unknown_atom'
}

function buildFallbackFromStructure(input: AtomRegistryMatcherInput): AtomRegistryMatcherResult {
  const structure = input.structure
  const lossLedger = input.lossLedger ?? []
  const recipe = structure?.render_recipe
  const anchors = new Map(
    (structure?.semantic_anchors ?? []).map((anchor) => [anchor.anchor_id, anchor]),
  )

  const atomEntries: AtomPlanEntry[] = (recipe?.scene_effects ?? []).map((effect, index) => {
    const anchor = anchors.get(effect.segment_id)
    const atomKey = atomKeyFromSceneEffect(effect)
    return {
      atom_id: atomKey,
      atom_key: atomKey,
      layerKind: (effect.layer as EffectAtom['layerKind']) ?? 'composite',
      capability_query: effect.phenomenon ?? '',
      mapping_status: effect.preset || effect.plugin_id ? 'matched' : 'missing',
      plugin_id: effect.plugin_id ?? effect.effect_id ?? null,
      preset: effect.preset ?? null,
      layer: (effect.layer as EffectAtom['layerKind']) ?? 'composite',
      segment_id: effect.segment_id,
      motif_id: null,
      motif_family: null,
      time_range: anchor
        ? {
            start_sec: anchor.start_sec,
            end_sec: anchor.end_sec,
            segment_id: effect.segment_id,
          }
        : {
            start_sec: null,
            end_sec: null,
            segment_id: effect.segment_id,
          },
      must_match: {},
      can_adapt: [],
      evidence: {
        evidence_refs: effect.evidence_refs ?? [],
        confidence: effect.confidence ?? null,
      },
      sequence: index + 1,
    }
  })

  const grounding = structure?.director_grounding
  const missingItems: MissingAtomTodoItem[] =
    grounding &&
    typeof grounding === 'object' &&
    grounding !== null &&
    'remotion_capability_plan' in grounding
      ? ((
          grounding as {
            remotion_capability_plan: {
              missing_capabilities: Array<{
                id: string
                description: string
                suggested_contract: Record<string, unknown>
              }>
            }
          }
        ).remotion_capability_plan.missing_capabilities.map((item) => ({
          id: item.id,
          description: item.description,
          suggested_contract: item.suggested_contract,
          status: 'open' as const,
          target_layer:
            item.suggested_contract.target_layer === 'overlay' ? 'overlay' : 'effect',
          segment_ids: Array.isArray(item.suggested_contract.segment_ids)
            ? item.suggested_contract.segment_ids.filter(
                (value): value is string => typeof value === 'string',
              )
            : [],
        })) ?? [])
      : []

  const localDecisions: LocalRegistryMappingDecision[] = atomEntries.map((entry) => ({
    atom_id: entry.atom_id,
    segment_id: entry.segment_id,
    decision: entry.mapping_status === 'matched' ? 'reuse' : 'missing',
    layerKind: entry.layerKind,
    plugin_id: entry.plugin_id,
    preset: entry.preset,
    target_layer: 'effect',
    plugin_family: entry.motif_family ?? entry.layerKind,
    must_match: entry.must_match,
    can_adapt: entry.can_adapt,
    fallback: null,
    loss_risk: [],
    reason:
      entry.mapping_status === 'matched'
        ? 'Render recipe projection matched existing preset/plugin_id'
        : 'Render recipe projection missing preset/plugin_id',
    match_score: entry.mapping_status === 'matched' ? 1 : null,
  }))

  return {
    atomPlan: {
      schema_version: ATOM_PLAN_SCHEMA_VERSION,
      task_id: input.taskId,
      source: 'render_recipe_projection',
      data: atomEntries.length ? atomEntries : null,
      atom_count: atomEntries.length,
      loss_ledger: lossLedger.filter((entry) =>
        ['render_recipe', 'render_plan_compile', 'effect_roadmap'].includes(entry.source_stage),
      ),
    },
    missingAtomsTodo: {
      schema_version: MISSING_ATOMS_TODO_SCHEMA_VERSION,
      task_id: input.taskId,
      data: missingItems.length ? missingItems : null,
      items: missingItems,
      loss_ledger: lossLedger.filter((entry) => entry.source_stage === 'plugin_mapping'),
    },
    localMappingDecisions: localDecisions,
  }
}

export function matchAtomsToRegistry(input: AtomRegistryMatcherInput): AtomRegistryMatcherResult {
  if (input.effectRoadmap.segments.length === 0) {
    return buildFallbackFromStructure(input)
  }
  return matchRoadmapSegments(input)
}
