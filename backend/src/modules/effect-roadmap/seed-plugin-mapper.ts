import { clearSeedPluginManifests, registerSeedPluginManifests } from '../../../../shared/lib/render-plugin-manifest.js'
import { hydrateSeedPluginManifest } from '../../../../shared/lib/seed-manifest-bridge.js'
import type { DirectorGroundingResult } from '../sample-understanding/director-grounding/director-grounding.schema.js'
import type { CapabilityLayerKind } from '../../../../shared/types/capability-registry.v1.js'
import type {
  EffectMotifCanAdapt,
  EffectMotifLossRisk,
  EffectMotifMustMatch,
  EffectMotifMustMatchValue,
} from '../../../../shared/types/effect-roadmap.v1.js'
import type { RoadmapPluginRegistrySnapshot } from './roadmap-plugin-registry-snapshot.js'

export const SEED_PLUGIN_AUTHORING_REQUEST_SCHEMA_VERSION = 'seed_plugin_authoring_request.v1' as const
export const SEED_GENERATED_PLUGINS_SCHEMA_VERSION = 'seed_generated_plugins.v1' as const
export const MAPPING_DECISIONS_SEED_SCHEMA_VERSION = 'mapping_decisions_seed.v1' as const

export type SeedMappingDecisionKind = 'generate_plugin' | 'unavailable' | 'rejected'

export interface SeedMappingFallback {
  preset?: string
  plugin_id?: string
  reason: string
}

export interface AtomPlanArtifactEntry {
  atom_key: string
  atom_id?: string
  preset?: string | null
  plugin_id?: string | null
  layer?: string | null
  time_range?: {
    start_sec: number | null
    end_sec: number | null
    segment_id: string
  }
  props?: Record<string, unknown>
  evidence?: {
    phenomenon?: string | null
    evidence_refs?: string[]
    confidence?: number | null
  }
  sequence?: number
  capability_query?: string
}

export interface AtomPlanArtifact {
  schema_version: string
  task_id: string
  data?: AtomPlanArtifactEntry[] | null
}

export interface MissingAtomTodoItem {
  id: string
  atom_id?: string
  description: string
  status: 'open' | 'seed_pending' | 'resolved'
  plugin_family?: string
  layerKind?: CapabilityLayerKind
  target_layer?: 'effect' | 'overlay'
  segment_ids?: string[]
  must_match?: EffectMotifMustMatch
  can_adapt?: EffectMotifCanAdapt
  loss_risk?: EffectMotifLossRisk[]
  suggested_contract?: Record<string, unknown>
  capability_query?: string
}

export interface MissingAtomsTodoArtifact {
  schema_version: string
  task_id: string
  items?: MissingAtomTodoItem[]
  data?: MissingAtomTodoItem[] | null
}

export interface DirectorGroundingArtifact {
  schema_version: string
  task_id: string
  data?: DirectorGroundingResult | null
}

export interface SeedAuthoringItem {
  atom_id: string
  missing_atom_id: string
  target_layer: 'effect' | 'overlay'
  plugin_family: string
  layerKind?: CapabilityLayerKind
  must_match: EffectMotifMustMatch
  can_adapt: EffectMotifCanAdapt
  loss_risk: EffectMotifLossRisk[]
  capability_query?: string
  segment_ids: string[]
}

export interface SeedPluginAuthoringRequestPayload {
  missing_atoms: MissingAtomTodoItem[]
  registry_snapshot: RoadmapPluginRegistrySnapshot
  authoring_items: SeedAuthoringItem[]
}

export interface SeedPluginAuthoringRequestArtifact {
  schema_version: typeof SEED_PLUGIN_AUTHORING_REQUEST_SCHEMA_VERSION
  task_id: string
  invoked: boolean
  data: SeedPluginAuthoringRequestPayload | null
}

export interface SeedGeneratedPluginProposal {
  atom_id: string
  missing_atom_id: string
  plugin_id: string
  plugin_family: string
  target_layer: 'effect' | 'overlay'
  must_match: EffectMotifMustMatch
  can_adapt: EffectMotifCanAdapt
  status: 'draft' | 'verified' | 'rejected'
  manifest?: Record<string, unknown>
  component_summary?: string
}

