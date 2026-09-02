import { env } from '../config/env.js'
import {
  extractStructuredJsonCandidate,
  extractTextCandidate,
  type StructuredJsonExtractionReport,
} from '../modules/agent-tools/structured-json-tool.js'
import {
  assertValidRemotionTimelineSpec,
  validateRemotionTimelineSpec,
  type RemotionTimelineValidationIssue,
} from '../../../shared/lib/remotion-timeline-validator.js'
import { normalizeV2TimelineTextOwnership } from '../../../shared/lib/remotion-timeline-text-ownership.js'
import {
  REMOTION_TIMELINE_SPEC_SCHEMA_VERSION,
  REMOTION_TIMELINE_TRANSITION_TYPES,
  type RemotionTimelineSpecV1,
} from '../../../shared/types/remotion-timeline-spec.v1.js'
import {
  buildDeterministicRemotionTimelineSpec,
  type V2RemotionTimelinePlannerInput,
} from './remotion-timeline-planner.js'
import { extractV2TimelineHardRequirements } from './hard-requirements.js'
import {
  applyV2TimelineRevisionGroupFragment,
  applyV2TimelineRevisionFragment,
  enforceV2TimelineRevisionGroup,
  enforceV2TimelineRevisionScope,
  V2_TIMELINE_REVISION_GROUP_FRAGMENT_SCHEMA_VERSION,
  V2_TIMELINE_REVISION_FRAGMENT_SCHEMA_VERSION,
  type V2TimelineRevisionGroupFragment,
  type V2TimelineRevisionFragment,
} from './timeline-revision-scope.js'
import {
  prepareArkImageInputs,
  releaseArkImageInputs,
  resolveServerImageAccess,
  type ArkImageInputReport,
  type ArkResponsesImageInput,
} from './ark-image-input.js'

export const V2_TIMELINE_PLANNER_PROTOCOL_VERSION = 'v2_timeline_planner_protocol.v2'

const MAX_V2_PLANNER_IMAGE_INPUTS = 12
const TimelineJsonSchema = {
  type: 'object',
  required: ['schema_version', 'task_id', 'creative_brief', 'canvas', 'scenes', 'assets', 'transitions', 'caption_tracks', 'overlays', 'audio', 'material_jobs', 'render_policy'],
  properties: {
    schema_version: { type: 'string', const: REMOTION_TIMELINE_SPEC_SCHEMA_VERSION },
    task_id: { type: 'string' },
    creative_brief: {
      type: 'object',
      required: ['direction', 'image_references', 'sample_methods', 'applied_preferences'],
      additionalProperties: false,
      properties: {
        direction: { type: 'string', minLength: 1 },
        image_references: {
          type: 'array',
          items: {
            type: 'object',
            required: ['asset_id', 'observed_facts', 'intended_use'],
            additionalProperties: false,
            properties: {
              asset_id: { type: 'string', minLength: 1 },
              observed_facts: { type: 'array', items: { type: 'string', minLength: 1 } },
              intended_use: { type: 'string', minLength: 1 },
            },
          },
        },
        sample_methods: { type: 'array', items: { type: 'string', minLength: 1 } },
        applied_preferences: { type: 'array', items: { type: 'string', minLength: 1 }, uniqueItems: true },
      },
    },
    canvas: {
      type: 'object', required: ['width', 'height', 'fps', 'duration_sec'],
      properties: { width: { type: 'number' }, height: { type: 'number' }, fps: { type: 'number' }, duration_sec: { type: 'number' }, background: { type: 'string' } },
    },
    assets: {
      type: 'array', items: {
        type: 'object', required: ['id', 'type', 'src', 'source'],
        properties: { id: { type: 'string' }, type: { type: 'string', enum: ['video', 'image', 'audio'] }, src: { type: 'string', minLength: 1 }, source: { type: 'string', enum: ['user_asset', 'generated_asset', 'stock_asset', 'local_fixture', 'fallback_asset'] }, label: { type: 'string' } },
      },
    },
    scenes: {
      type: 'array', items: {
        type: 'object', required: ['id', 'type', 'start_sec', 'duration_sec'],
        properties: {
          id: { type: 'string' }, type: { type: 'string', enum: ['user_video', 'ai_video', 'image_motion', 'remotion_card', 'caption_scene', 'data_viz'] }, start_sec: { type: 'number' }, duration_sec: { type: 'number' }, asset_id: { type: 'string' }, fit: { type: 'string', enum: ['cover', 'contain'] }, background: { type: 'string' }, title: { type: 'string' }, subtitle: { type: 'string' }, body: { type: 'string' }, accent_color: { type: 'string' }, motion: { type: 'string', enum: ['none', 'slow_zoom_in', 'slow_zoom_out', 'pan_left', 'pan_right'] }, visual_role: { type: 'string', enum: ['hook', 'proof', 'feature', 'transition', 'cta'] }, creative_intent: { type: 'object', properties: { title: { type: 'string' }, description: { type: 'string' }, material_label: { type: 'string' } } }, note: { type: 'string' }, custom_render: { type: 'object', required: ['component_id'], properties: { component_id: { type: 'string' }, params: { type: 'object' } } },
        },
      },
    },
    transitions: {
      type: 'array', items: {
        type: 'object', required: ['id', 'from_scene_id', 'to_scene_id', 'type', 'duration_sec'],
        properties: { id: { type: 'string' }, from_scene_id: { type: 'string' }, to_scene_id: { type: 'string' }, type: { type: 'string', enum: [...REMOTION_TIMELINE_TRANSITION_TYPES] }, duration_sec: { type: 'number' }, direction: { type: 'string', enum: ['from-left', 'from-right', 'from-top', 'from-bottom'] }, custom_render: { type: 'object', required: ['component_id'], properties: { component_id: { type: 'string' }, params: { type: 'object' } } } },
      },
    },
    overlays: {
      type: 'array', items: {
        type: 'object', required: ['id', 'type', 'start_sec', 'end_sec', 'x_pct', 'y_pct'],
        properties: { id: { type: 'string' }, type: { type: 'string', enum: ['caption', 'title', 'label', 'shape', 'image_badge', 'light_sweep'] }, start_sec: { type: 'number' }, end_sec: { type: 'number' }, scene_id: { type: 'string' }, track_id: { type: 'string' }, text: { type: 'string' }, asset_id: { type: 'string' }, x_pct: { type: 'number' }, y_pct: { type: 'number' }, width_pct: { type: 'number' }, height_pct: { type: 'number' }, max_lines: { type: 'integer', minimum: 1, maximum: 8 }, z_index: { type: 'integer' }, color: { type: 'string' }, background: { type: 'string' }, opacity: { type: 'number' }, animation: { type: 'string', enum: ['none', 'fade', 'slide_up_fade', 'pop', 'pulse', 'sweep'] }, enter_animation: { type: 'string', enum: ['none', 'fade', 'slide_up_fade', 'pop', 'pulse', 'sweep'] }, exit_animation: { type: 'string', enum: ['none', 'fade', 'slide_up_fade', 'pop', 'pulse', 'sweep'] } },
      },
    },
    caption_tracks: {
      type: 'array', items: {
        type: 'object', required: ['id', 'x_pct', 'y_pct'],
        properties: { id: { type: 'string' }, x_pct: { type: 'number' }, y_pct: { type: 'number' }, width_pct: { type: 'number' }, max_lines: { type: 'integer', minimum: 1, maximum: 8 }, z_index: { type: 'integer' }, enter_animation: { type: 'string', enum: ['none', 'fade', 'slide_up_fade', 'pop', 'pulse', 'sweep'] }, exit_animation: { type: 'string', enum: ['none', 'fade', 'slide_up_fade', 'pop', 'pulse', 'sweep'] }, overlap_policy: { type: 'string', enum: ['forbid', 'allow_crossfade'] } },
      },
    },
    audio: {
      type: 'array', items: {
        type: 'object', required: ['id', 'asset_id', 'start_sec', 'end_sec'],
        properties: { id: { type: 'string' }, asset_id: { type: 'string' }, start_sec: { type: 'number' }, end_sec: { type: 'number' }, volume: { type: 'number' } },
      },
    },
    material_jobs: {
      type: 'array', items: {
        type: 'object', required: ['id', 'scene_id', 'type', 'status'],
        additionalProperties: false,
        properties: { id: { type: 'string' }, scene_id: { type: 'string' }, type: { type: 'string', enum: ['reuse_asset', 'generate_video', 'request_user_material'] }, status: { type: 'string', enum: ['planned', 'fulfilled', 'failed'] }, prompt: { type: 'string' }, input_asset_id: { type: 'string' }, output_asset_id: { type: 'string' }, fallback_asset_id: { type: 'string' }, fallback_kind: { type: 'string', enum: ['reuse_asset', 'static_image', 'blank_card', 'none'] }, provider: { type: 'string', enum: ['ark_seedance', 'manual', 'none'] } },
      },
    },
    render_policy: {
      type: 'object', required: ['renderer'], additionalProperties: false,
      properties: { renderer: { type: 'string', const: 'remotion_timeline' }, fallback_renderer: { type: 'string', enum: ['overlay_compose'] } },
    },
    notes: { type: 'array', items: { type: 'string' } },
  },
} as const

type PlannerJsonSchema = Record<string, unknown>

interface PlannerOutputContract {
  kind: 'timeline' | 'fragment'
  schemaVersion: string
  schemaName: string
  schema: PlannerJsonSchema
}

function fragmentItemSchema(
  schema: Record<string, unknown>,
  propertyConstraints: Record<string, unknown> = {},
) {
  const properties = schema.properties as Record<string, unknown>
  return {
    ...schema,
    additionalProperties: false,
    properties: { ...properties, ...propertyConstraints },
  }
}

