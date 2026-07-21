export type JsonRecord = Record<string, unknown>

export function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function normalizeId(value: unknown, fallback: string): string {
  if (typeof value === 'string' && value.trim()) return value.trim()
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return fallback
}

export function normalizeLooseKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/slot|素材|画面|镜头|片段|段落|资源|asset|material/gi, '')
    .replace(/[\s_-]+/g, '')
}

export function stringFromRecord(
  record: JsonRecord,
  keys: string[],
): string | undefined {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
    if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  }
  return undefined
}

export function numberFromRecord(
  record: JsonRecord,
  keys: string[],
): number | undefined {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'number' && Number.isFinite(value)) return value
    if (typeof value === 'string' && value.trim()) {
      const numeric = Number(value)
      if (Number.isFinite(numeric)) return numeric
    }
  }
  return undefined
}

/** 模型常把数组写成字符串：单值、逗号分隔、或 JSON 数组字符串 */
export function coerceStringArray(value: unknown): string[] {
  if (value == null) return []
  if (Array.isArray(value)) {
    return value
      .map((item) => (typeof item === 'string' ? item.trim() : String(item)))
      .filter(Boolean)
  }
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return []
    if (trimmed.startsWith('[')) {
      try {
        return coerceStringArray(JSON.parse(trimmed) as unknown)
      } catch {
        /* fall through */
      }
    }
    if (/[,，;；|]/.test(trimmed)) {
      return trimmed
        .split(/[,，;；|]/)
        .map((part) => part.trim())
        .filter(Boolean)
    }
    return [trimmed]
  }
  return []
}

export function clampNumber(
  value: number | undefined,
  min: number,
  max: number,
  fallback: number,
): number {
  if (value === undefined || !Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, value))
}

export function parseJsonIfString(value: unknown): unknown {
  if (typeof value !== 'string') return value
  const trimmed = value.trim()
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return value
  try {
    return JSON.parse(trimmed) as unknown
  } catch {
    return value
  }
}
