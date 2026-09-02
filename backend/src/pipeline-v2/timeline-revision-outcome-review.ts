import { env } from '../config/env.js'
import { extractTextCandidate } from '../modules/agent-tools/structured-json-tool.js'
import type { RemotionTimelineSpecV1 } from '../../../shared/types/remotion-timeline-spec.v1.js'
import type { DirectorTimelineFacts } from '../../../shared/types/director-context.js'
import {
  VISUAL_STRATEGY_SCENE_FIELDS,
  type V2TimelineRevisionGroup,
  type V2TimelineRevisionScope,
} from './timeline-revision-scope.js'
import type { V2PlannerInput } from './v2-input.js'

type V2TimelineAvailableComponents = NonNullable<V2PlannerInput['availableComponents']>

export type V2TimelineRevisionViolationKind =
  | 'missing_requested_change'
  | 'unrelated_change'
  | 'visible_text_violation'
  | 'caption_presentation_violation'
  | 'sample_boundary_violation'
  | 'other'

export interface V2TimelineRevisionReviewVerdict {
  pass: boolean
  violations: Array<{ kind: V2TimelineRevisionViolationKind; message: string }>
  repairInstruction?: string
}

export interface V2TimelineFactDigest {
  creative_brief?: RemotionTimelineSpecV1['creative_brief']
  scenes: Array<{
    id: string
    title?: string
    description?: string
    visual_role?: string
    duration_sec: number
    type: RemotionTimelineSpecV1['scenes'][number]['type']
    asset_id?: string
    motion?: RemotionTimelineSpecV1['scenes'][number]['motion']
    custom_render_component_id?: string
    caption_count: number
    material_jobs: Array<{
      id: string
      type: RemotionTimelineSpecV1['material_jobs'][number]['type']
      status: RemotionTimelineSpecV1['material_jobs'][number]['status']
      input_asset_id?: string
      output_asset_id?: string
      fallback_kind?: RemotionTimelineSpecV1['material_jobs'][number]['fallback_kind']
      prompt?: string
    }>
  }>
  visible_text: Array<{
    id: string
    scene_id?: string
    type: string
    text: string
    position: { x_pct: number; y_pct: number; width_pct?: number; max_lines?: number }
    animation?: string
  }>
  transitions: Array<{
    id: string
    from_scene_id: string
    to_scene_id: string
    type: string
    duration_sec: number
    custom_render_component_id?: string
    custom_render_display_name?: string
  }>
  audio: Array<{ start_sec: number; end_sec: number; volume?: number }>
  notes: string[]
}

export interface V2TimelineRevisionOutcomeReview {
  pass: boolean
  baseDigest: V2TimelineFactDigest
  candidateDigest: V2TimelineFactDigest
  violations: V2TimelineRevisionReviewVerdict['violations']
  repairInstruction?: string
  audit: {
    source: 'llm' | 'injected'
    modelResponse?: { id?: unknown; model?: unknown; status?: unknown; usage?: unknown; output_text: string }
    structuredOutput?: { requested: boolean; providerFallback: boolean; reason?: string }
    jsonRepair?: { requested: boolean; success: boolean; error?: string }
  }
}

export interface V2TimelineRevisionCommitDecision {
  ok: boolean
  scope: V2TimelineRevisionScope
  violation?: { kind: 'missing_requested_change'; message: string }
}

/** A semantic revision failure must retain the persisted V2 revision, not fall back to a new plan. */
export class V2TimelineRevisionOutcomeError extends Error {
  constructor(readonly review: V2TimelineRevisionOutcomeReview) {
    super(`V2 revision outcome review failed: ${JSON.stringify(review.violations)}`)
    this.name = 'V2TimelineRevisionOutcomeError'
  }
}

export interface V2TimelineSpecDiffSummary {
  scenes: string[]
  visibleText: string[]
  transitions: string[]
  audio: string[]
  other: string[]
  hasAudienceFacingChange: boolean
}

function describeFieldChanges(label: string, before: unknown, after: unknown): string[] {
  if (
    typeof before === 'object' && before !== null &&
    typeof after === 'object' && after !== null &&
    !Array.isArray(before) && !Array.isArray(after)
  ) {
    const keys = new Set([...Object.keys(before), ...Object.keys(after)])
    const lines: string[] = []
    for (const key of keys) {
      const b = (before as Record<string, unknown>)[key]
      const a = (after as Record<string, unknown>)[key]
      if (JSON.stringify(b) !== JSON.stringify(a)) {
        lines.push(...describeFieldChanges(`${label}.${key}`, b, a))
      }
    }
    return lines
  }
  return [`${label}: ${JSON.stringify(before)} -> ${JSON.stringify(after)}`]
}

function diffKeyedArray<T extends object>(
  base: T[],
  candidate: T[],
  keyOf: (item: T, index: number) => string,
  label: string,
): string[] {
  const lines: string[] = []
  const baseByKey = new Map(base.map((item, index) => [keyOf(item, index), item]))
  const candidateByKey = new Map(candidate.map((item, index) => [keyOf(item, index), item]))
  for (const [id, before] of baseByKey) {
    const after = candidateByKey.get(id)
    if (after === undefined) lines.push(`${label}.${id}: removed`)
    else lines.push(...describeFieldChanges(`${label}.${id}`, before, after))
  }
  for (const id of candidateByKey.keys()) {
    if (!baseByKey.has(id)) lines.push(`${label}.${id}: added`)
  }
  return lines
}

