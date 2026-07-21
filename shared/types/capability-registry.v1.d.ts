/** Remotion 分层能力 registry — layerKind 与插件契约 */
import type { SceneEffects } from './render-plan.v1.js';
export type CapabilityLayerKind = 'motion_driver' | 'mask_reveal' | 'distortion' | 'color_transform' | 'texture_grade' | 'color_grade' | 'layout' | 'overlay' | 'audio_driver' | 'composite';
export declare const CAPABILITY_LAYER_KINDS: readonly ["motion_driver", "mask_reveal", "distortion", "color_transform", "texture_grade", "color_grade", "layout", "overlay", "audio_driver", "composite"];
export type CapabilityTargetLayer = 'effect' | 'overlay';
export type CapabilityAtomicity = 'atomic' | 'composite_legacy';
export type CapabilityAdaptability = 'none' | 'low' | 'medium' | 'high';
export interface CapabilitySupportRange {
    min?: number;
    max?: number;
}
export type CapabilitySupportValue = string | number | boolean | string[] | number[] | CapabilitySupportRange;
export interface CapabilityPluginBoundary {
    /**
     * Structured capability facts keyed by visual grammar paths, for example
     * geometry.primitive or style.color_transform.
     */
    supports?: Record<string, CapabilitySupportValue>;
    /**
     * Hard negative constraints. A plugin must not be reused when a requested
     * must_match grammar clause hits one of these facts.
     */
    cannotSupport?: string[];
    /**
     * Layers that this plugin must not satisfy by itself. Use composition when
     * a sample requires these alongside the plugin's primary layer.
     */
    forbiddenLayers?: CapabilityLayerKind[];
    /**
     * Capability families that need an explicit composition decision instead of
     * being implicitly bundled with this plugin.
     */
    requiresCompositionFor?: string[];
    adaptability?: Partial<Record<'geometry' | 'timing' | 'style' | 'assets', CapabilityAdaptability>>;
}
export type CapabilityAcceptedAssetType = 'image' | 'video' | 'generated_video' | 'audio' | 'text';
export interface CapabilityPluginManifest {
    id: string;
    label: string;
    status: 'verified' | 'experimental';
    targetLayer: CapabilityTargetLayer;
    layerKind: CapabilityLayerKind;
    atomicity?: CapabilityAtomicity;
    family?: string;
    primaryLayer?: CapabilityLayerKind;
    secondaryLayers?: CapabilityLayerKind[];
    fallbackPreset?: SceneEffects['preset'];
    capabilities: string[];
    requiredParams: string[];
    defaultParams: Record<string, unknown>;
    compatibleLayers: CapabilityLayerKind[];
    acceptedAssetTypes: CapabilityAcceptedAssetType[];
    negativeKeywords?: string[];
    boundary?: CapabilityPluginBoundary;
    description?: string;
}
export declare function isOverlayCapability(manifest: CapabilityPluginManifest): boolean;
//# sourceMappingURL=capability-registry.v1.d.ts.map