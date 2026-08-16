import { env } from '../config/env.js'
import {
  extractStructuredJsonCandidate,
  extractTextCandidate,
  type StructuredJsonExtractionReport,
} from '../modules/agent-tools/structured-json-tool.js'
import {
  assertValidRemotionTimelineSpec,
  validateRemotionTimelineSpec,
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
    required.push('overlays', 'caption_tracks')
    properties.overlays = {
      type: 'array', minItems: ids.length, maxItems: ids.length,
      items: fragmentItemSchema(overlayItem, { id: { type: 'string', enum: ids } }),
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
        schema: TimelineJsonSchema as unknown as PlannerJsonSchema,
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
  repairs: Array<{ job_id: string; scene_id: string; field: 'prompt' | 'status' | 'audio'; reason: string }>
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
  const unresolvedGeneratedAssets = new Set(
    spec.assets
      .filter((asset) => asset.source === 'generated_asset' && !asset.src.trim())
      .map((asset) => asset.id),
  )
  const unsupportedAudioAssets = new Set(
    spec.assets
      .filter((asset) => asset.type === 'audio' && unresolvedGeneratedAssets.has(asset.id))
      .map((asset) => asset.id),
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
  const audio = spec.audio?.filter((clip) => !unsupportedAudioAssets.has(clip.asset_id))
  const nextSpec = {
    ...spec,
    ...(assets.length !== spec.assets.length ? { assets } : {}),
    ...(audio?.length !== spec.audio?.length ? { audio } : {}),
    ...(material_jobs.length !== spec.material_jobs.length || repairs.some((repair) => repair.field === 'prompt' || repair.field === 'status') ? { material_jobs } : {}),
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
  const deterministicBase = buildDeterministicRemotionTimelineSpec(input)
  const hardRequirements = extractV2TimelineHardRequirements(input.prompt)
  const creationMode =
    input.creationMode ??
    (input.sampleUnderstanding || input.referenceVideoPath
      ? 'sample_replicate'
      : input.materials?.some((material) => material.type === 'image' || material.type === 'video')
        ? 'material_brief'
        : 'text_to_video')
  const modeRule = creationMode === 'sample_replicate'
    ? 'sample_replicate：从 sample_understanding 选择与当前目标相关的注意力建立、信息揭示、镜头语言、动作节奏、转场逻辑和叙事作用；最终画面来自用户素材或生成素材，不复制样例内容或镜头切点。'
    : creationMode === 'material_brief'
      ? 'material_brief：根据当前要求和用户素材组织方案；没有样例时不得声称沿用了样例节奏或风格。'
      : 'text_to_video：真实动态画面使用 ai_video + generate_video；字幕由 overlays 表达，remotion_card 只用于有意设计的文字或动态图形画面。'
  const imageInputReport = visualInputReport ?? {
    requested_image_material_count: (input.materials ?? []).filter((material) => material.type === 'image').length,
    attached_image_input_count: 0,
    ark_file_input_count: 0,
    public_url_input_count: 0,
    attached_material_ids: [],
    failed_material_ids: [],
    omitted_material_ids: [],
    warnings: [],
  }
  const hasImageContext = imageInputReport.requested_image_material_count > 0
    || deterministicBase.assets.some((asset) => asset.type === 'image')
  const needsVisibleTextRules = hardRequirements.required_captions.length > 0
    || /字幕|文案|标题|上屏|排版|caption|subtitle|title|text/i.test(input.prompt)
  const materialCatalog = deterministicBase.assets.map((asset) => ({
    id: asset.id,
    type: asset.type,
    label: asset.label,
    source: asset.source,
    src: asset.src,
  }))
  const creativeContext = {
    recalled_user_preferences: input.planningContext?.recalledCreativeMemories ?? [],
    recalled_creation_knowledge: input.planningContext?.recalledCreativeKnowledge ?? [],
  }
  return [
    '你是视频创作平台中负责方案规划的模型。请把已确认的创作要求、真实素材与相关创作方法转化为可继续编辑并实际渲染的时间线方案；不要承担意图路由、工具执行或完成状态判断。',
    '',
    '冲突处理顺序：当前用户要求 > 当前有效项目要求 > 服务端权威素材与项目事实 > 本轮采用的偏好、创作知识和样例方法。',
    '',
    '最高优先级',
    '- 只返回符合当前 JSON Schema 的 JSON，不输出解释、Markdown、代码或执行命令。',
    `- schema_version 必须是 "${REMOTION_TIMELINE_SPEC_SCHEMA_VERSION}"；字段名、枚举和 ID 保持英文协议形式。`,
    '- 不得填写 planning_gaps、执行回执或虚假完成状态。新建 generate_video 任务只能是 planned，完成状态由服务端维护。',
    '- 只能引用素材目录和组件目录中提供的 ID。assets[].src 必须逐字复制权威素材目录中的 src；不得改写或编造 URL、input_image_url 或 ID。',
    '- creative_brief.direction 只表达全片创作方向；material_job.prompt 只表达当前镜头的具体主体、环境、光线、镜头运动和动作。',
    '- creative_brief.applied_preferences 只表达本轮实际采用的 recalled_user_preferences 原句；仅召回但未采用的偏好不得写入。',
    '- 文件名、内部 ID、布局约束和规划说明不得成为成片可见文字；除非用户明确要求逐字展示，否则上屏字段只能写观众文案。',
    '- 每个镜头必须有有效时间、类型和实现方式；所有 asset、scene、transition、overlay 和 material_job ID 必须唯一。',
    '',
    '当前创建模式',
    modeRule,
    '',
    '真实画面、素材与生成规则',
    '- 缺失的真实动态画面使用 ai_video + generate_video；remotion_card 只用于有意设计的文字或动态图形画面，不得冒充缺失的真实镜头。',
    '- generate_video prompt 应具体描述主体、环境、光线、镜头运动和动作。assets 只包含已有且 src 非空的可渲染资产；ai_video scene 在生成前引用 material_job.output_asset_id，不伪造 asset。',
    '- 没有真实音频素材时，只在 notes 描述音乐策略，不创建空 audio 或伪生成任务。',
    '- 用户明确指定镜头数时按该数量规划；用户明确要求使用全部素材时，每个可视素材都必须进入方案。用户没有限制镜头数时，多张图片优先分别作为主镜头，最多 12 个镜头。',
    ...(hasImageContext
      ? [
          '- 图片只记录与当前用途相关的可见事实，不编造。每个实际采用的图片在 creative_brief.image_references 中使用服务端 asset_id，并分别记录若干原子事实及 intended_use。',
          '- 依赖原图生成新动作、新事件、新视角或扩展环境时，使用 ai_video + generate_video，并通过 input_asset_id 绑定同一原图；仅忠实展示、平移、缩放或裁切时使用 image_motion。文字描述不能替代原始参考图片。',
        ]
      : []),
    '',
    '本轮适用的可见文字规则',
    '- 文件名、内部 ID、布局说明和规划说明不得成为字幕；user_video、ai_video、image_motion 的镜头说明写入 creative_intent，只有 overlays[].text 上屏。',
    '- creative_intent 与同镜头 generate_video prompt 的主体和动作保持一致。镜头和结构标签应符合实际内容领域，领域不明时使用中性表达，不套用产品营销词。',
    ...(needsVisibleTextRules
      ? [
          '- 观众文案写入真正上屏字段；hard_requirements.required_captions 必须逐字出现在 overlays[].text。',
          '- 多句字幕使用同一 caption track 上的多个定时 overlay；布局、行数和样式要求用结构化字段表达，不得把要求原句当字幕。',
        ]
      : []),
    ...(input.availableComponents?.length
      ? [
          '',
          '本轮适用的自定义组件规则',
          '- 可用自定义画面能力只是实现候选，不代表推荐顺序。只使用与目标语义和 purpose 匹配的 component_id，通过 custom_render 引用；不得自行编造组件或输出源码。',
        ]
      : []),
    '',
    '当前任务',
    input.prompt,
    '',
    '当前有效项目要求',
    JSON.stringify(input.planningContext?.activeRequirements ?? []),
    '',
    '相关创作上下文',
    JSON.stringify(creativeContext),
    '',
    '权威素材目录',
    JSON.stringify(materialCatalog),
    ...(hasImageContext ? ['', '真实图片输入报告', JSON.stringify(imageInputReport)] : []),
    ...(input.sampleUnderstanding ? ['', '样例理解', JSON.stringify(compactSampleUnderstanding(input))] : []),
    ...(input.availableComponents?.length
      ? ['', '可用自定义画面能力', JSON.stringify(input.availableComponents)]
      : []),
    '',
    '画布与确定性要求',
    JSON.stringify(
      {
        task_id: input.taskId,
        creation_mode: creationMode,
        canvas: deterministicBase.canvas,
        duration_sec: input.durationSec ?? null,
        hard_requirements: hardRequirements,
        allowed_scene_types: ['user_video', 'ai_video', 'image_motion', 'remotion_card', 'caption_scene', 'data_viz'],
        allowed_transition_types: REMOTION_TIMELINE_TRANSITION_TYPES,
        allowed_overlay_types: ['caption', 'title', 'label', 'shape', 'image_badge', 'light_sweep'],
      },
      null,
      2,
    ),
    '',
    '输出前只核对三件事：是否落实当前要求和全部 active requirements；是否只引用权威 ID 并正确绑定原图；时间线是否可编辑、可渲染且没有把内部说明写成可见内容。只输出最终 JSON。',
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
    input.revisionDurationMode === 'resize_timeline'
      ? '- 本轮明确允许改变范围时长；保持范围内场景相对时间一致。'
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
    && (existingComponentIds.size > 0 || Boolean(mediaScopeApplies) || Boolean(transitionScopeApplies)
      || /组件|自定义|效果|动效|custom_render/i.test(input.prompt))
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
    '- Fragment 返回 creative_brief 时，applied_preferences 只能包含本轮实际采用的 recalled_user_preferences 原句。',
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

function hasExplicitSceneCount(prompt: string): boolean {
  return /(\d{1,2})\s*(段|个镜头|镜头|个场景|场景|幕|scene|scenes)/i.test(prompt) ||
    /[一二两三四五六七八九十]\s*(段|个镜头|镜头|个场景|场景|幕)/.test(prompt)
}

function wantsFullMaterialCoverage(prompt: string): boolean {
  return /全部|所有|每张|每个|都用|用完|全用|use all/i.test(prompt)
}

function assertLlmMainSceneMaterialCoverage(input: V2RemotionTimelinePlannerInput, spec: RemotionTimelineSpecV1) {
  const expected = buildDeterministicRemotionTimelineSpec(input).assets.filter(
    (asset) => asset.source === 'user_asset' && (asset.type === 'image' || asset.type === 'video'),
  )
  const fullCoverageRequested = wantsFullMaterialCoverage(input.prompt)
  if (fullCoverageRequested) {
    const assetById = new Map(spec.assets.map((asset) => [asset.id, asset]))
    const usedSrcs = new Set<string>()
    for (const scene of spec.scenes) {
      const sceneAsset = scene.asset_id ? assetById.get(scene.asset_id) : undefined
      if (sceneAsset) usedSrcs.add(sceneAsset.src)
    }
    for (const overlay of spec.overlays) {
      const overlayAsset = overlay.asset_id ? assetById.get(overlay.asset_id) : undefined
      if (overlayAsset) usedSrcs.add(overlayAsset.src)
    }
    for (const job of spec.material_jobs) {
      const inputAsset = job.input_asset_id ? assetById.get(job.input_asset_id) : undefined
      if (inputAsset) usedSrcs.add(inputAsset.src)
    }
    const missing = expected.filter((asset) => !usedSrcs.has(asset.src))
    if (missing.length) {
      throw new Error(
        `LLM timeline did not cover all requested visual materials; missing ${missing.length}/${expected.length}.`,
      )
    }
    return
  }

  if (hasExplicitSceneCount(input.prompt)) return
  if (expected.length < 4) return

  const assetById = new Map(spec.assets.map((asset) => [asset.id, asset]))
  const mainSceneSrcs = new Set(
    spec.scenes
      .map((scene) => (scene.asset_id ? assetById.get(scene.asset_id)?.src : undefined))
      .filter((src): src is string => Boolean(src)),
  )
  for (const job of spec.material_jobs) {
    const inputAsset = job.input_asset_id ? assetById.get(job.input_asset_id) : undefined
    if (inputAsset) mainSceneSrcs.add(inputAsset.src)
  }
  const missing = expected.filter((asset) => !mainSceneSrcs.has(asset.src))
  if (missing.length) {
    throw new Error(
      `LLM timeline used only ${expected.length - missing.length}/${expected.length} user visual materials as main scenes; falling back to deterministic coverage.`,
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

async function bindAuthoritativePlannerAssets(
  input: V2RemotionTimelinePlannerInput,
  spec: RemotionTimelineSpecV1,
  options: { allowPersistedPlanningGaps?: boolean } = {},
): Promise<RemotionTimelineSpecV1> {
  if (spec.material_jobs.some((job) => job.input_image_url)) {
    throw new Error('input_image_url is reserved for historical persisted jobs; model output must use input_asset_id.')
  }
  if (spec.creative_brief?.planning_gaps?.length && !options.allowPersistedPlanningGaps) {
    throw new Error('planning_gaps are server-maintained and cannot be returned by the planner model.')
  }
  const recalledPreferences = new Set([
    ...(input.planningContext?.recalledCreativeMemories ?? []),
    ...(input.revisionBaseSpec?.creative_brief?.applied_preferences ?? []),
  ])
  for (const preference of spec.creative_brief?.applied_preferences ?? []) {
    if (!recalledPreferences.has(preference)) {
      throw new Error('creative_brief applied preference was not recalled by the server.')
    }
  }
  const authoritativeAssets = authoritativePlannerAssets(input)
  const conditionedAssetIds = new Set(
    spec.material_jobs.flatMap((job) => job.input_asset_id ? [job.input_asset_id] : []),
  )
  const imageReferences = new Map(
    (spec.creative_brief?.image_references ?? []).map((reference) => [reference.asset_id, reference]),
  )

  for (const assetId of conditionedAssetIds) {
    const authoritative = authoritativeAssets.get(assetId)
    if (!authoritative || authoritative.type !== 'image') {
      throw new Error(`input_asset_id is not a server-owned image asset: ${assetId}`)
    }
    if (!await resolveServerImageAccess(authoritative.src)) {
      throw new Error(`input_asset_id does not reference an approved image source: ${assetId}`)
    }
    if (!spec.assets.some((asset) => asset.id === assetId)) {
      throw new Error(`input_asset_id is missing from the candidate asset list: ${assetId}`)
    }
    const reference = imageReferences.get(assetId)
    if (!reference) {
      throw new Error(`image-conditioned generation is missing creative_brief image facts for: ${assetId}`)
    }
    if (!reference.observed_facts.some((fact) => fact.trim()) || !reference.intended_use.trim()) {
      throw new Error(`image-conditioned generation has incomplete creative_brief image facts for: ${assetId}`)
    }
  }
  for (const reference of spec.creative_brief?.image_references ?? []) {
    const authoritative = authoritativeAssets.get(reference.asset_id)
    if (!authoritative || authoritative.type !== 'image') {
      throw new Error(`creative_brief image reference is not a server-owned image asset: ${reference.asset_id}`)
    }
  }

  return {
    ...spec,
    assets: spec.assets.map((asset) => {
      const authoritative = authoritativeAssets.get(asset.id)
      if (!authoritative) throw new Error(`model returned an asset not owned by the server: ${asset.id}`)
      return { ...authoritative }
    }),
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
  assets: Array<{ id: string; type: string }>
  outputContract: PlannerOutputContract
}) {
  return [
    'Correct only the fields implicated by the validation error below.',
    'Use only server-provided asset IDs and remove or replace rejected references when the error requires it.',
    `Server-owned asset catalog (IDs and types only): ${JSON.stringify(input.assets)}`,
    input.outputContract.kind === 'fragment'
      ? 'Preserve fields in the fragment that are unrelated to the validation error.'
      : 'Preserve unrelated timeline choices, captions, timing, and valid assets.',
    `Return JSON only following this schema: ${JSON.stringify(input.outputContract.schema)}`,
    `Validation error: ${input.error}`,
    'Original final answer:',
    input.invalidText,
  ].join('\n')
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
    const normalized = normalizeV2TimelineTextOwnership(merged)
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
  if ((preparationError || !preparedCandidate?.validation.ok) && !jsonRepair && options.allowJsonRepair !== false) {
    const error = preparationError?.message
      ?? `LLM timeline spec field validation failed: ${JSON.stringify(preparedCandidate?.validation.issues)}`
    const repairPrompt = timelineFieldRepairPrompt({
      invalidText: extractTextCandidate(rawResponse),
      error,
      assets: [...authoritativePlannerAssets(input).values()].map((asset) => ({
        id: asset.id,
        type: asset.type,
      })),
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
      if (extracted.candidate) {
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
  assertLlmMainSceneMaterialCoverage(input, spec)

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
