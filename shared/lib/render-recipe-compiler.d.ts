import type { MigrationProtocolV12, RenderSceneEffectRecipe, SemanticAnchor } from '../types/migration-protocol.v1.2.js';
import type { CapabilityLayerKind } from '../types/capability-registry.v1.js';
import type { RenderPlanComponentResolutionDecision, RenderAsset, SceneEffects } from '../types/render-plan.v1.js';
export interface CompiledSceneEffectRecipe {
    segment_id: string;
    preset: SceneEffects['preset'];
    plugin_id: string;
    layerKind: CapabilityLayerKind;
    targetLayer: 'effect' | 'overlay';
    phenomenon?: string;
    evidence_refs?: string[];
    confidence?: number;
    params?: Record<string, unknown>;
    reason: string;
    resolution: 'compiled' | 'fallback';
}
export interface OverlayCapabilityRecipe {
    segment_id: string;
    plugin_id: string;
    layerKind: 'overlay';
    params?: Record<string, unknown>;
    reason: string;
}
export interface SceneEffectCompileOutcome {
    effect?: CompiledSceneEffectRecipe;
    overlay?: OverlayCapabilityRecipe;
    resolution?: RenderPlanComponentResolutionDecision;
}
export declare function compileSceneEffectRecipe(input: {
    recipe: RenderSceneEffectRecipe;
    anchor: SemanticAnchor;
    parentRecipe?: MigrationProtocolV12['render_recipe'];
    assets: RenderAsset[];
}): SceneEffectCompileOutcome;
export declare function compileSceneEffectRecipesForAnchor(input: {
    recipes: RenderSceneEffectRecipe[];
    anchor: SemanticAnchor;
    parentRecipe?: MigrationProtocolV12['render_recipe'];
    assets: RenderAsset[];
}): {
    effects: CompiledSceneEffectRecipe[];
    overlays: OverlayCapabilityRecipe[];
    resolutions: RenderPlanComponentResolutionDecision[];
};
export declare function shouldAddAudioReactiveFallback(input: {
    forceAudioReactive?: boolean;
    hasAudioDriverLayer: boolean;
    hasAudioTimingInSegment: boolean;
}): boolean;
//# sourceMappingURL=render-recipe-compiler.d.ts.map