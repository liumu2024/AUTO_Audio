import type { AudioVisualUnderstandingHints } from '../../../../../shared/types/sample-understanding-skills.js'
import type { DirectorGroundingResult } from './director-grounding.schema.js'

export type PromptClausePhase =
  | 'global'
  | 'observation'
  | 'effect_intent'
  | 'capability_roadmap'

export type PromptClauseCriticality = 'hard' | 'high' | 'medium' | 'advisory'

export interface PromptClause {
  id: string
  phase: PromptClausePhase
  criticality: PromptClauseCriticality
  instruction: string
  expected_paths: string[]
  validation: string
}

export interface PromptClauseAuditFinding {
  clause_id: string
  status: 'passed' | 'failed' | 'warning' | 'skipped'
  criticality: PromptClauseCriticality
  expected: string
  actual: string
  evidence_paths: string[]
  impact?: string
}

export interface PromptClauseAuditReport {
  schema_version: 'prompt_clause_audit.v1'
  task_id: string
  generated_at: string
  summary: {
    total: number
    passed: number
    failed: number
    warning: number
    skipped: number
  }
  findings: PromptClauseAuditFinding[]
}

export const PROMPT_CLAUSE_REGISTRY: PromptClause[] = [
  {
    id: 'sample_material_boundary',
    phase: 'global',
    criticality: 'hard',
    instruction:
      'Treat the sample video only as structure/style evidence; user materials are the only slot candidates.',
    expected_paths: [
      'source.sample_video.role',
      'source.reference_materials[].role',
    ],
    validation:
      'sample_video.role is structure_source and every reference material role is slot_candidate.',
  },
  {
    id: 'shot_events_required',
    phase: 'observation',
    criticality: 'high',
    instruction:
      'Emit fine-grained shot_events that capture visible shot boundaries, not only broad story segments.',
    expected_paths: ['shot_events[]'],
    validation:
      'shot_events count meets the minimum derived from visual_keyframes or sample duration.',
  },
  {
    id: 'transition_observations_required',
    phase: 'observation',
    criticality: 'high',
    instruction:
      'Emit observed transition_observations with timing and visual mechanism whenever the sample changes shots.',
    expected_paths: ['transition_observations[]'],
    validation:
      'transition_observations count is consistent with the expected shot boundary count.',
  },
  {
    id: 'no_scene_effects_in_grounding',
    phase: 'capability_roadmap',
    criticality: 'hard',
    instruction:
      'Do not write executable render_recipe.scene_effects in Director Grounding; later tools compile effect intents into effects.',
    expected_paths: ['render_recipe.scene_effects'],
    validation: 'render_recipe.scene_effects is an empty array.',
  },
  {
    id: 'effect_intents_reference_segments',
    phase: 'effect_intent',
    criticality: 'high',
    instruction:
      'Every effect_intents[].segment_id must reference a real temporal_events[].id.',
    expected_paths: ['effect_intents[].segment_id', 'temporal_events[].id'],
    validation: 'all effect intent segment references are resolvable.',
  },
]

export function formatPromptClausesForPrompt(
  phases: PromptClausePhase[] = ['global', 'observation', 'effect_intent', 'capability_roadmap'],
): string {
  const allowed = new Set(phases)
  return JSON.stringify(
    PROMPT_CLAUSE_REGISTRY.filter((clause) => allowed.has(clause.phase)).map((clause) => ({
      clause_id: clause.id,
      phase: clause.phase,
      criticality: clause.criticality,
      instruction: clause.instruction,
      expected_paths: clause.expected_paths,
    })),
    null,
    2,
  )
}

export function expectedMinimumShotEvents(input: {
  sampleHints?: AudioVisualUnderstandingHints
  durationSec?: number
}): number {
  const keyframeCount = input.sampleHints?.visual_keyframes?.length ?? 0
  if (keyframeCount >= 4) {
    return Math.min(12, Math.max(3, Math.ceil(keyframeCount * 0.5)))
  }

  const duration = input.durationSec ?? input.sampleHints?.metadata.video_duration ?? 0
  if (duration > 0) {
    return Math.min(10, Math.max(3, Math.ceil(duration / 2)))
  }

  return 3
}

