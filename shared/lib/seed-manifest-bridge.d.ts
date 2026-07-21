import type { CapabilityLayerKind } from '../types/capability-registry.v1.js';
import type { SceneEffects } from '../types/render-plan.v1.js';
/** LayerKind → primitive preset when Seed manifest omits fallbackPreset. */
export declare const LAYER_KIND_FALLBACK_PRESET: Record<CapabilityLayerKind, SceneEffects['preset']>;
export declare function resolveSeedManifestLayerKind(manifest: Record<string, unknown>, atomLayerKind?: CapabilityLayerKind): CapabilityLayerKind;
export declare function inferFallbackPresetFromSeedManifest(input: {
    manifest: Record<string, unknown>;
    atomLayerKind?: CapabilityLayerKind;
}): SceneEffects['preset'] | null;
/** Fill missing fallbackPreset so Seed proposals compile to primitive layers. */
export declare function hydrateSeedPluginManifest(manifest: Record<string, unknown> | undefined, atomLayerKind?: CapabilityLayerKind): Record<string, unknown> | null;
export declare function resolveSeedCompilePluginId(input: {
    proposalPluginId: string;
    preset: SceneEffects['preset'];
}): string;
//# sourceMappingURL=seed-manifest-bridge.d.ts.map