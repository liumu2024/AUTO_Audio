import type { DirectorAspectRatio } from './director-context.js';
import type { CapabilityLayerKind } from './capability-registry.v1.js';
import type { AudioLayer, OverlayLayer, RenderAsset, SceneEffects } from './render-plan.v1.js';
/** 对 RenderPlan 的原子变更（PropertyEditor / REVISE_RENDER_PLAN 消费） */
export type RenderActionType = 'BIND_MATERIAL' | 'APPLY_EFFECT_LAYER' | 'ADD_OVERLAY' | 'SET_AUDIO' | 'SET_CANVAS' | 'REQUEST_COMPONENT';
export interface BindMaterialPayload {
    sceneId: string;
    assetId: string;
    trim?: {
        start_sec: number;
        end_sec: number;
    };
    fit?: 'cover' | 'contain';
}
export interface ApplyEffectLayerPayload {
    sceneId: string;
    plugin_id?: string;
    layerKind?: CapabilityLayerKind;
    effects?: SceneEffects;
}
export interface AddOverlayPayload {
    sceneId: string;
    overlay: OverlayLayer;
}
export interface SetAudioPayload {
    sceneId: string;
    audioId?: string;
    patch: Partial<AudioLayer>;
}
export interface SetCanvasPayload {
    aspectRatio?: DirectorAspectRatio;
    fps?: number;
}
export interface RequestComponentPayload {
    capability_id: string;
    segment_ids?: string[];
    reason?: string;
}
export type RenderActionPayload = BindMaterialPayload | ApplyEffectLayerPayload | AddOverlayPayload | SetAudioPayload | SetCanvasPayload | RequestComponentPayload;
export interface RenderAction {
    type: RenderActionType;
    sceneId?: string;
    anchorId?: string;
    payload: RenderActionPayload;
}
export interface RenderActionBatch {
    actions: RenderAction[];
    reason?: string;
}
/** 供 BIND_MATERIAL 批量注入时使用 */
export interface RenderMaterialBinding {
    assets: RenderAsset[];
    prompt?: string;
}
//# sourceMappingURL=render-action.d.ts.map