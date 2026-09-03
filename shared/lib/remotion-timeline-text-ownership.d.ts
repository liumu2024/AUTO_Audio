import type { RemotionTimelineSpecV1 } from '../types/remotion-timeline-spec.v1.js';
/**
 * Normalizes two invariants at the V2 protocol seam:
 * - visual-scene planning fields stay separate from on-screen text;
 * - a model-supplied text overlay with omitted layout numbers receives stable
 *   geometry from its owning scene instead of discarding the whole plan;
 * - legacy 0-1 caption geometry is converted to the protocol's 0-100 percentage points.
 */
export declare function normalizeV2TimelineTextOwnership(spec: RemotionTimelineSpecV1): RemotionTimelineSpecV1;
//# sourceMappingURL=remotion-timeline-text-ownership.d.ts.map