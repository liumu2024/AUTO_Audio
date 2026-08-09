import { env } from '../config/env.js'
import { extractTextCandidate } from '../modules/agent-tools/structured-json-tool.js'
import type { RemotionTimelineSpecV1 } from '../../../shared/types/remotion-timeline-spec.v1.js'
import { VISUAL_STRATEGY_SCENE_FIELDS } from './timeline-revision-scope.js'
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
  scenes: Array<{
    id: string
    title?: string
    description?: string
    visual_role?: string
    duration_sec: number
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
  scope: 'global' | 'subtitle' | 'scene' | 'visual_strategy' | 'transition'
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
      scenes.length > 0 || visibleText.length > 0 || transitions.length > 0 || audio.length > 0,
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
    scenes: spec.scenes.map((scene) => ({
      id: scene.id,
      title: nonBlank(scene.creative_intent?.title) ?? nonBlank(scene.title),
      description: nonBlank(scene.creative_intent?.description) ?? nonBlank(scene.body),
      visual_role: scene.visual_role,
      duration_sec: scene.duration_sec,
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
  scope: 'global' | 'subtitle' | 'scene' | 'visual_strategy' | 'transition'
  sceneId?: string
  transitionIds?: string[]
}): V2TimelineRevisionCommitDecision {
  const comparable = (spec: RemotionTimelineSpecV1) => input.scope === 'subtitle'
    ? {
        caption_tracks: spec.caption_tracks ?? [],
        overlays: spec.overlays.filter((overlay) => overlay.type === 'caption'),
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
  revisionScope?: string
  revisionSceneId?: string
  revisionTransitionIds?: string[]
}) {
  const componentsById = new Map((input.availableComponents ?? []).map((item) => [item.id, item]))
  const effectiveTransitions = input.candidateDigest.transitions.map((transition) => {
    const componentId = transition.custom_render_component_id
    if (!componentId) {
      return { id: transition.id, effective_render: { kind: 'preset', preset: transition.type } }
    }
    return {
      id: transition.id,
      effective_render: {
        kind: 'custom_component',
        component_id: componentId,
        display_name: componentsById.get(componentId)?.displayName ?? transition.custom_render_display_name,
        effect_summary: componentsById.get(componentId)?.effectSummary,
      },
      fallback_preset: transition.type,
    }
  })
  return [
    'You are the V2 timeline revision outcome reviewer.',
    'Judge the actual candidate against the user\'s current request and the persisted base timeline.',
    'Use semantic judgment, not a fixed keyword list. First determine the semantic change scope of the current request: it may target scene content, on-screen copy, presentation, audio, transitions, timing, or the whole concept.',
    'A revision must implement the requested change while preserving confirmed content outside that scope. The base timeline is evidence, not a blanket instruction to preserve every field exactly.',
    'When the current request asks to create, rewrite, or freely author on-screen copy, the old on-screen copy is intentionally replaceable. Do not require its exact wording, a prior product-name caption, or its previous phrasing to survive solely because it existed in the base. Preserve the product subject in the timeline unless the user asks to change that subject.',
    'Only call a change unrelated when it alters a field outside the current request scope; do not call a necessary rewording inside the requested scope unrelated.',
    'Visible text must be audience copy. Do not accept technical notes, filenames, internal planning instructions, or display constraints as captions unless the user explicitly asked to show those exact words.',
    'When the request is a presentation constraint (placement, line limit, non-repetition), evaluate the candidate\'s displayed text and geometry rather than treating the constraint itself as copy.',
    'When a sample is used for inspiration, reject copied sample-specific subject matter or copy; reusable rhythm and structure are allowed.',
    'When custom_render_component_id is present, that custom component defines the effective transition. The preset type and direction are fallback presentation settings only; do not require the custom effect name to appear in the preset type.',
    'Return JSON only. Do not reveal reasoning.',
    `User request: ${input.prompt}`,
    `Confirmed V2 conversation facts: ${input.confirmedContext ?? 'None supplied; rely on the persisted base timeline.'}`,
    `Base timeline facts: ${input.hasBase ? JSON.stringify(input.baseDigest) : 'No prior timeline; judge whether the initial plan fulfils the request.'}`,
    `Candidate timeline facts: ${JSON.stringify(input.candidateDigest)}`,
    `Candidate effective transition facts: ${JSON.stringify(effectiveTransitions)}`,
    `Observed diff: ${JSON.stringify(buildV2TimelineRevisionDiff(input.baseDigest, input.candidateDigest))}`,
    ...(input.specDiff
      ? [
          `Computed spec diff (authoritative for field changes): ${[
            ...input.specDiff.scenes,
            ...input.specDiff.visibleText,
            ...input.specDiff.transitions,
            ...input.specDiff.audio,
            ...input.specDiff.other,
          ].join('\n')}`,
          'Field and presentation changes are computed by the program above. Evaluate only whether those changes satisfy the user request semantically; do not demand changes that the computed diff does not contain.',
        ]
      : []),
    ...(input.revisionScope
      ? [`Tool-authorized revision boundary: scope=${input.revisionScope}${input.revisionSceneId ? `, scene_id=${input.revisionSceneId}` : ''}${input.revisionTransitionIds?.length ? `, transition_ids=${input.revisionTransitionIds.join(',')}` : ''}. Any change outside this boundary is an unrelated change.`]
      : []),
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
  revisionScope?: string
  revisionSceneId?: string
  revisionTransitionIds?: string[]
  assess?: (input: {
    prompt: string
    baseDigest: V2TimelineFactDigest
    candidateDigest: V2TimelineFactDigest
  }) => Promise<V2TimelineRevisionReviewVerdict>
}): Promise<V2TimelineRevisionOutcomeReview> {
  const baseDigest = input.baseSpec ? buildV2TimelineFactDigest(input.baseSpec) : emptyTimelineFactDigest()
  const candidateDigest = buildV2TimelineFactDigest(input.candidateSpec)
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
    revisionTransitionIds: input.revisionTransitionIds,
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
