import { CAPABILITY_LAYER_KINDS } from '../types/capability-registry.v1.js';
import { createDefaultEffect } from './effect-registry.js';
import { getRenderPluginManifest, isKnownFallbackPreset, pluginIdForPreset, } from './render-plugin-manifest.js';
/** LayerKind → primitive preset when Seed manifest omits fallbackPreset. */
export const LAYER_KIND_FALLBACK_PRESET = {
    motion_driver: 'primitive_orb_motion',
    mask_reveal: 'primitive_mask_reveal',
    distortion: 'primitive_ripple_displacement',
    color_transform: 'primitive_color_transform',
    texture_grade: 'primitive_texture_grade',
    color_grade: 'primitive_texture_grade',
    layout: 'primitive_collage_layout',
    overlay: 'primitive_vignette_overlay',
    audio_driver: 'primitive_beat_pulse',
    composite: 'color_portal_spotlight',
};
export function resolveSeedManifestLayerKind(manifest, atomLayerKind) {
    const raw = (typeof manifest.layerKind === 'string' ? manifest.layerKind : undefined) ??
        (typeof manifest.layer_kind === 'string' ? manifest.layer_kind : undefined) ??
        atomLayerKind;
    if (raw && CAPABILITY_LAYER_KINDS.includes(raw)) {
        return raw;
    }
    return atomLayerKind ?? 'composite';
}
export function inferFallbackPresetFromSeedManifest(input) {
    const explicit = (typeof input.manifest.fallbackPreset === 'string' ? input.manifest.fallbackPreset : undefined) ??
        (typeof input.manifest.fallback_preset === 'string' ? input.manifest.fallback_preset : undefined);
    if (isKnownFallbackPreset(explicit)) {
        return explicit;
    }
    const layerKind = resolveSeedManifestLayerKind(input.manifest, input.atomLayerKind);
    const preset = LAYER_KIND_FALLBACK_PRESET[layerKind];
    return createDefaultEffect(preset) ? preset : null;
}
/** Fill missing fallbackPreset so Seed proposals compile to primitive layers. */
export function hydrateSeedPluginManifest(manifest, atomLayerKind) {
    if (!manifest)
        return null;
    const layerKind = resolveSeedManifestLayerKind(manifest, atomLayerKind);
    const fallbackPreset = inferFallbackPresetFromSeedManifest({ manifest, atomLayerKind });
    return {
        ...manifest,
        layerKind,
        ...(fallbackPreset ? { fallbackPreset } : {}),
    };
}
export function resolveSeedCompilePluginId(input) {
    return (getRenderPluginManifest(input.proposalPluginId)?.id ??
        pluginIdForPreset(input.preset) ??
        input.proposalPluginId);
}
//# sourceMappingURL=seed-manifest-bridge.js.map