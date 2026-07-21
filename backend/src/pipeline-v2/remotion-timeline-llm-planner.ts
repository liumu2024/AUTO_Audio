import { env } from '../config/env.js'
import {
  extractStructuredJsonCandidate,
  type StructuredJsonExtractionReport,
} from '../modules/agent-tools/structured-json-tool.js'
import {
  assertValidRemotionTimelineSpec,
  validateRemotionTimelineSpec,
} from '../../../shared/lib/remotion-timeline-validator.js'
import {
  REMOTION_TIMELINE_SPEC_SCHEMA_VERSION,
  type RemotionTimelineSpecV1,
} from '../../../shared/types/remotion-timeline-spec.v1.js'
import {
  buildDeterministicRemotionTimelineSpec,
  type V2RemotionTimelinePlannerInput,
} from './remotion-timeline-planner.js'

export interface V2TimelineLlmPlannerResult {
  spec: RemotionTimelineSpecV1
  rawResponse: unknown
  extractionReport: StructuredJsonExtractionReport
  promptText: string
}

function buildTimelinePlannerPrompt(input: V2RemotionTimelinePlannerInput): string {
  const example = buildDeterministicRemotionTimelineSpec(input)
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
    '- render_policy.allow_custom_component must be false.',
    '- Keep the plan compact: prefer 3 to 5 scenes and avoid unnecessary generated video jobs.',
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
        user_prompt: input.prompt,
        main_video_asset_id: 'main_video_asset',
        main_video_path: example.assets.find((asset) => asset.id === 'main_video_asset')?.src,
        optional_image_asset_id: example.assets.find((asset) => asset.id === 'planner_image_asset')?.id ?? null,
        optional_image_src: example.assets.find((asset) => asset.id === 'planner_image_asset')?.src ?? null,
        external_input_image_url: input.inputImageUrl ?? null,
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

async function callResponsesApi(promptText: string): Promise<unknown> {
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
          content: [{ type: 'input_text', text: promptText }],
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
): Promise<V2TimelineLlmPlannerResult> {
  const promptText = buildTimelinePlannerPrompt(input)
  const rawResponse = await callResponsesApi(promptText)
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

  const validation = validateRemotionTimelineSpec(extracted.candidate)
  if (!validation.ok) {
    throw new Error(`LLM timeline spec is invalid: ${JSON.stringify(validation.issues, null, 2)}`)
  }

  return {
    spec: assertValidRemotionTimelineSpec(extracted.candidate),
    rawResponse,
    extractionReport: extracted.report,
    promptText,
  }
}
