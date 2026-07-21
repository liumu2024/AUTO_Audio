export type JsonTargetPredicate = (value: unknown) => boolean

export interface StructuredJsonExtractionReport {
  parsed: boolean
  source: 'direct' | 'nested' | 'text' | 'none'
  text_chars: number
  complete_json_candidates: number
  has_opening_brace: boolean
  has_closing_brace: boolean
  likely_truncated_json: boolean
  failure_reason?: string
}

export interface StructuredJsonExtractionResult {
  candidate: unknown | null
  repairInput: unknown
  report: StructuredJsonExtractionReport
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function tryParseJson(text: string): unknown | undefined {
  try {
    return JSON.parse(text) as unknown
  } catch {
    return undefined
  }
}

export function extractJsonObjectStrings(text: string): string[] {
  const candidates: string[] = []
  let depth = 0
  let start = -1
  let inString = false
  let escaped = false

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    if (inString) {
      if (escaped) {
        escaped = false
      } else if (char === '\\') {
        escaped = true
      } else if (char === '"') {
        inString = false
      }
      continue
    }

    if (char === '"') {
      inString = true
      continue
    }
    if (char === '{') {
      if (depth === 0) start = index
      depth += 1
      continue
    }
    if (char !== '}') continue

    depth -= 1
    if (depth === 0 && start >= 0) {
      candidates.push(text.slice(start, index + 1))
      start = -1
    }
  }

  return candidates.sort((left, right) => right.length - left.length)
}

export function parseJsonFromText(text: string): unknown {
  const trimmed = text.trim()
  const withoutFence = trimmed
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim()

  const direct = tryParseJson(withoutFence)
  if (direct !== undefined) return direct

  for (const jsonText of extractJsonObjectStrings(withoutFence)) {
    const parsed = tryParseJson(jsonText)
    if (parsed !== undefined) return parsed
  }

  return text
}

export function extractTextCandidate(candidate: unknown): string {
  if (typeof candidate === 'string') return candidate

  if (Array.isArray(candidate)) {
    const messageTexts = candidate
      .map((item) => {
        if (!isRecord(item)) return ''
        if (item.type !== 'message' && item.role !== 'assistant') return ''
        return extractTextCandidate(item)
      })
      .filter(Boolean)
    if (messageTexts.length > 0) return messageTexts.join('\n')
    return candidate.map((item) => extractTextCandidate(item)).filter(Boolean).join('\n')
  }

  if (!isRecord(candidate)) return ''

  const textFields = [candidate.text, candidate.output_text, candidate.content, candidate.arguments]
  for (const field of textFields) {
    if (typeof field === 'string') return field
  }

  const nestedFields = [
    candidate.content,
    candidate.output,
    candidate.data,
    candidate.result,
    candidate.response,
    candidate.message,
    candidate.choices,
  ]
  for (const field of nestedFields) {
    if (typeof field === 'string') return field
    if (Array.isArray(field) || isRecord(field)) {
      const text = extractTextCandidate(field)
      if (text) return text
    }
  }

  return ''
}

function findTargetCandidate(
  raw: unknown,
  isTarget: JsonTargetPredicate,
  depth = 0,
): { candidate: unknown; source: 'direct' | 'nested' | 'text' } | null {
  if (depth > 10) return null

  const parsed = typeof raw === 'string' ? parseJsonFromText(raw) : raw
  if (isTarget(parsed)) {
    return { candidate: parsed, source: typeof raw === 'string' ? 'text' : 'direct' }
  }

  if (Array.isArray(parsed)) {
    for (const item of parsed) {
      const found = findTargetCandidate(item, isTarget, depth + 1)
      if (found) return { ...found, source: found.source === 'direct' ? 'nested' : found.source }
    }
    return null
  }

  if (!isRecord(parsed)) return null

  const preferredKeys = [
    'output_text',
    'text',
    'content',
    'json',
    'parsed',
    'arguments',
    'data',
    'result',
    'response',
    'message',
    'choices',
    'output',
  ]
  for (const key of preferredKeys) {
    if (!(key in parsed)) continue
    const found = findTargetCandidate(parsed[key], isTarget, depth + 1)
    if (found) return { ...found, source: found.source === 'direct' ? 'nested' : found.source }
  }

  for (const value of Object.values(parsed)) {
    const found = findTargetCandidate(value, isTarget, depth + 1)
    if (found) return { ...found, source: found.source === 'direct' ? 'nested' : found.source }
  }

  return null
}

export function extractStructuredJsonCandidate(
  raw: unknown,
  isTarget: JsonTargetPredicate,
): StructuredJsonExtractionResult {
  const found = findTargetCandidate(raw, isTarget)
  const text = extractTextCandidate(raw).trim()
  const completeJsonCandidates = text ? extractJsonObjectStrings(text).length : 0
  const reportBase = {
    text_chars: text.length,
    complete_json_candidates: completeJsonCandidates,
    has_opening_brace: text.includes('{'),
    has_closing_brace: text.includes('}'),
    likely_truncated_json:
      text.includes('{') && (!text.includes('}') || completeJsonCandidates === 0),
  }

  if (found) {
    return {
      candidate: found.candidate,
      repairInput: found.candidate,
      report: {
        ...reportBase,
        parsed: true,
        source: found.source,
      },
    }
  }

  return {
    candidate: null,
    repairInput: text || raw,
    report: {
      ...reportBase,
      parsed: false,
      source: 'none',
      failure_reason: text
        ? 'No target JSON object was found in the response text.'
        : 'No response text was found.',
    },
  }
}