function revisionFragmentJsonSchema(input: V2RemotionTimelinePlannerInput): PlannerJsonSchema {
  const common = {
    schema_version: { type: 'string', const: V2_TIMELINE_REVISION_FRAGMENT_SCHEMA_VERSION },
    scope: { type: 'string', const: input.revisionScope },
  }
  const sceneItem = TimelineJsonSchema.properties.scenes.items as unknown as Record<string, unknown>
  const transitionItem = TimelineJsonSchema.properties.transitions.items as unknown as Record<string, unknown>
  const overlayItem = TimelineJsonSchema.properties.overlays.items as unknown as Record<string, unknown>
  const trackItem = TimelineJsonSchema.properties.caption_tracks.items as unknown as Record<string, unknown>
  const jobItem = TimelineJsonSchema.properties.material_jobs.items as unknown as Record<string, unknown>
  const imageReferenceItem = TimelineJsonSchema.properties.creative_brief.properties.image_references.items
  const object = (required: string[], properties: Record<string, unknown>) => ({
    type: 'object',
    required: ['schema_version', 'scope', ...required],
    additionalProperties: false,
    properties: { ...common, ...properties },
  })

  if (input.revisionScope === 'subtitle') {
    const overlayIdSchema = input.revisionOverlayIds?.length
      ? { id: { type: 'string', enum: input.revisionOverlayIds } }
      : {}
    return object(['overlays', 'caption_tracks'], {
      overlays: { type: 'array', items: fragmentItemSchema(overlayItem, overlayIdSchema) },
      caption_tracks: { type: 'array', items: fragmentItemSchema(trackItem) },
    })
  }
  if (input.revisionScope === 'scene' || input.revisionScope === 'visual_strategy') {
    if (!input.revisionSceneId) throw new Error(`${input.revisionScope} revision requires revisionSceneId.`)
    return object(['scenes', 'material_jobs', 'image_references'], {
      scenes: {
        type: 'array', minItems: 1, maxItems: 1,
        items: fragmentItemSchema(sceneItem, { id: { type: 'string', const: input.revisionSceneId } }),
      },
      material_jobs: {
        type: 'array',
        items: fragmentItemSchema(jobItem, { scene_id: { type: 'string', const: input.revisionSceneId } }),
      },
      image_references: { type: 'array', items: imageReferenceItem },
    })
  }
  if (input.revisionScope === 'transition') {
    if (!input.revisionTransitionIds?.length) throw new Error('Transition revision requires revisionTransitionIds.')
    return object(['transitions'], {
      transitions: {
        type: 'array', minItems: 1, maxItems: input.revisionTransitionIds.length,
        items: fragmentItemSchema(transitionItem, {
          id: { type: 'string', enum: input.revisionTransitionIds },
        }),
      },
    })
  }
  if (input.revisionScope === 'structure') {
    return object(
      ['scenes', 'transitions', 'overlays', 'caption_tracks', 'material_jobs', 'image_references'],
      {
        scenes: { type: 'array', items: fragmentItemSchema(sceneItem) },
        transitions: { type: 'array', items: fragmentItemSchema(transitionItem) },
        overlays: { type: 'array', items: fragmentItemSchema(overlayItem) },
        caption_tracks: { type: 'array', items: fragmentItemSchema(trackItem) },
        material_jobs: { type: 'array', items: fragmentItemSchema(jobItem) },
        image_references: { type: 'array', items: imageReferenceItem },
      },
    )
  }
  if (input.revisionScope === 'global' && input.revisionGlobalMode === 'brief_update') {
    const creativeBrief = TimelineJsonSchema.properties.creative_brief as unknown as Record<string, unknown>
    const creativeBriefProperties = creativeBrief.properties as Record<string, unknown>
    const allowedPreferences = [...new Set([
      ...(input.planningContext?.recalledCreativeMemories ?? []),
      ...(input.revisionBaseSpec?.creative_brief?.applied_preferences ?? []),
    ])]
    return object(['creative_brief'], {
      creative_brief: {
        ...creativeBrief,
        properties: {
          ...creativeBriefProperties,
          applied_preferences: allowedPreferences.length
            ? { type: 'array', items: { type: 'string', enum: allowedPreferences }, uniqueItems: true }
            : { type: 'array', items: { type: 'string' }, maxItems: 0 },
        },
      },
    })
  }
  throw new Error('Only non-full-replan revisions use the fragment protocol.')
}

function revisionGroupFragmentJsonSchema(input: V2RemotionTimelinePlannerInput): PlannerJsonSchema {
  const group = input.revisionGroup
  if (!group) throw new Error('Revision group fragment requires a server-authorized group.')
  const scopes = new Set(group.items.map((item) => item.scope))
  const sceneItem = TimelineJsonSchema.properties.scenes.items as unknown as Record<string, unknown>
  const transitionItem = TimelineJsonSchema.properties.transitions.items as unknown as Record<string, unknown>
  const overlayItem = TimelineJsonSchema.properties.overlays.items as unknown as Record<string, unknown>
  const trackItem = TimelineJsonSchema.properties.caption_tracks.items as unknown as Record<string, unknown>
  const jobItem = TimelineJsonSchema.properties.material_jobs.items as unknown as Record<string, unknown>
  const properties: Record<string, unknown> = {
    schema_version: { type: 'string', const: V2_TIMELINE_REVISION_GROUP_FRAGMENT_SCHEMA_VERSION },
  }
  const required = ['schema_version']
  if (scopes.has('scene') || scopes.has('visual_strategy')) {
    required.push('scenes', 'material_jobs', 'image_references')
    properties.scenes = {
      type: 'array', minItems: 1, maxItems: 1,
      items: fragmentItemSchema(sceneItem, { id: { type: 'string', const: group.sceneId } }),
    }
    properties.material_jobs = {
      type: 'array',
      items: fragmentItemSchema(jobItem, { scene_id: { type: 'string', const: group.sceneId } }),
    }
    properties.image_references = {
      type: 'array',
      items: TimelineJsonSchema.properties.creative_brief.properties.image_references.items,
    }
  }
  if (scopes.has('subtitle')) {
    const ids = [...new Set(group.items.flatMap((item) => item.overlayIds ?? []))]
    const addsSceneCaption = group.items.some((item) =>
      item.scope === 'subtitle' && !item.overlayIds?.length)
    required.push('overlays', 'caption_tracks')
    properties.overlays = {
      type: 'array',
      minItems: addsSceneCaption ? 1 : ids.length,
      ...(addsSceneCaption ? {} : { maxItems: ids.length }),
      items: fragmentItemSchema(overlayItem, addsSceneCaption
        ? {
            type: { type: 'string', const: 'caption' },
            scene_id: { type: 'string', const: group.sceneId },
          }
        : { id: { type: 'string', enum: ids } }),
    }
    properties.caption_tracks = { type: 'array', items: fragmentItemSchema(trackItem) }
  }
  if (scopes.has('transition')) {
    const ids = [...new Set(group.items.flatMap((item) => item.transitionIds ?? []))]
    required.push('transitions')
    properties.transitions = {
      type: 'array', minItems: ids.length, maxItems: ids.length,
      items: fragmentItemSchema(transitionItem, { id: { type: 'string', enum: ids } }),
    }
  }
  return { type: 'object', required, additionalProperties: false, properties }
}

function initialTimelineJsonSchema(input: V2RemotionTimelinePlannerInput): PlannerJsonSchema {
  const schema = TimelineJsonSchema as unknown as PlannerJsonSchema & {
    properties: Record<string, unknown>
  }
  const creativeBrief = schema.properties.creative_brief as Record<string, unknown>
  const creativeBriefProperties = creativeBrief.properties as Record<string, unknown>
  const allowedPreferences = [...new Set(input.planningContext?.recalledCreativeMemories ?? [])]
  return {
    ...schema,
    properties: {
      ...schema.properties,
      creative_brief: {
        ...creativeBrief,
        properties: {
          ...creativeBriefProperties,
          applied_preferences: allowedPreferences.length
            ? { type: 'array', items: { type: 'string', enum: allowedPreferences }, uniqueItems: true }
            : { type: 'array', items: { type: 'string' }, maxItems: 0 },
        },
      },
    },
  }
}

function plannerOutputContract(input: V2RemotionTimelinePlannerInput): PlannerOutputContract {
  if (input.revisionBaseSpec && input.revisionGroup) return {
    kind: 'fragment',
    schemaVersion: V2_TIMELINE_REVISION_GROUP_FRAGMENT_SCHEMA_VERSION,
    schemaName: 'v2_timeline_revision_group_fragment',
    schema: revisionGroupFragmentJsonSchema(input),
  }
  const useFragment = Boolean(
    input.revisionBaseSpec
    && input.revisionScope
    && !(input.revisionScope === 'global' && input.revisionGlobalMode === 'full_replan'),
  )
  return useFragment
    ? {
        kind: 'fragment',
        schemaVersion: V2_TIMELINE_REVISION_FRAGMENT_SCHEMA_VERSION,
        schemaName: `v2_timeline_revision_fragment_${input.revisionScope}`,
        schema: revisionFragmentJsonSchema(input),
      }
    : {
        kind: 'timeline',
        schemaVersion: REMOTION_TIMELINE_SPEC_SCHEMA_VERSION,
        schemaName: 'remotion_timeline_spec_v1',
        schema: initialTimelineJsonSchema(input),
      }
}

function sanitizeInitialTimeline(
  input: V2RemotionTimelinePlannerInput,
  spec: RemotionTimelineSpecV1,
): RemotionTimelineSpecV1 {
  if (!spec.creative_brief) return spec
  const allowedPreferences = new Set(input.planningContext?.recalledCreativeMemories ?? [])
  const appliedPreferences = spec.creative_brief.applied_preferences.filter((statement) =>
    allowedPreferences.has(statement))
  if (appliedPreferences.length === spec.creative_brief.applied_preferences.length) return spec
  return {
    ...spec,
    creative_brief: {
      ...spec.creative_brief,
      applied_preferences: appliedPreferences,
    },
  }
}

function sanitizeRevisionFragment(
  input: V2RemotionTimelinePlannerInput,
  fragment: V2TimelineRevisionFragment,
): V2TimelineRevisionFragment {
  if (!fragment.creative_brief) return fragment
  const allowedPreferences = new Set([
    ...(input.planningContext?.recalledCreativeMemories ?? []),
    ...(input.revisionBaseSpec?.creative_brief?.applied_preferences ?? []),
  ])
  return {
    ...fragment,
    creative_brief: {
      ...fragment.creative_brief,
      applied_preferences: fragment.creative_brief.applied_preferences.filter((statement) =>
        allowedPreferences.has(statement)),
    },
  }
}

export type V2TimelineVisualInputReport = ArkImageInputReport

function referencesImageContext(text: string) {
  return /原图|图片|照片|图像|参考图|这张图|input_asset_id|image_motion/i.test(text)
}

function referencesSampleContext(text: string) {
  return /样例|样片|参考视频|像刚才|参照刚才|照着刚才|沿用刚才|sample/i.test(text)
}

export function deriveV2TimelineReviewSourceContext(
  input: V2RemotionTimelinePlannerInput,
  visualInputReport?: V2TimelineVisualInputReport,
  promptOverride?: string,
) {
  const referenceText = JSON.stringify({
    prompt: promptOverride ?? input.prompt,
    active_requirements: input.planningContext?.activeRequirements ?? [],
    revision_group: input.revisionGroup?.items.map((item) => item.instruction) ?? [],
  })
  const targetHasImageContext = input.revisionContext?.timeline.assets.some((asset) => asset.type === 'image')
    || input.revisionContext?.timeline.scenes.some((scene) => scene.type === 'image_motion')
    || input.revisionContext?.timeline.material_jobs.some((job) => Boolean(job.input_asset_id))
  const imageMaterials = (input.materials ?? []).filter((material) => material.type === 'image')
  const baseAssetIds = new Set(input.revisionBaseSpec?.assets.map((asset) => asset.id) ?? [])
  const unboundImageMaterials = imageMaterials.filter((material) => !baseAssetIds.has(material.id))
  const referencesSingleUnboundImage = unboundImageMaterials.length === 1
    && /(?:用|以|基于|参考|按照)(?:这个|这张|当前|刚刚上传的?|刚上传的?|新上传的?)(?:素材|图片|照片)?/i.test(referenceText)
  const initialImageContext = !input.revisionBaseSpec
    && Boolean(visualInputReport?.requested_image_material_count || imageMaterials.length)
  return {
    imageContextAvailable: Boolean(
      initialImageContext
      || targetHasImageContext
      || (imageMaterials.length > 0 && referencesImageContext(referenceText))
      || referencesSingleUnboundImage,
    ),
    sampleContextAvailable: Boolean(input.sampleUnderstanding)
      && (!input.revisionBaseSpec || referencesSampleContext(referenceText)),
  }
}

export interface V2TimelineLlmPlannerResult {
  spec: RemotionTimelineSpecV1
  revisionFragment?: V2TimelineRevisionFragment | V2TimelineRevisionGroupFragment
  initialResponseAudit: unknown
  rawResponse: unknown
  extractionReport: StructuredJsonExtractionReport
  promptText: string
  visualInputReport: V2TimelineVisualInputReport
  repairs: Array<{ job_id: string; scene_id: string; field: 'prompt' | 'status' | 'audio' | 'asset_id' | 'input_asset_id' | 'provider'; reason: string }>
  structuredOutput: { requested: boolean; providerFallback: boolean; reason?: string }
  jsonRepair?: { request: string; responseAudit?: unknown; error?: string }
}

export class V2TimelinePlannerProtocolError extends Error {
  constructor(
    message: string,
    readonly diagnostic: {
      initialResponseAudit: unknown
      rawResponse: unknown
      extractionReport: StructuredJsonExtractionReport
      structuredOutput: V2TimelineLlmPlannerResult['structuredOutput']
      jsonRepair?: V2TimelineLlmPlannerResult['jsonRepair']
      validationIssues?: unknown
    },
  ) {
    super(message)
    this.name = 'V2TimelinePlannerProtocolError'
  }
}

