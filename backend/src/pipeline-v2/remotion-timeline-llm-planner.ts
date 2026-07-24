import { env } from '../config/env.js'
import {
  extractStructuredJsonCandidate,
  type StructuredJsonExtractionReport,
} from '../modules/agent-tools/structured-json-tool.js'
import {
  assertValidRemotionTimelineSpec,
  validateRemotionTimelineSpec,
} from '../../../shared/lib/remotion-timeline-validator.js'
import { normalizeV2TimelineTextOwnership } from '../../../shared/lib/remotion-timeline-text-ownership.js'
import { isLikelyExternallyReachableUrl } from '../../../shared/lib/external-url-access.js'
import {
  REMOTION_TIMELINE_SPEC_SCHEMA_VERSION,
  type RemotionTimelineSpecV1,
} from '../../../shared/types/remotion-timeline-spec.v1.js'
import {
  buildDeterministicRemotionTimelineSpec,
  type V2RemotionTimelinePlannerInput,
} from './remotion-timeline-planner.js'
import { extractV2TimelineHardRequirements } from './hard-requirements.js'
import {
  deleteV2PlannerFile,
  uploadV2PlannerImageFile,
  waitForV2PlannerFileReady,
} from './ark-file-input.js'

const MAX_V2_PLANNER_IMAGE_INPUTS = 12

export interface V2TimelineVisualInputReport {
  requested_image_material_count: number
  attached_image_input_count: number
  ark_file_input_count: number
  public_url_input_count: number
  omitted_material_ids: string[]
}

export interface V2TimelineLlmPlannerResult {
  spec: RemotionTimelineSpecV1
  rawResponse: unknown
  extractionReport: StructuredJsonExtractionReport
  promptText: string
  visualInputReport: V2TimelineVisualInputReport
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
    '- External video generation image inputs must be public http(s) URLs; never use localhost, private-network, file, or data URLs for input_image_url.',
    '- If main_video_asset_id is null, do not create user_video scenes unless another video asset exists in assets.',
    '- If reference_video_path is provided, treat it as style/structure context only; do not include it as an output asset unless it is also listed as main_video_path.',
    '- If sample_understanding is provided, use it as the source for sample content, rhythm, pacing, shot structure, and transition cues. Do not ignore it and do not infer sample details only from the filename.',
    '- creation_mode controls the task branch:',
    '  - sample_replicate: learn structure, pacing, atmosphere, and transitions from sample_understanding; user materials or generated assets provide final visuals.',
    '  - material_brief: no sample video is available; infer structure from user_prompt and material_assets only. Do not mention sample rhythm or sample style.',
    '  - text_to_video: no sample and no visual material are available; plan AI video scenes for realistic visuals when the provider can support them, and keep Remotion captions/cards as fallback.',
    '- planning_context contains stable draft/version facts only. user_prompt has priority when there is any conflict.',
    '- revision_context, when present, is the authoritative persisted V2 draft being revised. It is not a chat recap.',
    '- For a revision, preserve scenes, assets, transitions, overlays, and user notes that the user did not ask to change. Make a broader rewrite only when the user explicitly requests one.',
    '- The selected revision item identifies the user\'s current focus, not an instruction to ignore the rest of the timeline.',
    '- render_policy.allow_custom_component must be false.',
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
    'Allowed transition types: cut, fade, slide, wipe, light_flash.',
    'Allowed overlay types: caption, title, label, shape, image_badge, light_sweep.',
    '',
    'Runtime input:',
    JSON.stringify(
      {
        task_id: input.taskId,
        creation_mode: creationMode,
        user_prompt: input.prompt,
        planning_context: input.planningContext ?? null,
        revision_context: input.revisionContext ?? null,
        main_video_asset_id: example.assets.find((asset) => asset.id === 'main_video_asset')?.id ?? null,
        main_video_path: example.assets.find((asset) => asset.id === 'main_video_asset')?.src ?? null,
        reference_video_path: input.referenceVideoPath ?? null,
        optional_image_asset_id: example.assets.find((asset) => asset.id === 'planner_image_asset')?.id ?? null,
        optional_image_src: example.assets.find((asset) => asset.id === 'planner_image_asset')?.src ?? null,
        material_assets: example.assets.map((asset) => ({
          id: asset.id,
          type: asset.type,
          src: asset.src,
          label: asset.label,
          source: asset.source,
        })),
        user_materials: input.materials ?? [],
        sample_understanding: compactSampleUnderstanding(input),
        hard_requirements: hardRequirements,
        external_input_image_url: input.inputImageUrl ?? null,
        attached_image_inputs: visualInputReport ?? {
          requested_image_material_count: (input.materials ?? []).filter((material) => material.type === 'image').length,
          attached_image_input_count: 0,
          ark_file_input_count: 0,
          public_url_input_count: 0,
          omitted_material_ids: [],
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
  const missing = expected.filter((asset) => !mainSceneSrcs.has(asset.src))
  if (missing.length) {
    throw new Error(
      `LLM timeline used only ${expected.length - missing.length}/${expected.length} user visual materials as main scenes; falling back to deterministic coverage.`,
    )
  }
}

type PlannerImageContent =
  | { type: 'input_image'; image_url: string }
  | { type: 'input_image'; file_id: string }

async function preparePlannerImageInputs(input: V2RemotionTimelinePlannerInput): Promise<{
  content: PlannerImageContent[]
  temporaryFileIds: string[]
  report: V2TimelineVisualInputReport
}> {
  const imageMaterials = (input.materials ?? []).filter((material) => material.type === 'image')
  const selected = imageMaterials.slice(0, MAX_V2_PLANNER_IMAGE_INPUTS)
  const content: PlannerImageContent[] = []
  const temporaryFileIds: string[] = []
  let publicUrlInputCount = 0

  try {
    for (const material of selected) {
      const publicImageUrl = [material.publicUrl, material.src].find(isLikelyExternallyReachableUrl)
      if (publicImageUrl) {
        content.push({ type: 'input_image', image_url: publicImageUrl })
        publicUrlInputCount += 1
        continue
      }
      const uploaded = await uploadV2PlannerImageFile({
        localPath: material.src,
        originalName: material.name,
      })
      temporaryFileIds.push(uploaded.fileId)
      await waitForV2PlannerFileReady(uploaded.fileId)
      content.push({ type: 'input_image', file_id: uploaded.fileId })
    }
  } catch (error) {
    await Promise.all(temporaryFileIds.map((fileId) => deleteV2PlannerFile(fileId)))
    throw error
  }

  return {
    content,
    temporaryFileIds,
    report: {
      requested_image_material_count: imageMaterials.length,
      attached_image_input_count: content.length,
      ark_file_input_count: temporaryFileIds.length,
      public_url_input_count: publicUrlInputCount,
      omitted_material_ids: imageMaterials.slice(MAX_V2_PLANNER_IMAGE_INPUTS).map((material) => material.id),
    },
  }
}

async function callResponsesApi(
  promptText: string,
  imageInputs: PlannerImageContent[],
): Promise<unknown> {
  if (!env.directorAgentApiKey) {
    throw new Error('DIRECTOR_AGENT_API_KEY is not configured.')
  }

  const response = await fetch(env.directorAgentResponsesUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.directorAgentApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: env.directorAgentModel,
      input: [
        {
          role: 'user',
          content: [
            { type: 'input_text', text: promptText },
            ...imageInputs,
          ],
        },
      ],
    }),
    signal: AbortSignal.timeout(env.directorAgentTimeoutMs),
  })

