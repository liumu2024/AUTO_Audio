import type { RemotionTimelineSpecV1 } from '../../../shared/types/remotion-timeline-spec.v1.js'

export function assertV2TimelinePlanningComplete(spec: RemotionTimelineSpecV1): void {
  const gaps = spec.creative_brief?.planning_gaps ?? []
  if (gaps.length > 0) {
    throw new Error(`V2 timeline has unresolved planning gaps: ${gaps.map((gap) => gap.message).join('; ')}`)
  }
}