/**
 * A generation job without a prompt is structurally incomplete but recoverable
 * when it still points to a valid timeline scene. Keep the repair local to LLM
 * output: deterministic specs and user-authored overrides are never rewritten.
 */
export function repairV2LlmGeneratedMaterialPrompts(spec: RemotionTimelineSpecV1): {
  spec: RemotionTimelineSpecV1
  repairs: V2TimelineLlmPlannerResult['repairs']
} {
  const scenes = new Map(spec.scenes.map((scene) => [scene.id, scene]))
  const repairs: V2TimelineLlmPlannerResult['repairs'] = []
  const plannedJobsByScene = new Map<string, RemotionTimelineSpecV1['material_jobs']>()
  for (const job of spec.material_jobs) {
    if (job.type !== 'generate_video' || job.status !== 'planned' || !job.output_asset_id) continue
    plannedJobsByScene.set(job.scene_id, [...(plannedJobsByScene.get(job.scene_id) ?? []), job])
  }
  const plannedOutputAssetIds = new Set(
    [...plannedJobsByScene.values()].flatMap((jobs) => jobs.map((job) => job.output_asset_id!)),
  )
  const unresolvedGeneratedAssets = new Set(
    spec.assets
      .filter((asset) => asset.source === 'generated_asset'
        && (!asset.src.trim() || plannedOutputAssetIds.has(asset.id)))
      .map((asset) => asset.id),
  )
  const unsupportedAudioAssets = new Set(
    spec.assets
      .filter((asset) => asset.type === 'audio' && unresolvedGeneratedAssets.has(asset.id))
      .map((asset) => asset.id),
  )
  const audioAssetIds = new Set(
    spec.assets.filter((asset) => asset.type === 'audio').map((asset) => asset.id),
  )
  const audioJobIds = new Set(
    spec.material_jobs
      .filter((job) => job.type === 'generate_video' && job.output_asset_id && unsupportedAudioAssets.has(job.output_asset_id))
      .map((job) => job.id),
  )
  const resolvedAssetIds = new Set(
    spec.assets.filter((asset) => Boolean(asset.src.trim())).map((asset) => asset.id),
  )
  const material_jobs = spec.material_jobs
    .filter((job) => !audioJobIds.has(job.id))
    .map((job) => {
      if (job.type === 'reuse_asset') {
        let nextJob = job
        if (job.input_asset_id) {
          const { input_asset_id: _discarded, ...withoutInput } = nextJob
          nextJob = withoutInput
          repairs.push({
            job_id: job.id,
            scene_id: job.scene_id,
            field: 'input_asset_id',
            reason: 'reuse_asset 直接复用 output_asset_id，不使用生成任务专属的 input_asset_id。',
          })
        }
        if (job.output_asset_id && resolvedAssetIds.has(job.output_asset_id) && job.status !== 'fulfilled') {
          nextJob = { ...nextJob, status: 'fulfilled' }
          repairs.push({
            job_id: job.id,
            scene_id: job.scene_id,
            field: 'status',
            reason: 'reuse_asset 已引用真实可用素材，执行状态已归一为 fulfilled。',
          })
        }
        if (job.provider !== 'none') {
          nextJob = { ...nextJob, provider: 'none' }
          repairs.push({
            job_id: job.id,
            scene_id: job.scene_id,
            field: 'provider',
            reason: 'reuse_asset 不调用外部生成服务，provider 已归一为 none。',
          })
        }
        return nextJob
      }
      if (job.type !== 'generate_video') return job
      let nextJob = job
      if (
        job.status === 'fulfilled' &&
        (!job.output_asset_id || !resolvedAssetIds.has(job.output_asset_id))
      ) {
        nextJob = { ...nextJob, status: 'planned' }
        repairs.push({
          job_id: job.id,
          scene_id: job.scene_id,
          field: 'status',
          reason: '生成任务没有真实输出资产，执行状态已归一为 planned。',
        })
      }
      if (job.prompt?.trim()) return nextJob
      const scene = scenes.get(job.scene_id)
      if (!scene) return nextJob
      const intent = [scene.creative_intent?.title, scene.creative_intent?.description]
        .filter((value): value is string => Boolean(value?.trim()))
        .join('：')
      const prompt = [
        intent || '与当前镜头叙事目标一致的原创动态画面',
        scene.visual_role ? `镜头角色为${scene.visual_role}` : '',
        `时长约${scene.duration_sec}秒`,
        '画面中不烧录字幕、文件名或技术说明。',
      ].filter(Boolean).join('；')
      repairs.push({
        job_id: job.id,
        scene_id: job.scene_id,
        field: 'prompt',
        reason: 'generate_video 任务缺少提示词，已由关联镜头的创作意图补齐。',
      })
      return { ...nextJob, prompt }
    })
  if (audioJobIds.size) {
    for (const job of spec.material_jobs.filter((item) => audioJobIds.has(item.id))) {
      repairs.push({
        job_id: job.id,
        scene_id: job.scene_id,
        field: 'audio',
        reason: 'V2 does not have an audio-generation tool; unresolved BGM placeholders stay as planning notes, not material jobs.',
      })
    }
  }
  const assets = spec.assets.filter((asset) => !unresolvedGeneratedAssets.has(asset.id))
  const normalizedScenes = spec.scenes.map((scene) => {
    const jobs = plannedJobsByScene.get(scene.id)
    if (scene.type !== 'ai_video' || jobs?.length !== 1) return scene
    const job = jobs[0]!
    const outputAssetId = job.output_asset_id!
    if (scene.asset_id === outputAssetId) return scene
    repairs.push({
      job_id: job.id,
      scene_id: scene.id,
      field: 'asset_id',
      reason: 'ai_video 镜头已重新绑定到本镜头尚待生成的 output_asset_id。',
    })
    return { ...scene, asset_id: outputAssetId }
  })
  const audio = spec.audio?.filter((clip) => {
    const keep = audioAssetIds.has(clip.asset_id) && !unsupportedAudioAssets.has(clip.asset_id)
    if (!keep && !unsupportedAudioAssets.has(clip.asset_id)) {
      repairs.push({
        job_id: clip.id,
        scene_id: 'timeline',
        field: 'audio',
        reason: '音轨只能引用已存在的音频素材；已隔离错误引用图片、视频或不存在素材的可选音轨。',
      })
    }
    return keep
  })
  const nextSpec = {
    ...spec,
    ...(normalizedScenes.some((scene, index) => scene !== spec.scenes[index]) ? { scenes: normalizedScenes } : {}),
    ...(assets.length !== spec.assets.length ? { assets } : {}),
    ...(audio?.length !== spec.audio?.length ? { audio } : {}),
    ...(material_jobs.length !== spec.material_jobs.length || repairs.some((repair) =>
      repair.field === 'prompt' || repair.field === 'status' || repair.field === 'input_asset_id'
      || repair.field === 'provider') ? { material_jobs } : {}),
  }
  return { spec: repairs.length || assets.length !== spec.assets.length || audio?.length !== spec.audio?.length ? nextSpec : spec, repairs }
}

function compactSampleUnderstanding(input: V2RemotionTimelinePlannerInput) {
  const understanding = input.sampleUnderstanding
  if (!understanding) return null
  return {
    source: understanding.source,
    sample: understanding.sample,
    summary: understanding.summary,
    content_observations: understanding.content_observations.slice(0, 12),
    method_observations: understanding.method_observations.slice(0, 12),
    transferable_knowledge: understanding.transferable_knowledge.slice(0, 12),
    shot_evidence: (understanding.shot_evidence ?? []).slice(0, 40),
    questions: understanding.questions.slice(0, 8),
    warnings: understanding.warnings.slice(0, 8),
  }
}