export function auditDirectorGroundingPromptClauses(input: {
  taskId: string
  grounding: DirectorGroundingResult
  sampleHints?: AudioVisualUnderstandingHints
  materialCount?: number
}): PromptClauseAuditReport {
  const findings = PROMPT_CLAUSE_REGISTRY.map((clause): PromptClauseAuditFinding => {
    if (clause.id === 'sample_material_boundary') {
      const materialRoles = input.grounding.source.reference_materials.map((material) => material.role)
      const passed =
        input.grounding.source.sample_video.role === 'structure_source' &&
        materialRoles.every((role) => role === 'slot_candidate') &&
        (input.materialCount === undefined ||
          input.grounding.source.reference_materials.length === input.materialCount)
      return {
        clause_id: clause.id,
        criticality: clause.criticality,
        status: passed ? 'passed' : 'failed',
        expected: clause.validation,
        actual: `sample_role=${input.grounding.source.sample_video.role}; material_roles=${materialRoles.join(',') || 'none'}; material_count=${input.grounding.source.reference_materials.length}`,
        evidence_paths: clause.expected_paths,
        impact: passed ? undefined : 'Material/source boundary may become ambiguous downstream.',
      }
    }

    if (clause.id === 'shot_events_required') {
      const expected = expectedMinimumShotEvents({
        sampleHints: input.sampleHints,
        durationSec: input.grounding.audio_visual_evidence.duration_sec,
      })
      const actual = input.grounding.shot_events.length
      return {
        clause_id: clause.id,
        criticality: clause.criticality,
        status: actual >= expected ? 'passed' : 'warning',
        expected: `shot_events.length >= ${expected}`,
        actual: `shot_events.length=${actual}`,
        evidence_paths: clause.expected_paths,
        impact:
          actual >= expected
            ? undefined
            : 'Render planning will have less evidence for shot density and material coverage.',
      }
    }

    if (clause.id === 'transition_observations_required') {
      const expectedShots = expectedMinimumShotEvents({
        sampleHints: input.sampleHints,
        durationSec: input.grounding.audio_visual_evidence.duration_sec,
      })
      const expectedTransitions = Math.max(1, Math.min(expectedShots - 1, 6))
      const actual = input.grounding.transition_observations.length
      return {
        clause_id: clause.id,
        criticality: clause.criticality,
        status: expectedShots <= 1 ? 'skipped' : actual >= expectedTransitions ? 'passed' : 'warning',
        expected: `transition_observations.length >= ${expectedTransitions}`,
        actual: `transition_observations.length=${actual}`,
        evidence_paths: clause.expected_paths,
        impact:
          actual >= expectedTransitions
            ? undefined
            : 'Transitions may collapse to generic hard cuts in template adaptation.',
      }
    }

    if (clause.id === 'no_scene_effects_in_grounding') {
      const actual = input.grounding.render_recipe.scene_effects.length
      return {
        clause_id: clause.id,
        criticality: clause.criticality,
        status: actual === 0 ? 'passed' : 'failed',
        expected: clause.validation,
        actual: `render_recipe.scene_effects.length=${actual}`,
        evidence_paths: clause.expected_paths,
        impact:
          actual === 0
            ? undefined
            : 'Director Grounding is leaking executable effect selection into a later responsibility.',
      }
    }

    if (clause.id === 'effect_intents_reference_segments') {
      const segmentIds = new Set(input.grounding.temporal_events.map((event) => event.id))
      const missing = input.grounding.effect_intents
        .map((intent) => intent.segment_id)
        .filter((segmentId) => !segmentIds.has(segmentId))
      return {
        clause_id: clause.id,
        criticality: clause.criticality,
        status: missing.length ? 'failed' : 'passed',
        expected: clause.validation,
        actual: missing.length
          ? `unresolved_segment_ids=${[...new Set(missing)].join(',')}`
          : `checked=${input.grounding.effect_intents.length}`,
        evidence_paths: clause.expected_paths,
        impact: missing.length ? 'Effect roadmap cannot bind these intents to timeline segments.' : undefined,
      }
    }

    return {
      clause_id: clause.id,
      criticality: clause.criticality,
      status: 'skipped',
      expected: clause.validation,
      actual: 'no audit implementation',
      evidence_paths: clause.expected_paths,
    }
  })

  const summary = findings.reduce(
    (acc, finding) => {
      acc[finding.status] += 1
      return acc
    },
    { total: findings.length, passed: 0, failed: 0, warning: 0, skipped: 0 },
  )

  return {
    schema_version: 'prompt_clause_audit.v1',
    task_id: input.taskId,
    generated_at: new Date().toISOString(),
    summary,
    findings,
  }
}