  const text = await response.text()
  if (!response.ok) {
    throw new Error(`Responses API returned ${response.status}: ${text.slice(0, 500)}`)
  }

  try {
    return JSON.parse(text) as unknown
  } catch {
    return text
  }
}

export async function runV2TimelineLlmPlanner(
  input: V2RemotionTimelinePlannerInput,
  options: { promptText?: string } = {},
): Promise<V2TimelineLlmPlannerResult> {
  const preparedImages = await preparePlannerImageInputs(input)
  const promptText = options.promptText ?? buildV2TimelinePlannerPrompt(input, preparedImages.report)
  let rawResponse: unknown
  try {
    rawResponse = await callResponsesApi(promptText, preparedImages.content)
  } finally {
    await Promise.all(preparedImages.temporaryFileIds.map((fileId) => deleteV2PlannerFile(fileId)))
  }
  const extracted = extractStructuredJsonCandidate(
    rawResponse,
    (value): value is RemotionTimelineSpecV1 =>
      typeof value === 'object' &&
      value !== null &&
      !Array.isArray(value) &&
      (value as { schema_version?: unknown }).schema_version === REMOTION_TIMELINE_SPEC_SCHEMA_VERSION,
  )
  if (!extracted.candidate) {
    throw new Error(
      `LLM timeline planner did not return ${REMOTION_TIMELINE_SPEC_SCHEMA_VERSION}: ${JSON.stringify(
        extracted.report,
        null,
        2,
      )}`,
    )
  }

  const normalizedCandidate = normalizeV2TimelineTextOwnership(
    extracted.candidate as RemotionTimelineSpecV1,
  )
  const validation = validateRemotionTimelineSpec(normalizedCandidate)
  if (!validation.ok) {
    throw new Error(`LLM timeline spec is invalid: ${JSON.stringify(validation.issues, null, 2)}`)
  }

  const spec = assertValidRemotionTimelineSpec(normalizedCandidate)
  assertLlmMainSceneMaterialCoverage(input, spec)

  return {
    spec,
    rawResponse,
    extractionReport: extracted.report,
    promptText,
    visualInputReport: preparedImages.report,
  }
}