export interface SeedGeneratedPluginsArtifact {
  schema_version: typeof SEED_GENERATED_PLUGINS_SCHEMA_VERSION
  task_id: string
  invoked: boolean
  data: { proposals: SeedGeneratedPluginProposal[] } | null
}

export interface SeedMappingDecision {
  atom_id: string
  missing_atom_id: string
  decision: SeedMappingDecisionKind
  target_layer: 'effect' | 'overlay'
  plugin_family: string
  must_match: EffectMotifMustMatch
  can_adapt: EffectMotifCanAdapt
  fallback: SeedMappingFallback | null
  loss_risk: EffectMotifLossRisk[]
  proposal?: SeedGeneratedPluginProposal
  rejection_reason?: string
  unavailable_reason?: string
}

export interface MappingDecisionsSeedArtifact {
  schema_version: typeof MAPPING_DECISIONS_SEED_SCHEMA_VERSION
  task_id: string
  decisions: SeedMappingDecision[]
  remaining_missing_atoms: MissingAtomTodoItem[]
}

export interface SeedAuthoringProposalDraft {
  atom_id: string
  missing_atom_id: string
  plugin_id: string
  plugin_family: string
  target_layer: 'effect' | 'overlay'
  must_match: EffectMotifMustMatch
  can_adapt?: EffectMotifCanAdapt
  fallback?: SeedMappingFallback | null
  loss_risk?: EffectMotifLossRisk[]
  manifest?: Record<string, unknown>
  component_summary?: string
}

export interface SeedAuthoringInvokeResult {
  available: boolean
  raw_response: string
  proposals: SeedAuthoringProposalDraft[]
  unavailable_reason?: string
}

export interface SeedAuthoringClient {
  invoke(input: {
    taskId: string
    request: SeedPluginAuthoringRequestPayload
  }): Promise<SeedAuthoringInvokeResult>
}

export interface SeedPluginMapperInput {
  taskId: string
  atomPlan: AtomPlanArtifact
  missingAtomsTodo: MissingAtomsTodoArtifact
  directorGrounding: DirectorGroundingArtifact
  registrySnapshot: RoadmapPluginRegistrySnapshot
  seedClient: SeedAuthoringClient
}