/**
 * Computes the authoritative field-level diff between two timeline specs.
 * Unlike the digest projection (which only carries selected semantic fields),
 * this covers every field including presentation styles, so a caption
 * background/opacity change is recognized as a real revision.
 */
export function describeV2TimelineSpecDiff(
  base: RemotionTimelineSpecV1,
  candidate: RemotionTimelineSpecV1,
): V2TimelineSpecDiffSummary {
  const scenes = diffKeyedArray(base.scenes, candidate.scenes, (scene) => scene.id, 'scene')
  const visibleText = diffKeyedArray(base.overlays, candidate.overlays, (overlay) => overlay.id, 'overlay')
  const transitions = diffKeyedArray(
    base.transitions,
    candidate.transitions,
    (transition) => `${transition.from_scene_id}:${transition.to_scene_id}`,
    'transition',
  )
  const baseOrder = base.transitions.map((item) => `${item.from_scene_id}:${item.to_scene_id}`)
  const candidateOrder = candidate.transitions.map((item) => `${item.from_scene_id}:${item.to_scene_id}`)
  if (JSON.stringify(baseOrder) !== JSON.stringify(candidateOrder)) {
    transitions.push(`transitions order changed: [${candidateOrder.join(', ')}]`)
  }
  const audio = diffKeyedArray(base.audio ?? [], candidate.audio ?? [], (_clip, index) => String(index), 'audio')
  const other = [
    ...(JSON.stringify(base.canvas) !== JSON.stringify(candidate.canvas) ? ['canvas changed'] : []),
    ...(JSON.stringify(base.creative_brief) !== JSON.stringify(candidate.creative_brief) ? ['creative_brief changed'] : []),
    ...diffKeyedArray(base.material_jobs, candidate.material_jobs, (job) => job.id, 'material_job'),
    ...(JSON.stringify(base.notes ?? []) !== JSON.stringify(candidate.notes ?? []) ? ['notes changed'] : []),
  ]
  return {
    scenes,
    visibleText,
    transitions,
    audio,
    other,
    hasAudienceFacingChange:
      scenes.length > 0 || visibleText.length > 0 || transitions.length > 0 || audio.length > 0
      || other.some((line) => !line.startsWith('notes changed')),
  }
}

function nonBlank(value: string | undefined) {
  const text = value?.trim()
  return text || undefined
}

/**
 * This is a user-facing factual projection of the persisted V2 spec. It is
 * deliberately derived on demand, so chat summaries cannot claim a change
 * that the saved timeline does not actually contain.
 */
export function buildV2TimelineFactDigest(spec: RemotionTimelineSpecV1): V2TimelineFactDigest {
  return {
    creative_brief: spec.creative_brief,
    scenes: spec.scenes.map((scene) => ({
      id: scene.id,
      title: nonBlank(scene.creative_intent?.title) ?? nonBlank(scene.title),
      description: nonBlank(scene.creative_intent?.description) ?? nonBlank(scene.body),
      visual_role: scene.visual_role,
      duration_sec: scene.duration_sec,
      type: scene.type,
      asset_id: scene.asset_id,
      motion: scene.motion,
      custom_render_component_id: scene.custom_render?.component_id,
      caption_count: spec.overlays.filter((overlay) =>
        overlay.type === 'caption' && overlay.scene_id === scene.id && Boolean(overlay.text?.trim())).length,
      material_jobs: spec.material_jobs.filter((job) => job.scene_id === scene.id).map((job) => ({
        id: job.id,
        type: job.type,
        status: job.status,
        input_asset_id: job.input_asset_id,
        output_asset_id: job.output_asset_id,
        fallback_kind: job.fallback_kind,
        prompt: job.prompt,
      })),
    })),
    visible_text: spec.overlays
      .filter((overlay) => ['caption', 'title', 'label'].includes(overlay.type) && Boolean(overlay.text?.trim()))
      .map((overlay) => ({
        id: overlay.id,
        scene_id: overlay.scene_id,
        type: overlay.type,
        text: overlay.text!.trim(),
        position: {
          x_pct: overlay.x_pct,
          y_pct: overlay.y_pct,
          width_pct: overlay.width_pct,
          max_lines: overlay.max_lines,
        },
        animation: overlay.animation,
      })),
    transitions: spec.transitions.map((transition) => ({
      id: transition.id,
      from_scene_id: transition.from_scene_id,
      to_scene_id: transition.to_scene_id,
      type: transition.type,
      duration_sec: transition.duration_sec,
      custom_render_component_id: transition.custom_render?.component_id,
      custom_render_display_name: transition.custom_render?.display_name,
    })),
    audio: (spec.audio ?? []).map((clip) => ({
      start_sec: clip.start_sec,
      end_sec: clip.end_sec,
      volume: clip.volume,
    })),
    notes: (spec.notes ?? []).slice(-12),
  }
}

