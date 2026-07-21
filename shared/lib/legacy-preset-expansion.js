import { createDefaultEffect } from './effect-registry.js';
import { splitEffectLayer } from './legacy-preset-split.js';
import { isLegacyCompositePreset } from './primitive-presets.js';
/** Expand a render_recipe preset to the primitive presets expected after compile-time split. */
export function expandRecipePresetToCompiledPresets(preset) {
    if (!preset)
        return [];
    if (!isLegacyCompositePreset(preset))
        return [preset];
    const baseEffect = createDefaultEffect(preset);
    if (!baseEffect)
        return [preset];
    const baseLayer = {
        id: 'legacy_expand_tmp',
        layerKind: 'composite',
        plugin_id: preset,
        preset: baseEffect.preset,
        effects: baseEffect,
        source: 'scene_recipe',
        is_primary: true,
    };
    const expanded = splitEffectLayer(baseLayer)
        .map((layer) => layer.preset)
        .filter((value) => Boolean(value));
    return expanded.length ? [...new Set(expanded)] : [preset];
}
//# sourceMappingURL=legacy-preset-expansion.js.map