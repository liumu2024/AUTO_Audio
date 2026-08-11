import type { RemotionTimelineSpecV1 } from '../../../shared/types/remotion-timeline-spec.v1.js'

type SelectionKind = 'scene' | 'overlay' | 'transition'

function parseSelection(value: string): { kind: SelectionKind; id: string; prefix: string } | undefined {
  for (const kind of ['scene', 'overlay', 'transition'] as const) {
    const prefix = `v2-${kind}-`
    if (value.startsWith(prefix)) return { kind, id: value.slice(prefix.length), prefix }
  }
  return undefined
}

function idsFor(spec: RemotionTimelineSpecV1, kind: SelectionKind): string[] {
  if (kind === 'scene') return spec.scenes.map((item) => item.id)
  if (kind === 'overlay') return spec.overlays.map((item) => item.id)
  return spec.transitions.map((item) => item.id)
}

/** Keeps a server-owned UI selection only when its identity is unambiguous. */
export function normalizeV2TimelineSelection(input: {
  selectedItemId?: string | null
  nextSpec: RemotionTimelineSpecV1
}): string | null {
  if (!input.selectedItemId) return null
  const parsed = parseSelection(input.selectedItemId)
  if (!parsed) return null
  const nextIds = new Set(idsFor(input.nextSpec, parsed.kind))
  if (nextIds.has(parsed.id)) return input.selectedItemId
  return null
}