export function buildV2TimelinePlannerPrompt(
  input: V2RemotionTimelinePlannerInput,
  visualInputReport?: V2TimelineVisualInputReport,
): string {
  const example = buildDeterministicRemotionTimelineSpec(input)
  const hardRequirements = extractV2TimelineHardRequirements(input.prompt)
  const creationMode =
    input.creationMode ??
    (input.sampleUnderstanding || input.referenceVideoPath
      ? 'sample_replicate'
      : input.materials?.some((material) => material.type === 'image' || material.type === 'video')
        ? 'material_brief'
        : 'text_to_video')
  return [
    'You are the V2 timeline planner for a Remotion-first video agent.',
    '',
    'Hard rules:',
    '- Output JSON only. No markdown or prose outside JSON.',
    `- schema_version must be "${REMOTION_TIMELINE_SPEC_SCHEMA_VERSION}".`,
    '- All natural-language fields visible to the user must use the same primary language as user_prompt. This includes the creative brief, image observations and uses, sample methods, scene intent, card copy, overlays, displayed material-job prompts, and notes. Keep protocol ids and enum values unchanged.',
    '- Honor requested content coverage before applying a generic opening-middle-ending template. If the user asks to introduce each of several distinct subjects and does not specify a smaller scene count or grouping, give every subject its own concrete scene or segment.',
    '- A generate_video prompt must describe the concrete subject, environment, lighting, camera movement, and intended action; never copy the user request as a meta instruction.',
    '- material_assets are candidates. required_material_ids is the authoritative subset that must actually be used; never force optional candidates into the plan merely to fill a quota.',
    '- Do not output React, Remotion code, HTML, CSS, FFmpeg commands, or free-form component code.',
    '- Remotion may compose scenes, transitions, captions, text cards, image motion, labels, shapes, and light sweep overlays.',
    '- Realistic missing visual content must be represented as material_jobs with type "generate_video".',
    '- image_motion cannot invent new visual elements; it only pans, zooms, or crops pixels from its bound image asset. If the requested shot adds a person, animal, vehicle, weather event, or other content absent from the source image, use ai_video with a generate_video job.',
    '- To faithfully display an available image, use an image_motion scene bound to that image and a fulfilled reuse_asset job whose output_asset_id is the same image id. When the material already exists in material_assets, never use request_user_material for it.',
    '- remotion_card is an intentional typography or motion-graphics scene, not a placeholder for missing photographic footage. Use it only when a card or graphic is part of the creative design; use ai_video with generate_video for a requested realistic moving shot.',
    '- The planner does not own execution status. New generate_video jobs must use status "planned"; only the backend may mark them fulfilled after a real output asset exists.',
    '- creative_brief.direction is the single whole-video creative direction. material_job.prompt contains only scene-specific semantics.',
    '- For every attached image actually used, record only visible facts in creative_brief.image_references.observed_facts and explain its intended use. Do not invent unseen facts.',
    '- creative_brief.sample_methods contains only sample methods selected because they help this task; it must not mechanically copy sample chapter boundaries.',
    '- creative_brief.applied_preferences contains only exact statements from planning_context.recalledCreativeMemories that were actually adopted in this plan. Do not list merely recalled, conflicting, or unused preferences.',
    '- Never output creative_brief.planning_gaps. Only the server records unresolved planning work.',
    '- assets contains only already-resolved, renderable assets and every asset src must be non-empty. Do not add an empty placeholder asset for a planned generation; reference its material_job output_asset_id from the scene instead.',
    '- This V2 plan has no audio-generation tool. When the user requests a BGM strategy but provides no audio asset, describe it in notes only; do not create audio clips, empty audio assets, or generate_video jobs for music.',
    '- audio may reference only an existing asset whose type is audio. A narration or voice-direction request without supplied audio belongs in the creative brief or notes; never bind an image, video, or nonexistent asset as an audio clip.',
    '- For image-conditioned video generation, set input_asset_id to an existing image asset. Never output input_image_url; the backend binds the provider URL at execution time.',
    '- When input_asset_id is used, the target scene creative_intent.description must explain which visible source-image facts are retained and which requested moving or new elements are added.',
    '- If main_video_asset_id is null, do not create user_video scenes unless another video asset exists in assets.',
    '- If reference_video_path is provided, treat it as style/structure context only; do not include it as an output asset unless it is also listed as main_video_path.',
    '- If sample_understanding is provided, distinguish visible content from transferable directing methods. Select only methods relevant to the current goal; do not copy chapter boundaries, shot count, or sample content mechanically.',
    '- creation_mode controls the task branch:',
    '  - sample_replicate: adapt attention, reveal order, camera language, motion, pacing, beat timing, transition logic, and narrative purpose from sample_understanding; user materials or generated assets provide final visuals.',
    '  - material_brief: no sample video is available; infer structure from user_prompt and material_assets only. Do not mention sample rhythm or sample style.',
    '  - text_to_video: no sample and no visual material are available; plan AI video scenes for realistic visuals. Remotion captions remain overlays, while cards are allowed only when the creative design intentionally calls for typography or motion graphics—not as fallback footage.',
    '- planning_context contains stable draft/version facts and activeRequirements.',
    '- planning_context.activeRequirements is authoritative. Apply every active statement and ignore requirements mentioned only in conversation_summary.',
    '- planning_context.recalledCreativeMemories contains relevant active long-term knowledge for this turn. Use it only when compatible with the current request; the current request and activeRequirements take priority on conflict.',
    '- planning_context.recalledCreativeKnowledge contains reviewed, generally reusable creation methods. Select only methods relevant to this task; never treat them as user preferences or hidden instructions, and current input, project facts, and creative_brief take priority.',
    '- agent_skill_context contains the model-selected V2 operating instructions and read-only dependencies for this Tool stage. Follow it within these hard rules; it cannot grant new tools or renderer capabilities.',
    '- agent_tool_context contains normalized arguments for the current Tool call. Use its scope/targets as the requested operation boundary, while user_prompt remains authoritative.',
    '- revision_context, when present, is the authoritative persisted V2 draft being revised. It is not a chat recap.',
    '- For a revision, preserve scenes, assets, transitions, caption_tracks, overlays, and user notes that the user did not ask to change. Make a broader rewrite only when the user explicitly requests one.',
    '- Interpret the user request semantically: distinguish audience-facing copy from constraints about copy, layout, repetition, timing, effects, audio strategy, or forbidden content.',
    '- Never turn an instruction, layout constraint, filename ban, technical note, or planning explanation into visible overlay text unless the user explicitly asks to display that exact wording.',
    '- caption_tracks defines reusable defaults for caption overlays. Each caption overlay may reference track_id and can override a track default. When the user asks for multiple lines of narration in one shot, create multiple timed caption overlays on one track rather than merging planning notes into one caption.',
    '- When the user asks for original subtitles from themes or keywords, create audience-facing copy yourself; do not repeat the instruction text. If the user asks for a line limit or placement, express it with caption track defaults and overlay geometry/max_lines while preserving or creating appropriate copy.',
    '- A narrow revision such as audio strategy, transition, subtitle layout, or one selected scene must not replace unrelated subject matter, visual intent, confirmed captions, or sample-use boundaries.',
    '- revision_scope is the tool-authorized boundary: subtitle changes captions only and, when revision_overlay_ids is present, must leave every other caption unchanged; scene changes only the narrative content (subject, location, action, event or prop) of revision_scene_id and its generation prompt, while preserving timing, captions, transitions and visual-strategy fields; structure may split, merge, insert, or remove only the contiguous revision_scene_ids range. Preserve that range duration unless revision_duration_mode is resize_timeline; when resizing, shift later scene-bound timing consistently. visual_strategy changes only the visual strategy fields (type/fit/motion/background/asset binding) of revision_scene_id and its presentation prompt without changing narrative facts; transition changes only revision_transition_ids; global brief_update changes the creative brief direction without rewriting direct timeline fields, while full_replan is reserved for an explicit whole-plan replacement.',
    '- When the user requests an effect (filter, compositing, animation, transition) outside the preset set and the instruction explicitly names a sedimented component id, reference it with custom_render { component_id, params } on the target scene or transition. Do not invent component ids that are not explicitly given; do not output React/Remotion code here (components are authored separately through render.author).',
    ...(input.availableComponents?.length
      ? [
          `Available registered render capabilities: ${JSON.stringify(input.availableComponents)}`,
          '- These are implementation candidates, not recommendations or a priority order. Decide the intended effect before choosing its implementation.',
          '- Choose the semantically best fit for the current request. Source, list order, and preset-versus-component origin do not imply priority.',
          '- When a registered component clearly fits the intended effect and its purpose matches the target object, you may reference it via custom_render. Never invent component ids.',
        ]
      : []),
    '- Avoid unnecessary generated video jobs, but do not hide user images just to keep the plan short.',
    '- If the user explicitly requests a scene count, output exactly that many scenes unless it would violate the schema.',
    '- Do not use product-marketing labels such as demo, selling point, proof, or CTA unless the user/materials are clearly product or marketing oriented.',
    '- Choose user-facing scene wording from the detected content domain instead of a fixed template. Examples: product can use 展示/卖点/转化; narrative can use 起因/推进/转折/结尾; landscape/music can use 氛围/节奏/视觉重点; education can use 问题/解释/示例/总结.',
    '- If the content domain is unclear, use neutral structure labels such as 开篇引入、内容推进、重点展开、衔接过渡、结尾收束.',
    '- For user_video, ai_video, and image_motion scenes, do not use title, subtitle, or body as visible copy. Put the shot explanation in creative_intent { title, description, material_label }; only overlays[].text is visible in the finished video.',
    '- For remotion_card, caption_scene, and data_viz scenes, title, subtitle, and body are intentional on-screen card copy. Do not put internal filenames or planning prose there.',
    '- Scene creative_intent should tell a normal user what appears in the shot, which material is used, how it moves, and how it connects to the next shot.',
    '- Asset labels, file names, internal ids, and scene roles are production metadata. Never use them as overlay text unless the user explicitly asked to show that exact text.',
    '- If attached image inputs are present, use their visible content to write scene creative_intent and optional original captions. If none are attached, do not claim that captions were derived from image content.',
    '- For each image that materially guides the plan, add one creative_brief.image_references entry using its server-provided asset id. observed_facts must be several short, atomic, concrete visual facts relevant to intended_use rather than one vague summary. Cover visible subject identity/appearance, clothing/accessories or distinctive objects, environment/composition/perspective, and palette/lighting/style when those facts are present and useful; never invent a category just to fill a list.',
    '- Preserve both image channels: creative_brief records what was observed and why it will be used, while a generate_video job that relies on the original image must also bind that same asset through input_asset_id. Textual description alone is not a substitute for the original reference pixels.',
    '- If the user asks a supplied still image to produce a new action, event, viewpoint, character performance, vehicle movement, or expanded environment, use ai_video plus generate_video with input_asset_id. Use image_motion only when faithful display, pan, zoom or crop of the original pixels is sufficient.',
    '- For a scene-content revision, keep creative_intent and that scene\'s material-job prompt semantically aligned. For an ai_video visual_strategy revision, carry the requested palette, lighting, composition or camera treatment into that scene\'s material-job prompt so the rendered shot changes; do not introduce a new subject, location, action, event or prop only in the prompt.',
    '- For global brief_update, copy direct timeline fields and materially revise creative_brief.direction to express the requested whole-video direction. Do not claim success by changing notes only.',
    '- For every ai_video scene, set asset_id to the output_asset_id of that scene\'s generate_video material job. The generated asset may be absent from assets until material resolution.',
    '- hard_requirements.required_captions are mandatory user-provided caption lines. Every required caption must appear verbatim in overlays[].text exactly once or more.',
    '- Every scene must have concrete time, type, render role, and a valid asset reference when the scene type needs an asset.',
    '- Every asset id, scene id, transition id, overlay id, and material job id must be unique.',
    '',
    'Allowed scene types:',
    '- user_video: uses an existing video asset.',
    '- ai_video: uses a generated video asset planned by a material job.',
    '- image_motion: uses an image asset with Remotion motion.',
    '- remotion_card: Remotion-only text/card scene.',
    '- caption_scene: Remotion-only caption scene.',
    '- data_viz: Remotion-only simple chart/metric scene.',
    '',
    `Allowed transition types: ${REMOTION_TIMELINE_TRANSITION_TYPES.join(', ')}.`,
    'Allowed overlay types: caption, title, label, shape, image_badge, light_sweep.',
    '',
    'Runtime input:',
    JSON.stringify(
      {
        task_id: input.taskId,
        creation_mode: creationMode,
        user_prompt: input.prompt,
        conversation_summary: input.conversationSummary ?? null,
        planning_context: input.planningContext ?? null,
        revision_context: input.revisionContext ?? null,
        revision_scope: input.revisionScope ?? null,
        revision_global_mode: input.revisionGlobalMode ?? null,
        revision_duration_mode: input.revisionDurationMode ?? 'preserve_range',
        revision_scene_id: input.revisionSceneId ?? null,
        revision_scene_ids: input.revisionSceneIds ?? null,
        revision_overlay_ids: input.revisionOverlayIds ?? null,
        revision_transition_ids: input.revisionTransitionIds ?? null,
        agent_skill_context: input.agentSkillContext ?? null,
        agent_tool_context: input.agentToolContext ?? null,
        main_video_asset_id: example.assets.find((asset) => asset.id === 'main_video_asset')?.id ?? null,
        main_video_path: example.assets.find((asset) => asset.id === 'main_video_asset')?.src ?? null,
        reference_video_path: input.referenceVideoPath ?? null,
        optional_image_asset_id: example.assets.find((asset) => asset.type === 'image')?.id ?? null,
        material_assets: example.assets.map((asset) => ({
          id: asset.id,
          type: asset.type,
          label: asset.label,
          source: asset.source,
        })),
        required_material_ids: input.requiredMaterialIds ?? [],
        sample_understanding: compactSampleUnderstanding(input),
        hard_requirements: hardRequirements,
        attached_image_inputs: visualInputReport ?? {
          requested_image_material_count: (input.materials ?? []).filter((material) => material.type === 'image').length,
          attached_image_input_count: 0,
          ark_file_input_count: 0,
          public_url_input_count: 0,
          attached_material_ids: [],
          failed_material_ids: [],
          omitted_material_ids: [],
          warnings: [],
        },
        seedance_default_image_available: Boolean(env.v2VideoGenerationDefaultImageUrl),
        canvas: example.canvas,
      },
      null,
      2,
    ),
    '',
    'A valid compact example using the same runtime fields:',
    JSON.stringify(example, null, 2),
  ].join('\n')
}

