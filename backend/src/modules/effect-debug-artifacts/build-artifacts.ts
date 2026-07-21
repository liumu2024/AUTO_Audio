import type { DirectorGroundingResult } from '../sample-understanding/director-grounding/director-grounding.schema.js'
import type { LossLedgerEntry } from '../../../../shared/types/effect-roadmap.v1.js'
import type { CompositionValidationDocument } from '../../../../shared/types/composition-plan.v1.js'
import {
  EFFECT_ROADMAP_SCHEMA_VERSION,
  type EffectRoadmap,
} from '../../../../shared/types/effect-roadmap.v1.js'
import type { MigrationProtocolV12 } from '../../../../shared/types/migration-protocol.v1.2.js'
import type {
  RenderEffectLayer,
  RenderPlanComponentResolution,
  RenderPlanV1,
} from '../../../../shared/types/render-plan.v1.js'
import { resolveSeedAuthoringClient } from '../effect-roadmap/ark-seed-authoring-client.js'
import { matchAtomsToRegistry } from '../effect-roadmap/atom-registry-matcher.js'
import { buildRoadmapPluginRegistrySnapshot } from '../effect-roadmap/roadmap-plugin-registry-snapshot.js'
import {
  mapMissingAtomsWithSeed,
  type SeedAuthoringClient,
} from '../effect-roadmap/seed-plugin-mapper.js'
import { collectEffectLossLedger } from './collect-loss-ledger.js'
import {
  applyCompiledEffectLayersToRenderPlan,
  compileEffectRoadmap,
  type CompiledEffectLayersArtifact,
} from '../effect-roadmap/roadmap-compiler.js'
import { authorSeedPluginProposals } from '../remotion-component-authoring/capability-resolver.js'
import type { RoadmapAgentRunStatus } from '../effect-roadmap/roadmap-agent.service.js'
import {
  runEffectCompositionPipeline,
  applyEffectCompositionPipelineToRenderPlan,
} from '../effect-composition/run-effect-composition-pipeline.js'

export interface EffectDebugArtifactBundle {
  taskId: string
  lossLedger: LossLedgerEntry[]
  directorGrounding: Record<string, unknown>
  effectRoadmap: Record<string, unknown>
  effectRoadmapProjection: Record<string, unknown>
  roadmapAgentRawResponse: string
  roadmapAgentRepairRawResponse: string
  atomPlan: Record<string, unknown>
  missingAtomsTodo: Record<string, unknown>
  seedPluginAuthoringRequest: Record<string, unknown>
  seedPluginAuthoringRawResponse: string
  seedGeneratedPlugins: Record<string, unknown>
  mappingDecisions: Record<string, unknown>
  mappingDecisionsSeed: Record<string, unknown>
  compiledEffectLayers: Record<string, unknown>
  effectIntent: Record<string, unknown>
  compositionPlan: Record<string, unknown>
  compositionValidation: Record<string, unknown>
  renderPlan: Record<string, unknown>
  doctorReport: Record<string, unknown>
}

export interface BuildEffectDebugArtifactsInput {
  taskId: string
  structure: MigrationProtocolV12
  renderPlan?: RenderPlanV1 | null
  componentResolution?: RenderPlanComponentResolution
  effectRoadmap?: EffectRoadmap | null
  roadmapAgentStatus?: RoadmapAgentRunStatus | null
  roadmapAgentError?: string | null
  roadmapAgentInitialRawResponse?: string | null
  roadmapAgentRepairRawResponse?: string | null
  seedClient?: SeedAuthoringClient
}

function isGrounding(value: unknown): value is DirectorGroundingResult {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as DirectorGroundingResult).schema_version === 'director_grounding.v1'
  )
}

function buildEffectRoadmapProjection(input: {
  taskId: string
  structure: MigrationProtocolV12
}) {
  const recipe = input.structure.render_recipe
  const segmentRoadmaps = input.structure.semantic_anchors.map((anchor) => ({
    segment_id: anchor.anchor_id,
    start_sec: anchor.start_sec,
    end_sec: anchor.end_sec,
    effect_group_id: null,
    shared_refs: null,
    layer_order: (recipe?.scene_effects ?? [])
      .filter((effect) => effect.segment_id === anchor.anchor_id)
      .map((effect) => ({
        preset: effect.preset ?? null,
        plugin_id: effect.plugin_id ?? effect.effect_id ?? null,
        layer: effect.layer ?? null,
      })),
    motif_id: null,
    phases: [],
  }))

  return {
    schema_version: 'effect_roadmap_projection.v1',
    task_id: input.taskId,
    segment_roadmaps: segmentRoadmaps,
    note: 'render_recipe projection for debug only; not a valid EffectRoadmap',
  }
}

