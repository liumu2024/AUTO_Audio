import type { RemotionTimelineSpecV1 } from '../../../shared/types/remotion-timeline-spec.v1.js'

export type V2TimelineRevisionScope = 'subtitle'

/**
 * Applies the Tool-authorized revision scope before semantic review and
 * persistence. The planner can remain creative inside the scope, while fields
 * outside it keep their persisted V2 values.
 */
export function applyV2TimelineRevisionScope(input: {
  baseSpec: RemotionTimelineSpecV1
  candidateSpec: RemotionTimelineSpecV1
  scope: V2TimelineRevisionScope
}): RemotionTimelineSpecV1 {
  if (input.scope === 'subtitle') {
    return {
      ...input.baseSpec,
      caption_tracks: input.candidateSpec.caption_tracks ?? input.baseSpec.caption_tracks,
      overlays: [
        ...input.baseSpec.overlays.filter((overlay) => overlay.type !== 'caption'),
        ...input.candidateSpec.overlays.filter((overlay) => overlay.type === 'caption'),
      ],
    }
  }
  return input.candidateSpec
}