function projectV2TimelineRevisionDigest(
  digest: V2TimelineFactDigest,
  input: {
    revisionScope?: V2TimelineRevisionScope
    revisionSceneId?: string
    revisionSceneIds?: string[]
    revisionOverlayIds?: string[]
    revisionTransitionIds?: string[]
    revisionGlobalMode?: 'brief_update' | 'full_replan'
    revisionProjectionSceneIds?: string[]
  },
): V2TimelineFactDigest {
  if (
    !input.revisionScope
    || (input.revisionScope === 'global' && input.revisionGlobalMode === 'full_replan')
  ) return digest

  if (input.revisionScope === 'global') {
    return { ...emptyTimelineFactDigest(), creative_brief: digest.creative_brief }
  }

  const sceneIds = new Set<string>()
  const transitionIds = new Set(input.revisionTransitionIds ?? [])
  if (input.revisionScope === 'structure') {
    const projectedSceneIds = new Set(input.revisionProjectionSceneIds ?? [])
    return {
      ...emptyTimelineFactDigest(),
      scenes: digest.scenes.filter((scene) => projectedSceneIds.has(scene.id)),
      visible_text: digest.visible_text.filter((item) =>
        item.scene_id != null && projectedSceneIds.has(item.scene_id)),
      transitions: digest.transitions.filter((transition) =>
        projectedSceneIds.has(transition.from_scene_id)
        && projectedSceneIds.has(transition.to_scene_id)),
    }
  }
  if (input.revisionSceneId) sceneIds.add(input.revisionSceneId)
  for (const id of input.revisionSceneIds ?? []) sceneIds.add(id)
  if (input.revisionScope === 'transition') {
    for (const transition of digest.transitions) {
      if (!transitionIds.has(transition.id)) continue
      sceneIds.add(transition.from_scene_id)
      sceneIds.add(transition.to_scene_id)
    }
  }
  const overlayIds = new Set(input.revisionOverlayIds ?? [])
  const visibleText = digest.visible_text.filter((item) =>
    input.revisionScope === 'subtitle'
      ? (!input.revisionSceneId || item.scene_id === input.revisionSceneId)
        && (overlayIds.size === 0 || overlayIds.has(item.id))
      : item.scene_id != null && sceneIds.has(item.scene_id))
  return {
    creative_brief:
      input.revisionScope === 'scene' || input.revisionScope === 'visual_strategy'
        ? digest.creative_brief
        : undefined,
    scenes: digest.scenes.filter((scene) => sceneIds.has(scene.id)).map((scene) =>
      input.revisionScope === 'transition' ? { ...scene, material_jobs: [] } : scene),
    visible_text: visibleText,
    transitions: input.revisionScope === 'transition'
      ? digest.transitions.filter((transition) => transitionIds.has(transition.id))
      : [],
    audio: [],
    notes: [],
  }
}

function projectV2TimelineRevisionGroupDigest(
  digest: V2TimelineFactDigest,
  group: V2TimelineRevisionGroup,
): V2TimelineFactDigest {
  const scopes = new Set(group.items.map((item) => item.scope))
  const overlayIds = new Set(group.items.flatMap((item) => item.overlayIds ?? []))
  const includesSceneCaptionAdd = group.items.some((item) =>
    item.scope === 'subtitle' && !item.overlayIds?.length)
  const transitionIds = new Set(group.items.flatMap((item) => item.transitionIds ?? []))
  const sceneIds = new Set([group.sceneId])
  for (const transition of digest.transitions) {
    if (!transitionIds.has(transition.id)) continue
    sceneIds.add(transition.from_scene_id)
    sceneIds.add(transition.to_scene_id)
  }
  return {
    creative_brief: scopes.has('scene') || scopes.has('visual_strategy')
      ? digest.creative_brief
      : undefined,
    scenes: digest.scenes.filter((scene) => sceneIds.has(scene.id)).map((scene) =>
      scene.id === group.sceneId ? scene : { ...scene, material_jobs: [] }),
    visible_text: digest.visible_text.filter((item) =>
      overlayIds.has(item.id) || Boolean(includesSceneCaptionAdd && item.scene_id === group.sceneId)),
    transitions: digest.transitions.filter((transition) => transitionIds.has(transition.id)),
    audio: [],
    notes: [],
  }
}

function structureRevisionProjectionSceneIds(input: {
  baseSpec?: RemotionTimelineSpecV1
  candidateSpec: RemotionTimelineSpecV1
  revisionSceneIds?: string[]
}) {
  if (!input.baseSpec || !input.revisionSceneIds?.length) return undefined
  const targetIndices = input.revisionSceneIds.map((id) =>
    input.baseSpec!.scenes.findIndex((scene) => scene.id === id))
  if (targetIndices.some((index) => index < 0)) {
    throw new Error('Structure revision review requires known target scenes.')
  }
  const first = Math.min(...targetIndices)
  const last = Math.max(...targetIndices)
  const leftAnchor = input.baseSpec.scenes[first - 1]?.id
  const rightAnchor = input.baseSpec.scenes[last + 1]?.id
  const candidateStart = leftAnchor
    ? input.candidateSpec.scenes.findIndex((scene) => scene.id === leftAnchor)
    : 0
  const candidateEnd = rightAnchor
    ? input.candidateSpec.scenes.findIndex((scene) => scene.id === rightAnchor)
    : input.candidateSpec.scenes.length - 1
  if (candidateStart < 0 || candidateEnd < candidateStart) {
    throw new Error('Structure revision review could not resolve its boundary anchors.')
  }
  return {
    base: input.baseSpec.scenes
      .slice(Math.max(0, first - 1), Math.min(input.baseSpec.scenes.length, last + 2))
      .map((scene) => scene.id),
    candidate: input.candidateSpec.scenes
      .slice(candidateStart, candidateEnd + 1)
      .map((scene) => scene.id),
  }
}

