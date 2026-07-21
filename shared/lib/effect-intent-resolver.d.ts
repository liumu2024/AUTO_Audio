import type { EffectIntent, EffectIntentDocument } from '../types/effect-intent.v1.js';
import type { EffectRoadmap } from '../types/effect-roadmap.v1.js';
export interface ResolveEffectIntentsInput {
    taskId: string;
    effectRoadmap?: EffectRoadmap | null;
    /** DirectorGrounding.effect_intents — used when roadmap is empty or partial. */
    groundingEffectIntents?: EffectIntent[];
}
/**
 * Roadmap-derived intents take precedence per segment; grounding intents fill gaps.
 */
export declare function resolveEffectIntents(input: ResolveEffectIntentsInput): EffectIntentDocument;
//# sourceMappingURL=effect-intent-resolver.d.ts.map