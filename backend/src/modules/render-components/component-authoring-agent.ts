import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { z } from 'zod'

import {
  CUSTOM_SCENE_PROPS_CONTRACT,
  CUSTOM_TRANSITION_PROPS_CONTRACT,
} from '../../../../shared/types/remotion-custom-component.js'
import type { RemotionTimelineSpecV1 } from '../../../../shared/types/remotion-timeline-spec.v1.js'
import { env } from '../../config/env.js'
import {
  deleteArkImageFile,
  uploadArkImageFile,
  waitForArkImageFileReady,
} from '../../pipeline-v2/ark-file-input.js'
import { findV2FfmpegBinary } from '../../pipeline-v2/ffmpeg-binary.js'
import { renderV2RemotionTimeline } from '../../pipeline-v2/remotion-timeline-renderer.js'
import {
  findPromotedRenderComponentBySource,
  promoteRenderComponent,
  RENDER_COMPONENT_VISUAL_POLICY_VERSION,
  readRenderComponent,
  registerRenderComponent,
  removeDraftRenderComponent,
  renderComponentEvidenceForCanvas,
  renderComponentEvidenceMatchesCanvas,
  renderComponentId,
  setRenderComponentDisplayName,
  timelineRenderComponentReferences,
} from './component-registry.js'

const GeneratedComponentSchema = z.object({
  source: z.string().min(1).max(40_000),
  effectSummary: z.string().trim().min(1).max(500),
}).strict()

const VisualVerdictSchema = z.object({
  passed: z.boolean(),
  criteria: z.array(z.object({
    criterion: z.string().min(1).max(500),
    passed: z.boolean(),
    evidence: z.string().min(1).max(1_000),
  }).strict()).min(1).max(16),
  summary: z.string().min(1).max(1_000),
})

export const V2_TRANSITION_VISUAL_INTEGRITY_CRITERIA = [
  'At progress 0, the frame is one complete, undistorted source A with no tiling or duplicate regions.',
  'At progress 1, the frame is one complete, undistorted destination B with no tiling or duplicate regions.',
  'Intermediate frames preserve the spatial correspondence of A and B without repeated, stretched, or offset slices.',
  'Visible slicing is confined between the transition endpoints; neither endpoint remains partitioned.',
] as const

function authoringInputWithIntegrityCriteria(
  input: RenderComponentAuthoringInput,
): RenderComponentAuthoringInput {
  if (input.purpose !== 'transition') return input
  return {
    ...input,
    acceptanceCriteria: [...new Set([
      ...input.acceptanceCriteria,
      ...V2_TRANSITION_VISUAL_INTEGRITY_CRITERIA,
    ])],
  }
}

function visualVerdictSchema(criteria: string[]) {
  const criterion = z.enum(criteria as [string, ...string[]])
  return z.object({
    passed: z.boolean(),
    criteria: z.array(z.object({
      criterion,
      passed: z.boolean(),
      evidence: z.string().min(1).max(1_000),
    }).strict()).length(criteria.length)
      .refine((items) => new Set(items.map((item) => item.criterion)).size === criteria.length, 'each criterion must appear exactly once'),
    summary: z.string().min(1).max(1_000),
  })
}

export interface RenderComponentAuthoringInput {
  purpose: 'scene' | 'transition'
  displayName: string
  effectBrief: string
  acceptanceCriteria: string[]
  canvas: { width: number; height: number; fps: number; durationSec: number }
  skillContent: string
  sourceWorkspaceSessionId?: string
}

type GeneratedComponent = z.infer<typeof GeneratedComponentSchema>
type VisualVerdict = z.infer<typeof VisualVerdictSchema>

interface PreviewEvidence {
  videoPath: string
  framePaths: string[]
  previewDir?: string
}