export function buildDirectorTimelineFacts(
  revision: number,
  spec: RemotionTimelineSpecV1,
): DirectorTimelineFacts {
  const digest = buildV2TimelineFactDigest(spec)
  return {
    revision,
    scenes: digest.scenes.map((scene) => ({
      id: scene.id,
      title: scene.title,
      description: scene.description,
      visualRole: scene.visual_role,
      durationSec: scene.duration_sec,
      type: scene.type,
      assetId: scene.asset_id,
      motion: scene.motion,
      customRenderComponentId: scene.custom_render_component_id,
      captionCount: scene.caption_count,
      materialJobs: scene.material_jobs.map((job) => ({
        id: job.id,
        type: job.type,
        status: job.status,
        inputAssetId: job.input_asset_id,
        outputAssetId: job.output_asset_id,
        fallbackKind: job.fallback_kind,
        prompt: job.prompt,
      })),
    })),
    visibleText: digest.visible_text.map((item) => ({
      id: item.id,
      sceneId: item.scene_id,
      type: item.type,
      text: item.text,
      yPct: item.position.y_pct,
      maxLines: item.position.max_lines,
      animation: item.animation,
    })),
    transitions: digest.transitions.map((transition) => ({
      id: transition.id,
      fromSceneId: transition.from_scene_id,
      toSceneId: transition.to_scene_id,
      fromSceneIndex: digest.scenes.findIndex((scene) => scene.id === transition.from_scene_id) + 1,
      toSceneIndex: digest.scenes.findIndex((scene) => scene.id === transition.to_scene_id) + 1,
      type: transition.type,
      durationSec: transition.duration_sec,
    })),
    audioClipCount: digest.audio.length,
    notes: digest.notes,
  }
}

function changedIds<T extends { id: string }>(base: T[], candidate: T[]) {
  const baseById = new Map(base.map((item) => [item.id, item]))
  const candidateById = new Map(candidate.map((item) => [item.id, item]))
  return {
    added: candidate.filter((item) => !baseById.has(item.id)).map((item) => item.id),
    removed: base.filter((item) => !candidateById.has(item.id)).map((item) => item.id),
    changed: candidate
      .filter((item) => {
        const before = baseById.get(item.id)
        return before !== undefined && JSON.stringify(before) !== JSON.stringify(item)
      })
      .map((item) => item.id),
  }
}

export function buildV2TimelineRevisionDiff(
  base: V2TimelineFactDigest,
  candidate: V2TimelineFactDigest,
) {
  return {
    scenes: changedIds(base.scenes, candidate.scenes),
    visible_text: changedIds(base.visible_text, candidate.visible_text),
    transitions: changedIds(
      base.transitions.map((item, index) => ({ ...item, id: `${item.from_scene_id}:${item.to_scene_id}:${index}` })),
      candidate.transitions.map((item, index) => ({ ...item, id: `${item.from_scene_id}:${item.to_scene_id}:${index}` })),
    ),
    audio_changed: JSON.stringify(base.audio) !== JSON.stringify(candidate.audio),
    notes_changed: JSON.stringify(base.notes) !== JSON.stringify(candidate.notes),
  }
}

function emptyTimelineFactDigest(): V2TimelineFactDigest {
  return { scenes: [], visible_text: [], transitions: [], audio: [], notes: [] }
}

/**
 * Final persistence gate. It runs after scope filtering, so a planner cannot
 * claim success when its proposed change is removed by the tool boundary.
 */
export function evaluateV2TimelineRevisionCommit(input: {
  baseSpec: RemotionTimelineSpecV1
  candidateSpec: RemotionTimelineSpecV1
  scope: V2TimelineRevisionScope
  sceneId?: string
  sceneIds?: string[]
  overlayIds?: string[]
  transitionIds?: string[]
}): V2TimelineRevisionCommitDecision {
  const comparable = (spec: RemotionTimelineSpecV1) => input.scope === 'subtitle'
    ? {
        caption_tracks: spec.caption_tracks ?? [],
        overlays: spec.overlays.filter((overlay) =>
          overlay.type === 'caption'
          && (!input.sceneId || overlay.scene_id === input.sceneId)
          && (!input.overlayIds?.length || input.overlayIds.includes(overlay.id))),
      }
    : input.scope === 'scene'
      ? (() => {
          const sceneId = input.sceneId
          if (!sceneId) throw new Error('Scene revision scope requires a sceneId.')
          const captionTrackIds = new Set(
            spec.overlays
              .filter((overlay) => overlay.type === 'caption' && overlay.scene_id === sceneId && overlay.track_id)
              .map((overlay) => overlay.track_id as string),
          )
          return {
            scene: spec.scenes.find((scene) => scene.id === sceneId),
            caption_tracks: (spec.caption_tracks ?? []).filter((track) => captionTrackIds.has(track.id)),
            caption_overlays: spec.overlays.filter((overlay) =>
              overlay.type === 'caption' && overlay.scene_id === sceneId),
            transitions: spec.transitions.filter((transition) =>
              transition.from_scene_id === sceneId || transition.to_scene_id === sceneId),
          }
        })()
      : input.scope === 'structure'
        ? {
            scenes: spec.scenes,
            transitions: spec.transitions,
            overlays: spec.overlays,
            material_jobs: spec.material_jobs,
          }
      : input.scope === 'visual_strategy'
        ? (() => {
            const sceneId = input.sceneId
            if (!sceneId) throw new Error('Visual strategy revision scope requires a sceneId.')
            const scene = spec.scenes.find((candidate) => candidate.id === sceneId)
            return {
              scene: scene
                ? VISUAL_STRATEGY_SCENE_FIELDS.reduce(
                    (acc, field) => ({
                      ...acc,
                      [field]: (scene as unknown as Record<string, unknown>)[field],
                    }),
                    {} as Record<string, unknown>,
                  )
                : null,
              material_jobs: spec.material_jobs.filter((job) => job.scene_id === sceneId),
            }
          })()
        : input.scope === 'transition'
          ? (() => {
              const transitionIds = new Set(input.transitionIds)
              if (transitionIds.size === 0) throw new Error('Transition revision scope requires transitionIds.')
              return spec.transitions.filter((transition) => transitionIds.has(transition.id))
            })()
        : input.scope === 'global'
          ? {
              creative_brief: spec.creative_brief,
              canvas: spec.canvas,
              assets: spec.assets,
              scenes: spec.scenes,
              transitions: spec.transitions,
              overlays: spec.overlays,
              material_jobs: spec.material_jobs,
              audio: spec.audio ?? [],
              render_policy: spec.render_policy,
            }
          : (() => {
              throw new Error(`Unsupported revision scope: ${String(input.scope)}`)
            })()
  if (JSON.stringify(comparable(input.baseSpec)) !== JSON.stringify(comparable(input.candidateSpec))) {
    return { ok: true, scope: input.scope }
  }
  return {
    ok: false,
    scope: input.scope,
    violation: {
      kind: 'missing_requested_change',
      message: input.scope === 'subtitle'
        ? '候选方案没有产生任何可保存的字幕轨或字幕片段变化。'
        : '候选方案没有产生任何可保存的 V2 时间线变化。',
    },
  }
}

