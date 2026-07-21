import { EFFECT_INTENT_SCHEMA_VERSION } from '../types/effect-intent.v1.js';
import { effectIntentsFromRoadmap } from './effect-intent-from-roadmap.js';
/**
 * Roadmap-derived intents take precedence per segment; grounding intents fill gaps.
 */
export function resolveEffectIntents(input) {
    const fromRoadmap = (input.effectRoadmap?.segments.length ?? 0) > 0
        ? effectIntentsFromRoadmap({
            taskId: input.taskId,
            effectRoadmap: input.effectRoadmap,
        })
        : null;
    const groundingIntents = input.groundingEffectIntents ?? [];
    if (fromRoadmap?.intents.length) {
        if (!groundingIntents.length)
            return fromRoadmap;
        const covered = new Set(fromRoadmap.intents.map((intent) => intent.segment_id));
        const supplemental = groundingIntents.filter((intent) => !covered.has(intent.segment_id));
        return {
            schema_version: EFFECT_INTENT_SCHEMA_VERSION,
            task_id: input.taskId,
            intents: [...fromRoadmap.intents, ...supplemental],
        };
    }
    return {
        schema_version: EFFECT_INTENT_SCHEMA_VERSION,
        task_id: input.taskId,
        intents: groundingIntents,
    };
}
//# sourceMappingURL=effect-intent-resolver.js.map