export interface RenderComponentAuthoringDependencies {
  generateCode?: (input: {
    prompt: string
    purpose: RenderComponentAuthoringInput['purpose']
    repairFeedback?: string
  }) => Promise<GeneratedComponent>
  renderPreview?: (input: {
    componentId: string
    purpose: RenderComponentAuthoringInput['purpose']
    canvas: RenderComponentAuthoringInput['canvas']
  }) => Promise<PreviewEvidence>
  reviewPreview?: (input: {
    prompt: string
    purpose: RenderComponentAuthoringInput['purpose']
    effectBrief: string
    acceptanceCriteria: string[]
    framePaths: string[]
  }) => Promise<VisualVerdict>
  cleanupPreview?: (preview: PreviewEvidence) => Promise<void>
}

const SCENE_EXAMPLE = `// Scene example
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from 'remotion'
export default function SceneEffect({params, scene, assets}) {
  const frame = useCurrentFrame()
  const {durationInFrames} = useVideoConfig()
  const opacity = interpolate(frame, [0, durationInFrames - 1], [0, 1], {extrapolateLeft:'clamp', extrapolateRight:'clamp'})
  return <AbsoluteFill style={{opacity, background: scene.background ?? '#111827'}}>{String(params?.label ?? '')}</AbsoluteFill>
}`

const TRANSITION_EXAMPLE = `// Transition example
import { AbsoluteFill } from 'remotion'
export default function TransitionEffect({children, progress, direction, params}) {
  const visible = direction === 'entering' ? progress : 1 - progress
  return <AbsoluteFill style={{overflow:'hidden'}}><div style={{width:'100%',height:'100%',opacity:visible}}>{children}</div></AbsoluteFill>
}`

export function buildRenderComponentCodingPrompt(input: RenderComponentAuthoringInput & {
  repairFeedback?: string
  previousSource?: string
}): string {
  return [
    'You are the coding Agent for one sandboxed React/Remotion component. Return JSON only: {"source": string, "effectSummary": string}.',
    'Installed runtime: React 19.2.6; Remotion 4.0.469.',
    `Canvas: ${input.canvas.width}x${input.canvas.height}, ${input.canvas.fps}fps, current task duration ${input.canvas.durationSec}s.`,
    `Purpose: ${input.purpose}.`,
    `Registered display name: ${input.displayName}`,
    `Effect brief: ${input.effectBrief}`,
    `Acceptance criteria:\n${input.acceptanceCriteria.map((item, index) => `${index + 1}. ${item}`).join('\n')}`,
    'Allowed imports only: react, remotion, @remotion/transitions, @remotion/media.',
    'Forbidden: Math.random, fetch/network, network URL literals, resource-loading native JSX tags, Node APIs, browser globals, eval, require, dynamic import.',
    'Use deterministic React/CSS driven by Remotion frames. CSS animation/transition, timers, requestAnimationFrame, Date, and performance are forbidden. Export exactly one default function component.',
    'Use useVideoConfig() for the actual width, height, and durationInFrames; do not hard-code Canvas numbers because preview and reuse may render at another size.',
    'Scale layout dimensions and gaps from the actual width/height so every required element remains distinct and in-frame at preview and reuse sizes.',
    'Treat quantified criteria literally: if N elements must always be present, give all N a non-zero visible size on every frame; stagger animation state, not element existence.',
    'Express all frame offsets and animation durations as fractions of durationInFrames; never hard-code frame counts from the task duration.',
    'A transition must render children, cover the full frame, implement entering and exiting, and have correct progress=0 and progress=1 endpoints.',
    'A scene animation should use useCurrentFrame/useVideoConfig/interpolate.',
    CUSTOM_TRANSITION_PROPS_CONTRACT,
    CUSTOM_SCENE_PROPS_CONTRACT,
    SCENE_EXAMPLE,
    TRANSITION_EXAMPLE,
    'Full project Skill follows:',
    input.skillContent,
    ...(input.repairFeedback ? [
      `Previous attempt failed. Repair this exact error without changing the requested effect:\n${input.repairFeedback}`,
      'Every failed acceptance criterion must map to visible code behavior. Change the prior source where the evidence says it failed; do not return an unchanged implementation.',
      `Previous source to repair:\n\`\`\`tsx\n${input.previousSource ?? ''}\n\`\`\``,
    ] : []),
  ].join('\n\n')
}

