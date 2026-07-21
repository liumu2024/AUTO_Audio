import { CAPABILITY_LAYER_KINDS, isOverlayCapability } from '../types/capability-registry.v1.js';
import { EFFECT_PRESET_REGISTRY } from './effect-registry.js';
import { LAYERED_RENDER_PLUGIN_MANIFESTS } from './render-plugins/index.js';
export { CAPABILITY_LAYER_KINDS, isOverlayCapability };
const KNOWN_FALLBACK_PRESETS = new Set(EFFECT_PRESET_REGISTRY.map((item) => item.id));
const DEFAULT_COMPAT = {
    motion_driver: ['mask_reveal', 'distortion', 'color_grade', 'audio_driver'],
    mask_reveal: ['motion_driver', 'color_grade', 'audio_driver', 'distortion'],
    distortion: ['color_grade', 'audio_driver', 'motion_driver'],
    color_transform: ['mask_reveal', 'motion_driver', 'audio_driver', 'texture_grade'],
    texture_grade: ['motion_driver', 'mask_reveal', 'distortion', 'layout', 'audio_driver', 'color_transform'],
    color_grade: ['motion_driver', 'mask_reveal', 'distortion', 'layout', 'audio_driver'],
    layout: ['color_grade', 'audio_driver', 'motion_driver'],
    overlay: ['color_grade'],
    audio_driver: ['motion_driver', 'mask_reveal', 'distortion', 'color_grade', 'layout'],
    composite: [...CAPABILITY_LAYER_KINDS],
};
function manifest(input) {
    return {
        ...input,
        atomicity: input.atomicity ?? 'atomic',
        primaryLayer: input.primaryLayer ?? input.layerKind,
        secondaryLayers: input.secondaryLayers ?? [],
        compatibleLayers: input.compatibleLayers.length
            ? input.compatibleLayers
            : DEFAULT_COMPAT[input.layerKind],
    };
}
export const RENDER_PLUGIN_MANIFESTS = LAYERED_RENDER_PLUGIN_MANIFESTS.map((item) => manifest(item));
const RUNTIME_SEED_PLUGIN_MANIFESTS = [];
export function registerSeedPluginManifests(manifests) {
    const registered = [];
    for (const raw of manifests) {
        if (!raw)
            continue;
        const normalized = normalizeCapabilityManifestJson(raw);
        if (!normalized)
            continue;
        const exists = RENDER_PLUGIN_MANIFESTS.some((item) => item.id === normalized.id) ||
            RUNTIME_SEED_PLUGIN_MANIFESTS.some((item) => item.id === normalized.id);
        if (exists)
            continue;
        RUNTIME_SEED_PLUGIN_MANIFESTS.push(normalized);
        registered.push(normalized);
    }
    return registered;
}
export function clearSeedPluginManifests() {
    RUNTIME_SEED_PLUGIN_MANIFESTS.length = 0;
}
export function getRenderPluginManifest(id) {
    if (!id)
        return undefined;
    const fromSeed = RUNTIME_SEED_PLUGIN_MANIFESTS.find((item) => item.id === id);
    if (fromSeed)
        return fromSeed;
    return RENDER_PLUGIN_MANIFESTS.find((item) => item.id === id);
}
export function pluginIdForPreset(preset) {
    if (!preset)
        return undefined;
    return RENDER_PLUGIN_MANIFESTS.find((item) => item.fallbackPreset === preset)?.id;
}
export function isKnownFallbackPreset(preset) {
    if (!preset)
        return false;
    return KNOWN_FALLBACK_PRESETS.has(preset);
}
export function listManifestsByLayerKind(layerKind) {
    return RENDER_PLUGIN_MANIFESTS.filter((item) => item.layerKind === layerKind);
}
export function resolvePluginManifest(input) {
    const byId = getRenderPluginManifest(input.plugin_id ?? input.effect_id);
    if (byId)
        return byId;
    if (input.preset) {
        const byPreset = RENDER_PLUGIN_MANIFESTS.find((item) => item.fallbackPreset === input.preset);
        if (byPreset)
            return byPreset;
    }
    if (input.layer) {
        const candidates = listManifestsByLayerKind(input.layer);
        if (candidates.length === 1)
            return candidates[0];
    }
    return undefined;
}
/** snake_case / legacy manifest JSON -> CapabilityPluginManifest */
export function normalizeCapabilityManifestJson(raw) {
    const id = typeof raw.id === 'string' ? raw.id : undefined;
    if (!id)
        return null;
    const existing = getRenderPluginManifest(id);
    if (existing)
        return existing;
    const layerKindRaw = (typeof raw.layerKind === 'string' ? raw.layerKind : undefined) ??
        (typeof raw.layer_kind === 'string' ? raw.layer_kind : undefined);
    const layerKind = normalizeLegacyLayerKind(layerKindRaw);
    const targetLayerRaw = (typeof raw.targetLayer === 'string' ? raw.targetLayer : undefined) ??
        (typeof raw.target_layer === 'string' ? raw.target_layer : undefined);
    const targetLayer = targetLayerRaw === 'overlay' ? 'overlay' : 'effect';
    const fallbackPreset = (typeof raw.fallbackPreset === 'string' ? raw.fallbackPreset : undefined) ??
        (typeof raw.fallback_preset === 'string' ? raw.fallback_preset : undefined);
    const normalizedLayerKind = targetLayer === 'overlay' ? 'overlay' : layerKind;
    const primaryLayerRaw = (typeof raw.primaryLayer === 'string' ? raw.primaryLayer : undefined) ??
        (typeof raw.primary_layer === 'string' ? raw.primary_layer : undefined);
    return manifest({
        id,
        label: typeof raw.label === 'string' ? raw.label : id,
        status: raw.status === 'experimental' ? 'experimental' : 'verified',
        targetLayer,
        layerKind: normalizedLayerKind,
        atomicity: raw.atomicity === 'composite_legacy' ? 'composite_legacy' : 'atomic',
        family: typeof raw.family === 'string' ? raw.family : undefined,
        primaryLayer: primaryLayerRaw ? normalizeLegacyLayerKind(primaryLayerRaw) : normalizedLayerKind,
        secondaryLayers: stringArray(raw.secondaryLayers ?? raw.secondary_layers)
            .map((item) => normalizeLegacyLayerKind(item))
            .filter(Boolean),
        fallbackPreset: isKnownFallbackPreset(fallbackPreset) ? fallbackPreset : undefined,
        capabilities: stringArray(raw.capabilities),
        requiredParams: stringArray(raw.requiredParams ?? raw.required_params),
        defaultParams: record(raw.defaultParams ?? raw.default_params),
        compatibleLayers: stringArray(raw.compatibleLayers ?? raw.compatible_layers)
            .map((item) => normalizeLegacyLayerKind(item))
            .filter(Boolean),
        acceptedAssetTypes: stringArray(raw.acceptedAssetTypes ?? raw.supported_asset_types).filter((item) => ['image', 'video', 'generated_video', 'audio', 'text'].includes(item)),
        negativeKeywords: stringArray(raw.negativeKeywords ?? raw.negative_keywords),
        boundary: record(raw.boundary),
        description: typeof raw.description === 'string' ? raw.description : undefined,
    });
}
function stringArray(value) {
    if (!Array.isArray(value))
        return [];
    return value.filter((item) => typeof item === 'string');
}
function record(value) {
    if (typeof value !== 'object' || value === null || Array.isArray(value))
        return {};
    return value;
}
function normalizeLegacyLayerKind(value) {
    const map = {
        motion_driver: 'motion_driver',
        mask_reveal: 'mask_reveal',
        distortion: 'distortion',
        color_transform: 'color_transform',
        texture_grade: 'texture_grade',
        color_grade: 'color_grade',
        layout: 'layout',
        overlay: 'overlay',
        audio_driver: 'audio_driver',
        composite: 'composite',
        driver: 'motion_driver',
        reveal: 'mask_reveal',
        grade: 'color_grade',
        transition: 'mask_reveal',
        primary: 'composite',
        fallback: 'composite',
        generated: 'composite',
    };
    if (!value)
        return 'composite';
    return map[value] ?? (CAPABILITY_LAYER_KINDS.includes(value)
        ? value
        : 'composite');
}
//# sourceMappingURL=render-plugin-manifest.js.map