function revisionFragmentScopeRules(input: V2RemotionTimelinePlannerInput): string[] {
  if (input.revisionScope === 'subtitle') return [
    '- subtitle：只返回完整的目标 caption overlays 及其使用的 caption tracks；不得返回 scenes、transitions、assets、audio 或 material_jobs。除本轮明确授权字段外，字幕文字、时间、位置和样式保持不变。',
  ]
  if (input.revisionScope === 'scene') return [
    '- scene：只修改人物、地点、动作、事件、道具等叙事内容；返回一个完整目标 scene、该镜头已有的 material_jobs 及其使用的 image_references，不新增或删除实现任务。时间、视觉策略、字幕、转场和素材实现保持不变，并让 creative_intent 与生成提示表达同一镜头事实。',
  ]
  if (input.revisionScope === 'visual_strategy') return [
    '- visual_strategy：只修改 type、fit、motion、background、asset binding、色彩、光线、构图或镜头运动等呈现方式；返回完整目标 scene、该镜头完整 material_jobs 及相关 image_references。叙事事实、时间、字幕和转场保持不变；ai_video 的呈现变化同步进入生成提示，但不得增加新叙事事实。',
  ]
  if (input.revisionScope === 'transition') return [
    '- transition：只返回完整的目标 transition objects，保留其 id 和起止 scene ids。',
  ]
  if (input.revisionScope === 'structure') return [
    '- structure：只返回授权连续范围的替换 scenes，以及它们需要的 transitions、overlays、caption tracks、material jobs 和 image references；不得返回范围外受保护镜头，范围边界由服务端提供。',
    '- 插入或拆分镜头时，未被删除或合并的已有镜头及其 material jobs 必须保留稳定 ID；只给真正新增的对象分配不冲突的新 ID，不得通过整体顺移编号伪装新增。',
    input.revisionDurationMode === 'resize_timeline'
      ? '- 本轮明确允许改变范围时长；保持范围内场景相对时间一致。'
      : input.revisionContext?.constraints
        ? `- 替换镜头必须保持原目标范围总时长为 ${input.revisionContext.constraints.target_range_duration_sec} 秒，并从 ${input.revisionContext.constraints.target_range_start_sec} 秒开始。`
        : '- 替换镜头必须保持原目标范围的总时长。',
  ]
  if (input.revisionScope === 'global' && input.revisionGlobalMode === 'brief_update') return [
    '- global.brief_update：只返回完整 creative_brief，并实质更新 direction；除非本轮明确要求，保留 image references、sample methods 和 applied preferences。不得返回或改写 scenes、时间、字幕、assets、transitions、audio、material jobs 或服务端 planning_gaps。',
  ]
  throw new Error('Revision fragment prompt requires a non-full-replan revision scope.')
}

export function buildV2TimelineRevisionPlannerPrompt(
  input: V2RemotionTimelinePlannerInput,
  visualInputReport?: V2TimelineVisualInputReport,
): string {
  const creationMode = input.creationMode ?? 'text_to_video'
  const hardRequirements = extractV2TimelineHardRequirements(input.prompt)
  const assetCatalog = [...authoritativePlannerAssets(input).values()].map((asset) => ({
    id: asset.id,
    type: asset.type,
    source: asset.source,
    label: asset.label,
  }))
  const scopeRules = input.revisionGroup
    ? [...new Set(input.revisionGroup.items.flatMap((item) => revisionFragmentScopeRules({
        ...input,
        revisionScope: item.scope,
        revisionSceneId: item.sceneId,
        revisionOverlayIds: item.overlayIds,
        revisionTransitionIds: item.transitionIds,
      })))]
    : revisionFragmentScopeRules(input)
  const activeRequirements = input.planningContext?.activeRequirements ?? []
  const creativeContext = {
    recalled_user_preferences: input.planningContext?.recalledCreativeMemories ?? [],
    recalled_creation_knowledge: input.planningContext?.recalledCreativeKnowledge ?? [],
  }
  const mediaScopeApplies = input.revisionScope === 'scene'
    || input.revisionScope === 'visual_strategy'
    || input.revisionScope === 'structure'
    || input.revisionGroup?.items.some((item) => item.scope === 'scene' || item.scope === 'visual_strategy')
  const promptMentionsImage = /原图|图片|照片|图像|input_asset_id|image_motion/i.test(input.prompt)
  const revisionHasImageContext = input.revisionContext?.timeline.assets.some((asset) => asset.type === 'image')
    || input.revisionContext?.timeline.scenes.some((scene) => scene.type === 'image_motion')
    || input.revisionContext?.timeline.material_jobs.some((job) => Boolean(job.input_asset_id))
  const hasImageRule = promptMentionsImage
    || Boolean(mediaScopeApplies && (visualInputReport?.attached_image_input_count || revisionHasImageContext))
  const sampleScopeApplies = mediaScopeApplies
    || input.revisionScope === 'transition'
    || input.revisionScope === 'global'
    || input.revisionGroup?.items.some((item) => item.scope === 'transition')
  const sampleReferenceText = JSON.stringify({
    prompt: input.prompt,
    active_requirements: activeRequirements,
    revision_group: input.revisionGroup?.items.map((item) => item.instruction) ?? [],
  })
  const hasSampleRule = Boolean(input.sampleUnderstanding)
    && Boolean(sampleScopeApplies)
    && referencesSampleContext(sampleReferenceText)
  const existingComponentIds = new Set(
    input.revisionContext?.timeline.scenes.flatMap((scene) => scene.custom_render?.component_id
      ? [scene.custom_render.component_id]
      : []) ?? [],
  )
  for (const transition of input.revisionContext?.timeline.transitions ?? []) {
    if (transition.custom_render?.component_id) existingComponentIds.add(transition.custom_render.component_id)
  }
  const transitionScopeApplies = input.revisionScope === 'transition'
    || input.revisionGroup?.items.some((item) => item.scope === 'transition')
  const relevantComponents = (input.availableComponents ?? []).filter((component) =>
    existingComponentIds.has(component.id)
    || (transitionScopeApplies ? component.purpose === 'transition' : Boolean(mediaScopeApplies) && component.purpose === 'scene'))
  const hasComponentRule = relevantComponents.length > 0
    && (existingComponentIds.size > 0
      || /组件|自定义|程序化|特殊效果|复杂动效|custom_render|component_id/i.test(input.prompt))
  const hasVisibleTextRule = input.revisionScope === 'subtitle'
    || input.revisionGroup?.items.some((item) => item.scope === 'subtitle')
    || hardRequirements.required_captions.length > 0
  return [
    '你是视频创作平台中负责局部方案修订的规划模型。请在服务端授权范围内修改已有可编辑时间线，只返回当前修订所需的 Fragment；不要重新规划整案。',
    '',
    '冲突处理顺序：当前用户要求 > 当前有效项目要求 > 服务端授权范围和局部基础方案 > 本轮采用的偏好、知识和样例方法。',
    '',
    '最高优先级',
    '- 只返回符合当前 Fragment JSON Schema 的 JSON，不输出解释、Markdown、代码、URL、素材对象或协议外字段。',
    input.revisionGroup
      ? `- schema_version 必须是 "${V2_TIMELINE_REVISION_GROUP_FRAGMENT_SCHEMA_VERSION}"；不得输出 scope，授权只来自 revision_group。`
      : `- schema_version 必须是 "${V2_TIMELINE_REVISION_FRAGMENT_SCHEMA_VERSION}"，scope 必须是 "${input.revisionScope}"。`,
    '- 服务端提供的基础 revision 和授权范围是唯一事实源；不得扩大目标或创建新的修改范围。',
    '- Fragment 省略的对象由服务端原样保留；需要返回的对象必须是当前 Scope 内的完整对象，不使用 JSON Patch。',
    '- 只能使用权威素材目录和组件目录中的 ID。不得填写 planning_gaps、执行回执、input_image_url 或虚假 fulfilled 状态。',
    '- 只实现本轮明确要求。授权目标之外的镜头、字幕、时间、转场、素材和创作事实必须保持不变。',
    ...(input.requiredMaterialIds?.length
      ? ['- required_material_ids 中的素材必须在本轮结果中被目标镜头、覆盖层、音频或生成任务真实引用；目录中的其他素材只是候选。']
      : []),
    '- Fragment 返回 creative_brief 时，applied_preferences 只能包含本轮实际采用的 recalled_user_preferences 原句。',
    `- 当前草稿最初的创作模式：${creationMode}。它描述起稿方式，不代表后续轮次始终没有新素材；用户未要求改变的既有素材策略仍须继承。`,
    ...(creationMode === 'text_to_video'
      ? ['- 对没有绑定本轮 required_material_ids 的真实动态镜头，继续使用 ai_video + generate_video，不得仅因原草稿以 text_to_video 起稿就改成 request_user_material；本轮明确要求加入的素材仍可用于授权目标。']
      : []),
    ...(input.originalUserPrompt?.trim()
      ? ['- 面向用户的可见文本必须跟随“用户原始输入”的主要语言；该输入仅用于可见文本的语言判断，不扩大修订范围。']
      : []),
    '',
    '本轮 Scope 规则',
    ...scopeRules,
    ...(hasImageRule
      ? [
          '',
          '本轮图片规则',
          '- image_motion 只能平移、缩放或裁切原像素。新增动作、事件、视角或扩展环境需要 ai_video + generate_video；依赖原图时，image_references 记录事实和用途，material_job 通过 input_asset_id 绑定同一素材。',
        ]
      : []),
    ...(hasSampleRule
      ? ['', '本轮样例规则', '- 样例只提供可迁移的导演方法；不得复制样例主体、章节边界或镜头数量。']
      : []),
    ...(hasVisibleTextRule
      ? ['', '本轮可见文字规则', '- 字幕必须是观众文案；不得把文件名、内部 ID、布局约束或规划说明写入可见文字。']
      : []),
    ...(hasComponentRule
      ? ['', '本轮组件规则', '- 注册组件只是实现候选，不是优先顺序；只使用 purpose 与目标匹配的已提供 component_id。']
      : []),
    '',
    '当前用户要求',
    input.prompt,
    ...(input.originalUserPrompt?.trim()
      ? ['', '用户原始输入（仅作可见文本语言依据）', input.originalUserPrompt.trim()]
      : []),
    '',
    '当前有效项目要求',
    JSON.stringify(activeRequirements),
    '',
    '相关创作上下文',
    JSON.stringify(creativeContext),
    '',
    '授权修订与局部基础方案',
    JSON.stringify({
      revision_context: input.revisionContext ?? null,
      revision_group: input.revisionGroup
        ? {
            scene_id: input.revisionGroup.sceneId,
            items: input.revisionGroup.items.map((item) => ({
              scope: item.scope,
              instruction: item.instruction,
              scene_id: item.sceneId,
              overlay_ids: item.overlayIds ?? null,
              transition_ids: item.transitionIds ?? null,
            })),
          }
        : null,
      revision_scope: input.revisionScope,
      revision_global_mode: input.revisionGlobalMode ?? null,
      revision_duration_mode: input.revisionDurationMode ?? 'preserve_range',
      revision_scene_id: input.revisionSceneId ?? null,
      revision_scene_ids: input.revisionSceneIds ?? null,
      revision_overlay_ids: input.revisionOverlayIds ?? null,
      revision_transition_ids: input.revisionTransitionIds ?? null,
      server_asset_catalog: assetCatalog,
      required_material_ids: input.requiredMaterialIds ?? [],
      hard_requirements: hardRequirements,
    }, null, 2),
    ...(hasImageRule ? ['', '真实图片输入报告', JSON.stringify(visualInputReport ?? null)] : []),
    ...(hasSampleRule ? ['', '相关样例理解', JSON.stringify(compactSampleUnderstanding(input))] : []),
    ...(hasComponentRule ? ['', '可用自定义画面能力', JSON.stringify(relevantComponents)] : []),
    '',
    '输出前核对：只改授权目标；返回的对象完整且无协议外字段；省略对象能由服务端安全保留。只输出最终 JSON。',
  ].join('\n')
}