function extractResponseText(payload: unknown): string {
  if (typeof payload === 'string') return payload
  if (!payload || typeof payload !== 'object') return ''
  const record = payload as Record<string, unknown>
  if (typeof record.output_text === 'string') return record.output_text
  if (!Array.isArray(record.output)) return ''
  return record.output.flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    const content = (item as Record<string, unknown>).content
    if (!Array.isArray(content)) return []
    return content.flatMap((part) => {
      if (!part || typeof part !== 'object') return []
      const value = part as Record<string, unknown>
      return typeof value.text === 'string' ? [value.text] : []
    })
  }).join('\n')
}

function jsonCandidate(text: string): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  try {
    return JSON.parse(trimmed)
  } catch {
    const start = trimmed.indexOf('{')
    const end = trimmed.lastIndexOf('}')
    if (start >= 0 && end > start) return JSON.parse(trimmed.slice(start, end + 1))
    throw new Error('Model response did not contain a JSON object.')
  }
}

async function requestStructuredModel<T>(input: {
  prompt: string
  schemaName: string
  schema: z.ZodType<T>
  fileIds?: string[]
}): Promise<T> {
  if (!env.directorAgentApiKey) throw new Error('DIRECTOR_AGENT_API_KEY is not configured.')
  const body = (useSchema: boolean) => ({
    model: env.directorAgentModel,
    ...(useSchema ? { text: {
      format: {
        type: 'json_schema',
        name: input.schemaName,
        schema: z.toJSONSchema(input.schema, { target: 'draft-7' }),
      },
    } } : {}),
    input: [{
      role: 'user',
      content: [
        { type: 'input_text', text: input.prompt },
        ...(input.fileIds ?? []).map((fileId) => ({ type: 'input_image', file_id: fileId })),
      ],
    }],
  })
  const request = (useSchema: boolean) => fetch(env.directorAgentResponsesUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.directorAgentApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body(useSchema)),
    signal: AbortSignal.timeout(env.directorAgentTimeoutMs),
  })
  let response = await request(true)
  let text = await response.text()
  if (!response.ok && [400, 404, 422].includes(response.status)) {
    response = await request(false)
    text = await response.text()
  }
  if (!response.ok) throw new Error(`Responses API returned ${response.status}: ${text.slice(0, 500)}`)
  let payload: unknown = text
  try { payload = JSON.parse(text) } catch { /* provider may return plain text */ }
  return input.schema.parse(jsonCandidate(extractResponseText(payload)))
}

async function defaultGenerateCode(input: {
  prompt: string
}): Promise<GeneratedComponent> {
  return requestStructuredModel({
    prompt: input.prompt,
    schemaName: 'remotion_component_source',
    schema: GeneratedComponentSchema,
  })
}

function previewCanvas(canvas: RenderComponentAuthoringInput['canvas']) {
  const scale = Math.min(1, 360 / Math.max(canvas.width, canvas.height))
  const even = (value: number) => Math.max(2, Math.round(value * scale / 2) * 2)
  return { width: even(canvas.width), height: even(canvas.height), fps: 12, duration_sec: 1 }
}

export function renderComponentPreviewSampleFrames(
  purpose: RenderComponentAuthoringInput['purpose'],
): number[] {
  // TimelineComposition extends the source sequence by the transition length,
  // placing this five-frame transition at frames 6..10 of the preview.
  return purpose === 'transition' ? [6, 7, 8, 9, 10] : [0, 3, 6, 9, 11]
}

