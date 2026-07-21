import type { EffectRoadmap } from '../types/effect-roadmap.v1.js';
import type { EffectIntentDocument, EffectIntentId } from '../types/effect-intent.v1.js';
export declare function effectIntentsFromRoadmap(input: {
    taskId: string;
    effectRoadmap: EffectRoadmap;
}): EffectIntentDocument;
export declare function intentIdFromMotifFamily(family: string): EffectIntentId;
//# sourceMappingURL=effect-intent-from-roadmap.d.ts.map