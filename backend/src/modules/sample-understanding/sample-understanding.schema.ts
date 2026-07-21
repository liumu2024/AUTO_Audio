/**
 * 样例理解严格契约（Zod）。
 *
 * LLM 原始 JSON 必须先经 parse-sample-understanding.ts：
 *   normalizeSampleUnderstandingCandidate → SampleUnderstandingResultSchema
 *
 * 枚举归一与形状修复集中在 normalizer/，不在此文件逐字段打补丁。
 */
import { z } from 'zod'

import {
  CONTENT_DOMAINS,
  VISUAL_PHENOMENON_MECHANISMS,
} from '../../../../shared/types/director-grounding.v1.js'
import { coerceStringArray } from './normalizer/json-utils.js'
import {
  RENDER_EFFECT_PRESETS,
  SLOT_SOURCES,
  SLOT_TYPES,
  TRANSITION_DIRECTIONS,
  TRANSITION_PRESENTATIONS,
} from './normalizer/enum-coercion.js'

const nonEmptyString = z.preprocess((value) => {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return value
}, z.string().min(1))

const stringArray = z.preprocess(
  (value) => coerceStringArray(value),
  z.array(z.string()).default([]),
)

const ViralPointSchema = z.object({
  time: z.number().min(0),
  type: z.string(),
  reason: z.string(),
  mechanism: z.enum(VISUAL_PHENOMENON_MECHANISMS).optional(),
  evidence_refs: z.array(z.string()).optional(),
  confidence: z.number().min(0).max(1).optional(),
})

const TransitionTimingSchema = z.object({
  type: z.enum(['linear', 'spring']).default('linear'),
  easing: z.string().optional(),
  damping: z.number().positive().optional(),
  stiffness: z.number().positive().optional(),
})

const TransitionOverlaySchema = z.object({
  type: z.enum(['none', 'light_leak', 'flash', 'color_wash']).default('none'),
  duration_sec: z.number().min(0).optional(),
  offset_sec: z.number().optional(),
  intensity: z.number().min(0).max(1).optional(),
})

const TemplateTransitionSchema = z.object({
  id: nonEmptyString,
  from_segment_id: nonEmptyString,
  to_segment_id: nonEmptyString,
  at_sec: z.number().min(0),
  presentation: z.enum(TRANSITION_PRESENTATIONS),
  duration_sec: z.number().min(0),
  timing: TransitionTimingSchema.default({ type: 'linear' }),
  direction: z.enum(TRANSITION_DIRECTIONS).optional(),
  overlay: TransitionOverlaySchema.optional(),
  reason: z.string().optional(),
})

const TemplateSequenceSchema = z.object({
  from_sec: z.number().min(0),
  duration_sec: z.number().positive(),
  layout: z.enum(['fill', 'none']).default('fill'),
  premount_sec: z.number().min(0).default(0.5),
})

const TemplateVisualMotionSchema = z.object({
  preset: z
    .enum(['static', 'zoom_in', 'push_in', 'pan', 'shake'])
    .default('static'),
  intensity: z.number().min(0).max(1).default(0.35),
  easing: z.string().optional(),
  driver: z.literal('useCurrentFrame').default('useCurrentFrame'),
})

const SceneEffectRuntimeSchema = z
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
  global_effects: z.array(z.enum(RENDER_EFFECT_PRESETS)).optional(),
  scene_effects: z.array(SceneEffectRuntimeSchema).optional(),
  audio_driver: z
    .object({
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
    .optional(),
})

export const ParsedCreativeIntentSchema = z.object({
  raw_text: z.string(),
  goal: z.string(),
  product_or_topic: z.string().optional(),
  target_audience: z.string().optional(),
  style_keywords: stringArray,
  must_keep: stringArray,
  must_change: stringArray,
  generation_directive: z.string(),
})

