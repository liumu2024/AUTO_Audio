import { AnalyzerResponseError } from '../video-understanding/errors.js'
import {
  EFFECT_ROADMAP_SCHEMA_VERSION,
  type EffectRoadmap,
} from '../../../../shared/types/effect-roadmap.v1.js'
import { assertValidEffectRoadmap, validateEffectRoadmap } from '../../../../shared/lib/effect-roadmap.validator.js'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function parseJsonFromText(text: string): unknown {
  const trimmed = text.trim()
  const withoutFence = trimmed
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim()
  const start = withoutFence.indexOf('{')
  const end = withoutFence.lastIndexOf('}')
  if (start < 0 || end < start) {
    throw new AnalyzerResponseError('Could not locate JSON object in model output.')
  }
  const jsonSlice = withoutFence.slice(start, end + 1)
  try {
    return JSON.parse(jsonSlice) as unknown
  } catch (error) {
    const detail =
      error instanceof SyntaxError
        ? `JSON syntax error: ${error.message}`
        : error instanceof Error
          ? error.message
          : String(error)
    throw new AnalyzerResponseError(detail, error)
  }
}

export function extractResponsesText(raw: unknown): string {
  if (typeof raw === 'string') return raw
  if (Array.isArray(raw)) {
    return raw.map((item) => extractResponsesText(item)).filter(Boolean).join('\n')
  }
  if (!isRecord(raw)) return ''

  for (const field of [raw.output_text, raw.text, raw.result]) {
    if (typeof field === 'string') return field
  }
  if (Array.isArray(raw.output)) return extractResponsesText(raw.output)
  if (Array.isArray(raw.content)) return extractResponsesText(raw.content)
  return ''
}

export function parseEffectRoadmapCandidate(candidate: unknown, taskId: string): EffectRoadmap {
  if (!isRecord(candidate)) {
    throw new AnalyzerResponseError('EffectRoadmap candidate must be an object.')
  }

  if (candidate.schema_version !== EFFECT_ROADMAP_SCHEMA_VERSION) {
    throw new AnalyzerResponseError(
      `EffectRoadmap schema_version must be ${EFFECT_ROADMAP_SCHEMA_VERSION}, got ${String(candidate.schema_version)}`,
    )
  }

  const validation = validateEffectRoadmap(candidate)
  if (!validation.ok) {
    throw new AnalyzerResponseError(
      `EffectRoadmap validation failed: ${validation.errors
        .slice(0, 8)
        .map((error) => `${error.path}: ${error.message}`)
        .join('; ')}`,
      validation.errors,
    )
  }

  assertValidEffectRoadmap(candidate)

  if (candidate.task_id !== taskId) {
    throw new AnalyzerResponseError(
      `EffectRoadmap task_id mismatch: expected ${taskId}, got ${String(candidate.task_id)}`,
    )
  }

  return candidate as unknown as EffectRoadmap
}

export function extractEffectRoadmapFromResponsesBody(raw: unknown, taskId: string): EffectRoadmap {
  if (isRecord(raw) && raw.schema_version === EFFECT_ROADMAP_SCHEMA_VERSION) {
    return parseEffectRoadmapCandidate(raw, taskId)
  }

  const text = extractResponsesText(raw)
  if (!text.trim()) {
    throw new AnalyzerResponseError('Responses API returned no text output for EffectRoadmap.')
  }

  return parseEffectRoadmapCandidate(parseJsonFromText(text), taskId)
}