export function buildV2TimelineSemanticCorrectionPrompt(input: {
  plannerInput: V2RemotionTimelinePlannerInput
  rejectedCandidate: unknown
  violations: Array<{ kind: string; message: string }>
  repairInstruction?: string
  outputKind: 'timeline' | 'fragment'
  visualInputReport?: V2TimelineVisualInputReport
}): string {
  const plannerInput = input.plannerInput
  const authoritativeAssets = authoritativePlannerAssets(plannerInput)
  const scopedAssetIds = new Set(plannerInput.revisionContext?.timeline.assets.map((asset) => asset.id) ?? [])
  const collectCandidateAssetIds = (value: unknown) => {
    const ids = new Set<string>()
    const visit = (current: unknown) => {
      if (Array.isArray(current)) {
        current.forEach(visit)
        return
      }
      if (!current || typeof current !== 'object') return
      for (const [key, child] of Object.entries(current as Record<string, unknown>)) {
        if ((key === 'asset_id' || key === 'input_asset_id' || key === 'fallback_asset_id')
          && typeof child === 'string' && authoritativeAssets.has(child)) ids.add(child)
        visit(child)
      }
    }
    visit(value)
    return ids
  }
  for (const assetId of collectCandidateAssetIds(input.rejectedCandidate)) scopedAssetIds.add(assetId)
  const assetCatalog = [...authoritativeAssets.values()]
    .filter((asset) => input.outputKind === 'timeline' || scopedAssetIds.has(asset.id))
    .map((asset) => ({
    id: asset.id,
    type: asset.type,
    label: asset.label,
    source: asset.source,
    src: asset.src,
  }))
  const correctionFacts = JSON.stringify({
    prompt: plannerInput.prompt,
    violations: input.violations,
    repairInstruction: input.repairInstruction,
    candidate: input.rejectedCandidate,
  })
  const mediaScopeApplies = input.outputKind === 'timeline'
    || plannerInput.revisionScope === 'scene'
    || plannerInput.revisionScope === 'visual_strategy'
    || plannerInput.revisionScope === 'structure'
    || plannerInput.revisionGroup?.items.some((item) => item.scope === 'scene' || item.scope === 'visual_strategy')
  const revisionContextText = JSON.stringify(plannerInput.revisionContext ?? {})
  const hasImageContext = Boolean(mediaScopeApplies)
    && Boolean(input.visualInputReport?.attached_image_input_count || /原图|图片|照片|图像|input_asset_id|image_motion/i.test(correctionFacts))
  const hasSampleContext = Boolean(plannerInput.sampleUnderstanding)
    && (/样例|样片|参考视频|sample_boundary|sample_methods/i.test(correctionFacts)
      || /"sample_methods":\s*\[(?!\s*\])/.test(revisionContextText))
  const componentIds = new Set((plannerInput.availableComponents ?? []).map((component) => component.id))
  const hasComponentContext = Boolean(plannerInput.availableComponents?.length)
    && (/custom_render|组件|自定义画面|component/i.test(correctionFacts)
      || [...componentIds].some((id) => correctionFacts.includes(id) || revisionContextText.includes(id)))
  const recalledPreferences = (plannerInput.planningContext?.recalledCreativeMemories ?? [])
    .filter((item) => correctionFacts.includes(item))
  const recalledKnowledge = (plannerInput.planningContext?.recalledCreativeKnowledge ?? [])
    .filter((item) => correctionFacts.includes(item))
  const creativeContext = {
    recalled_user_preferences: recalledPreferences,
    recalled_creation_knowledge: recalledKnowledge,
  }
  const scopeRules = input.outputKind === 'fragment'
    ? plannerInput.revisionGroup
      ? [...new Set(plannerInput.revisionGroup.items.flatMap((item) => revisionFragmentScopeRules({
          ...plannerInput,
          revisionScope: item.scope,
          revisionSceneId: item.sceneId,
          revisionOverlayIds: item.overlayIds,
          revisionTransitionIds: item.transitionIds,
        })))]
      : revisionFragmentScopeRules(plannerInput)
    : []
  const outputRule = input.outputKind === 'fragment'
    ? plannerInput.revisionGroup
      ? `返回一个修正后的联合 Fragment，schema_version 为 "${V2_TIMELINE_REVISION_GROUP_FRAGMENT_SCHEMA_VERSION}"；不得拆成多次修订或扩大 revision_group。`
      : `返回一个修正后的 ${plannerInput.revisionScope} Fragment，schema_version 为 "${V2_TIMELINE_REVISION_FRAGMENT_SCHEMA_VERSION}"；不得扩大 Scope。`
    : '返回修正后的完整 Timeline JSON；保留未被当前要求改变的内容。'
  return [
    '你是视频创作平台中负责语义修正的规划模型。请直接修正刚被拒绝的候选，不要重新解释用户意图或从头规划。',
    '',
    '最高优先级',
    '- 只返回符合当前 JSON Schema 的 JSON，不输出解释、Markdown 或代码。',
    `- ${outputRule}`,
    '- 只修复列出的违规项；服务端授权范围、权威素材 ID、未授权对象和已经正确的内容必须保持不变。',
    input.outputKind === 'timeline'
      ? '- 不得填写 planning_gaps、执行回执、input_image_url 或虚假 fulfilled 状态。assets[].src 只能逐字复制权威素材目录。'
      : '- 不得填写 planning_gaps、执行回执、素材 URL、input_image_url 或虚假 fulfilled 状态。',
    ...scopeRules,
    '',
    '当前用户要求',
    plannerInput.prompt,
    '',
    '当前有效项目要求',
    JSON.stringify(plannerInput.planningContext?.activeRequirements ?? []),
    '',
    '修正必需的权威事实',
    JSON.stringify({
      server_asset_catalog: assetCatalog,
      required_material_ids: plannerInput.requiredMaterialIds ?? [],
      creative_context: creativeContext,
    }, null, 2),
    ...(hasImageContext
      ? ['', '真实图片输入报告', JSON.stringify(input.visualInputReport ?? null)]
      : []),
    ...(hasSampleContext
      ? ['', '相关样例理解', JSON.stringify(compactSampleUnderstanding(plannerInput))]
      : []),
    ...(hasComponentContext
      ? ['', '可用自定义画面能力', JSON.stringify(plannerInput.availableComponents)]
      : []),
    ...(input.outputKind === 'fragment'
      ? [
          '',
          '服务端授权与局部基础方案',
          JSON.stringify({
            revision_scope: plannerInput.revisionScope,
            revision_group: plannerInput.revisionGroup ?? null,
            revision_scene_id: plannerInput.revisionSceneId ?? null,
            revision_scene_ids: plannerInput.revisionSceneIds ?? null,
            revision_overlay_ids: plannerInput.revisionOverlayIds ?? null,
            revision_transition_ids: plannerInput.revisionTransitionIds ?? null,
            revision_global_mode: plannerInput.revisionGlobalMode ?? null,
            revision_duration_mode: plannerInput.revisionDurationMode ?? 'preserve_range',
            revision_context: plannerInput.revisionContext ?? null,
          }, null, 2),
        ]
      : []),
    '',
    '刚被拒绝的候选',
    JSON.stringify(input.rejectedCandidate, null, 2),
    '',
    '审查发现的违规项',
    JSON.stringify(input.violations, null, 2),
    '',
    '本次修正要求',
    input.repairInstruction ?? '修正列出的语义违规，不扩大授权范围。',
    '',
    '输出前核对：每项违规都有对应修正；授权外内容未变；返回类型与原候选一致。只输出最终 JSON。',
  ].join('\n')
}

export function assertRequiredMaterialCoverage(
  input: Pick<V2RemotionTimelinePlannerInput, 'requiredMaterialIds'>,
  spec: RemotionTimelineSpecV1,
  revisionFragment?: V2TimelineRevisionFragment | V2TimelineRevisionGroupFragment,
) {
  const required = new Set(input.requiredMaterialIds ?? [])
  if (required.size === 0) return
  const collectUsedMaterialIds = (candidate: {
    scenes?: RemotionTimelineSpecV1['scenes']
    overlays?: RemotionTimelineSpecV1['overlays']
    audio?: RemotionTimelineSpecV1['audio']
    material_jobs?: RemotionTimelineSpecV1['material_jobs']
  }) => {
    const used = new Set<string>()
    for (const scene of candidate.scenes ?? []) if (scene.asset_id) used.add(scene.asset_id)
    for (const overlay of candidate.overlays ?? []) if (overlay.asset_id) used.add(overlay.asset_id)
    for (const clip of candidate.audio ?? []) used.add(clip.asset_id)
    for (const job of candidate.material_jobs ?? []) if (job.input_asset_id) used.add(job.input_asset_id)
    return used
  }
  const usedInSpec = collectUsedMaterialIds(spec)
  const usedInFragment = revisionFragment ? collectUsedMaterialIds(revisionFragment) : undefined
  const missing = [...required].filter((id) =>
    !usedInSpec.has(id) || (usedInFragment !== undefined && !usedInFragment.has(id)))
  if (missing.length > 0) {
    throw timelineFieldRepairError(
      `Timeline does not use required material IDs: ${missing.join(', ')}`,
      ['assets', 'scenes', 'overlays', 'audio', 'material_jobs'],
    )
  }
}

function authoritativePlannerAssets(input: V2RemotionTimelinePlannerInput) {
  return new Map(
    [
      ...buildDeterministicRemotionTimelineSpec(input).assets,
      ...(input.revisionBaseSpec?.assets ?? []),
    ].map((asset) => [asset.id, asset]),
  )
}

type TimelineFieldRepairError = Error & { allowedRepairPaths: string[] }

function timelineFieldRepairError(message: string, allowedRepairPaths: string[]): TimelineFieldRepairError {
  return Object.assign(new Error(message), { allowedRepairPaths })
}

function assetReferenceRepairPaths(spec: RemotionTimelineSpecV1, assetId: string): string[] {
  return [
    ...spec.scenes.flatMap((scene, index) => scene.asset_id === assetId
      ? [`scenes[${index}].asset_id`]
      : []),
    ...spec.overlays.flatMap((overlay, index) => overlay.asset_id === assetId
      ? [`overlays[${index}].asset_id`]
      : []),
    ...(spec.audio ?? []).flatMap((clip, index) => clip.asset_id === assetId
      ? [`audio[${index}].asset_id`]
      : []),
    ...spec.material_jobs.flatMap((job, index) => [
      ...(job.input_asset_id === assetId ? [`material_jobs[${index}].input_asset_id`] : []),
      ...(job.output_asset_id === assetId ? [`material_jobs[${index}].output_asset_id`] : []),
      ...(job.fallback_asset_id === assetId ? [`material_jobs[${index}].fallback_asset_id`] : []),
    ]),
    ...(spec.creative_brief?.image_references ?? []).flatMap((reference, index) =>
      reference.asset_id === assetId ? [`creative_brief.image_references[${index}].asset_id`] : []),
  ]
}

