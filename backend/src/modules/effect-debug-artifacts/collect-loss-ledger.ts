import type { DirectorGroundingResult } from '../sample-understanding/director-grounding/director-grounding.schema.js'
import type { MigrationProtocolV12 } from '../../../../shared/types/migration-protocol.v1.2.js'
import type { EffectRoadmap, LossLedgerEntry } from '../../../../shared/types/effect-roadmap.v1.js'
import type {
  RenderPlanComponentResolution,
  RenderPlanV1,
} from '../../../../shared/types/render-plan.v1.js'
import { expandRecipePresetToCompiledPresets } from '../../../../shared/lib/legacy-preset-expansion.js'
import type { RoadmapAgentRunStatus } from '../effect-roadmap/roadmap-agent.service.js'

function isGrounding(value: unknown): value is DirectorGroundingResult {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as DirectorGroundingResult).schema_version === 'director_grounding.v1'
  )
}

export function collectEffectLossLedger(input: {
  taskId: string
  structure: MigrationProtocolV12
  renderPlan?: RenderPlanV1 | null
  componentResolution?: RenderPlanComponentResolution
  effectRoadmap?: EffectRoadmap | null
  roadmapAgentStatus?: RoadmapAgentRunStatus | null
  roadmapAgentError?: string | null
}): LossLedgerEntry[] {
  const entries: LossLedgerEntry[] = []
  let counter = 0
  const nextId = (prefix: string) => `${prefix}_${String(++counter).padStart(3, '0')}`

  const grounding = isGrounding(input.structure.director_grounding)
    ? input.structure.director_grounding
    : undefined
  const recipe = input.structure.render_recipe
  const sceneEffects = recipe?.scene_effects ?? []

  if (!grounding) {
    entries.push({
      id: nextId('loss'),
      source_stage: 'director_grounding',
      reason: 'structure.director_grounding is missing or not director_grounding.v1',
      evidence_refs: [],
      fallback_used: null,
      severity: 'medium',
    })
  }

  if (!recipe) {
    entries.push({
      id: nextId('loss'),
      source_stage: 'render_recipe',
      reason: 'structure.render_recipe is missing',
      evidence_refs: [],
      fallback_used: null,
      severity: 'medium',
    })
  }

  for (const effect of sceneEffects) {
    if (!effect.preset && !effect.plugin_id && !effect.effect_id) {
      entries.push({
        id: nextId('loss'),
        source_stage: 'render_recipe',
        reason: `scene_effects row for segment ${effect.segment_id} has no preset or plugin_id`,
        evidence_refs: effect.evidence_refs ?? [],
        fallback_used: null,
        severity: 'high',
      })
    }
  }

  const phenomena = grounding?.visual_phenomena ?? []
  for (const phenomenon of phenomena) {
    const refs = phenomenon.evidence_refs ?? [phenomenon.id]
    const covered = sceneEffects.some((effect) =>
      (effect.evidence_refs ?? []).some((ref) => refs.includes(ref) || ref === phenomenon.id),
    )
    if (!covered) {
      entries.push({
        id: nextId('loss'),
        source_stage: 'effect_roadmap',
        reason: `visual_phenomenon ${phenomenon.id} has no render_recipe.scene_effects coverage`,
        evidence_refs: refs,
        fallback_used: null,
        severity: 'low',
      })
    }
  }

  const roadmapEntry = buildEffectRoadmapLossEntry({
    effectRoadmap: input.effectRoadmap,
    roadmapAgentStatus: input.roadmapAgentStatus,
    roadmapAgentError: input.roadmapAgentError,
    nextId,
  })
  if (roadmapEntry) {
    entries.push(roadmapEntry)
  }

  for (const decision of input.componentResolution?.decisions ?? []) {
    if (decision.decision === 'fallback') {
      entries.push({
        id: nextId('loss'),
        source_stage: 'plugin_mapping',
        reason: decision.reason ?? `Fallback for capability ${decision.capability_id}`,
        evidence_refs: decision.segment_ids ?? [],
        fallback_used: decision.fallback_preset ?? decision.preset ?? null,
        severity: 'medium',
      })
    }
  }

  if (input.renderPlan) {
    for (const anchor of input.structure.semantic_anchors) {
      const expected = sceneEffects.filter((effect) => effect.segment_id === anchor.anchor_id)
      const scene = input.renderPlan.scenes.find((item) => item.source_anchor_id === anchor.anchor_id)
      const actualPresets = new Set(
        (scene?.effect_layers ?? []).map((layer) => String(layer.preset)),
      )
      for (const effect of expected) {
        const expectedPresets = expandRecipePresetToCompiledPresets(effect.preset)
        const missing = expectedPresets.filter((preset) => !actualPresets.has(preset))
        if (missing.length > 0) {
          const allMissing = missing.length === expectedPresets.length
          entries.push({
            id: nextId('loss'),
            source_stage: 'render_plan_compile',
            reason: allMissing
              ? `Expected compiled presets for ${effect.preset ?? 'unknown'} missing from scene ${anchor.anchor_id}: ${missing.join(', ')}`
              : `Partial compiled preset expansion for ${effect.preset} missing in scene ${anchor.anchor_id}: ${missing.join(', ')}`,
            evidence_refs: effect.evidence_refs ?? [],
            fallback_used: null,
            severity: allMissing ? 'high' : 'medium',
          })
        }
      }
    }
  }

  return entries
}

function buildEffectRoadmapLossEntry(input: {
  effectRoadmap?: EffectRoadmap | null
  roadmapAgentStatus?: RoadmapAgentRunStatus | null
  roadmapAgentError?: string | null
  nextId: (prefix: string) => string
}): LossLedgerEntry | null {
  const segmentCount = input.effectRoadmap?.segments.length ?? 0
  const status = input.roadmapAgentStatus

  if (status === 'ok' && segmentCount > 0) {
    return null
  }

  if (status === 'disabled') {
    return {
      id: input.nextId('loss'),
      source_stage: 'effect_roadmap',
      reason:
        'EffectRoadmap agent disabled; effect-roadmap.json contains empty segments until agent runs',
      evidence_refs: [],
      fallback_used: null,
      severity: 'info',
    }
  }

  if (status === 'skipped') {
    return {
      id: input.nextId('loss'),
      source_stage: 'effect_roadmap',
      reason:
        'EffectRoadmap agent skipped because director_grounding is missing; effect-roadmap.json remains empty',
      evidence_refs: [],
      fallback_used: null,
      severity: 'info',
    }
  }

  if (status === 'failed') {
    return {
      id: input.nextId('loss'),
      source_stage: 'effect_roadmap',
      reason: input.roadmapAgentError
        ? `EffectRoadmap agent failed: ${input.roadmapAgentError}`
        : 'EffectRoadmap agent failed; effect-roadmap.json contains empty segments',
      evidence_refs: [],
      fallback_used: null,
      severity: 'medium',
    }
  }

  if (status === 'ok' && segmentCount === 0) {
    return {
      id: input.nextId('loss'),
      source_stage: 'effect_roadmap',
      reason:
        'EffectRoadmap agent returned empty segments; motif/atoms/bindings were not produced',
      evidence_refs: [],
      fallback_used: null,
      severity: 'info',
    }
  }

  return {
    id: input.nextId('loss'),
    source_stage: 'effect_roadmap',
    reason:
      'EffectRoadmap agent has not run; effect-roadmap.json contains empty segments until motif/atoms/bindings are produced',
    evidence_refs: [],
    fallback_used: null,
    severity: 'info',
  }
}