export interface SeedPluginMapperOutput {
  seedPluginAuthoringRequest: SeedPluginAuthoringRequestArtifact
  seedPluginAuthoringRawResponse: string
  seedGeneratedPlugins: SeedGeneratedPluginsArtifact
  mappingDecisionsSeed: MappingDecisionsSeedArtifact
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function mustMatchValuesEqual(
  required: EffectMotifMustMatchValue,
  proposed: unknown,
): boolean {
  if (Array.isArray(required)) {
    return (
      Array.isArray(proposed) &&
      required.length === proposed.length &&
      required.every((item, index) => item === proposed[index])
    )
  }
  return required === proposed
}

export function violatesMustMatch(
  required: EffectMotifMustMatch,
  proposed: EffectMotifMustMatch | undefined,
): string | null {
  const requiredKeys = Object.keys(required)
  if (requiredKeys.length === 0) {
    return null
  }

  if (!proposed || Object.keys(proposed).length === 0) {
    return 'Seed proposal omitted must_match constraints'
  }

  for (const [key, requiredValue] of Object.entries(required)) {
    if (!(key in proposed)) {
      return `Seed proposal missing must_match.${key} (required ${String(requiredValue)})`
    }
    if (!mustMatchValuesEqual(requiredValue, proposed[key])) {
      return `Seed proposal violates must_match.${key} (required ${String(requiredValue)}, proposed ${String(proposed[key])})`
    }
  }

  return null
}

function readMissingItems(todo: MissingAtomsTodoArtifact): MissingAtomTodoItem[] {
  const items = todo.items ?? todo.data ?? []
  return items.filter((item) => item.status !== 'resolved')
}

function resolveTargetLayer(item: MissingAtomTodoItem): 'effect' | 'overlay' {
  if (item.target_layer === 'overlay') return 'overlay'
  const contract = item.suggested_contract
  if (isRecord(contract) && contract.target_layer === 'overlay') return 'overlay'
  return 'effect'
}

function resolvePluginFamily(item: MissingAtomTodoItem): string {
  if (item.plugin_family?.trim()) return item.plugin_family.trim()
  if (item.layerKind?.trim()) return item.layerKind.trim()
  const contract = item.suggested_contract
  if (isRecord(contract) && typeof contract.layerKind === 'string') {
    return contract.layerKind
  }
  if (isRecord(contract) && typeof contract.plugin_family === 'string') {
    return contract.plugin_family
  }
  return 'unknown'
}

function resolveAtomId(item: MissingAtomTodoItem, atomPlan: AtomPlanArtifact): string {
  if (item.atom_id?.trim()) return item.atom_id.trim()
  const planEntries = atomPlan.data ?? []
  const segmentIds = item.segment_ids ??
    (isRecord(item.suggested_contract) && Array.isArray(item.suggested_contract.segment_ids)
      ? (item.suggested_contract.segment_ids as string[])
      : [])

  for (const entry of planEntries) {
    if (entry.atom_id === item.id || entry.atom_key === item.id) {
      return entry.atom_id ?? entry.atom_key
    }
    if (
      segmentIds.length > 0 &&
      entry.time_range?.segment_id &&
      segmentIds.includes(entry.time_range.segment_id) &&
      entry.layer === resolvePluginFamily(item)
    ) {
      return entry.atom_id ?? entry.atom_key
    }
  }

  return item.id
}

function resolveSegmentIds(item: MissingAtomTodoItem): string[] {
  if (item.segment_ids?.length) return item.segment_ids
  const contract = item.suggested_contract
  if (isRecord(contract) && Array.isArray(contract.segment_ids)) {
    return contract.segment_ids.filter((value): value is string => typeof value === 'string')
  }
  return []
}

function resolveMustMatch(
  item: MissingAtomTodoItem,
  grounding: DirectorGroundingResult | null | undefined,
): EffectMotifMustMatch {
  if (item.must_match && Object.keys(item.must_match).length > 0) {
    return item.must_match
  }
  const contract = item.suggested_contract
  if (isRecord(contract) && isRecord(contract.must_match)) {
    return contract.must_match as EffectMotifMustMatch
  }
  const fromGrounding = grounding?.remotion_capability_plan.missing_capabilities.find(
    (capability) => capability.id === item.id,
  )
  if (fromGrounding && isRecord(fromGrounding.suggested_contract.must_match)) {
    return fromGrounding.suggested_contract.must_match as EffectMotifMustMatch
  }
  return {}
}

function resolveCanAdapt(item: MissingAtomTodoItem): EffectMotifCanAdapt {
  if (item.can_adapt?.length) return item.can_adapt
  const contract = item.suggested_contract
  if (isRecord(contract) && Array.isArray(contract.can_adapt)) {
    return contract.can_adapt.filter((value): value is string => typeof value === 'string')
  }
  return []
}

function resolveLossRisk(item: MissingAtomTodoItem): EffectMotifLossRisk[] {
  return item.loss_risk ?? []
}

function resolveCapabilityQuery(
  item: MissingAtomTodoItem,
  atomPlan: AtomPlanArtifact,
  atomId: string,
): string | undefined {
  if (item.capability_query?.trim()) return item.capability_query.trim()
  const planEntry = (atomPlan.data ?? []).find(
    (entry) => (entry.atom_id ?? entry.atom_key) === atomId,
  )
  return planEntry?.capability_query
}

function buildAuthoringItems(input: {
  missingItems: MissingAtomTodoItem[]
  atomPlan: AtomPlanArtifact
  grounding: DirectorGroundingResult | null | undefined
}): SeedAuthoringItem[] {
  return input.missingItems.map((item) => {
    const atomId = resolveAtomId(item, input.atomPlan)
    return {
      atom_id: atomId,
      missing_atom_id: item.id,
      target_layer: resolveTargetLayer(item),
      plugin_family: resolvePluginFamily(item),
      layerKind: item.layerKind,
      must_match: resolveMustMatch(item, input.grounding),
      can_adapt: resolveCanAdapt(item),
      loss_risk: resolveLossRisk(item),
      capability_query: resolveCapabilityQuery(item, input.atomPlan, atomId),
      segment_ids: resolveSegmentIds(item),
    }
  })
}

function buildUnavailableDecision(
  item: SeedAuthoringItem,
  reason: string,
): SeedMappingDecision {
  return {
    atom_id: item.atom_id,
    missing_atom_id: item.missing_atom_id,
    decision: 'unavailable',
    target_layer: item.target_layer,
    plugin_family: item.plugin_family,
    must_match: item.must_match,
    can_adapt: item.can_adapt,
    fallback: null,
    loss_risk: item.loss_risk,
    unavailable_reason: reason,
  }
}

function buildRejectedDecision(
  item: SeedAuthoringItem,
  draft: SeedAuthoringProposalDraft,
  rejectionReason: string,
): { decision: SeedMappingDecision; proposal: SeedGeneratedPluginProposal } {
  const proposal: SeedGeneratedPluginProposal = {
    atom_id: draft.atom_id,
    missing_atom_id: draft.missing_atom_id,
    plugin_id: draft.plugin_id,
    plugin_family: draft.plugin_family,
    target_layer: draft.target_layer,
    must_match: draft.must_match,
    can_adapt: draft.can_adapt ?? item.can_adapt,
    status: 'rejected',
    manifest: draft.manifest,
    component_summary: draft.component_summary,
  }

  return {
    proposal,
    decision: {
      atom_id: item.atom_id,
      missing_atom_id: item.missing_atom_id,
      decision: 'rejected',
      target_layer: item.target_layer,
      plugin_family: item.plugin_family,
      must_match: item.must_match,
      can_adapt: item.can_adapt,
      fallback: null,
      loss_risk: [
        ...item.loss_risk,
        {
          id: `seed_reject_${item.missing_atom_id}`,
          reason: rejectionReason,
          evidence_refs: [],
          requested_grammar: Object.entries(item.must_match)
            .map(([key, value]) => `${key}=${String(value)}`)
            .join(','),
          severity: 'high',
        },
      ],
      proposal,
      rejection_reason: rejectionReason,
    },
  }
}

function buildGenerateDecision(
  item: SeedAuthoringItem,
  draft: SeedAuthoringProposalDraft,
): { decision: SeedMappingDecision; proposal: SeedGeneratedPluginProposal } {
  const hydratedManifest =
    hydrateSeedPluginManifest(
      draft.manifest as Record<string, unknown> | undefined,
      item.layerKind,
    ) ?? draft.manifest

  const proposal: SeedGeneratedPluginProposal = {
    atom_id: draft.atom_id,
    missing_atom_id: draft.missing_atom_id,
    plugin_id: draft.plugin_id,
    plugin_family: draft.plugin_family,
    target_layer: draft.target_layer,
    must_match: draft.must_match,
    can_adapt: draft.can_adapt ?? item.can_adapt,
    status: 'draft',
    manifest: hydratedManifest,
    component_summary: draft.component_summary,
  }

  return {
    proposal,
    decision: {
      atom_id: item.atom_id,
      missing_atom_id: item.missing_atom_id,
      decision: 'generate_plugin',
      target_layer: item.target_layer,
      plugin_family: item.plugin_family,
      must_match: item.must_match,
      can_adapt: item.can_adapt,
      fallback: draft.fallback ?? null,
      loss_risk: draft.loss_risk ?? item.loss_risk,
      proposal,
    },
  }
}

function updateRemainingMissingAtom(
  item: MissingAtomTodoItem,
  decision: SeedMappingDecision,
): MissingAtomTodoItem {
  if (decision.decision === 'generate_plugin') {
    return {
      ...item,
      status: 'seed_pending',
      atom_id: decision.atom_id,
    }
  }
  return {
    ...item,
    status: 'open',
    atom_id: decision.atom_id,
  }
}

export async function mapMissingAtomsWithSeed(
  input: SeedPluginMapperInput,
): Promise<SeedPluginMapperOutput> {
  clearSeedPluginManifests()
  const missingItems = readMissingItems(input.missingAtomsTodo)
  const grounding = input.directorGrounding.data ?? null
  const authoringItems = buildAuthoringItems({
    missingItems,
    atomPlan: input.atomPlan,
    grounding,
  })

  if (authoringItems.length === 0) {
    const emptyRequest: SeedPluginAuthoringRequestArtifact = {
      schema_version: SEED_PLUGIN_AUTHORING_REQUEST_SCHEMA_VERSION,
      task_id: input.taskId,
      invoked: false,
      data: null,
    }
    return {
      seedPluginAuthoringRequest: emptyRequest,
      seedPluginAuthoringRawResponse: 'No open missing atoms; Seed authoring skipped.\n',
      seedGeneratedPlugins: {
        schema_version: SEED_GENERATED_PLUGINS_SCHEMA_VERSION,
        task_id: input.taskId,
        invoked: false,
        data: null,
      },
      mappingDecisionsSeed: {
        schema_version: MAPPING_DECISIONS_SEED_SCHEMA_VERSION,
        task_id: input.taskId,
        decisions: [],
        remaining_missing_atoms: [],
      },
    }
  }

  const requestPayload: SeedPluginAuthoringRequestPayload = {
    missing_atoms: missingItems,
    registry_snapshot: input.registrySnapshot,
    authoring_items: authoringItems,
  }

  const seedResult = await input.seedClient.invoke({
    taskId: input.taskId,
    request: requestPayload,
  })

  const decisions: SeedMappingDecision[] = []
  const proposals: SeedGeneratedPluginProposal[] = []
  const remainingMissingAtoms: MissingAtomTodoItem[] = []

  if (!seedResult.available) {
    for (const item of authoringItems) {
      const decision = buildUnavailableDecision(
        item,
        seedResult.unavailable_reason ?? 'Seed authoring service unavailable',
      )
      decisions.push(decision)
      const source = missingItems.find((entry) => entry.id === item.missing_atom_id)
      if (source) {
        remainingMissingAtoms.push(updateRemainingMissingAtom(source, decision))
      }
    }

    return {
      seedPluginAuthoringRequest: {
        schema_version: SEED_PLUGIN_AUTHORING_REQUEST_SCHEMA_VERSION,
        task_id: input.taskId,
        invoked: true,
        data: requestPayload,
      },
      seedPluginAuthoringRawResponse: seedResult.raw_response,
      seedGeneratedPlugins: {
        schema_version: SEED_GENERATED_PLUGINS_SCHEMA_VERSION,
        task_id: input.taskId,
        invoked: true,
        data: { proposals: [] },
      },
      mappingDecisionsSeed: {
        schema_version: MAPPING_DECISIONS_SEED_SCHEMA_VERSION,
        task_id: input.taskId,
        decisions,
        remaining_missing_atoms: remainingMissingAtoms,
      },
    }
  }

  const draftsByAtomId = new Map(
    seedResult.proposals.map((proposal) => [proposal.atom_id, proposal]),
  )

  for (const item of authoringItems) {
    const draft = draftsByAtomId.get(item.atom_id)
    const source = missingItems.find((entry) => entry.id === item.missing_atom_id)

    if (!draft) {
      const decision = buildUnavailableDecision(
        item,
        `Seed returned no proposal for atom_id ${item.atom_id}`,
      )
      decisions.push(decision)
      if (source) remainingMissingAtoms.push(updateRemainingMissingAtom(source, decision))
      continue
    }

    const violation = violatesMustMatch(item.must_match, draft.must_match)
    if (violation) {
      const { decision, proposal } = buildRejectedDecision(item, draft, violation)
      decisions.push(decision)
      proposals.push(proposal)
      if (source) remainingMissingAtoms.push(updateRemainingMissingAtom(source, decision))
      continue
    }

    const { decision, proposal } = buildGenerateDecision(item, draft)
    decisions.push(decision)
    proposals.push(proposal)
    if (source) remainingMissingAtoms.push(updateRemainingMissingAtom(source, decision))
  }

  registerSeedPluginManifests(
    proposals.map((proposal) => proposal.manifest as Record<string, unknown> | undefined),
  )

  return {
    seedPluginAuthoringRequest: {
      schema_version: SEED_PLUGIN_AUTHORING_REQUEST_SCHEMA_VERSION,
      task_id: input.taskId,
      invoked: true,
      data: requestPayload,
    },
    seedPluginAuthoringRawResponse: seedResult.raw_response,
    seedGeneratedPlugins: {
      schema_version: SEED_GENERATED_PLUGINS_SCHEMA_VERSION,
      task_id: input.taskId,
      invoked: true,
      data: { proposals },
    },
    mappingDecisionsSeed: {
      schema_version: MAPPING_DECISIONS_SEED_SCHEMA_VERSION,
      task_id: input.taskId,
      decisions,
      remaining_missing_atoms: remainingMissingAtoms,
    },
  }
}