function previewSpec(input: {
  componentId: string
  purpose: RenderComponentAuthoringInput['purpose']
  canvas: RenderComponentAuthoringInput['canvas']
}): RemotionTimelineSpecV1 {
  const canvas = previewCanvas(input.canvas)
  const transition = input.purpose === 'transition'
  return {
    schema_version: 'remotion_timeline_spec.v1',
    task_id: `component_preview_${input.componentId}`,
    canvas,
    assets: [],
    scenes: transition
      ? [
          {
            id: 'preview_a', type: 'remotion_card', start_sec: 0, duration_sec: 0.5,
            title: 'A · LEFT TOP', body: '1 / source / triangle', accent_color: '#22d3ee',
          },
          {
            id: 'preview_b', type: 'remotion_card', start_sec: 0.5, duration_sec: 0.5,
            title: 'B · RIGHT BOTTOM', body: '9 / destination / circle', accent_color: '#f97316',
          },
        ]
      : [{
          id: 'preview_scene', type: 'remotion_card', start_sec: 0, duration_sec: 1,
          title: 'TEST', background: '#0f172a', custom_render: { component_id: input.componentId, params: {} },
        }],
    transitions: transition ? [{
      id: 'preview_transition', from_scene_id: 'preview_a', to_scene_id: 'preview_b',
      type: 'fade', duration_sec: 5 / 12, custom_render: { component_id: input.componentId, params: {} },
    }] : [],
    overlays: [],
    material_jobs: [],
    audio: [],
    render_policy: { renderer: 'remotion_timeline' },
  }
}

function run(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
    const errors: Buffer[] = []
    child.stderr.on('data', (chunk: Buffer) => errors.push(chunk))
    child.on('error', reject)
    child.on('close', (code) => code === 0
      ? resolve()
      : reject(new Error(`${command} exited with ${code}: ${Buffer.concat(errors).toString('utf8').slice(-2_000)}`)))
  })
}

