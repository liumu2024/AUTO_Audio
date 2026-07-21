import type { RenderEffectLayer } from '../types/render-plan.v1.js';
export declare function splitLegacyColorPortalLayer(layer: RenderEffectLayer): RenderEffectLayer[];
export declare function splitLegacyKineticColorRippleLayer(layer: RenderEffectLayer): RenderEffectLayer[];
export declare function splitLegacyCinematicGradePackLayer(layer: RenderEffectLayer): RenderEffectLayer[];
export declare function splitLegacyCinematicLightSweepLayer(layer: RenderEffectLayer): RenderEffectLayer[];
export declare function splitLegacyAudioReactiveLayer(layer: RenderEffectLayer): RenderEffectLayer[];
export declare function splitLegacyMaskSliceLayer(layer: RenderEffectLayer): RenderEffectLayer[];
export declare function splitLegacyRippleDisplacementLayer(layer: RenderEffectLayer): RenderEffectLayer[];
export declare function splitLegacyEditorialCollageLayer(layer: RenderEffectLayer): RenderEffectLayer[];
export declare function splitEffectLayer(layer: RenderEffectLayer): RenderEffectLayer[];
export declare function splitEffectLayers(layers: RenderEffectLayer[]): RenderEffectLayer[];
/** @deprecated use splitEffectLayer */
export declare function splitLegacyCompositeLayer(layer: RenderEffectLayer): RenderEffectLayer[];
//# sourceMappingURL=legacy-preset-split.d.ts.map