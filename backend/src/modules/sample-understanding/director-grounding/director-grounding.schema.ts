import { z } from 'zod'

import {
  CONTENT_DOMAINS,
  VISUAL_PHENOMENON_MECHANISMS,
} from '../../../../../shared/types/director-grounding.v1.js'
import { RENDER_EFFECT_PRESETS } from '../normalizer/enum-coercion.js'

const nonEmptyString = z.preprocess((value) => {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return value
}, z.string().min(1))

const IntentSchema = z.object({
  raw_text: z.string().default(''),
  goal: z.string().default('replicate_structure'),
  product_or_topic: z.string().optional(),
  target_audience: z.string().optional(),
  style_keywords: z.array(z.string()).default([]),
  must_keep: z.array(z.string()).default([]),
  must_change: z.array(z.string()).default([]),
  generation_directive: z.string().default('Replicate the sample editing style with user materials.'),
})

const AudioDriverSchema = z.object({
  beat_times: z.array(z.number()).default([]),
  strong_beats: z.array(z.number()).optional(),
  energy_peaks: z
    .array(
      z.object({
        time: z.number(),
        intensity: z.number(),
        duration_sec: z.number().optional(),
      }),
    )
    .optional(),
  waveform: z
    .array(
      z.object({
        time: z.number(),
        value: z.number(),
      }),
    )
    .optional(),
})

const EffectIntentSyncSchema = z.object({
  driver: z.enum(['audio_beat', 'manual', 'motion_subject']).optional(),
  peak_policy: z.string().optional(),
})

const EffectIntentSchema = z.object({
  intent_id: nonEmptyString,
  segment_id: nonEmptyString,
  evidence_refs: z.array(z.string()).default([]),
  style: z.string().optional(),
  motion_subject: z.string().optional(),
  motion_pattern: z.string().optional(),
  unlock_mode: z.string().optional(),
  reveal_mode: z.string().optional(),
  geometry: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.array(z.string())])).optional(),
  sync: EffectIntentSyncSchema.optional(),
  description: z.string().optional(),
})

const SceneEffectSchema = z
  .object({
    segment_id: nonEmptyString,
    preset: z.enum(RENDER_EFFECT_PRESETS).optional(),
    effect_id: z.string().optional(),
    plugin_id: z.string().optional(),
    layer: z.enum(VISUAL_PHENOMENON_MECHANISMS).optional(),
    phenomenon: z.string().optional(),
    evidence_refs: z.array(z.string()).optional(),
    confidence: z.number().min(0).max(1).optional(),
    params: z.record(z.string(), z.unknown()).optional(),
  })
  .superRefine((effect, ctx) => {
    if (!effect.preset && !effect.plugin_id && !effect.effect_id) {
      ctx.addIssue({
        code: 'custom',
        path: ['preset'],
        message: 'scene_effects item requires preset or plugin_id/effect_id',
      })
    }
  })

const RenderRecipeSchema = z.object({
  style_family: z.string().optional(),
  global_effects: z.array(z.enum(RENDER_EFFECT_PRESETS)).default([]),
  scene_effects: z.array(SceneEffectSchema).default([]),
  audio_driver: AudioDriverSchema.optional(),
})

const CapabilityLayerEntrySchema = z.object({
  plugin_id: nonEmptyString,
  layer: z.enum(VISUAL_PHENOMENON_MECHANISMS),
  preset: z.enum(RENDER_EFFECT_PRESETS).optional(),
  reason: z.string().optional(),
  confidence: z.number().min(0).max(1).optional(),
})

const CapabilityLayerPlanSchema = z.object({
  segment_id: nonEmptyString,
  layers: z.array(CapabilityLayerEntrySchema).default([]),
})

const ShotEventSchema = z.object({
  id: nonEmptyString,
  start_sec: z.number().min(0),
  end_sec: z.number().min(0),
  visual_summary: z.string().default(''),
  camera_motion: z.string().optional(),
  visual_change_intensity: z.number().min(0).max(1).default(0.5),
  evidence_refs: z.array(z.string()).default([]),
  confidence: z.number().min(0).max(1).optional(),
  linked_temporal_event_id: z.string().optional(),
})

const TransitionObservationSchema = z.object({
  id: nonEmptyString,
  at_sec: z.number().min(0),
  from_shot_id: z.string().optional(),
  to_shot_id: z.string().optional(),
  type: nonEmptyString,
  duration_sec: z.number().min(0).default(0),
  visual_mechanism: z.string().default(''),
  sync: z.string().optional(),
  evidence_refs: z.array(z.string()).default([]),
  confidence: z.number().min(0).max(1).optional(),
})