const ReviewSchema = {
  type: 'object',
  required: ['pass', 'violations'],
  properties: {
    pass: { type: 'boolean' },
    violations: {
      type: 'array',
      items: {
        type: 'object',
        required: ['kind', 'message'],
        properties: {
          kind: {
            type: 'string',
            enum: [
              'missing_requested_change',
              'unrelated_change',
              'visible_text_violation',
              'caption_presentation_violation',
              'sample_boundary_violation',
              'other',
            ],
          },
          message: { type: 'string' },
        },
      },
    },
    repairInstruction: { type: 'string' },
  },
} as const

export function buildV2TimelineOutcomeReviewPrompt(input: {
  prompt: string
  baseDigest: V2TimelineFactDigest
  candidateDigest: V2TimelineFactDigest
  availableComponents?: V2TimelineAvailableComponents
  specDiff?: V2TimelineSpecDiffSummary
  confirmedContext?: string
  hasBase: boolean
  revisionScope?: V2TimelineRevisionScope
  revisionSceneId?: string
  revisionSceneIds?: string[]
  revisionOverlayIds?: string[]
  revisionTransitionIds?: string[]
  revisionGlobalMode?: 'brief_update' | 'full_replan'
  revisionDurationMode?: 'preserve_range' | 'resize_timeline'
  revisionGroup?: V2TimelineRevisionGroup
  imageContextAvailable?: boolean
  sampleContextAvailable?: boolean
}) {
  const componentsById = new Map((input.availableComponents ?? []).map((item) => [item.id, item]))
  const effectiveComponents = [
    ...input.candidateDigest.scenes.flatMap((scene) => scene.custom_render_component_id
      ? [{
          target: 'scene',
          id: scene.id,
          component_id: scene.custom_render_component_id,
          display_name: componentsById.get(scene.custom_render_component_id)?.displayName,
          effect_summary: componentsById.get(scene.custom_render_component_id)?.effectSummary,
        }]
      : []),
    ...input.candidateDigest.transitions.flatMap((transition) => {
      const componentId = transition.custom_render_component_id
      if (!componentId) return []
      return [{
        target: 'transition',
      id: transition.id,
        component_id: componentId,
        display_name: componentsById.get(componentId)?.displayName ?? transition.custom_render_display_name,
        effect_summary: componentsById.get(componentId)?.effectSummary,
      fallback_preset: transition.type,
      }]
    }),
  ]
  const candidateUsesImageRealization = input.candidateDigest.scenes.some((scene) =>
    scene.type === 'image_motion'
    || scene.material_jobs.some((job) => Boolean(job.input_asset_id)))
  const groupUsesImageRelevantScope = input.revisionGroup?.items.some((item) =>
    item.scope === 'scene' || item.scope === 'visual_strategy')
  const mediaScopeApplies = !input.hasBase
    || ['scene', 'visual_strategy', 'structure'].includes(input.revisionScope ?? '')
    || Boolean(groupUsesImageRelevantScope)
  const imageRiskApplies = (!input.hasBase && candidateUsesImageRealization)
    || (['scene', 'visual_strategy', 'structure'].includes(input.revisionScope ?? '') && candidateUsesImageRealization)
    || Boolean(groupUsesImageRelevantScope && candidateUsesImageRealization)
    || Boolean(input.imageContextAvailable && mediaScopeApplies)
  const sceneVisualRiskApplies = imageRiskApplies
    || !input.hasBase
    || ['scene', 'visual_strategy', 'structure'].includes(input.revisionScope ?? '')
    || input.revisionGroup?.items.some((item) => item.scope === 'scene' || item.scope === 'visual_strategy')
  const sampleRiskApplies = (!input.hasBase && Boolean(input.candidateDigest.creative_brief?.sample_methods?.length))
    || Boolean(input.sampleContextAvailable && (
      mediaScopeApplies
      || input.revisionScope === 'transition'
      || input.revisionScope === 'global'
      || input.revisionGroup?.items.some((item) => item.scope === 'transition')
    ))
  const globalRiskApplies = input.revisionScope === 'global'
  const visibleTextRiskApplies = !input.hasBase
    || input.revisionScope === 'subtitle'
    || input.revisionGroup?.items.some((item) => item.scope === 'subtitle')
  const authoritativeDiff = input.specDiff
    ? [
        ...input.specDiff.scenes,
        ...input.specDiff.visibleText,
        ...input.specDiff.transitions,
        ...input.specDiff.audio,
        ...input.specDiff.other,
      ]
    : input.hasBase
      ? buildV2TimelineRevisionDiff(input.baseDigest, input.candidateDigest)
      : undefined
  const authorizedBoundary = input.revisionGroup
    ? { kind: 'revision_group', items: input.revisionGroup.items.map((item) => ({
        scope: item.scope,
        instruction: item.instruction,
        scene_id: item.sceneId,
        overlay_ids: item.overlayIds ?? [],
        transition_ids: item.transitionIds ?? [],
      })) }
    : input.revisionScope
      ? {
          kind: 'revision',
          scope: input.revisionScope,
          global_mode: input.revisionGlobalMode,
          duration_mode: input.revisionDurationMode,
          scene_id: input.revisionSceneId,
          scene_ids: input.revisionSceneIds,
          scene_ids_semantics: input.revisionScope === 'structure'
            ? 'base_contiguous_range_to_replace'
            : undefined,
          overlay_ids: input.revisionOverlayIds,
          transition_ids: input.revisionTransitionIds,
        }
      : { kind: input.hasBase ? 'revision_without_explicit_scope' : 'initial_plan' }
  return [
    '你是视频创作平台中负责时间线结果审查的模型。请依据用户要求、服务端授权边界和程序计算的实际差异，判断候选是否真正落实要求且没有越界；不要规划或修改方案。',
    '',
    '最高优先级',
    input.hasBase
      ? '- 程序计算的实际差异是“实际改变了什么”的唯一事实源；不得根据候选措辞猜测不存在的变化，也不得要求它未包含的改动。'
      : '- 首次创建时，候选方案事实是要求落实的依据；没有基础方案，不使用差异判断。',
    '- 只返回 JSON，字段仅为 pass、violations 和可选 repairInstruction；不输出思维过程。',
    '',
    '判断顺序',
    input.hasBase
      ? '1. 用户要求的每项变化是否在候选和实际差异中落实；'
      : '1. 用户要求的每项内容是否在候选方案事实中落实；',
    '2. 实际变化是否全部位于授权边界内；',
    '3. 未授权的既有内容是否保持不变；',
    '4. 当前任务适用的高风险规则是否满足。',
    '',
    '通用判断',
    '- 使用语义判断，不使用固定关键词命中。必要的范围内改写不算越界，范围外字段变化才算 unrelated_change。',
    ...(input.revisionScope === 'structure'
      ? ['- structure 的 scene_ids 表示基础方案中允许整体替换的连续范围，不是候选方案的镜头 ID 白名单。候选可以在该范围内新增、删除或重新编号镜头；只有改变范围外对象或越过保留锚点才算越界。']
      : []),
    '- 可见文字必须是观众文案；技术说明、文件名、内部 ID、布局约束和规划指令不得成为字幕，除非用户明确要求逐字展示。',
    ...(visibleTextRiskApplies
      ? ['- 用户要求重写或创作字幕时，旧字幕允许被替换；不要因为基础方案存在旧文案就要求逐字保留。布局、行数和位置要求应检查结构化字段，不把约束文字本身当字幕。']
      : []),
    ...(imageRiskApplies
      ? [
          '',
          '本轮适用的风险规则',
          '- 图片条件生成：新动作、新事件、新视角或扩展环境必须由 ai_video + generate_video 实现，并用 input_asset_id 绑定用户原图；只有文字相似而没有原图绑定不算落实。',
          '- 图片理解：creative_brief 只保留与用途有关的可见事实，不得编造；不机械要求图片没有呈现或任务不需要的类别。',
          '- 真实画面实现：remotion_card 只能实现有意设计的文字或动态图形镜头，不能因为文字描述了目标画面就算作真实或电影化镜头已经完成。',
        ]
      : []),
    ...(sceneVisualRiskApplies
      ? ['- scene/visual_strategy 一致性：人物、地点、动作、事件或道具等叙事变化必须同时进入 creative_intent 与生成 Prompt；visual_strategy 只改变呈现方式，不能把新叙事事实偷偷写进生成 Prompt，也不能只改编辑器字段而让生成请求保持不变。']
      : []),
    ...(sampleRiskApplies
      ? ['- 样例迁移：可以迁移节奏、镜头语言和叙事方法，不得复制样例主体、字幕或章节结构。']
      : []),
    ...(globalRiskApplies
      ? ['- global.brief_update：creative_brief.direction 必须实际体现全片新方向，scene 时间、字幕、素材和转场保持不变；只有 full_replan 可以替换整案。']
      : []),
    ...(effectiveComponents.length
      ? ['- 自定义组件：custom_render 指定的注册组件是实际呈现方式；preset 只是回退，不要求两者名称相同。']
      : []),
    '',
    '当前用户要求',
    input.prompt,
    '',
    '服务端授权边界',
    JSON.stringify(authorizedBoundary),
    ...(input.revisionScope
      ? [`scope=${input.revisionScope}${input.revisionGlobalMode ? `, global_mode=${input.revisionGlobalMode}` : ''}${input.revisionDurationMode ? `, duration_mode=${input.revisionDurationMode}` : ''}${input.revisionSceneId ? `, scene_id=${input.revisionSceneId}` : ''}${input.revisionSceneIds?.length ? `, scene_ids=${input.revisionSceneIds.join(',')}` : ''}${input.revisionOverlayIds?.length ? `, overlay_ids=${input.revisionOverlayIds.join(',')}` : ''}${input.revisionTransitionIds?.length ? `, transition_ids=${input.revisionTransitionIds.join(',')}` : ''}`]
      : []),
    '',
    '相关有效要求',
    input.confirmedContext ?? '[]',
    '',
    '基础方案事实',
    input.hasBase ? JSON.stringify(input.baseDigest) : '无基础方案；这是首次创建。',
    '',
    '候选方案事实',
    JSON.stringify(input.candidateDigest),
    '',
    ...(input.hasBase ? ['', '程序计算的实际差异', JSON.stringify(authoritativeDiff)] : []),
    ...(effectiveComponents.length
      ? ['', '有效自定义组件事实', JSON.stringify(effectiveComponents)]
      : []),
    '',
    input.hasBase
      ? '输出前核对：每项明确要求是否有实际差异支撑；每项实际差异是否位于授权边界；violations 与 repairInstruction 是否只描述真实未落实或越界问题。只输出最终 JSON。'
      : '输出前核对：每项明确要求是否由候选方案事实落实；violations 与 repairInstruction 是否只描述真实未落实问题。只输出最终 JSON。',
  ].join('\n')
}