async function bindAuthoritativePlannerAssets(
  input: V2RemotionTimelinePlannerInput,
  spec: RemotionTimelineSpecV1,
  options: { allowPersistedPlanningGaps?: boolean } = {},
): Promise<RemotionTimelineSpecV1> {
  const legacyImageJobIndex = spec.material_jobs.findIndex((job) => job.input_image_url)
  if (legacyImageJobIndex >= 0) {
    throw timelineFieldRepairError(
      'input_image_url is reserved for historical persisted jobs; model output must use input_asset_id.',
      [`material_jobs[${legacyImageJobIndex}].input_image_url`, `material_jobs[${legacyImageJobIndex}].input_asset_id`],
    )
  }
  if (spec.creative_brief?.planning_gaps?.length && !options.allowPersistedPlanningGaps) {
    throw timelineFieldRepairError(
      'planning_gaps are server-maintained and cannot be returned by the planner model.',
      ['creative_brief.planning_gaps'],
    )
  }
  const recalledPreferences = new Set([
    ...(input.planningContext?.recalledCreativeMemories ?? []),
    ...(input.revisionBaseSpec?.creative_brief?.applied_preferences ?? []),
  ])
  for (const [index, preference] of (spec.creative_brief?.applied_preferences ?? []).entries()) {
    if (!recalledPreferences.has(preference)) {
      throw timelineFieldRepairError(
        'creative_brief applied preference was not recalled by the server.',
        ['creative_brief.applied_preferences.length', `creative_brief.applied_preferences[${index}]`],
      )
    }
  }
  const authoritativeAssets = authoritativePlannerAssets(input)
  const candidateAssets = [...spec.assets]
  const conditionedAssetIds = new Set(
    spec.material_jobs.flatMap((job) => job.input_asset_id ? [job.input_asset_id] : []),
  )
  const imageReferences = new Map(
    (spec.creative_brief?.image_references ?? []).map((reference) => [reference.asset_id, reference]),
  )

  for (const assetId of conditionedAssetIds) {
    const authoritative = authoritativeAssets.get(assetId)
    const jobPaths = spec.material_jobs.flatMap((job, index) => job.input_asset_id === assetId
      ? [`material_jobs[${index}].input_asset_id`]
      : [])
    if (!authoritative || authoritative.type !== 'image') {
      throw timelineFieldRepairError(
        `input_asset_id is not a server-owned image asset: ${assetId}`,
        [...jobPaths, ...assetReferenceRepairPaths(spec, assetId)],
      )
    }
    if (!await resolveServerImageAccess(authoritative.src)) {
      throw timelineFieldRepairError(
        `input_asset_id does not reference an approved image source: ${assetId}`,
        jobPaths,
      )
    }
    if (!candidateAssets.some((asset) => asset.id === assetId)) candidateAssets.push(authoritative)
    const reference = imageReferences.get(assetId)
    if (!reference) {
      const nextIndex = spec.creative_brief?.image_references.length ?? 0
      throw timelineFieldRepairError(
        `image-conditioned generation is missing creative_brief image facts for: ${assetId}`,
        ['creative_brief.image_references.length', `creative_brief.image_references[${nextIndex}]`],
      )
    }
    if (!reference.observed_facts.some((fact) => fact.trim()) || !reference.intended_use.trim()) {
      const referenceIndex = spec.creative_brief!.image_references.findIndex((item) => item.asset_id === assetId)
      throw timelineFieldRepairError(
        `image-conditioned generation has incomplete creative_brief image facts for: ${assetId}`,
        [
          `creative_brief.image_references[${referenceIndex}].observed_facts`,
          `creative_brief.image_references[${referenceIndex}].intended_use`,
        ],
      )
    }
  }
  for (const [index, reference] of (spec.creative_brief?.image_references ?? []).entries()) {
    const authoritative = authoritativeAssets.get(reference.asset_id)
    if (!authoritative || authoritative.type !== 'image') {
      throw timelineFieldRepairError(
        `creative_brief image reference is not a server-owned image asset: ${reference.asset_id}`,
        [`creative_brief.image_references[${index}].asset_id`],
      )
    }
  }

  const unauthorizedAssetIndex = candidateAssets.findIndex((asset) => !authoritativeAssets.has(asset.id))
  if (unauthorizedAssetIndex >= 0) {
    const assetId = candidateAssets[unauthorizedAssetIndex]!.id
    throw timelineFieldRepairError(
      `model returned an asset not owned by the server: ${assetId}`,
      ['assets.length', `assets[${unauthorizedAssetIndex}]`, ...assetReferenceRepairPaths(spec, assetId)],
    )
  }

  return {
    ...spec,
    assets: candidateAssets.map((asset) => ({ ...authoritativeAssets.get(asset.id)! })),
  }
}

async function preparePlannerImageInputs(input: V2RemotionTimelinePlannerInput) {
  const imageMaterials = (input.materials ?? []).filter((material) => material.type === 'image')
  return prepareArkImageInputs({
    materials: imageMaterials.map((material) => ({
      id: material.id,
      name: material.name,
      source: material.src,
      publicUrl: material.publicUrl,
    })),
    maxInputs: MAX_V2_PLANNER_IMAGE_INPUTS,
  })
}

export function buildV2TimelineSchemaFallbackPrompt(
  promptText: string,
  outputContract: { schemaName: string; schemaVersion: string; schema: Record<string, unknown> },
) {
  const required = Array.isArray(outputContract.schema.required)
    ? outputContract.schema.required.filter((item): item is string => typeof item === 'string')
    : []
  const properties = outputContract.schema.properties && typeof outputContract.schema.properties === 'object'
    ? Object.keys(outputContract.schema.properties)
    : []
  return [
    promptText,
    '',
    '结构化输出当前不可用，仍须严格返回一个 JSON object。不得输出 Markdown 或解释。',
    JSON.stringify({
      schema_name: outputContract.schemaName,
      schema_version: outputContract.schemaVersion,
      required_top_level_fields: required,
      allowed_top_level_fields: properties,
    }),
  ].join('\n')
}

async function callResponsesApi(
  promptText: string,
  imageInputs: ArkResponsesImageInput[],
  options: { allowStructuredOutput?: boolean; outputContract: PlannerOutputContract },
): Promise<{
  raw: unknown
  structuredOutput: { requested: boolean; providerFallback: boolean; reason?: string }
}> {
  if (!env.directorAgentApiKey) {
    throw new Error('DIRECTOR_AGENT_API_KEY is not configured.')
  }

  const requested = env.directorAgentStructuredOutputMode === 'auto' && options.allowStructuredOutput !== false
  const body = (useSchema: boolean) => ({
    model: env.directorAgentModel,
    ...(useSchema
      ? {
          text: {
            format: {
              type: 'json_schema',
              name: options.outputContract.schemaName,
              schema: options.outputContract.schema,
            },
          },
        }
      : {}),
    input: [
      {
        role: 'user',
        content: [
          {
            type: 'input_text',
            text: useSchema
              ? promptText
              : buildV2TimelineSchemaFallbackPrompt(promptText, options.outputContract),
          },
          ...imageInputs,
        ],
      },
    ],
  })
  const request = async (useSchema: boolean) => fetch(env.directorAgentResponsesUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.directorAgentApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body(useSchema)),
    signal: AbortSignal.timeout(env.directorAgentTimeoutMs),
  })
  let response = await request(requested)
  let text = await response.text()
  const schemaRejected = requested && !response.ok && [400, 404, 422].includes(response.status)
  if (schemaRejected) {
    response = await request(false)
    const retryText = await response.text()
    if (!response.ok) throw new Error(`Responses API returned ${response.status}: ${retryText.slice(0, 500)}`)
    try {
      return { raw: JSON.parse(retryText), structuredOutput: { requested: true, providerFallback: true, reason: text.slice(0, 500) } }
    } catch {
      return { raw: retryText, structuredOutput: { requested: true, providerFallback: true, reason: text.slice(0, 500) } }
    }
  }
  if (!response.ok) {
    throw new Error(`Responses API returned ${response.status}: ${text.slice(0, 500)}`)
  }

  try {
    return { raw: JSON.parse(text) as unknown, structuredOutput: { requested, providerFallback: false } }
  } catch {
    return { raw: text, structuredOutput: { requested, providerFallback: false } }
  }
}

function responseAudit(raw: unknown) {
  const record = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {}
  return {
    id: record.id,
    model: record.model,
    status: record.status,
    created_at: record.created_at,
    usage: record.usage,
    output_text: extractTextCandidate(raw),
  }
}

function timelineJsonSyntaxRepairPrompt(input: {
  invalidText: string
  error: string
  outputContract: PlannerOutputContract
}) {
  return [
    'Repair only the JSON format below. Do not change its business meaning, timeline choices, assets, or captions.',
    `Return JSON only following this schema: ${JSON.stringify(input.outputContract.schema)}`,
    `Parse or validation error: ${input.error}`,
    'Original final answer:',
    input.invalidText,
  ].join('\n')
}

function timelineFieldRepairPrompt(input: {
  invalidText: string
  error: string
  allowedRepairPaths: string[]
  assets: Array<{ id: string; type: string }>
  outputContract: PlannerOutputContract
  revisionConstraints?: NonNullable<V2RemotionTimelinePlannerInput['revisionContext']>['constraints']
  requiredMaterialIds?: string[]
}) {
  return [
    'Correct only the fields implicated by the validation error below.',
    input.allowedRepairPaths.length > 0
      ? `Only these JSON paths may change: ${JSON.stringify(input.allowedRepairPaths)}`
      : 'This is a revision fragment; remain inside the fragment schema and its authorized revision scope.',
    'Use only server-provided asset IDs and remove or replace rejected references when the error requires it.',
    'A catalog id is the assets[].id itself, not an alias. Copy that id unchanged into assets[] and use the same id for input_asset_id.',
    'To faithfully display an available image, use image_motion with a fulfilled reuse_asset job whose output_asset_id is that image id. Use ai_video only with generate_video; then scene.asset_id is the generated output and input_asset_id is the source image. Never use request_user_material for an asset already present in the server catalog.',
    'For ai_video, scene.asset_id must remain equal to its generate_video job output_asset_id. Never replace it with the input image id or add the unresolved output id to assets[].',
    `Server-owned asset catalog (IDs and types only): ${JSON.stringify(input.assets)}`,
    `Authoritative revision constraints: ${JSON.stringify(input.revisionConstraints ?? null)}`,
    `Required material IDs: ${JSON.stringify(input.requiredMaterialIds ?? [])}`,
    input.outputContract.kind === 'fragment'
      ? 'Preserve fields in the fragment that are unrelated to the validation error.'
      : 'Preserve unrelated timeline choices, captions, timing, and valid assets.',
    `Return JSON only following this schema: ${JSON.stringify(input.outputContract.schema)}`,
    `Validation error: ${input.error}`,
    'Original final answer:',
    input.invalidText,
  ].join('\n')
}

function changedJsonPaths(before: unknown, after: unknown, path = ''): string[] {
  if (Object.is(before, after)) return []
  if (Array.isArray(before) && Array.isArray(after)) {
    const changes = before.length === after.length ? [] : [`${path}.length`]
    if (path === 'assets') {
      const beforeIds = before.map((item) => item && typeof item === 'object'
        ? (item as { id?: unknown }).id
        : undefined)
      const afterIds = after.map((item) => item && typeof item === 'object'
        ? (item as { id?: unknown }).id
        : undefined)
      if (beforeIds.every((id): id is string => typeof id === 'string')
        && afterIds.every((id): id is string => typeof id === 'string')
        && new Set(beforeIds).size === beforeIds.length
        && new Set(afterIds).size === afterIds.length) {
        const afterById = new Map(afterIds.map((id, index) => [id, after[index]]))
        const beforeIdSet = new Set(beforeIds)
        beforeIds.forEach((id, index) => {
          changes.push(...changedJsonPaths(before[index], afterById.get(id), `${path}[${index}]`))
        })
        afterIds.forEach((id, index) => {
          if (!beforeIdSet.has(id)) changes.push(`${path}[${index}]`)
        })
        return changes
      }
    }
    const count = Math.max(before.length, after.length)
    for (let index = 0; index < count; index += 1) {
      changes.push(...changedJsonPaths(before[index], after[index], `${path}[${index}]`))
    }
    return changes
  }
  if (before && after && typeof before === 'object' && typeof after === 'object') {
    return [...new Set([...Object.keys(before), ...Object.keys(after)])]
      .flatMap((key) => changedJsonPaths(
        (before as Record<string, unknown>)[key],
        (after as Record<string, unknown>)[key],
        path ? `${path}.${key}` : key,
      ))
  }
  return [path]
}

function isRelatedRepairPath(changedPath: string, allowedPath: string) {
  return changedPath === allowedPath
    || changedPath.startsWith(`${allowedPath}.`)
    || changedPath.startsWith(`${allowedPath}[`)
    || allowedPath.startsWith(`${changedPath}.`)
    || allowedPath.startsWith(`${changedPath}[`)
}

