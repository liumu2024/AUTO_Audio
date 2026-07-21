import type { CapabilityAcceptedAssetType, CapabilityLayerKind, CapabilityPluginManifest, CapabilityTargetLayer } from '../types/capability-registry.v1.js';
import { CAPABILITY_LAYER_KINDS, isOverlayCapability } from '../types/capability-registry.v1.js';
import type { SceneEffects } from '../types/render-plan.v1.js';
export type { CapabilityAcceptedAssetType, CapabilityLayerKind, CapabilityPluginManifest, CapabilityTargetLayer, };
export { CAPABILITY_LAYER_KINDS, isOverlayCapability };
/** @deprecated use CapabilityLayerKind */
export type RenderEffectLayerKind = CapabilityLayerKind;
/** @deprecated use CapabilityPluginManifest */
export type RenderPluginManifest = CapabilityPluginManifest;
export declare const RENDER_PLUGIN_MANIFESTS: CapabilityPluginManifest[];
export declare function registerSeedPluginManifests(manifests: Array<Record<string, unknown> | undefined>): CapabilityPluginManifest[];
export declare function clearSeedPluginManifests(): void;
export declare function getRenderPluginManifest(id: string | undefined): CapabilityPluginManifest | undefined;
export declare function pluginIdForPreset(preset: string | undefined): string | undefined;
export declare function isKnownFallbackPreset(preset: string | undefined): preset is SceneEffects['preset'];
export declare function listManifestsByLayerKind(layerKind: CapabilityLayerKind): CapabilityPluginManifest[];
export declare function resolvePluginManifest(input: {
    plugin_id?: string;
    effect_id?: string;
    preset?: string;
    layer?: CapabilityLayerKind;
}): CapabilityPluginManifest | undefined;
/** snake_case / legacy manifest JSON -> CapabilityPluginManifest */
export declare function normalizeCapabilityManifestJson(raw: Record<string, unknown>): CapabilityPluginManifest | null;
//# sourceMappingURL=render-plugin-manifest.d.ts.map