function parseVerdict(text: string): V2TimelineRevisionReviewVerdict {
  const trimmed = text.trim()
  const start = trimmed.indexOf('{')
  const end = trimmed.lastIndexOf('}')
  const parsed = JSON.parse(start >= 0 && end > start ? trimmed.slice(start, end + 1) : trimmed) as Record<string, unknown>
  if (typeof parsed.pass !== 'boolean' || !Array.isArray(parsed.violations)) {
    throw new Error('Revision reviewer JSON does not match the required verdict schema.')
  }
  const violations = parsed.violations.map((value) => {
    if (!value || typeof value !== 'object') throw new Error('Revision reviewer violation must be an object.')
    const item = value as Record<string, unknown>
    if (
      typeof item.message !== 'string' ||
      ![
        'missing_requested_change',
        'unrelated_change',
        'visible_text_violation',
        'caption_presentation_violation',
        'sample_boundary_violation',
        'other',
      ].includes(String(item.kind))
    ) throw new Error('Revision reviewer violation is invalid.')
    return { kind: item.kind as V2TimelineRevisionViolationKind, message: item.message }
  })
  return {
    pass: parsed.pass,
    violations,
    repairInstruction: typeof parsed.repairInstruction === 'string' && parsed.repairInstruction.trim()
      ? parsed.repairInstruction.trim()
      : undefined,
  }
}