async function defaultRenderPreview(input: {
  componentId: string
  purpose: RenderComponentAuthoringInput['purpose']
  canvas: RenderComponentAuthoringInput['canvas']
}): Promise<PreviewEvidence> {
  const previewDir = await mkdtemp(path.join(os.tmpdir(), 'v2-component-preview-'))
  try {
    const rendered = await renderV2RemotionTimeline({
      spec: previewSpec(input),
      outputDir: previewDir,
      outputName: 'preview.mp4',
      authorizedDraftComponentIds: [input.componentId],
      authorizedPreviewComponentIds: [input.componentId],
      recordComponentOutcomes: false,
    })
    const ffmpeg = findV2FfmpegBinary(path.resolve(process.cwd(), '..'))
    const framePaths: string[] = []
    const sampleFrames = renderComponentPreviewSampleFrames(input.purpose)
    for (const [index, frame] of sampleFrames.entries()) {
      const framePath = path.join(previewDir, `frame-${index}.png`)
      await run(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-i', rendered.outputPath, '-vf', `select=eq(n\\,${frame})`, '-frames:v', '1', framePath])
      framePaths.push(framePath)
    }
    return { videoPath: rendered.outputPath, framePaths, previewDir }
  } catch (error) {
    await rm(previewDir, { recursive: true, force: true })
    throw error
  }
}

function visualReviewPrompt(input: {
  purpose: RenderComponentAuthoringInput['purpose']
  effectBrief: string
  acceptanceCriteria: string[]
}): string {
  return [
    input.purpose === 'transition'
      ? 'Review five chronological frames captured inside the transition at progress 0, 0.25, 0.5, 0.75, and 1. Remotion renders the entering and exiting presentations together.'
      : 'Review five chronological frames captured across the scene at timeline progress 0, 0.25, 0.5, 0.75, and 1.',
    `Effect brief: ${input.effectBrief}`,
    `Acceptance criteria:\n${input.acceptanceCriteria.map((item, index) => `${index + 1}. ${item}`).join('\n')}`,
    'The A and B preview cards are deliberately asymmetric, with different colors and an off-center glow/line. Use those spatial cues to detect duplicated, stretched, or offset regions.',
    'For presence or count criteria, a small but non-zero visible element counts as present; do not confuse low initial growth with absence.',
    'For reveal or mask endpoint criteria, a full destination frame is evidence of complete coverage and the boundary need not remain visible at the endpoint; judge boundary shape from intermediate frames.',
    'Judge each criterion only from visible frame evidence. passed may be true only when every criterion passes. Return JSON only.',
  ].join('\n\n')
}

class VisualReviewProtocolError extends Error {}

async function requireVisualAcceptance(input: {
  authoring: RenderComponentAuthoringInput
  preview: PreviewEvidence
  reviewPreview: NonNullable<RenderComponentAuthoringDependencies['reviewPreview']>
}): Promise<VisualVerdict> {
  let verdict: VisualVerdict
  try {
    verdict = VisualVerdictSchema.parse(await input.reviewPreview({
      prompt: visualReviewPrompt(input.authoring),
      purpose: input.authoring.purpose,
      effectBrief: input.authoring.effectBrief,
      acceptanceCriteria: input.authoring.acceptanceCriteria,
      framePaths: input.preview.framePaths,
    }))
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    throw new VisualReviewProtocolError(`Visual review protocol failed: ${reason}`)
  }
  const allCriteriaPass = input.authoring.acceptanceCriteria.every((criterion) =>
    verdict.criteria.some((item) => item.criterion === criterion && item.passed))
  if (!verdict.passed || !allCriteriaPass) {
    throw new Error(`Visual acceptance failed: ${verdict.summary}; criteria=${JSON.stringify(verdict.criteria)}`)
  }
  return verdict
}

async function defaultReviewPreview(input: {
  prompt: string
  framePaths: string[]
  acceptanceCriteria: string[]
}): Promise<VisualVerdict> {
  const fileIds: string[] = []
  try {
    for (const framePath of input.framePaths) {
      const uploaded = await uploadArkImageFile({ localPath: framePath })
      fileIds.push(uploaded.fileId)
      await waitForArkImageFileReady(uploaded.fileId)
    }
    return await requestStructuredModel({
      prompt: input.prompt,
      schemaName: 'remotion_component_visual_verdict',
      schema: visualVerdictSchema(input.acceptanceCriteria),
      fileIds,
    })
  } finally {
    await Promise.all(fileIds.map((fileId) => deleteArkImageFile(fileId)))
  }
}

async function defaultCleanupPreview(preview: PreviewEvidence): Promise<void> {
  if (preview.previewDir) await rm(preview.previewDir, { recursive: true, force: true })
}

export async function ensureRenderComponentVisualEvidence(
  input: {
    componentId: string
    canvas: RenderComponentAuthoringInput['canvas']
  },
  dependencies: Pick<
    RenderComponentAuthoringDependencies,
    'renderPreview' | 'reviewPreview' | 'cleanupPreview'
  > = {},
): Promise<void> {
  const component = await readRenderComponent(input.componentId)
  if (!component || component.manifest.status !== 'promoted') {
    throw new Error(`Promoted render component not found: ${input.componentId}`)
  }
  if (renderComponentEvidenceMatchesCanvas(component.manifest.previewEvidenceByAspect, input.canvas)) return
  const authoring = authoringInputWithIntegrityCriteria({
    purpose: component.manifest.purpose,
    displayName: component.manifest.displayName,
    effectBrief: component.manifest.effectBrief,
    acceptanceCriteria: component.manifest.acceptanceCriteria,
    canvas: input.canvas,
    skillContent: '',
    sourceWorkspaceSessionId: component.manifest.sourceWorkspaceSessionId,
  })
  if (!authoring.effectBrief.trim() || authoring.acceptanceCriteria.length === 0) {
    throw new Error(`Component ${input.componentId} has no reusable visual acceptance contract.`)
  }
  const renderPreview = dependencies.renderPreview ?? defaultRenderPreview
  const reviewPreview = dependencies.reviewPreview ?? defaultReviewPreview
  const cleanupPreview = dependencies.cleanupPreview ?? defaultCleanupPreview
  let preview: PreviewEvidence | undefined
  try {
    preview = await renderPreview({
      componentId: component.id,
      purpose: component.manifest.purpose,
      canvas: input.canvas,
    })
    const verdict = await requireVisualAcceptance({ authoring, preview, reviewPreview })
    const promoted = await promoteRenderComponent({
      id: component.id,
      previewEvidence: {
        verdict: 'passed',
        policyVersion: RENDER_COMPONENT_VISUAL_POLICY_VERSION,
        canvas: { width: input.canvas.width, height: input.canvas.height },
        frameCount: preview.framePaths.length,
        summary: verdict.summary,
        criteria: verdict.criteria,
        reviewedAt: new Date().toISOString(),
      },
    })
    if (!promoted) throw new Error(`Component ${component.id} visual evidence update failed.`)
  } finally {
    if (preview) await cleanupPreview(preview)
  }
}

export async function ensureTimelineRenderComponentVisualEvidence(
  spec: RemotionTimelineSpecV1,
  dependencies: Pick<
    RenderComponentAuthoringDependencies,
    'renderPreview' | 'reviewPreview' | 'cleanupPreview'
  > = {},
): Promise<void> {
  const componentIds = [...new Set(timelineRenderComponentReferences(spec).map((reference) => reference.id))]
  for (const componentId of componentIds) {
    const component = await readRenderComponent(componentId)
    if (component?.manifest.status !== 'promoted') continue
    await ensureRenderComponentVisualEvidence({
      componentId,
      canvas: {
        width: spec.canvas.width,
        height: spec.canvas.height,
        fps: spec.canvas.fps,
        durationSec: spec.canvas.duration_sec,
      },
    }, dependencies)
  }
}

function failureStage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  if (/audit|compil|esbuild|import|default export/i.test(message)) return 'audit_compile'
  if (/visual|criterion|acceptance/i.test(message)) return 'visual_review'
  if (/render|ffmpeg|chrome|browser/i.test(message)) return 'preview_render'
  return 'generation'
}

