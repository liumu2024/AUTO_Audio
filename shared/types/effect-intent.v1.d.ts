export declare const EFFECT_INTENT_SCHEMA_VERSION: "effect_intent.v1";
export declare const EFFECT_INTENT_IDS: readonly ["grayscale_color_unlock", "orb_driven_color_wave", "layout_collage", "cinematic_texture_grade", "beat_sync_montage"];
export type EffectIntentId = (typeof EFFECT_INTENT_IDS)[number] | string;
export type EffectIntentMotionSubject = 'none' | 'orb' | 'ring' | 'mask' | string;
export type EffectIntentUnlockMode = 'radial_reveal' | 'directional_wave' | 'burst' | string;
export interface EffectIntentSync {
    driver?: 'audio_beat' | 'manual' | 'motion_subject';
    peak_policy?: 'unlock_on_strong_beat' | 'continuous' | string;
}
/** LLM / roadmap semantic intent — no plugin_id or preset. */
export interface EffectIntent {
    intent_id: EffectIntentId;
    segment_id: string;
    evidence_refs: string[];
    style?: string;
    motion_subject?: EffectIntentMotionSubject;
    motion_pattern?: string;
    unlock_mode?: EffectIntentUnlockMode;
    reveal_mode?: string;
    geometry?: Record<string, string | number | boolean | string[]>;
    sync?: EffectIntentSync;
    description?: string;
}
export interface EffectIntentDocument {
    schema_version: typeof EFFECT_INTENT_SCHEMA_VERSION;
    task_id: string;
    intents: EffectIntent[];
}
//# sourceMappingURL=effect-intent.v1.d.ts.map