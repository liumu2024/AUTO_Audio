import { env } from '../config/env.js'
import { extractTextCandidate } from '../modules/agent-tools/structured-json-tool.js'
import type { RemotionTimelineSpecV1 } from '../../../shared/types/remotion-timeline-spec.v1.js'

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
  transitions: Array<{ from_scene_id: string; to_scene_id: string; type: string; duration_sec: number }>
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

/** A semantic revision failure must retain the persisted V2 revision, not fall back to a new plan. */
export class V2TimelineRevisionOutcomeError extends Error {
  constructor(readonly review: V2TimelineRevisionOutcomeReview) {
    super(`V2 revision outcome review failed: ${JSON.stringify(review.violations)}`)
    this.name = 'V2TimelineRevisionOutcomeError'
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
      from_scene_id: transition.from_scene_id,
      to_scene_id: transition.to_scene_id,
      type: transition.type,
      duration_sec: transition.duration_sec,
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

function revisionDiff(base: V2TimelineFactDigest, candidate: V2TimelineFactDigest) {
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
  confirmedContext?: string
  hasBase: boolean
}) {
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
    'Return JSON only. Do not reveal reasoning.',
    `User request: ${input.prompt}`,
    `Confirmed V2 conversation facts: ${input.confirmedContext ?? 'None supplied; rely on the persisted base timeline.'}`,
    `Base timeline facts: ${input.hasBase ? JSON.stringify(input.baseDigest) : 'No prior timeline; judge whether the initial plan fulfils the request.'}`,
    `Candidate timeline facts: ${JSON.stringify(input.candidateDigest)}`,
    `Observed diff: ${JSON.stringify(revisionDiff(input.baseDigest, input.candidateDigest))}`,
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
  confirmedContext?: string
  assess?: (input: {
    prompt: string
    baseDigest: V2TimelineFactDigest
    candidateDigest: V2TimelineFactDigest
  }) => Promise<V2TimelineRevisionReviewVerdict>
}): Promise<V2TimelineRevisionOutcomeReview> {
  const baseDigest = input.baseSpec ? buildV2TimelineFactDigest(input.baseSpec) : emptyTimelineFactDigest()
  const candidateDigest = buildV2TimelineFactDigest(input.candidateSpec)
  if (input.assess) {
    const verdict = await input.assess({ prompt: input.prompt, baseDigest, candidateDigest })
    return { ...verdict, baseDigest, candidateDigest, audit: { source: 'injected' } }
  }
  if (!env.directorAgentApiKey) throw new Error('DIRECTOR_AGENT_API_KEY is not configured for revision review.')
  const prompt = buildV2TimelineOutcomeReviewPrompt({
    prompt: input.prompt,
    baseDigest,
    candidateDigest,
    confirmedContext: input.confirmedContext,
    hasBase: Boolean(input.baseSpec),
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