async function requestReview(prompt: string, schema: boolean) {
  const body = {
    model: env.directorAgentModel,
    ...(schema
      ? { text: { format: { type: 'json_schema', name: 'v2_timeline_revision_review', schema: ReviewSchema } } }
      : {}),
    input: [{ role: 'user', content: [{ type: 'input_text', text: prompt }] }],
  }
  const response = await fetch(env.directorAgentResponsesUrl, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.directorAgentApiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(env.directorAgentTimeoutMs),
  })
  const rawText = await response.text()
  if (!response.ok) throw new Error(`Revision reviewer returned ${response.status}: ${rawText.slice(0, 500)}`)
  try {
    return JSON.parse(rawText) as unknown
  } catch {
    return rawText
  }
}

export async function reviewV2TimelineRevisionOutcome(input: {
  prompt: string
  baseSpec?: RemotionTimelineSpecV1
  candidateSpec: RemotionTimelineSpecV1
  availableComponents?: V2TimelineAvailableComponents
  confirmedContext?: string
  revisionScope?: V2TimelineRevisionScope
  revisionSceneId?: string
  revisionSceneIds?: string[]
  revisionOverlayIds?: string[]
  revisionTransitionIds?: string[]
  revisionGlobalMode?: 'brief_update' | 'full_replan'
  revisionDurationMode?: 'preserve_range' | 'resize_timeline'
  revisionGroup?: V2TimelineRevisionGroup
  imageContextAvailable?: boolean
  sampleContextAvailable?: boolean
  assess?: (input: {
    prompt: string
    baseDigest: V2TimelineFactDigest
    candidateDigest: V2TimelineFactDigest
  }) => Promise<V2TimelineRevisionReviewVerdict>
}): Promise<V2TimelineRevisionOutcomeReview> {
  const structureProjection = input.revisionScope === 'structure'
    ? structureRevisionProjectionSceneIds(input)
    : undefined
  const digestProjection = {
    revisionScope: input.revisionScope,
    revisionSceneId: input.revisionSceneId,
    revisionSceneIds: input.revisionSceneIds,
    revisionOverlayIds: input.revisionOverlayIds,
    revisionTransitionIds: input.revisionTransitionIds,
    revisionGlobalMode: input.revisionGlobalMode,
  }
  const rawBaseDigest = input.baseSpec ? buildV2TimelineFactDigest(input.baseSpec) : emptyTimelineFactDigest()
  const rawCandidateDigest = buildV2TimelineFactDigest(input.candidateSpec)
  const baseDigest = input.revisionGroup
    ? projectV2TimelineRevisionGroupDigest(rawBaseDigest, input.revisionGroup)
    : projectV2TimelineRevisionDigest(
        rawBaseDigest,
        { ...digestProjection, revisionProjectionSceneIds: structureProjection?.base },
      )
  const candidateDigest = input.revisionGroup
    ? projectV2TimelineRevisionGroupDigest(rawCandidateDigest, input.revisionGroup)
    : projectV2TimelineRevisionDigest(
        rawCandidateDigest,
        { ...digestProjection, revisionProjectionSceneIds: structureProjection?.candidate },
      )
  const specDiff = input.baseSpec
    ? describeV2TimelineSpecDiff(input.baseSpec, input.candidateSpec)
    : undefined
  if (input.baseSpec && !(specDiff?.hasAudienceFacingChange ?? false)) {
    return {
      pass: false,
      baseDigest,
      candidateDigest,
      violations: [{
        kind: 'missing_requested_change',
        message: '候选方案没有产生可交付画面、字幕、转场或音频变化。',
      }],
      repairInstruction: '根据本轮要求生成实际方案差异；不要只修改内部说明或声称已经完成。',
      audit: { source: input.assess ? 'injected' : 'llm' },
    }
  }
  if (input.assess) {
    const verdict = await input.assess({ prompt: input.prompt, baseDigest, candidateDigest })
    return { ...verdict, baseDigest, candidateDigest, audit: { source: 'injected' } }
  }
  if (!env.directorAgentApiKey) throw new Error('DIRECTOR_AGENT_API_KEY is not configured for revision review.')
  const prompt = buildV2TimelineOutcomeReviewPrompt({
    prompt: input.prompt,
    baseDigest,
    candidateDigest,
    availableComponents: input.availableComponents,
    specDiff: input.baseSpec
      ? describeV2TimelineSpecDiff(input.baseSpec, input.candidateSpec)
      : undefined,
    confirmedContext: input.confirmedContext,
    hasBase: Boolean(input.baseSpec),
    revisionScope: input.revisionScope,
    revisionSceneId: input.revisionSceneId,
    revisionSceneIds: input.revisionSceneIds,
    revisionOverlayIds: input.revisionOverlayIds,
    revisionTransitionIds: input.revisionTransitionIds,
    revisionGlobalMode: input.revisionGlobalMode,
    revisionDurationMode: input.revisionDurationMode,
    revisionGroup: input.revisionGroup,
    imageContextAvailable: input.imageContextAvailable,
    sampleContextAvailable: input.sampleContextAvailable,
  })
  const requested = env.directorAgentStructuredOutputMode === 'auto'
  let raw: unknown
  let structuredOutput = { requested, providerFallback: false, reason: undefined as string | undefined }
  try {
    raw = await requestReview(prompt, requested)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (!requested || !/returned (400|404|422):/.test(message)) throw error
    raw = await requestReview(prompt, false)
    structuredOutput = { requested: true, providerFallback: true, reason: message.slice(0, 500) }
  }
  const outputText = extractTextCandidate(raw)
  let verdict: V2TimelineRevisionReviewVerdict
  let jsonRepair: V2TimelineRevisionOutcomeReview['audit']['jsonRepair']
  try {
    verdict = parseVerdict(outputText)
  } catch (error) {
    const repairPrompt = [
      'Repair only the JSON format below. Preserve the review decision and wording; do not re-evaluate the timeline.',
      `Required schema: ${JSON.stringify(ReviewSchema)}`,
      `JSON error: ${error instanceof Error ? error.message : String(error)}`,
      'Original response:',
      outputText,
    ].join('\n')
    try {
      const repaired = await requestReview(repairPrompt, false)
      verdict = parseVerdict(extractTextCandidate(repaired))
      jsonRepair = { requested: true, success: true }
    } catch (repairError) {
      jsonRepair = { requested: true, success: false, error: repairError instanceof Error ? repairError.message : String(repairError) }
      throw new Error(`Revision reviewer protocol failed: ${jsonRepair.error}`)
    }
  }
  const record = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {}
  return {
    ...verdict,
    baseDigest,
    candidateDigest,
    audit: {
      source: 'llm',
      modelResponse: {
        id: record.id,
        model: record.model,
        status: record.status,
        usage: record.usage,
        output_text: outputText,
      },
      structuredOutput,
      jsonRepair,
    },
  }
}

/**
 * Proves that the final saved candidate already satisfies a server-owned
 * failed instruction. No base spec is supplied so this check cannot authorize
 * or synthesize another edit; it can only accept or reject the current state.
 */
export function verifyV2TimelinePendingResolution(input: {
  instruction: string
  candidateSpec: RemotionTimelineSpecV1
  availableComponents?: V2TimelineAvailableComponents
  confirmedContext?: string
  imageContextAvailable?: boolean
  sampleContextAvailable?: boolean
  assess?: Parameters<typeof reviewV2TimelineRevisionOutcome>[0]['assess']
}) {
  return reviewV2TimelineRevisionOutcome({
    prompt: input.instruction,
    candidateSpec: input.candidateSpec,
    availableComponents: input.availableComponents,
    confirmedContext: input.confirmedContext,
    imageContextAvailable: input.imageContextAvailable,
    sampleContextAvailable: input.sampleContextAvailable,
    assess: input.assess,
  })
}