function validationIssueRepairPaths(issue: RemotionTimelineValidationIssue): string[] {
  if (issue.severity !== 'error' || issue.path === '$') return []
  if (/^overlays\[\d+\]$/.test(issue.path)
    && /within its referenced scene time range|overlapping segments|crossfade overlap/i.test(issue.message)) {
    return [`${issue.path}.start_sec`, `${issue.path}.end_sec`]
  }
  if (/^material_jobs\[\d+\]$/.test(issue.path)
    && /use input_asset_id or legacy input_image_url/i.test(issue.message)) {
    return [`${issue.path}.input_asset_id`, `${issue.path}.input_image_url`]
  }
  return [issue.path]
}

function preparationErrorRepairPaths(error: Error | undefined): string[] {
  if (!error) return []
  const paths = (error as Partial<TimelineFieldRepairError>).allowedRepairPaths
  return Array.isArray(paths) && paths.every((path) => typeof path === 'string') ? paths : []
}

function assertInitialFieldRepairPreservesSemantics(
  before: RemotionTimelineSpecV1,
  after: RemotionTimelineSpecV1,
  allowedRepairPaths: string[],
) {
  const unrelatedChanges = changedJsonPaths(before, after)
    .filter((path) => !allowedRepairPaths.some((allowedPath) => isRelatedRepairPath(path, allowedPath)))
  if (unrelatedChanges.length > 0) {
    throw new Error('Timeline field repair changed unrelated timeline semantics.')
  }
}

export async function runV2TimelineLlmPlanner(
  input: V2RemotionTimelinePlannerInput,
  options: { promptText?: string; allowJsonRepair?: boolean } = {},
): Promise<V2TimelineLlmPlannerResult> {
  const preparedImages = await preparePlannerImageInputs(input)
  try {
    const outputContract = plannerOutputContract(input)
    const promptText = options.promptText ?? (
      outputContract.kind === 'fragment'
        ? buildV2TimelineRevisionPlannerPrompt(input, preparedImages.report)
        : buildV2TimelinePlannerPrompt(input, preparedImages.report)
    )
    let rawResponse: unknown
    let initialResponseAudit: unknown
    let structuredOutput: V2TimelineLlmPlannerResult['structuredOutput']
    let jsonRepair: V2TimelineLlmPlannerResult['jsonRepair']
    const response = await callResponsesApi(promptText, preparedImages.content, { outputContract })
    rawResponse = response.raw
    initialResponseAudit = responseAudit(rawResponse)
    structuredOutput = response.structuredOutput
    let extracted = extractStructuredJsonCandidate(
      rawResponse,
      (value): value is RemotionTimelineSpecV1 | V2TimelineRevisionFragment | V2TimelineRevisionGroupFragment =>
        typeof value === 'object' &&
        value !== null &&
        !Array.isArray(value) &&
        (value as { schema_version?: unknown }).schema_version === outputContract.schemaVersion,
    )
  if (!extracted.candidate && options.allowJsonRepair !== false) {
    const error = `LLM timeline planner did not return ${outputContract.schemaVersion}: ${JSON.stringify(extracted.report)}`
    const repairPrompt = timelineJsonSyntaxRepairPrompt({
      invalidText: extractTextCandidate(rawResponse),
      error,
      outputContract,
    })
    try {
      const repaired = await callResponsesApi(repairPrompt, preparedImages.content, {
        allowStructuredOutput: false,
        outputContract,
      })
      jsonRepair = { request: repairPrompt, responseAudit: responseAudit(repaired.raw) }
      rawResponse = repaired.raw
      extracted = extractStructuredJsonCandidate(
        rawResponse,
        (value): value is RemotionTimelineSpecV1 | V2TimelineRevisionFragment | V2TimelineRevisionGroupFragment =>
          typeof value === 'object' && value !== null && !Array.isArray(value) &&
          (value as { schema_version?: unknown }).schema_version === outputContract.schemaVersion,
      )
    } catch (repairError) {
      jsonRepair = { request: repairPrompt, error: repairError instanceof Error ? repairError.message : String(repairError) }
    }
    if (!extracted.candidate) {
      throw new V2TimelinePlannerProtocolError(error, {
        initialResponseAudit: initialResponseAudit!,
        rawResponse: responseAudit(rawResponse), extractionReport: extracted.report,
        structuredOutput: structuredOutput!, jsonRepair,
      })
    }
  }
  if (!extracted.candidate) {
    throw new V2TimelinePlannerProtocolError(
      `LLM timeline planner did not return ${outputContract.schemaVersion}: ${JSON.stringify(extracted.report)}`,
      {
        initialResponseAudit: initialResponseAudit!,
        rawResponse: responseAudit(rawResponse),
        extractionReport: extracted.report,
        structuredOutput: structuredOutput!,
        jsonRepair,
      },
    )
  }

  const prepareCandidate = async (
    candidate: RemotionTimelineSpecV1 | V2TimelineRevisionFragment | V2TimelineRevisionGroupFragment,
  ) => {
    const revisionFragment = outputContract.kind === 'fragment'
      ? input.revisionGroup
        ? candidate as V2TimelineRevisionGroupFragment
        : sanitizeRevisionFragment(input, candidate as V2TimelineRevisionFragment)
      : undefined
    const merged = revisionFragment
      ? input.revisionGroup
        ? applyV2TimelineRevisionGroupFragment({
            baseSpec: input.revisionBaseSpec!,
            fragment: revisionFragment as V2TimelineRevisionGroupFragment,
            group: input.revisionGroup,
            availableAssets: [...authoritativePlannerAssets(input).values()],
          })
        : applyV2TimelineRevisionFragment({
            baseSpec: input.revisionBaseSpec!,
            fragment: revisionFragment as V2TimelineRevisionFragment,
            scope: input.revisionScope!,
            sceneId: input.revisionSceneId,
            sceneIds: input.revisionSceneIds,
            overlayIds: input.revisionOverlayIds,
            transitionIds: input.revisionTransitionIds,
            globalMode: input.revisionGlobalMode,
            durationMode: input.revisionDurationMode,
            availableAssets: [...authoritativePlannerAssets(input).values()],
          })
      : candidate as RemotionTimelineSpecV1
    const normalized = normalizeV2TimelineTextOwnership(
      revisionFragment ? merged : sanitizeInitialTimeline(input, merged),
    )
    const repaired = repairV2LlmGeneratedMaterialPrompts(normalized)
    const scopedSpec = revisionFragment
      ? input.revisionGroup
        ? enforceV2TimelineRevisionGroup({
            baseSpec: input.revisionBaseSpec!,
            candidateSpec: repaired.spec,
            group: input.revisionGroup,
          })
        : enforceV2TimelineRevisionScope({
            baseSpec: input.revisionBaseSpec!,
            candidateSpec: repaired.spec,
            scope: input.revisionScope!,
            sceneId: input.revisionSceneId,
            sceneIds: input.revisionSceneIds,
            overlayIds: input.revisionOverlayIds,
            transitionIds: input.revisionTransitionIds,
            globalMode: input.revisionGlobalMode,
            durationMode: input.revisionDurationMode,
          })
      : repaired.spec
    const authoritative = await bindAuthoritativePlannerAssets(input, scopedSpec, {
      allowPersistedPlanningGaps: Boolean(revisionFragment),
    })
    assertRequiredMaterialCoverage(input, authoritative, revisionFragment)
    return {
      revisionFragment,
      repaired: { spec: authoritative, repairs: repaired.repairs },
      validation: validateRemotionTimelineSpec(authoritative),
    }
  }
  let preparedCandidate: Awaited<ReturnType<typeof prepareCandidate>> | undefined
  let preparationError: Error | undefined
  try {
    preparedCandidate = await prepareCandidate(
      extracted.candidate as RemotionTimelineSpecV1 | V2TimelineRevisionFragment | V2TimelineRevisionGroupFragment,
    )
  } catch (error) {
    preparationError = error instanceof Error ? error : new Error(String(error))
  }
  const allowedRepairPaths = [
    ...preparationErrorRepairPaths(preparationError),
    ...(preparedCandidate?.validation.issues ?? []).flatMap(validationIssueRepairPaths),
  ]
  const canAttemptFieldRepair = outputContract.kind === 'fragment' || allowedRepairPaths.length > 0
  if ((preparationError || !preparedCandidate?.validation.ok)
    && canAttemptFieldRepair && !jsonRepair && options.allowJsonRepair !== false) {
    const rejectedCandidate = extracted.candidate
    const error = preparationError?.message
      ?? `LLM timeline spec field validation failed: ${JSON.stringify(
        preparedCandidate?.validation.issues.filter((issue) => issue.severity === 'error'),
      )}`
    const repairPrompt = timelineFieldRepairPrompt({
      invalidText: extractTextCandidate(rawResponse),
      error,
      allowedRepairPaths: [...new Set(allowedRepairPaths)],
      assets: [...authoritativePlannerAssets(input).values()].map((asset) => ({
        id: asset.id,
        type: asset.type,
      })),
      outputContract,
      revisionConstraints: input.revisionContext?.constraints,
      requiredMaterialIds: input.requiredMaterialIds,
    })
    try {
      const repaired = await callResponsesApi(repairPrompt, preparedImages.content, {
        allowStructuredOutput: false,
        outputContract,
      })
      jsonRepair = { request: repairPrompt, responseAudit: responseAudit(repaired.raw) }
      rawResponse = repaired.raw
      extracted = extractStructuredJsonCandidate(
        rawResponse,
        (value): value is RemotionTimelineSpecV1 | V2TimelineRevisionFragment | V2TimelineRevisionGroupFragment =>
          typeof value === 'object' && value !== null && !Array.isArray(value) &&
          (value as { schema_version?: unknown }).schema_version === outputContract.schemaVersion,
      )
      if (extracted.candidate) {
        if (outputContract.kind === 'timeline') {
          assertInitialFieldRepairPreservesSemantics(
            rejectedCandidate as RemotionTimelineSpecV1,
            extracted.candidate as RemotionTimelineSpecV1,
            allowedRepairPaths,
          )
        }
        preparedCandidate = await prepareCandidate(
          extracted.candidate as RemotionTimelineSpecV1 | V2TimelineRevisionFragment | V2TimelineRevisionGroupFragment,
        )
        preparationError = undefined
      }
    } catch (repairError) {
      preparationError = repairError instanceof Error ? repairError : new Error(String(repairError))
      jsonRepair = { request: repairPrompt, error: repairError instanceof Error ? repairError.message : String(repairError) }
    }
  }
  if (preparationError || !preparedCandidate) {
    throw new V2TimelinePlannerProtocolError(
      `LLM timeline spec ownership validation failed: ${preparationError?.message ?? 'candidate was not prepared'}`,
      {
        initialResponseAudit: initialResponseAudit!,
        rawResponse: responseAudit(rawResponse), extractionReport: extracted.report,
        structuredOutput: structuredOutput!, jsonRepair,
      },
    )
  }
  if (!preparedCandidate.validation.ok) {
    throw new V2TimelinePlannerProtocolError(
      `LLM timeline spec is invalid: ${JSON.stringify(preparedCandidate.validation.issues, null, 2)}`,
      {
        initialResponseAudit: initialResponseAudit!,
        rawResponse: responseAudit(rawResponse), extractionReport: extracted.report,
        structuredOutput: structuredOutput!, jsonRepair, validationIssues: preparedCandidate.validation.issues,
      },
    )
  }

  const spec = assertValidRemotionTimelineSpec(preparedCandidate.repaired.spec)

    return {
      spec,
      ...(preparedCandidate.revisionFragment
        ? { revisionFragment: preparedCandidate.revisionFragment }
        : {}),
      initialResponseAudit: initialResponseAudit!,
      rawResponse: responseAudit(rawResponse),
      extractionReport: extracted.report,
      promptText,
      visualInputReport: preparedImages.report,
      repairs: preparedCandidate.repaired.repairs,
      structuredOutput: structuredOutput!,
      ...(jsonRepair ? { jsonRepair } : {}),
    }
  } finally {
    await releaseArkImageInputs(preparedImages)
  }
}