function buildEffectRoadmap(input: {
  taskId: string
  effectRoadmap?: EffectRoadmap | null
  lossLedger: LossLedgerEntry[]
}) {
  if (input.effectRoadmap && input.effectRoadmap.segments.length > 0) {
    return {
      ...input.effectRoadmap,
      task_id: input.taskId,
      loss_ledger: [
        ...(input.effectRoadmap.loss_ledger ?? []),
        ...input.lossLedger.filter((entry) => entry.source_stage === 'effect_roadmap'),
      ],
    }
  }

  return {
    schema_version: EFFECT_ROADMAP_SCHEMA_VERSION,
    task_id: input.taskId,
    segments: [],
    loss_ledger: input.lossLedger.filter((entry) => entry.source_stage === 'effect_roadmap'),
  }
}

function buildMappingDecisions(input: {
  taskId: string
  componentResolution?: RenderPlanComponentResolution
  localRegistryDecisions: ReturnType<typeof matchAtomsToRegistry>['localMappingDecisions']
  lossLedger: LossLedgerEntry[]
}) {
  const decisions = input.componentResolution?.decisions ?? []
  return {
    schema_version: 'mapping_decisions.v1',
    task_id: input.taskId,
    data: decisions.length ? decisions : null,
    decisions,
    local_registry_decisions: input.localRegistryDecisions,
    authoring_enabled: input.componentResolution?.authoring_enabled ?? false,
    debug_dir: input.componentResolution?.debug_dir ?? null,
    loss_ledger: input.lossLedger.filter((entry) => entry.source_stage === 'plugin_mapping'),
  }
}

function buildDoctorReport(input: {
  taskId: string
  lossLedger: LossLedgerEntry[]
  renderPlan?: RenderPlanV1 | null
  compiledEffectLayers: CompiledEffectLayersArtifact
  compositionValidation?: CompositionValidationDocument | null
}) {
  const findings: Array<{
    id: string
    severity: LossLedgerEntry['severity']
    reason: string
    segment_id?: string
    evidence_refs: string[]
  }> = []
  const runtimeCompositePresets = new Set([
    'color_portal_spotlight',
    'kinetic_color_ripple',
    'cinematic_grade_pack',
    'cinematic_light_sweep',
    'editorial_split_collage',
    'ripple_displacement',
    'mask_slice_transition',
    'audio_reactive_cut_driver',
  ])
  const sceneLayersBySegment = new Map<string, RenderEffectLayer[]>()
  for (const scene of input.renderPlan?.scenes ?? []) {
    sceneLayersBySegment.set(scene.source_anchor_id, scene.effect_layers ?? [])
    sceneLayersBySegment.set(scene.id, scene.effect_layers ?? [])
  }

  for (const finding of input.compositionValidation?.findings ?? []) {
    findings.push({
      id: `doctor_composition_${finding.id}`,
      severity: finding.severity === 'error' ? 'high' : finding.severity === 'warning' ? 'medium' : 'low',
      reason: `Composition validation ${finding.rule}: ${finding.message}`,
      segment_id: finding.segment_id,
      evidence_refs: [],
    })
  }

  for (const segment of input.compiledEffectLayers.segments) {
    if (segment.skipped_atom_ids.length > 0) {
      findings.push({
        id: `doctor_skipped_atoms_${segment.segment_id}`,
        severity: 'high',
        reason: `Compiled segment ${segment.segment_id} skipped atoms: ${segment.skipped_atom_ids.join(', ')}`,
        segment_id: segment.segment_id,
        evidence_refs: [],
      })
    }

    if (segment.effect_layers.length > 0) {
      const sceneLayers = sceneLayersBySegment.get(segment.segment_id) ?? []
      const missingPresets = segment.effect_layers
        .map((layer) => layer.preset)
        .filter((preset) => !sceneLayers.some((layer) => layer.preset === preset))
      if (missingPresets.length > 0) {
        findings.push({
          id: `doctor_compiled_not_applied_${segment.segment_id}`,
          severity: 'high',
          reason: `Roadmap compiled layers are not fully present in render plan for ${segment.segment_id}: ${missingPresets.join(', ')}`,
          segment_id: segment.segment_id,
          evidence_refs: [],
        })
      }
    }
  }

  for (const scene of input.renderPlan?.scenes ?? []) {
    for (const layer of scene.effect_layers ?? []) {
      if (runtimeCompositePresets.has(layer.preset)) {
        findings.push({
          id: `doctor_runtime_composite_${scene.id}_${layer.id}`,
          severity: 'medium',
          reason: `Render plan still contains runtime composite preset ${layer.preset}; expected primitive layers.`,
          segment_id: scene.source_anchor_id,
          evidence_refs: [],
        })
      }
    }
  }

  const doctorLedger: LossLedgerEntry[] = findings.map((finding) => ({
    id: finding.id,
    source_stage: 'doctor',
    reason: finding.reason,
    evidence_refs: finding.evidence_refs,
    fallback_used: null,
    severity: finding.severity,
  }))

  return {
    schema_version: 'doctor_report.v1',
    task_id: input.taskId,
    doctor_status: 'ok',
    rounds_run: 1,
    output_policy: 'deterministic_static_checks',
    data: {
      checked_segments: input.compiledEffectLayers.segments.length,
      findings,
    },
    remaining_findings: findings,
    advisories: findings.length
      ? [
          'Review skipped atoms or missing compiled layers before judging visual fidelity from the frontend.',
        ]
      : [],
    loss_ledger: [
      ...input.lossLedger.filter((entry) => entry.source_stage === 'doctor'),
      ...doctorLedger,
    ],
  }
}