/** 严格模板契约（归一化后校验） */
export const TemplateSchemaV1RuntimeSchema = z
  .object({
    schema_version: z.literal('1.0'),
    id: nonEmptyString,
    title: nonEmptyString,
    duration: z.number().positive(),
    style: z.string(),
    content_domain: z.enum(CONTENT_DOMAINS).optional(),
    sample_video: z
      .object({
        id: nonEmptyString,
        name: z.string().optional(),
        url: z.string().optional(),
        duration: z.number().optional(),
      })
      .optional(),
    reference_materials: z
      .array(
        z.object({
          id: nonEmptyString,
          name: nonEmptyString,
          type: z.enum(['video', 'image', 'audio']),
          url: z.string().optional(),
          tags: z.array(z.string()).optional(),
          used_by_slots: z.array(z.string()).optional(),
        }),
      )
      .default([]),
    creative_intent: ParsedCreativeIntentSchema.optional(),
    sample_understanding: z
      .object({
        hook_formula: z.string(),
        narrative_arc: z.string(),
        conversion_logic: z.string(),
        audience_trigger: z.string(),
        reusable_pattern: z.string(),
      })
      .optional(),
    structure: z.array(
      z.object({
        id: nonEmptyString,
        name: nonEmptyString,
        creative_role: z.string().optional(),
        start: z.number().min(0),
        end: z.number().min(0),
        sequence: TemplateSequenceSchema,
        purpose: z.string(),
        emotion: z.string().optional(),
        subtitle: z.string().optional(),
        camera: z.string().optional(),
        motion: z.string().optional(),
        visual_motion: TemplateVisualMotionSchema,
        slot: nonEmptyString,
        intent_summary: z.string().optional(),
        evidence_refs: z.array(z.string()).optional(),
        confidence: z.number().min(0).max(1).optional(),
      }),
    ),
    slots: z.array(
      z.object({
        id: nonEmptyString,
        type: z.enum(SLOT_TYPES),
        required: z.boolean().default(true),
        tags: z.array(z.string()).default([]),
        description: z.string().optional(),
        source: z.enum(SLOT_SOURCES).optional(),
        accepted_material_types: z.array(z.enum(SLOT_TYPES)).optional(),
        default_material_id: z.string().optional(),
      }),
    ),
    transitions: z.array(TemplateTransitionSchema).default([]),
    style_features: z.record(z.string(), z.string().optional()).default({}),
    viral_points: z.array(ViralPointSchema).default([]),
    render_recipe: RenderRecipeSchema.optional(),
    capability_layers: z
      .array(
        z.object({
          segment_id: nonEmptyString,
          layers: z
            .array(
              z.object({
                plugin_id: nonEmptyString,
                layer: z.enum(VISUAL_PHENOMENON_MECHANISMS),
                preset: z.enum(RENDER_EFFECT_PRESETS).optional(),
                reason: z.string().optional(),
                confidence: z.number().min(0).max(1).optional(),
              }),
            )
            .default([]),
        }),
      )
      .optional(),
    source_video_id: z.string().optional(),
  })
  .superRefine((template, ctx) => {
    const slotIds = new Set(template.slots.map((slot) => slot.id))
    const segmentById = new Map(
      template.structure.map((segment, index) => [segment.id, { segment, index }]),
    )
    template.structure.forEach((segment, index) => {
      if (!slotIds.has(segment.slot)) {
        ctx.addIssue({
          code: 'custom',
          path: ['structure', index, 'slot'],
          message: `structure slot "${segment.slot}" does not exist in template.slots`,
        })
      }
      if (
        segment.sequence &&
        Math.abs(segment.sequence.from_sec - segment.start) > 0.001
      ) {
        ctx.addIssue({
          code: 'custom',
          path: ['structure', index, 'sequence', 'from_sec'],
          message: 'sequence.from_sec must equal segment.start',
        })
      }
      if (
        segment.sequence &&
        Math.abs(segment.sequence.duration_sec - (segment.end - segment.start)) >
          0.001
      ) {
        ctx.addIssue({
          code: 'custom',
          path: ['structure', index, 'sequence', 'duration_sec'],
          message: 'sequence.duration_sec must equal segment.end - segment.start',
        })
      }
    })
    template.transitions.forEach((transition, index) => {
      const from = segmentById.get(transition.from_segment_id)
      const to = segmentById.get(transition.to_segment_id)
      if (!from) {
        ctx.addIssue({
          code: 'custom',
          path: ['transitions', index, 'from_segment_id'],
          message: `transition from_segment_id "${transition.from_segment_id}" does not exist in template.structure`,
        })
      }
      if (!to) {
        ctx.addIssue({
          code: 'custom',
          path: ['transitions', index, 'to_segment_id'],
          message: `transition to_segment_id "${transition.to_segment_id}" does not exist in template.structure`,
        })
      }
      if (from && to && to.index !== from.index + 1) {
        ctx.addIssue({
          code: 'custom',
          path: ['transitions', index],
          message: 'transition must connect adjacent structure segments',
        })
      }
      if (transition.presentation === 'cut' && transition.duration_sec !== 0) {
        ctx.addIssue({
          code: 'custom',
          path: ['transitions', index, 'duration_sec'],
          message: 'cut transitions must use duration_sec 0',
        })
      }
      if (transition.presentation !== 'cut' && transition.duration_sec <= 0) {
        ctx.addIssue({
          code: 'custom',
          path: ['transitions', index, 'duration_sec'],
          message: 'non-cut transitions must use a positive duration_sec',
        })
      }
    })
  })

export const SampleUnderstandingResultSchema = z.object({
  schema_version: z.literal('sample_understanding.v1'),
  task_id: z.string(),
  director_grounding: z.unknown().optional(),
  source: z.object({
    sample_video: z.object({
      id: nonEmptyString,
      name: z.string().optional(),
      url: z.string().optional(),
      role: z.literal('structure_source'),
    }),
    reference_materials: z.array(
      z.object({
        id: nonEmptyString,
        name: nonEmptyString,
        type: z.enum(['video', 'image', 'audio']),
        role: z.literal('slot_candidate'),
        tags: z.array(z.string()).default([]),
      }),
    ),
  }),
  intent: ParsedCreativeIntentSchema,
  sample_analysis: z.object({
    hook_formula: z.string(),
    narrative_arc: z.string(),
    conversion_logic: z.string(),
    audience_trigger: z.string(),
    reusable_pattern: z.string(),
  }),
  template: TemplateSchemaV1RuntimeSchema,
})

export type SampleUnderstandingResult = z.infer<
  typeof SampleUnderstandingResultSchema
>