export const DirectorGroundingResultSchema = z.object({
  schema_version: z.literal('director_grounding.v1'),
  task_id: nonEmptyString,
  content_domain: z.enum(CONTENT_DOMAINS).default('unknown'),
  source: z.object({
    sample_video: z.object({
      id: nonEmptyString,
      name: z.string().optional(),
      url: z.string().optional(),
      role: z.literal('structure_source').default('structure_source'),
    }),
    reference_materials: z
      .array(
        z.object({
          id: nonEmptyString,
          name: nonEmptyString,
          type: z.enum(['video', 'image', 'audio']),
          role: z.literal('slot_candidate').default('slot_candidate'),
          tags: z.array(z.string()).default([]),
        }),
      )
      .default([]),
  }),
  intent: IntentSchema,
  audio_visual_evidence: z.object({
    duration_sec: z.number().positive(),
    fps: z.number().positive().optional(),
    key_observations: z.array(z.string()).default([]),
    beat_summary: z.string().default(''),
  }),
  visual_phenomena: z.array(
    z.object({
      id: nonEmptyString,
      start_sec: z.number().min(0),
      end_sec: z.number().min(0),
      type: nonEmptyString,
      mechanism: z.enum(VISUAL_PHENOMENON_MECHANISMS).optional(),
      description: z.string(),
      evidence: z.string().default(''),
      evidence_refs: z.array(z.string()).optional(),
      confidence: z.number().min(0).max(1).default(0.7),
    }),
  ),
  shot_events: z.array(ShotEventSchema).default([]),
  transition_observations: z.array(TransitionObservationSchema).default([]),
  temporal_events: z.array(
    z.object({
      id: nonEmptyString,
      start_sec: z.number().min(0),
      end_sec: z.number().min(0),
      creative_role: nonEmptyString,
      /** @deprecated 旧版字段；解析时会回填到 creative_role */
      marketing_role: z.string().optional(),
      description: z.string(),
      visual_prompt: z.string(),
      overlay_text: z.string().default(''),
      emotion_vibe: z.string().default('cinematic'),
      camera: z.string().default(''),
      motion: z.string().default(''),
      evidence_refs: z.array(z.string()).optional(),
      confidence: z.number().min(0).max(1).optional(),
      visual_motion: z
        .object({
          preset: z.enum(['static', 'zoom_in', 'push_in', 'pan', 'shake']).default('static'),
          intensity: z.number().min(0).max(1).default(0.35),
          easing: z.string().optional(),
          driver: z.literal('useCurrentFrame').default('useCurrentFrame'),
        })
        .default({
          preset: 'static',
          intensity: 0.35,
          driver: 'useCurrentFrame',
        }),
      slot_tags: z.array(z.string()).default([]),
      accepted_material_types: z.array(z.enum(['video', 'image', 'audio', 'text'])).default(['video', 'image']),
    }),
  ),
  style_summary: z.object({
    style_family: nonEmptyString,
    editing_pattern: z.string(),
    audio_sync_logic: z.string(),
    visual_style: z.string().default(''),
    pace: z.string().default(''),
  }),
  remotion_capability_plan: z.object({
    matched_plugins: z.array(
      z.object({
        preset: z.enum(RENDER_EFFECT_PRESETS),
        plugin_id: z.string().optional(),
        reason: z.string(),
        segment_ids: z.array(z.string()).default([]),
      }),
    ).default([]),
    capability_layers: z.array(CapabilityLayerPlanSchema).default([]),
    missing_capabilities: z.array(
      z.object({
        id: nonEmptyString,
        description: z.string(),
        suggested_contract: z.record(z.string(), z.unknown()).default({}),
      }),
    ).default([]),
    plugin_authoring_skill: z.object({
      enabled: z.boolean().default(false),
      purpose: z.string().default('Generate a new Remotion plugin only after human approval.'),
      candidate_plugin_ids: z.array(z.string()).default([]),
    }).default({
      enabled: false,
      purpose: 'Generate a new Remotion plugin only after human approval.',
      candidate_plugin_ids: [],
    }),
  }),
  render_recipe: RenderRecipeSchema,
  effect_intents: z.array(EffectIntentSchema).default([]),
  critique: z.object({
    likely_failure_points: z.array(z.string()).default([]),
    repair_notes: z.array(z.string()).default([]),
    final_decision: z.string().default('usable'),
  }),
})

export type DirectorGroundingResult = z.infer<typeof DirectorGroundingResultSchema>