export async function buildEffectDebugArtifacts(
  input: BuildEffectDebugArtifactsInput,
): Promise<EffectDebugArtifactBundle> {
  const lossLedger = collectEffectLossLedger({
    taskId: input.taskId,
    structure: input.structure,
    renderPlan: input.renderPlan,
    componentResolution: input.componentResolution,
    effectRoadmap: input.effectRoadmap,
    roadmapAgentStatus: input.roadmapAgentStatus,
    roadmapAgentError: input.roadmapAgentError,
  })
  const grounding = input.structure.director_grounding
  const registrySnapshot = buildRoadmapPluginRegistrySnapshot()

  const directorGrounding = {
    schema_version: 'director_grounding.v1',
    task_id: input.taskId,
    data: isGrounding(grounding) ? grounding : null,
  }

  const effectRoadmap = buildEffectRoadmap({
    taskId: input.taskId,
    effectRoadmap: input.effectRoadmap,
    lossLedger,
  })

  const effectRoadmapProjection = buildEffectRoadmapProjection({
    taskId: input.taskId,
    structure: input.structure,
  })

  const matcherResult = matchAtomsToRegistry({
    taskId: input.taskId,
    effectRoadmap: input.effectRoadmap ?? {
      schema_version: EFFECT_ROADMAP_SCHEMA_VERSION,
      task_id: input.taskId,
      segments: [],
    },
    registrySnapshot,
    structure: input.structure,
    lossLedger,
  })

  const seedOutput = await mapMissingAtomsWithSeed({
    taskId: input.taskId,
    atomPlan: matcherResult.atomPlan,
    missingAtomsTodo: matcherResult.missingAtomsTodo,
    directorGrounding,
    registrySnapshot,
    seedClient: input.seedClient ?? resolveSeedAuthoringClient(),
  })

  const seedAuthoring = await authorSeedPluginProposals({
    taskId: input.taskId,
    mappingDecisionsSeed: seedOutput.mappingDecisionsSeed,
    effectRoadmap: input.effectRoadmap ?? {
      schema_version: EFFECT_ROADMAP_SCHEMA_VERSION,
      task_id: input.taskId,
      segments: [],
    },
  })

  const mappingDecisions = buildMappingDecisions({
    taskId: input.taskId,
    componentResolution: input.componentResolution,
    localRegistryDecisions: matcherResult.localMappingDecisions,
    lossLedger,
  })

  const compiledEffectLayers = compileEffectRoadmap({
    taskId: input.taskId,
    effectRoadmap: input.effectRoadmap ?? {
      schema_version: EFFECT_ROADMAP_SCHEMA_VERSION,
      task_id: input.taskId,
      segments: [],
    },
    mappingDecisionsLocal: {
      local_registry_decisions: matcherResult.localMappingDecisions,
    },
    mappingDecisionsSeed: seedOutput.mappingDecisionsSeed,
    seedAuthoringByAtomId: seedAuthoring.byAtomId,
    lossLedger,
  })

  const groundingIntents = isGrounding(grounding) ? grounding.effect_intents ?? [] : []
  const shouldRunComposition =
    (input.effectRoadmap?.segments.length ?? 0) > 0 || groundingIntents.length > 0

  let renderPlanBase = input.renderPlan ?? null
  if (renderPlanBase && (input.effectRoadmap?.segments.length ?? 0) > 0) {
    renderPlanBase = applyCompiledEffectLayersToRenderPlan({
      plan: renderPlanBase,
      compiled: compiledEffectLayers,
      effectRoadmap: input.effectRoadmap,
      renderRecipe: input.structure.render_recipe,
    })
  }

  let compositionPipeline:
    | ReturnType<typeof applyEffectCompositionPipelineToRenderPlan>
    | ReturnType<typeof runEffectCompositionPipeline>
    | null = null

  if (shouldRunComposition && renderPlanBase) {
    const appliedComposition = applyEffectCompositionPipelineToRenderPlan({
      taskId: input.taskId,
      plan: renderPlanBase,
      structure: input.structure,
      effectRoadmap: input.effectRoadmap,
      groundingEffectIntents: groundingIntents,
      compiledEffectLayers,
      localMappingDecisions: matcherResult.localMappingDecisions,
    })
    renderPlanBase = appliedComposition.plan
    compositionPipeline = appliedComposition
  } else if (shouldRunComposition) {
    compositionPipeline = runEffectCompositionPipeline({
      taskId: input.taskId,
      effectRoadmap: input.effectRoadmap,
      groundingEffectIntents: groundingIntents,
      compiledEffectLayers,
      localMappingDecisions: matcherResult.localMappingDecisions,
      renderPlan: input.renderPlan ?? null,
    })
  }

  const renderPlanData = renderPlanBase

  const doctorReport = buildDoctorReport({
    taskId: input.taskId,
    lossLedger,
    renderPlan: renderPlanData,
    compiledEffectLayers,
    compositionValidation: compositionPipeline?.compositionValidation ?? null,
  })
  const finalLossLedger = [
    ...lossLedger,
    ...doctorReport.loss_ledger.filter(
      (entry) => !lossLedger.some((existing) => existing.id === entry.id),
    ),
  ]

  const renderPlan = {
    schema_version: 'render_plan.v1',
    task_id: input.taskId,
    data: renderPlanData,
    loss_ledger: lossLedger.filter((entry) => entry.source_stage === 'render_plan_compile'),
  }

  return {
    taskId: input.taskId,
    lossLedger: finalLossLedger,
    directorGrounding,
    effectRoadmap,
    effectRoadmapProjection,
    roadmapAgentRawResponse: input.roadmapAgentInitialRawResponse ?? '',
    roadmapAgentRepairRawResponse: input.roadmapAgentRepairRawResponse ?? '',
    atomPlan: matcherResult.atomPlan as unknown as Record<string, unknown>,
    missingAtomsTodo: {
      ...matcherResult.missingAtomsTodo,
      items: seedOutput.mappingDecisionsSeed.remaining_missing_atoms,
      data: seedOutput.mappingDecisionsSeed.remaining_missing_atoms.length
        ? seedOutput.mappingDecisionsSeed.remaining_missing_atoms
        : null,
    } as unknown as Record<string, unknown>,
    seedPluginAuthoringRequest: seedOutput.seedPluginAuthoringRequest as unknown as Record<
      string,
      unknown
    >,
    seedPluginAuthoringRawResponse: seedOutput.seedPluginAuthoringRawResponse,
    seedGeneratedPlugins: seedOutput.seedGeneratedPlugins as unknown as Record<string, unknown>,
    mappingDecisions,
    mappingDecisionsSeed: seedOutput.mappingDecisionsSeed as unknown as Record<string, unknown>,
    compiledEffectLayers: compiledEffectLayers as unknown as Record<string, unknown>,
    effectIntent: (compositionPipeline?.effectIntent ?? {
      schema_version: 'effect_intent.v1',
      task_id: input.taskId,
      intents: [],
    }) as unknown as Record<string, unknown>,
    compositionPlan: (compositionPipeline?.compositionPlan ?? {
      schema_version: 'composition_plan.v1',
      task_id: input.taskId,
      segments: [],
    }) as unknown as Record<string, unknown>,
    compositionValidation: (compositionPipeline?.compositionValidation ?? {
      schema_version: 'composition_validation.v1',
      task_id: input.taskId,
      status: 'pending',
      findings: [],
      repair_actions: [],
    }) as unknown as Record<string, unknown>,
    renderPlan,
    doctorReport,
  }
}
