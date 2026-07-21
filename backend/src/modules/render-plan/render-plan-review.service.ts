import { z } from 'zod'

import { env } from '../../config/env.js'
import type { RenderPlanValidationReport } from '../../../../shared/lib/render-plan-validator.js'
import type { RenderPlanV1 } from '../../../../shared/types/render-plan.v1.js'

const ReviewFindingSchema = z.object({
  severity: z.enum(['info', 'warning', 'error']),
  path: z.string().min(1),
  message: z.string().min(1),
})

const RepairHintSchema = z.object({
  path: z.string().min(1),
  action: z.enum(['keep', 'remove', 'replace', 'ask_user']),
  rationale: z.string().min(1),
})

const RenderPlanLlmReviewSchema = z.object({
  verdict: z.enum(['accept', 'needs_repair', 'needs_user_input']),
  confidence: z.number().min(0).max(1),
  findings: z.array(ReviewFindingSchema).default([]),
  repair_hints: z.array(RepairHintSchema).default([]),
})

export type RenderPlanLlmReview = z.infer<typeof RenderPlanLlmReviewSchema>

export type RenderPlanReviewResult =
  | {
      source: 'disabled'
      review: null
    }
  | {
      source: 'llm'
      review: RenderPlanLlmReview
    }
  | {
      source: 'llm_error'
      review: null
      error: string
    }

function summarizePlan(plan: RenderPlanV1) {
  return {
    task_id: plan.task_id,
    duration_sec: plan.duration_sec,
    strategy: plan.strategy,
    canvas: plan.canvas,
    asset_count: plan.assets.length,
    assets: plan.assets.slice(0, 16).map((asset) => ({
      id: asset.id,
      type: asset.type,
      source: asset.source,
      has_url: Boolean(asset.url),
      duration_sec: asset.duration_sec,
    })),
    scenes: plan.scenes.slice(0, 16).map((scene) => ({
      id: scene.id,
      role: scene.role,
      start_sec: scene.start_sec,
      end_sec: scene.end_sec,
      visual: {
        mode: scene.visual.mode,
        asset_id: scene.visual.asset_id,
        has_trim: Boolean(scene.visual.trim),
      },
      effects: scene.effects?.preset,
      effect_layers: (scene.effect_layers ?? []).map((layer) => ({
        id: layer.id,
        plugin_id: layer.plugin_id,
        preset: layer.preset,
        source: layer.source,
        resolution: layer.resolution,
      })),
      overlay_count: scene.overlays.length,
      audio_count: scene.audio.length,
    })),
  }
}

function buildPrompt(input: {
  renderPlan: RenderPlanV1
  validation: RenderPlanValidationReport
}): string {
  return `You are reviewing a Remotion RenderPlan for a local code-rendered video pipeline.
Return strict JSON only.

Hard boundaries:
- Do not invent assets, URLs, Remotion presets, or plugin ids.
- Do not suggest AI video generation as a fix.
- Prefer "accept" when hard validation already passes and issues are only stylistic.
- Use "needs_repair" only for concrete structural risks that deterministic code could fix.
- Use "needs_user_input" only when required material or intent is genuinely missing.

JSON schema:
{
  "verdict": "accept|needs_repair|needs_user_input",
  "confidence": 0.0,
  "findings": [{"severity":"info|warning|error","path":"string","message":"string"}],
  "repair_hints": [{"path":"string","action":"keep|remove|replace|ask_user","rationale":"string"}]
}

Validation report:
${JSON.stringify(input.validation, null, 2)}

RenderPlan summary:
${JSON.stringify(summarizePlan(input.renderPlan), null, 2)}
`
}

function extractText(payload: unknown): string {
  if (!payload || typeof payload !== 'object') return ''
  const record = payload as Record<string, unknown>
  if (typeof record.output_text === 'string') return record.output_text

  const output = record.output
  if (!Array.isArray(output)) return ''
  const parts: string[] = []
  for (const item of output) {
    if (!item || typeof item !== 'object') continue
    const content = (item as Record<string, unknown>).content
    if (!Array.isArray(content)) continue
    for (const block of content) {
      if (!block || typeof block !== 'object') continue
      const blockRecord = block as Record<string, unknown>
      if (typeof blockRecord.text === 'string') parts.push(blockRecord.text)
      if (typeof blockRecord.output_text === 'string') parts.push(blockRecord.output_text)
    }
  }
  return parts.join('\n')
}

function extractJson(text: string): unknown {
  const trimmed = text.trim()
  if (!trimmed) throw new Error('LLM returned empty review text.')
  try {
    return JSON.parse(trimmed)
  } catch {
    const start = trimmed.indexOf('{')
    const end = trimmed.lastIndexOf('}')
    if (start < 0 || end <= start) throw new Error('LLM review did not return JSON.')
    return JSON.parse(trimmed.slice(start, end + 1))
  }
}

async function callReviewModel(prompt: string): Promise<unknown> {
  if (!env.renderPlanLlmReviewApiKey) {
    throw new Error('RENDER_PLAN_LLM_REVIEW_API_KEY is not configured.')
  }

  const response = await fetch(env.renderPlanLlmReviewResponsesUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.renderPlanLlmReviewApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: env.renderPlanLlmReviewModel,
      input: [
        {
          role: 'user',
          content: [{ type: 'input_text', text: prompt }],
        },
      ],
    }),
    signal: AbortSignal.timeout(env.renderPlanLlmReviewTimeoutMs),
  })

  const text = await response.text()
  if (!response.ok) {
    throw new Error(`RenderPlan review model returned ${response.status}: ${text.slice(0, 500)}`)
  }
  return JSON.parse(text)
}

export async function reviewRenderPlanWithOptionalLlm(input: {
  renderPlan: RenderPlanV1
  validation: RenderPlanValidationReport
}): Promise<RenderPlanReviewResult> {
  if (!env.enableRenderPlanLlmReview) {
    return { source: 'disabled', review: null }
  }

  try {
    const raw = await callReviewModel(buildPrompt(input))
    const parsed = RenderPlanLlmReviewSchema.parse(extractJson(extractText(raw)))
    return { source: 'llm', review: parsed }
  } catch (error) {
    return {
      source: 'llm_error',
      review: null,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}
