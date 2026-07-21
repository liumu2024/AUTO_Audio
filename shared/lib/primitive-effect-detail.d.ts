import type { MigrationProtocolV12 } from '../types/migration-protocol.v1.2.js';
import type { PrimitiveBeatPulseEffects, PrimitiveBeatColorUnlockEffects, PrimitiveColorHintOverlayEffects, PrimitiveDirectionalWaveRevealEffects, PrimitiveFadeOverlayEffects, PrimitiveMaskRevealEffects, PrimitiveOrbMotionEffects, PrimitiveRippleDisplacementEffects, PrimitiveTransitionAccentOverlayEffects, SceneEffects } from '../types/render-plan.v1.js';
export declare function normalizePrimitiveEffectForAnchor(effect: SceneEffects | undefined, anchor: MigrationProtocolV12['semantic_anchors'][number]): SceneEffects | undefined;
export declare function detailPrimitiveOrbMotion(input: {
    effect: PrimitiveOrbMotionEffects;
    anchor: MigrationProtocolV12['semantic_anchors'][number];
    recipe: MigrationProtocolV12['render_recipe'] | undefined;
}): PrimitiveOrbMotionEffects;
export declare function detailPrimitiveDirectionalWaveReveal(input: {
    effect: PrimitiveDirectionalWaveRevealEffects;
    anchor: MigrationProtocolV12['semantic_anchors'][number];
    recipe: MigrationProtocolV12['render_recipe'] | undefined;
}): PrimitiveDirectionalWaveRevealEffects;
export declare function detailPrimitiveMaskReveal(input: {
    effect: PrimitiveMaskRevealEffects;
    anchor: MigrationProtocolV12['semantic_anchors'][number];
    recipe: MigrationProtocolV12['render_recipe'] | undefined;
}): PrimitiveMaskRevealEffects;
export declare function detailPrimitiveRippleDisplacement(input: {
    effect: PrimitiveRippleDisplacementEffects;
    anchor: MigrationProtocolV12['semantic_anchors'][number];
    recipe: MigrationProtocolV12['render_recipe'] | undefined;
}): PrimitiveRippleDisplacementEffects;
export declare function detailPrimitiveBeatPulse(effect: PrimitiveBeatPulseEffects): PrimitiveBeatPulseEffects;
export declare function detailPrimitiveBeatColorUnlock(input: {
    effect: PrimitiveBeatColorUnlockEffects;
    anchor: MigrationProtocolV12['semantic_anchors'][number];
    recipe: MigrationProtocolV12['render_recipe'] | undefined;
}): PrimitiveBeatColorUnlockEffects;
export declare function detailPrimitiveColorHintOverlay(input: {
    effect: PrimitiveColorHintOverlayEffects;
    anchor: MigrationProtocolV12['semantic_anchors'][number];
    recipe: MigrationProtocolV12['render_recipe'] | undefined;
}): PrimitiveColorHintOverlayEffects;
export declare function detailPrimitiveFadeOverlay(input: {
    effect: PrimitiveFadeOverlayEffects;
    anchor: MigrationProtocolV12['semantic_anchors'][number];
}): PrimitiveFadeOverlayEffects;
export declare function detailPrimitiveTransitionAccentOverlay(input: {
    effect: PrimitiveTransitionAccentOverlayEffects;
    anchor: MigrationProtocolV12['semantic_anchors'][number];
    recipe: MigrationProtocolV12['render_recipe'] | undefined;
}): PrimitiveTransitionAccentOverlayEffects;
export declare function detailPrimitiveEffectForAnchor(input: {
    effect: SceneEffects | undefined;
    anchor: MigrationProtocolV12['semantic_anchors'][number];
    recipe: MigrationProtocolV12['render_recipe'] | undefined;
}): SceneEffects | undefined;
export declare function wantsGlobalCinematicGrade(globalEffects: string[] | undefined): boolean;
//# sourceMappingURL=primitive-effect-detail.d.ts.map