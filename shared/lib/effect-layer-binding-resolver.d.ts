import type { MotifSharedGeometry, MotifSharedTimeline } from '../types/effect-roadmap.v1.js';
import type { RenderEffectLayer, RenderPlanComponentResolution, SceneEffects } from '../types/render-plan.v1.js';
export interface EffectSharedParamRef {
    $shared: string;
}
export interface EffectFollowRef {
    $follow: {
        sourceLayerId: string;
        sourcePath: string;
        mode: 'point_at_time';
    };
}
export interface SharedParamEntry {
    source_atom_id: string;
    source_path: string;
    value: unknown;
}
export interface RuntimeFollowBinding {
    targetLayerId: string;
    targetPath: string;
    sourceLayerId: string;
    sourcePath: string;
    mode: 'point_at_time';
}
export interface EffectBindingWarning {
    scene_id: string;
    layer_id: string;
    binding: string;
    reason: string;
}
export interface SceneEffectBindingContext {
    sharedParams?: Record<string, SharedParamEntry>;
    sharedTimeline?: MotifSharedTimeline;
    sharedGeometry?: MotifSharedGeometry;
    beatTimes?: number[];
    runtimeFollows?: RuntimeFollowBinding[];
    warnings?: EffectBindingWarning[];
}
export interface EffectBindingResolveInput {
    sceneId: string;
    layers: RenderEffectLayer[];
    sharedParams?: Record<string, SharedParamEntry>;
    sharedTimeline?: MotifSharedTimeline;
    sharedGeometry?: MotifSharedGeometry;
    beatTimes?: number[];
    sceneStartSec?: number;
    sceneDurationSec?: number;
}
export interface EffectBindingResolveResult {
    layers: RenderEffectLayer[];
    runtimeFollows: RuntimeFollowBinding[];
    warnings: EffectBindingWarning[];
}
export declare function isEffectSharedParamRef(value: unknown): value is EffectSharedParamRef;
export declare function isEffectFollowRef(value: unknown): value is EffectFollowRef;
export declare function atomIdFromLayerId(layerId: string): string | null;
export declare function resolveBindingPath(path: string): string;
export declare function getAtPath(root: unknown, path: string): unknown;
export declare function interpolatePathAtTime(keyframes: Array<{
    time: number;
    x_pct: number;
    y_pct: number;
}>, timeSec: number): {
    x_pct: number;
    y_pct: number;
};
export declare function interpolateRadiusAtTime(keyframes: Array<{
    time: number;
    value: number;
}>, timeSec: number): number;
export declare function resolveEffectLayerBindings(input: EffectBindingResolveInput): EffectBindingResolveResult;
export declare function sampleBindingValueAtTime(input: {
    layers: RenderEffectLayer[];
    sourceLayerId: string;
    sourcePath: string;
    timeSec: number;
}): unknown;
export declare function sampleLayerEffectsAtTime(input: {
    layers: RenderEffectLayer[];
    runtimeFollows: RuntimeFollowBinding[];
    layerId: string;
    timeSec: number;
}): SceneEffects | undefined;
export declare function sampleMaskCenterAtTime(effects: SceneEffects, timeSec: number): {
    x_pct: number;
    y_pct: number;
} | null;
export declare function mergeBindingWarningsIntoComponentResolution(input: {
    componentResolution?: RenderPlanComponentResolution;
    warnings: EffectBindingWarning[];
}): RenderPlanComponentResolution;
//# sourceMappingURL=effect-layer-binding-resolver.d.ts.map