export async function authorRenderComponent(
  requestedInput: RenderComponentAuthoringInput,
  dependencies: RenderComponentAuthoringDependencies = {},
): Promise<
  | { ok: true; componentId: string; purpose: 'scene' | 'transition'; displayName: string; effectSummary: string; status: 'promoted'; repaired: boolean; codingCalls: number; reused: boolean; visualVerdict: VisualVerdict }
  | { ok: false; stage: string; reason: string; repaired: boolean; codingCalls: number; failedSource?: string }
> {
  const input = authoringInputWithIntegrityCriteria(requestedInput)
  const generateCode = dependencies.generateCode ?? defaultGenerateCode
  const renderPreview = dependencies.renderPreview ?? defaultRenderPreview
  const reviewPreview = dependencies.reviewPreview ?? defaultReviewPreview
  const cleanupPreview = dependencies.cleanupPreview ?? defaultCleanupPreview
  let repairFeedback: string | undefined
  let previousSource: string | undefined

  for (let attempt = 0; attempt < 2; attempt += 1) {
    let componentId: string | undefined
    let preview: PreviewEvidence | undefined
    let generated: GeneratedComponent | undefined
    try {
      const prompt = buildRenderComponentCodingPrompt({ ...input, repairFeedback, previousSource })
      generated = GeneratedComponentSchema.parse(await generateCode({
        prompt,
        purpose: input.purpose,
        repairFeedback,
      }))
      const existing = await findPromotedRenderComponentBySource({
        source: generated.source,
        purpose: input.purpose,
      })
      if (existing) {
        componentId = existing.id
        const useRequestedDisplayName = async () => {
          const manifest = existing.manifest.displayName === input.displayName.trim()
            ? existing.manifest
            : await setRenderComponentDisplayName(existing.id, input.displayName)
          if (!manifest) throw new Error('Component display name update failed.')
          return manifest
        }
        const sameCriteria = existing.manifest.effectBrief === input.effectBrief
          && existing.manifest.acceptanceCriteria.length === input.acceptanceCriteria.length
          && existing.manifest.acceptanceCriteria.every((item, index) => item === input.acceptanceCriteria[index])
        const reusableEvidence = renderComponentEvidenceForCanvas(
          existing.manifest.previewEvidenceByAspect,
          input.canvas,
        )
        if (
          sameCriteria
          && reusableEvidence
        ) {
          const manifest = await useRequestedDisplayName()
          return {
            ok: true,
            componentId,
            purpose: existing.manifest.purpose,
            displayName: manifest.displayName,
            effectSummary: manifest.effectSummary,
            status: 'promoted',
            repaired: attempt > 0,
            codingCalls: attempt + 1,
            reused: true,
            visualVerdict: VisualVerdictSchema.parse({
              passed: true,
              criteria: reusableEvidence.criteria,
              summary: reusableEvidence.summary,
            }),
          }
        }
        preview = await renderPreview({ componentId, purpose: input.purpose, canvas: input.canvas })
        const verdict = await requireVisualAcceptance({ authoring: input, preview, reviewPreview })
        const accepted = await promoteRenderComponent({
          id: componentId,
          previewEvidence: {
            verdict: 'passed',
            policyVersion: RENDER_COMPONENT_VISUAL_POLICY_VERSION,
            canvas: { width: input.canvas.width, height: input.canvas.height },
            frameCount: preview.framePaths.length,
            summary: verdict.summary,
            criteria: verdict.criteria,
            reviewedAt: new Date().toISOString(),
          },
        })
        if (!accepted) throw new Error('Component preview evidence update failed.')
        const manifest = await useRequestedDisplayName()
        return {
          ok: true,
          componentId,
          purpose: existing.manifest.purpose,
          displayName: manifest.displayName,
          effectSummary: manifest.effectSummary,
          status: 'promoted',
          repaired: attempt > 0,
          codingCalls: attempt + 1,
          reused: true,
          visualVerdict: verdict,
        }
      }
      const requestedId = renderComponentId('cmp')
      const registered = await registerRenderComponent({
        id: requestedId,
        source: generated.source,
        displayName: input.displayName,
        effectSummary: generated.effectSummary,
        effectBrief: input.effectBrief,
        acceptanceCriteria: input.acceptanceCriteria,
        purpose: input.purpose,
        sourceWorkspaceSessionId: input.sourceWorkspaceSessionId,
      })
      componentId = registered.id
      preview = await renderPreview({ componentId, purpose: input.purpose, canvas: input.canvas })
      const verdict = await requireVisualAcceptance({ authoring: input, preview, reviewPreview })
      const promoted = await promoteRenderComponent({
        id: componentId,
        previewEvidence: {
          verdict: 'passed',
          policyVersion: RENDER_COMPONENT_VISUAL_POLICY_VERSION,
          canvas: { width: input.canvas.width, height: input.canvas.height },
          frameCount: preview.framePaths.length,
          summary: verdict.summary,
          criteria: verdict.criteria,
          reviewedAt: new Date().toISOString(),
        },
      })
      if (!promoted || promoted.status !== 'promoted') throw new Error('Component promotion failed after visual acceptance.')
      return {
        ok: true,
        componentId,
        purpose: promoted.purpose,
        displayName: promoted.displayName,
        effectSummary: promoted.effectSummary,
        status: 'promoted',
        repaired: attempt > 0,
        codingCalls: attempt + 1,
        reused: false,
        visualVerdict: verdict,
      }
    } catch (error) {
      if (componentId) await removeDraftRenderComponent(componentId)
      const reason = error instanceof Error ? error.message : String(error)
      if (error instanceof VisualReviewProtocolError) return {
        ok: false,
        stage: 'visual_review',
        reason,
        repaired: attempt > 0,
        codingCalls: attempt + 1,
        failedSource: generated?.source ?? previousSource,
      }
      if (attempt === 1) return {
        ok: false,
        stage: failureStage(error),
        reason,
        repaired: true,
        codingCalls: 2,
        failedSource: generated?.source ?? previousSource,
      }
      repairFeedback = reason
      previousSource = generated?.source ?? previousSource
    } finally {
      if (preview) await cleanupPreview(preview).catch(() => undefined)
    }
  }
  return { ok: false, stage: 'generation', reason: 'Component authoring exhausted its retry budget.', repaired: true, codingCalls: 2 }
}
