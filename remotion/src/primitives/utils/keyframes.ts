import { interpolate } from 'remotion'

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function normalizeNumberKeyframes(
  keyframes: { time: number; value: number }[] | unknown,
): Array<{ time: number; value: number }> {
  if (!Array.isArray(keyframes)) return []
  return keyframes
    .map((item) => {
      if (!item || typeof item !== 'object') return null
      const record = item as Record<string, unknown>
      const time = finiteNumber(record.time)
      const value = finiteNumber(record.value)
      return time === undefined || value === undefined ? null : { time, value }
    })
    .filter((item): item is { time: number; value: number } => Boolean(item))
    .sort((a, b) => a.time - b.time)
}

function normalizePositionKeyframes(
  keyframes: { time: number; x_pct: number; y_pct: number }[] | unknown,
): Array<{ time: number; x_pct: number; y_pct: number }> {
  if (!Array.isArray(keyframes)) return []
  return keyframes
    .map((item) => {
      if (!item || typeof item !== 'object') return null
      const record = item as Record<string, unknown>
      const time = finiteNumber(record.time)
      const xPct = finiteNumber(record.x_pct)
      const yPct = finiteNumber(record.y_pct)
      return time === undefined || xPct === undefined || yPct === undefined
        ? null
        : { time, x_pct: xPct, y_pct: yPct }
    })
    .filter((item): item is { time: number; x_pct: number; y_pct: number } =>
      Boolean(item),
    )
    .sort((a, b) => a.time - b.time)
}

export function interpolateNumberKeyframes(
  keyframes: { time: number; value: number }[] | unknown,
  timeSec: number,
): number {
  const normalized = normalizeNumberKeyframes(keyframes)
  if (normalized.length === 0) return 0
  if (timeSec <= normalized[0].time) return normalized[0].value
  const last = normalized[normalized.length - 1]
  if (timeSec >= last.time) return last.value
  for (let i = 0; i < normalized.length - 1; i += 1) {
    const a = normalized[i]
    const b = normalized[i + 1]
    if (timeSec >= a.time && timeSec <= b.time) {
      const progress = (timeSec - a.time) / Math.max(0.001, b.time - a.time)
      return interpolate(progress, [0, 1], [a.value, b.value])
    }
  }
  return last.value
}

export function interpolatePositionKeyframes(
  keyframes: { time: number; x_pct: number; y_pct: number }[] | unknown,
  timeSec: number,
): { xPct: number; yPct: number } {
  const normalized = normalizePositionKeyframes(keyframes)
  if (normalized.length === 0) return { xPct: 50, yPct: 50 }
  if (timeSec <= normalized[0].time) {
    return { xPct: normalized[0].x_pct, yPct: normalized[0].y_pct }
  }
  const last = normalized[normalized.length - 1]
  if (timeSec >= last.time) {
    return { xPct: last.x_pct, yPct: last.y_pct }
  }
  for (let i = 0; i < normalized.length - 1; i += 1) {
    const a = normalized[i]
    const b = normalized[i + 1]
    if (timeSec >= a.time && timeSec <= b.time) {
      const progress = (timeSec - a.time) / Math.max(0.001, b.time - a.time)
      return {
        xPct: interpolate(progress, [0, 1], [a.x_pct, b.x_pct]),
        yPct: interpolate(progress, [0, 1], [a.y_pct, b.y_pct]),
      }
    }
  }
  return { xPct: last.x_pct, yPct: last.y_pct }
}
