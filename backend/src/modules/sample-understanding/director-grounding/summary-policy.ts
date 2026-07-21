import type { PromptClauseAuditReport } from './prompt-clause-registry.js'
import type { DirectorGroundingResult } from './director-grounding.schema.js'

export const DIRECTOR_GROUNDING_SUMMARY_POLICY = {
  schema_version: 'summary_policy.v1',
  trigger: 'after_director_grounding_validation',
  compression_owner: 'system',
  never_compress_paths: [
    'schema_version',
    'task_id',
    'source.*.role',
    'temporal_events[].id',
    'temporal_events[].start_sec',
    'temporal_events[].end_sec',
    'temporal_events[].creative_role',
    'shot_events[].id',
    'shot_events[].start_sec',
    'shot_events[].end_sec',
    'transition_observations[].id',
    'transition_observations[].at_sec',
    'transition_observations[].type',
    'effect_intents[].intent_id',
    'effect_intents[].segment_id',
    'render_recipe.scene_effects',
    'prompt_clause_audit.findings[].clause_id',
    'prompt_clause_audit.findings[].status',
  ],
  compressible_paths: [
    'audio_visual_evidence.key_observations',
    'visual_phenomena[].description',
    'temporal_events[].description',
    'temporal_events[].visual_prompt',
    'style_summary.*',
    'critique.*',
  ],
  max_text_chars: 240,
} as const

export interface DirectorGroundingSummary {
  schema_version: 'director_grounding_summary.v1'
  task_id: string
  generated_at: string
  policy: typeof DIRECTOR_GROUNDING_SUMMARY_POLICY
  preserved: {
    source_roles: {
      sample_video: string
      reference_materials: string[]
    }
    duration_sec: number
    counts: {
      visual_phenomena: number
      shot_events: number
      transition_observations: number
      temporal_events: number
      effect_intents: number
      missing_capabilities: number
      scene_effects: number
    }
    temporal_events: Array<{
      id: string
      start_sec: number
      end_sec: number
      creative_role: string
      slot_tags: string[]
      accepted_material_types: string[]
    }>
    shot_events: Array<{
      id: string
      start_sec: number
      end_sec: number
      visual_change_intensity: number
      linked_temporal_event_id?: string
    }>
    transition_observations: Array<{
      id: string
      at_sec: number
      type: string
      from_shot_id?: string
      to_shot_id?: string
      duration_sec: number
    }>
    effect_intents: Array<{
      intent_id: string
      segment_id: string
      evidence_refs: string[]
    }>
    prompt_clause_audit?: PromptClauseAuditReport['summary']
  }
  compressed: {
    style_summary: Record<string, string>
    key_observations: string[]
    visual_phenomena: Array<{
      id: string
      type: string
      mechanism?: string
      description: string
    }>
    critique: {
      likely_failure_points: string[]
      repair_notes: string[]
      final_decision: string
    }
  }
}

function shorten(
  value: string | undefined,
  maxChars: number = DIRECTOR_GROUNDING_SUMMARY_POLICY.max_text_chars,
): string {
  const text = (value ?? '').trim()
  if (text.length <= maxChars) return text
  return `${text.slice(0, maxChars - 3)}...`
}

function shortenList(values: string[], maxItems = 8): string[] {
  return values.slice(0, maxItems).map((value) => shorten(value))
}

export function buildDirectorGroundingSummary(input: {
  taskId: string
  grounding: DirectorGroundingResult
  promptClauseAudit?: PromptClauseAuditReport
}): DirectorGroundingSummary {
  const grounding = input.grounding
  return {
    schema_version: 'director_grounding_summary.v1',
    task_id: input.taskId,
    generated_at: new Date().toISOString(),
    policy: DIRECTOR_GROUNDING_SUMMARY_POLICY,
    preserved: {
      source_roles: {
        sample_video: grounding.source.sample_video.role,
        reference_materials: grounding.source.reference_materials.map((material) => material.role),
      },
      duration_sec: grounding.audio_visual_evidence.duration_sec,
      counts: {
        visual_phenomena: grounding.visual_phenomena.length,
        shot_events: grounding.shot_events.length,
        transition_observations: grounding.transition_observations.length,
        temporal_events: grounding.temporal_events.length,
        effect_intents: grounding.effect_intents.length,
        missing_capabilities: grounding.remotion_capability_plan.missing_capabilities.length,
        scene_effects: grounding.render_recipe.scene_effects.length,
      },
      temporal_events: grounding.temporal_events.map((event) => ({
        id: event.id,
        start_sec: event.start_sec,
        end_sec: event.end_sec,
        creative_role: event.creative_role,
        slot_tags: event.slot_tags,
        accepted_material_types: event.accepted_material_types,
      })),
      shot_events: grounding.shot_events.map((shot) => ({
        id: shot.id,
        start_sec: shot.start_sec,
        end_sec: shot.end_sec,
        visual_change_intensity: shot.visual_change_intensity,
        ...(shot.linked_temporal_event_id
          ? { linked_temporal_event_id: shot.linked_temporal_event_id }
          : {}),
      })),
      transition_observations: grounding.transition_observations.map((transition) => ({
        id: transition.id,
        at_sec: transition.at_sec,
        type: transition.type,
        ...(transition.from_shot_id ? { from_shot_id: transition.from_shot_id } : {}),
        ...(transition.to_shot_id ? { to_shot_id: transition.to_shot_id } : {}),
        duration_sec: transition.duration_sec,
      })),
      effect_intents: grounding.effect_intents.map((intent) => ({
        intent_id: intent.intent_id,
        segment_id: intent.segment_id,
        evidence_refs: intent.evidence_refs,
      })),
      ...(input.promptClauseAudit ? { prompt_clause_audit: input.promptClauseAudit.summary } : {}),
    },
    compressed: {
      style_summary: Object.fromEntries(
        Object.entries(grounding.style_summary).map(([key, value]) => [key, shorten(value)]),
      ),
      key_observations: shortenList(grounding.audio_visual_evidence.key_observations),
      visual_phenomena: grounding.visual_phenomena.slice(0, 12).map((phenomenon) => ({
        id: phenomenon.id,
        type: phenomenon.type,
        ...(phenomenon.mechanism ? { mechanism: phenomenon.mechanism } : {}),
        description: shorten(phenomenon.description),
      })),
      critique: {
        likely_failure_points: shortenList(grounding.critique.likely_failure_points),
        repair_notes: shortenList(grounding.critique.repair_notes),
        final_decision: shorten(grounding.critique.final_decision, 80),
      },
    },
  }
}
