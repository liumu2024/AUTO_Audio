import { PRIMITIVE_PRESET_IDS } from '../../../../../shared/lib/primitive-presets.js'
import type { UserMaterialDto } from '../../../../../shared/types/pipeline.js'
import type { AudioVisualUnderstandingHints } from '../../../../../shared/types/sample-understanding-skills.js'
import type { VideoInput } from '../../video-understanding/video-input.js'
import { renderPromptTemplate } from '../prompts/prompt-loader.js'
import { formatPromptClausesForPrompt } from './prompt-clause-registry.js'

export interface DirectorGroundingPromptContext {
  taskId: string
  globalPrompt?: string
  materials?: UserMaterialDto[]
  sampleHints?: AudioVisualUnderstandingHints
}

function materialSummary(materials: UserMaterialDto[] | undefined) {
  return (materials ?? []).map((material) => ({
    id: material.id,
    name: material.label,
    type: material.material_type.toLowerCase(),
    tags: material.ai_tags ?? [],
  }))
}

function supportedPresetsList(): string {
  return PRIMITIVE_PRESET_IDS.join(', ')
}

function buildTemplateVariables(taskId: string) {
  return {
    task_id: taskId,
    supported_presets_list: supportedPresetsList(),
    prompt_clauses: formatPromptClausesForPrompt(),
  }
}

function sampleHintsSummary(sampleHints: AudioVisualUnderstandingHints | undefined) {
  if (!sampleHints) return null
  return {
    duration_sec: sampleHints.metadata.video_duration,
    fps: sampleHints.metadata.fps,
    visual_keyframe_count: sampleHints.visual_keyframes.length,
    beat_count: sampleHints.audio_features.beats.length,
    strong_beat_count: sampleHints.audio_features.strong_beats.length,
    energy_peak_count: sampleHints.audio_features.energy_peaks.length,
  }
}

function buildTaskContextSection(
  video: VideoInput,
  context: DirectorGroundingPromptContext,
): string {
  const creativeIntent =
    context.globalPrompt?.trim() ||
    'Replicate the sample editing structure and rhythm with user materials.'

  return [
    '## Task Context',
    `task_id=${context.taskId}`,
    `creative_intent_raw=${creativeIntent}`,
    `sample_video_file=${JSON.stringify({
      name: video.originalName,
      mimeType: video.mimeType,
      sizeBytes: video.sizeBytes,
      role: 'structure_source',
    })}`,
    `reference_materials=${JSON.stringify(materialSummary(context.materials), null, 2)}`,
    `sample_hints=${JSON.stringify(context.sampleHints ?? null, null, 2)}`,
    'capability_scope=Observe effects semantically. Do not choose plugins or write executable scene effects in this phase.',
  ].join('\n')
}

function buildCompactTaskContextSection(
  video: VideoInput,
  context: DirectorGroundingPromptContext,
): string {
  const creativeIntent =
    context.globalPrompt?.trim() ||
    'Replicate the sample editing structure and rhythm with user materials.'

  return [
    '## Compact Task Context',
    `task_id=${context.taskId}`,
    `creative_intent_raw=${creativeIntent}`,
    `sample_video_file=${JSON.stringify({
      name: video.originalName,
      mimeType: video.mimeType,
      sizeBytes: video.sizeBytes,
      role: 'structure_source',
    })}`,
    `reference_materials=${JSON.stringify(materialSummary(context.materials), null, 2)}`,
    `sample_hint_summary=${JSON.stringify(sampleHintsSummary(context.sampleHints), null, 2)}`,
    'capability_scope=Convert the observation brief into DirectorGrounding JSON. Do not choose executable scene effects.',
  ].join('\n')
}

export function buildDirectorObservationPrompt(
  video: VideoInput,
  context: DirectorGroundingPromptContext,
): string {
  const variables = buildTemplateVariables(context.taskId)

  return [
    renderPromptTemplate('director-grounding/observation-system.md', variables),
    '## Observation Brief Output Contract',
    [
      'Return exactly one JSON object with schema_version="director_observation_brief.v1".',
      'This phase only records evidence and reusable observations. Do not emit DirectorGroundingResult.',
      'Required top-level fields: schema_version, task_id, sample_facts, shot_events, transition_observations, temporal_outline, effect_observations, style_summary, material_slot_notes, risks.',
      'Keep descriptions concise and evidence-based. Use Simplified Chinese for natural-language fields.',
    ].join('\n'),
    buildTaskContextSection(video, context),
  ].join('\n\n')
}

export function buildDirectorGroundingStructuringPrompt(input: {
  video: VideoInput
  context: DirectorGroundingPromptContext
  observationBrief: unknown
}): string {
  const variables = buildTemplateVariables(input.context.taskId)

  return [
    renderPromptTemplate('global/redlines.md', variables),
    renderPromptTemplate('director-grounding/output-schema.md', variables),
    buildCompactTaskContextSection(input.video, input.context),
    '## Observation Brief From Previous Phase',
    `director_observation_brief=${JSON.stringify(input.observationBrief, null, 2)}`,
    '## Phase Responsibility',
    [
      'Use the observation brief as the source of video evidence.',
      'Fill the DirectorGroundingResult schema completely and keep ids stable.',
      'If the brief is uncertain, preserve uncertainty in confidence fields instead of inventing media or effects.',
    ].join('\n'),
  ].join('\n\n')
}

export function buildDirectorGroundingPrompt(
  video: VideoInput,
  context: DirectorGroundingPromptContext,
): string {
  const variables = buildTemplateVariables(context.taskId)

  return [
    renderPromptTemplate('director-grounding/observation-system.md', variables),
    renderPromptTemplate('director-grounding/output-schema.md', variables),
    buildTaskContextSection(video, context),
  ].join('\n\n')
}

export function buildDirectorGroundingRepairPrompt(input: {
  taskId: string
  validationError: string
  previousJson: unknown
}): string {
  const previousJson =
    typeof input.previousJson === 'string'
      ? input.previousJson
      : JSON.stringify(input.previousJson, null, 2)
  return [
    renderPromptTemplate('director-grounding/repair.md', {
      task_id: input.taskId,
      validation_error: input.validationError,
    }),
    `previous_json=\n${previousJson}`,
  ].join('\n\n')
}
