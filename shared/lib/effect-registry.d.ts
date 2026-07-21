import type { AudioReactiveCutDriverEffects, CinematicGradePackEffects, CinematicLightSweepEffects, ColorPortalSpotlightEffects, EditorialSplitCollageEffects, KineticColorRippleEffects, MaskSliceTransitionEffects, PrimitiveBeatFlashOverlayEffects, PrimitiveBeatColorUnlockEffects, PrimitiveBeatPulseEffects, PrimitiveBloomOverlayEffects, PrimitiveChromaticAberrationOverlayEffects, PrimitiveCollageLayoutEffects, PrimitiveColorHintOverlayEffects, PrimitiveColorTransformEffects, PrimitiveDirectionalWaveRevealEffects, PrimitiveFadeOverlayEffects, PrimitiveGrainOverlayEffects, PrimitiveLetterboxOverlayEffects, PrimitiveLightSweepOverlayEffects, PrimitiveMaskRevealEffects, PrimitiveOrbMotionEffects, PrimitiveOrbRingOverlayEffects, PrimitiveRingOverlayEffects, PrimitiveRippleDisplacementEffects, PrimitiveRippleRingOverlayEffects, PrimitiveSliceRevealEffects, PrimitiveTextureGradeEffects, PrimitiveTransitionAccentOverlayEffects, PrimitiveVignetteOverlayEffects, RenderAssetType, RippleDisplacementEffects, SceneEffects } from '../types/render-plan.v1.js';
export type EffectPresetId = SceneEffects['preset'];
export interface EffectFieldDefinition {
    path: string;
    label: string;
    kind: 'number' | 'text' | 'color' | 'toggle' | 'select' | 'keyframes';
    min?: number;
    max?: number;
    step?: number;
    options?: Array<{
        value: string;
        label: string;
    }>;
    description?: string;
}
export interface EffectPresetDefinition<T extends SceneEffects = SceneEffects> {
    id: T['preset'];
    label: string;
    description: string;
    supportedAssetTypes: RenderAssetType[];
    defaultEffect: T;
    fields: EffectFieldDefinition[];
    sampleUseCases: string[];
}
export declare const DEFAULT_COLOR_PORTAL_EFFECT: ColorPortalSpotlightEffects;
export declare const DEFAULT_PRIMITIVE_COLOR_TRANSFORM_EFFECT: PrimitiveColorTransformEffects;
export declare const DEFAULT_PRIMITIVE_MASK_REVEAL_EFFECT: PrimitiveMaskRevealEffects;
export declare const DEFAULT_PRIMITIVE_RING_OVERLAY_EFFECT: PrimitiveRingOverlayEffects;
export declare const DEFAULT_CINEMATIC_SWEEP_EFFECT: CinematicLightSweepEffects;
export declare const DEFAULT_RIPPLE_EFFECT: RippleDisplacementEffects;
export declare const DEFAULT_KINETIC_COLOR_RIPPLE_EFFECT: KineticColorRippleEffects;
export declare const DEFAULT_PRIMITIVE_ORB_MOTION_EFFECT: PrimitiveOrbMotionEffects;
export declare const DEFAULT_PRIMITIVE_ORB_RING_OVERLAY_EFFECT: PrimitiveOrbRingOverlayEffects;
export declare const DEFAULT_PRIMITIVE_DIRECTIONAL_WAVE_REVEAL_EFFECT: PrimitiveDirectionalWaveRevealEffects;
export declare const DEFAULT_EDITORIAL_SPLIT_COLLAGE_EFFECT: EditorialSplitCollageEffects;
export declare const DEFAULT_CINEMATIC_GRADE_PACK_EFFECT: CinematicGradePackEffects;
export declare const DEFAULT_AUDIO_REACTIVE_CUT_DRIVER_EFFECT: AudioReactiveCutDriverEffects;
export declare const DEFAULT_MASK_SLICE_TRANSITION_EFFECT: MaskSliceTransitionEffects;
export declare const DEFAULT_PRIMITIVE_TEXTURE_GRADE_EFFECT: PrimitiveTextureGradeEffects;
export declare const DEFAULT_PRIMITIVE_BLOOM_OVERLAY_EFFECT: PrimitiveBloomOverlayEffects;
export declare const DEFAULT_PRIMITIVE_VIGNETTE_OVERLAY_EFFECT: PrimitiveVignetteOverlayEffects;
export declare const DEFAULT_PRIMITIVE_GRAIN_OVERLAY_EFFECT: PrimitiveGrainOverlayEffects;
export declare const DEFAULT_PRIMITIVE_LETTERBOX_OVERLAY_EFFECT: PrimitiveLetterboxOverlayEffects;
export declare const DEFAULT_PRIMITIVE_CHROMATIC_ABERRATION_OVERLAY_EFFECT: PrimitiveChromaticAberrationOverlayEffects;
export declare const DEFAULT_PRIMITIVE_LIGHT_SWEEP_OVERLAY_EFFECT: PrimitiveLightSweepOverlayEffects;
export declare const DEFAULT_PRIMITIVE_BEAT_PULSE_EFFECT: PrimitiveBeatPulseEffects;
export declare const DEFAULT_PRIMITIVE_BEAT_FLASH_OVERLAY_EFFECT: PrimitiveBeatFlashOverlayEffects;
export declare const DEFAULT_PRIMITIVE_BEAT_COLOR_UNLOCK_EFFECT: PrimitiveBeatColorUnlockEffects;
export declare const DEFAULT_PRIMITIVE_COLOR_HINT_OVERLAY_EFFECT: PrimitiveColorHintOverlayEffects;
export declare const DEFAULT_PRIMITIVE_FADE_OVERLAY_EFFECT: PrimitiveFadeOverlayEffects;
export declare const DEFAULT_PRIMITIVE_TRANSITION_ACCENT_OVERLAY_EFFECT: PrimitiveTransitionAccentOverlayEffects;
export declare const DEFAULT_PRIMITIVE_SLICE_REVEAL_EFFECT: PrimitiveSliceRevealEffects;
export declare const DEFAULT_PRIMITIVE_RIPPLE_DISPLACEMENT_EFFECT: PrimitiveRippleDisplacementEffects;
export declare const DEFAULT_PRIMITIVE_RIPPLE_RING_OVERLAY_EFFECT: PrimitiveRippleRingOverlayEffects;
export declare const DEFAULT_PRIMITIVE_COLLAGE_LAYOUT_EFFECT: PrimitiveCollageLayoutEffects;
export declare const EFFECT_PRESET_REGISTRY: EffectPresetDefinition[];
export declare function getEffectPresetDefinition(preset: string | undefined): EffectPresetDefinition | undefined;
export declare function createDefaultEffect(preset: EffectPresetId): SceneEffects | undefined;
export declare function isKnownEffectPreset(preset: string | undefined): preset is EffectPresetId;
//# sourceMappingURL=effect-registry.d.ts.map