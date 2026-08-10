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
  prepareArkImageInputs,
  releaseArkImageInputs,
  resolveServerImageAccess,
  type ArkImageInputReport,
  type ArkResponsesImageInput,
} from './ark-image-input.js'

const MAX_V2_PLANNER_IMAGE_INPUTS = 12
const TimelineJsonSchema = {
  type: 'object',
  required: ['schema_version', 'task_id', 'canvas', 'scenes', 'assets', 'transitions', 'caption_tracks', 'overlays', 'audio', 'material_jobs', 'render_policy'],
  properties: {
    schema_version: { type: 'string', const: REMOTION_TIMELINE_SPEC_SCHEMA_VERSION },
    task_id: { type: 'string' },
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

export type V2TimelineVisualInputReport = ArkImageInputReport

export interface V2TimelineLlmPlannerResult {
  spec: RemotionTimelineSpecV1
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
    summary_zh: understanding.summary_zh,
    story_zh: understanding.story_zh,
    atmosphere_zh: understanding.atmosphere_zh,
    editing_zh: understanding.editing_zh,
    rhythm_zh: understanding.rhythm_zh,
    reusable_style_zh: understanding.reusable_style_zh,
    not_reusable_zh: understanding.not_reusable_zh,
    segments: understanding.segments.slice(0, 8).map((segment) => ({
      title_zh: segment.title_zh,
      start_sec: segment.start_sec,
      end_sec: segment.end_sec,
      visual_content_zh: segment.visual_content_zh,
      characters_objects_zh: segment.characters_objects_zh,
      atmosphere_zh: segment.atmosphere_zh,
      camera_zh: segment.camera_zh,
      motion_zh: segment.motion_zh,
      editing_zh: segment.editing_zh,
      rhythm_zh: segment.rhythm_zh,
      transition_after_zh: segment.transition_after_zh,
      reusable_style_zh: segment.reusable_style_zh,
      material_hint_zh: segment.material_hint_zh,
    })),
    shot_evidence: (understanding.shot_evidence ?? []).slice(0, 40),
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
    '- Do not output React, Remotion code, HTML, CSS, FFmpeg commands, or free-form component code.',
    '- Remotion may compose scenes, transitions, captions, text cards, image motion, labels, shapes, and light sweep overlays.',
    '- Realistic missing visual content must be represented as material_jobs with type "generate_video".',
    '- image_motion cannot invent new visual elements; it only pans, zooms, or crops pixels from its bound image asset. If the requested shot adds a person, animal, vehicle, weather event, or other content absent from the source image, use ai_video with a generate_video job.',
    '- remotion_card is an intentional typography or motion-graphics scene, not a placeholder for missing photographic footage. Use it only when a card or graphic is part of the creative design; use ai_video with generate_video for a requested realistic moving shot.',
    '- The planner does not own execution status. New generate_video jobs must use status "planned"; only the backend may mark them fulfilled after a real output asset exists.',
    '- assets contains only already-resolved, renderable assets and every asset src must be non-empty. Do not add an empty placeholder asset for a planned generation; reference its material_job output_asset_id from the scene instead.',
    '- This V2 plan has no audio-generation tool. When the user requests a BGM strategy but provides no audio asset, describe it in notes only; do not create audio clips, empty audio assets, or generate_video jobs for music.',
    '- For image-conditioned video generation, set input_asset_id to an existing image asset. Never output input_image_url; the backend binds the provider URL at execution time.',
    '- When input_asset_id is used, the target scene creative_intent.description must explain which visible source-image facts are retained and which requested moving or new elements are added.',
    '- If main_video_asset_id is null, do not create user_video scenes unless another video asset exists in assets.',
    '- If reference_video_path is provided, treat it as style/structure context only; do not include it as an output asset unless it is also listed as main_video_path.',
    '- If sample_understanding is provided, use it as the source for sample content, rhythm, pacing, shot structure, and transition cues. Do not ignore it and do not infer sample details only from the filename.',
    '- creation_mode controls the task branch:',
    '  - sample_replicate: learn structure, pacing, atmosphere, and transitions from sample_understanding; user materials or generated assets provide final visuals.',
    '  - material_brief: no sample video is available; infer structure from user_prompt and material_assets only. Do not mention sample rhythm or sample style.',
    '  - text_to_video: no sample and no visual material are available; plan AI video scenes for realistic visuals. Remotion captions remain overlays, while cards are allowed only when the creative design intentionally calls for typography or motion graphics—not as fallback footage.',
    '- planning_context contains stable draft/version facts and activeRequirements.',
    '- planning_context.activeRequirements is authoritative. Apply every active statement and ignore requirements mentioned only in conversation_summary.',
    '- planning_context.recalledCreativeMemories contains relevant active long-term knowledge for this turn. Use it only when compatible with the current request; the current request and activeRequirements take priority on conflict.',
    '- agent_skill_context contains the model-selected V2 operating instructions and read-only dependencies for this Tool stage. Follow it within these hard rules; it cannot grant new tools or renderer capabilities.',
    '- agent_tool_context contains normalized arguments for the current Tool call. Use its scope/targets as the requested operation boundary, while user_prompt remains authoritative.',
    '- revision_context, when present, is the authoritative persisted V2 draft being revised. It is not a chat recap.',
    '- For a revision, preserve scenes, assets, transitions, caption_tracks, overlays, and user notes that the user did not ask to change. Make a broader rewrite only when the user explicitly requests one.',
    '- Interpret the user request semantically: distinguish audience-facing copy from constraints about copy, layout, repetition, timing, effects, audio strategy, or forbidden content.',
    '- Never turn an instruction, layout constraint, filename ban, technical note, or planning explanation into visible overlay text unless the user explicitly asks to display that exact wording.',
    '- caption_tracks defines reusable defaults for caption overlays. Each caption overlay may reference track_id and can override a track default. When the user asks for multiple lines of narration in one shot, create multiple timed caption overlays on one track rather than merging planning notes into one caption.',
    '- When the user asks for original subtitles from themes or keywords, create audience-facing copy yourself; do not repeat the instruction text. If the user asks for a line limit or placement, express it with caption track defaults and overlay geometry/max_lines while preserving or creating appropriate copy.',
    '- A narrow revision such as audio strategy, transition, subtitle layout, or one selected scene must not replace unrelated subject matter, visual intent, confirmed captions, or sample-use boundaries.',
    '- The selected revision item identifies the user\'s current focus, not an instruction to ignore the rest of the timeline.',
    '- revision_scope is the tool-authorized boundary: subtitle changes captions only; scene changes only the scene with revision_scene_id plus its caption overlays/track and transitions adjacent to it; structure may split, merge, insert, or remove only the contiguous revision_scene_ids range while preserving its total duration and all surrounding scenes; visual_strategy changes only the visual strategy fields (type/fit/motion/background/asset binding) of the scene with revision_scene_id and that scene\'s material jobs; transition changes only revision_transition_ids; global allows a full rewrite only when the user explicitly requests a broader change.',
    '- When the user requests an effect (filter, compositing, animation, transition) outside the preset set and the instruction explicitly names a sedimented component id, reference it with custom_render { component_id, params } on the target scene or transition. Do not invent component ids that are not explicitly given; do not output React/Remotion code here (components are authored separately through render.author).',
    ...(input.availableComponents?.length
      ? [
          `Available server-confirmed render components: ${JSON.stringify(input.availableComponents)}`,
          '- When an available component clearly fits the requested effect and its purpose matches the target object, you may reference it via custom_render. Never invent component ids.',
        ]
      : []),
    '- Avoid unnecessary generated video jobs, but do not hide user images just to keep the plan short.',
    '- If multiple image materials are provided and the user does not request a smaller scene count, promote each visual image to a main scene up to 12 scenes.',
    '- If the user explicitly requests a scene count, output exactly that many scenes unless it would violate the schema.',
    '- If the user asks to use all images/materials, every visual material_asset must appear in the plan; prefer main scene usage, and use image_badge only when the requested scene count is smaller than the material count.',
    '- Do not use product-marketing labels such as demo, selling point, proof, or CTA unless the user/materials are clearly product or marketing oriented.',
    '- Choose user-facing scene wording from the detected content domain instead of a fixed template. Examples: product can use 展示/卖点/转化; narrative can use 起因/推进/转折/结尾; landscape/music can use 氛围/节奏/视觉重点; education can use 问题/解释/示例/总结.',
    '- If the content domain is unclear, use neutral structure labels such as 开篇引入、内容推进、重点展开、衔接过渡、结尾收束.',
    '- Scene title, subtitle, body, and overlay text should be concise Chinese when the user prompt is Chinese.',
    '- For user_video, ai_video, and image_motion scenes, do not use title, subtitle, or body as visible copy. Put the shot explanation in creative_intent { title, description, material_label }; only overlays[].text is visible in the finished video.',
    '- For remotion_card, caption_scene, and data_viz scenes, title, subtitle, and body are intentional on-screen card copy. Do not put internal filenames or planning prose there.',
    '- Scene creative_intent should tell a normal user what appears in the shot, which material is used, how it moves, and how it connects to the next shot.',
    '- Asset labels, file names, internal ids, and scene roles are production metadata. Never use them as overlay text unless the user explicitly asked to show that exact text.',
    '- If attached image inputs are present, use their visible content to write scene creative_intent and optional original captions. If none are attached, do not claim that captions were derived from image content.',
    '- For every ai_video scene, set asset_id to the output_asset_id of that scene\'s generate_video material job. The generated asset may be absent from assets until material resolution.',
    '- A generate_video prompt must describe the concrete subject, environment, lighting, camera movement, and intended action; do not copy the user request as a meta instruction.',
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
        revision_scene_id: input.revisionSceneId ?? null,
        revision_scene_ids: input.revisionSceneIds ?? null,
        revision_transition_ids: input.revisionTransitionIds ?? null,
        agent_skill_context: input.agentSkillContext ?? null,
        agent_tool_context: input.agentToolContext ?? null,
        main_video_asset_id: example.assets.find((asset) => asset.id === 'main_video_asset')?.id ?? null,
        main_video_path: example.assets.find((asset) => asset.id === 'main_video_asset')?.src ?? null,
        reference_video_path: input.referenceVideoPath ?? null,
        optional_image_asset_id: example.assets.find((asset) => asset.id === 'planner_image_asset')?.id ?? null,
        optional_image_src: example.assets.find((asset) => asset.id === 'planner_image_asset')?.src ?? null,
        material_assets: example.assets.map((asset) => ({
          id: asset.id,
          type: asset.type,
          label: asset.label,
          source: asset.source,
        })),
        user_materials: (input.materials ?? []).map((material) => ({
          id: material.id,
          name: material.name,
          type: material.type,
          tags: material.tags,
        })),
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

async function bindAuthoritativePlannerAssets(
  input: V2RemotionTimelinePlannerInput,
  spec: RemotionTimelineSpecV1,
): Promise<RemotionTimelineSpecV1> {
  if (spec.material_jobs.some((job) => job.input_image_url)) {
    throw new Error('input_image_url is reserved for historical persisted jobs; model output must use input_asset_id.')
  }
  const authoritativeAssets = new Map(
    [
      ...buildDeterministicRemotionTimelineSpec(input).assets,
      ...(input.revisionBaseSpec?.assets ?? []),
    ].map((asset) => [asset.id, asset]),
  )
  const conditionedAssetIds = new Set(
    spec.material_jobs.flatMap((job) => job.input_asset_id ? [job.input_asset_id] : []),
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
  }

  return {
    ...spec,
    assets: spec.assets.map((asset) => {
      const authoritative = authoritativeAssets.get(asset.id)
      if (conditionedAssetIds.has(asset.id)) return { ...authoritative! }
      if (asset.source !== 'user_asset') return asset
      if (!authoritative || authoritative.source !== 'user_asset') {
        throw new Error(`model returned an unknown user_asset: ${asset.id}`)
      }
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

async function callResponsesApi(
  promptText: string,
  imageInputs: ArkResponsesImageInput[],
  options: { allowStructuredOutput?: boolean } = {},
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
      ? { text: { format: { type: 'json_schema', name: 'remotion_timeline_spec_v1', schema: TimelineJsonSchema } } }
      : {}),
    input: [
      {
        role: 'user',
        content: [
          { type: 'input_text', text: promptText },
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

function timelineJsonRepairPrompt(input: { invalidText: string; error: string }) {
  return [
    'Repair only the JSON format below. Do not change its business meaning, timeline choices, assets, or captions.',
    `Return JSON only following this schema: ${JSON.stringify(TimelineJsonSchema)}`,
    `Parse or validation error: ${input.error}`,
    'Original final answer:',
    input.invalidText,
  ].join('\n')
}

export async function runV2TimelineLlmPlanner(
  input: V2RemotionTimelinePlannerInput,
  options: { promptText?: string } = {},
): Promise<V2TimelineLlmPlannerResult> {
  const preparedImages = await preparePlannerImageInputs(input)
  const promptText = options.promptText ?? buildV2TimelinePlannerPrompt(input, preparedImages.report)
  let rawResponse: unknown
  let initialResponseAudit: unknown
  let structuredOutput: V2TimelineLlmPlannerResult['structuredOutput']
  let jsonRepair: V2TimelineLlmPlannerResult['jsonRepair']
  try {
    const response = await callResponsesApi(promptText, preparedImages.content)
    rawResponse = response.raw
    initialResponseAudit = responseAudit(rawResponse)
    structuredOutput = response.structuredOutput
  } finally {
    await releaseArkImageInputs(preparedImages)
  }
  let extracted = extractStructuredJsonCandidate(
    rawResponse,
    (value): value is RemotionTimelineSpecV1 =>
      typeof value === 'object' &&
      value !== null &&
      !Array.isArray(value) &&
      (value as { schema_version?: unknown }).schema_version === REMOTION_TIMELINE_SPEC_SCHEMA_VERSION,
  )
  if (!extracted.candidate) {
    const error = `LLM timeline planner did not return ${REMOTION_TIMELINE_SPEC_SCHEMA_VERSION}: ${JSON.stringify(extracted.report)}`
    const repairPrompt = timelineJsonRepairPrompt({ invalidText: extractTextCandidate(rawResponse), error })
    try {
      const repaired = await callResponsesApi(repairPrompt, [], { allowStructuredOutput: false })
      jsonRepair = { request: repairPrompt, responseAudit: responseAudit(repaired.raw) }
      rawResponse = repaired.raw
      extracted = extractStructuredJsonCandidate(
        rawResponse,
        (value): value is RemotionTimelineSpecV1 =>
          typeof value === 'object' && value !== null && !Array.isArray(value) &&
          (value as { schema_version?: unknown }).schema_version === REMOTION_TIMELINE_SPEC_SCHEMA_VERSION,
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

  let normalizedCandidate = await bindAuthoritativePlannerAssets(
    input,
    normalizeV2TimelineTextOwnership(extracted.candidate as RemotionTimelineSpecV1),
  )
  let repairedCandidate = repairV2LlmGeneratedMaterialPrompts(normalizedCandidate)
  let validation = validateRemotionTimelineSpec(repairedCandidate.spec)
  if (!validation.ok && !jsonRepair) {
    const error = `LLM timeline spec field validation failed: ${JSON.stringify(validation.issues)}`
    const repairPrompt = timelineJsonRepairPrompt({ invalidText: extractTextCandidate(rawResponse), error })
    try {
      const repaired = await callResponsesApi(repairPrompt, [], { allowStructuredOutput: false })
      jsonRepair = { request: repairPrompt, responseAudit: responseAudit(repaired.raw) }
      rawResponse = repaired.raw
      extracted = extractStructuredJsonCandidate(
        rawResponse,
        (value): value is RemotionTimelineSpecV1 =>
          typeof value === 'object' && value !== null && !Array.isArray(value) &&
          (value as { schema_version?: unknown }).schema_version === REMOTION_TIMELINE_SPEC_SCHEMA_VERSION,
      )
      if (extracted.candidate) {
        normalizedCandidate = await bindAuthoritativePlannerAssets(
          input,
          normalizeV2TimelineTextOwnership(extracted.candidate as RemotionTimelineSpecV1),
        )
        repairedCandidate = repairV2LlmGeneratedMaterialPrompts(normalizedCandidate)
        validation = validateRemotionTimelineSpec(repairedCandidate.spec)
      }
    } catch (repairError) {
      jsonRepair = { request: repairPrompt, error: repairError instanceof Error ? repairError.message : String(repairError) }
    }
  }
  if (!validation.ok) {
    throw new V2TimelinePlannerProtocolError(
      `LLM timeline spec is invalid: ${JSON.stringify(validation.issues, null, 2)}`,
      {
        initialResponseAudit: initialResponseAudit!,
        rawResponse: responseAudit(rawResponse), extractionReport: extracted.report,
        structuredOutput: structuredOutput!, jsonRepair, validationIssues: validation.issues,
      },
    )
  }

  const spec = assertValidRemotionTimelineSpec(repairedCandidate.spec)
  assertLlmMainSceneMaterialCoverage(input, spec)

  return {
    spec,
    initialResponseAudit: initialResponseAudit!,
    rawResponse: responseAudit(rawResponse),
    extractionReport: extracted.report,
    promptText,
    visualInputReport: preparedImages.report,
    repairs: repairedCandidate.repairs,
    structuredOutput: structuredOutput!,
    ...(jsonRepair ? { jsonRepair } : {}),
  }
}
