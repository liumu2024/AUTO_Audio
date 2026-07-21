import { isKnownEffectPreset } from './effect-registry.js';
import { getRenderPluginManifest, isKnownFallbackPreset, isOverlayCapability, pluginIdForPreset, resolvePluginManifest, } from './render-plugin-manifest.js';
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function mergeRecords(base, patch) {
    if (!patch)
        return { ...base };
    const next = { ...base };
    for (const [key, value] of Object.entries(patch)) {
        const current = next[key];
        if (isRecord(current) && isRecord(value)) {
            next[key] = mergeRecords(current, value);
        }
        else {
            next[key] = value;
        }
    }
    return next;
}
function anchorDuration(anchor) {
    return Math.max(0.2, Number((anchor.end_sec - anchor.start_sec).toFixed(3)));
}
function localAudioTiming(recipe, anchor) {
    const audio = recipe?.audio_driver;
    const start = anchor.start_sec;
    const end = anchor.end_sec;
    const localize = (time) => Number((time - start).toFixed(3));
    return {
        beats: (audio?.beat_times ?? [])
            .filter((time) => time >= start && time < end)
            .map(localize),
        strongBeats: (audio?.strong_beats ?? [])
            .filter((time) => time >= start && time < end)
            .map(localize),
        energyPeaks: (audio?.energy_peaks ?? [])
            .filter((peak) => peak.time >= start && peak.time < end)
            .map((peak) => ({ ...peak, time: localize(peak.time) })),
    };
}
function evidenceText(anchor, recipe) {
    return [
        recipe.phenomenon,
        anchor.logic_intent.creative_role,
        anchor.logic_intent.marketing_role,
        anchor.logic_intent.emotion_vibe,
        anchor.replication_instructions.visual_generation_prompt,
        anchor.replication_instructions.overlay_rewrite_instruction,
    ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
}
function visualAssets(assets) {
    return assets.filter((asset) => asset.type === 'image' ||
        asset.type === 'video' ||
        asset.type === 'generated_video');
}
const PANEL_LAYOUT_PROFILES = {
    full_height_triptych: {
        id: 'full_height_triptych',
        xPct: [18, 50, 82],
        yPct: 50,
        widthPct: 34,
        heightPct: 100,
        borderRadiusPx: 0,
        scaleFrom: 0.96,
        scaleTo: 1.04,
    },
    compact_triptych_tiles: {
        id: 'compact_triptych_tiles',
        xPct: [22, 50, 78],
        yPct: 58,
        widthPct: 25,
        heightPct: 30,
        borderRadiusPx: 8,
        panelStyle: {
            border_px: 2,
            border_color: 'rgba(255,255,255,0.22)',
            shadow: true,
            chromatic_aberration_px: 1.8,
        },
        scaleFrom: 0.92,
        scaleTo: 1.04,
    },
};
function stringParam(params, keys) {
    for (const key of keys) {
        const value = params?.[key];
        if (typeof value === 'string' && value.trim())
            return value.trim();
    }
    return undefined;
}
function numberParam(params, key) {
    const value = params?.[key];
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
function resolvePanelLayoutProfile(input) {
    const explicitProfile = stringParam(input.params, [
        'panel_profile',
        'layout_profile',
        'layout_variant',
        'tile_profile',
    ]);
    if (explicitProfile && PANEL_LAYOUT_PROFILES[explicitProfile]) {
        return PANEL_LAYOUT_PROFILES[explicitProfile];
    }
    const tileScale = numberParam(input.params, 'tile_scale');
    const widthPct = numberParam(input.params, 'panel_width_pct');
    const heightPct = numberParam(input.params, 'panel_height_pct');
    const compactByParams = (tileScale !== undefined && tileScale < 0.72) ||
        (widthPct !== undefined && widthPct <= 28) ||
        (heightPct !== undefined && heightPct <= 36);
    if (compactByParams) {
        return PANEL_LAYOUT_PROFILES.compact_triptych_tiles;
    }
    const normalized = input.evidenceText.toLowerCase();
    const compactSignals = ['small', 'tile', 'block', 'card', 'mini', 'compact', '小块', '小屏', '小窗', '方块'];
    if (compactSignals.some((signal) => normalized.includes(signal))) {
        return PANEL_LAYOUT_PROFILES.compact_triptych_tiles;
    }
    return PANEL_LAYOUT_PROFILES.full_height_triptych;
}
function panelParams(input) {
    const { duration } = input;
    const items = visualAssets(input.assets).slice(0, 3);
    if (!items.length)
        return {};
    const profile = resolvePanelLayoutProfile({
        params: input.params,
        evidenceText: input.evidenceText ?? '',
    });
    return {
        ...(profile.panelStyle ? { panel_style: profile.panelStyle } : {}),
        panels: items.map((asset, index) => ({
            id: `${profile.id}_panel_${index + 1}`,
            asset_id: asset.id,
            start_sec: Number((index * 0.08).toFixed(3)),
            end_sec: Number(Math.max(duration, 999).toFixed(3)),
            x_pct: profile.xPct[index] ?? 50,
            y_pct: profile.yPct,
            width_pct: profile.widthPct,
            height_pct: profile.heightPct,
            fit: 'cover',
            opacity: 0.96,
            border_radius_px: profile.borderRadiusPx,
            entrance: index === 1 ? 'zoom' : index === 0 ? 'slide_left' : 'slide_right',
            scale_from: profile.scaleFrom,
            scale_to: profile.scaleTo,
        })),
    };
}
function radialTrianglePanelParams(assets, duration) {
    const items = visualAssets(assets).slice(0, 4);
    if (!items.length)
        return {};
    return {
        layout_mode: 'radial_triangle_prism',
        panels: Array.from({ length: 4 }, (_, index) => {
            const asset = items[index % items.length];
            return {
                id: `radial_panel_${index + 1}`,
                asset_id: asset.id,
                start_sec: Number((index * 0.18).toFixed(3)),
                end_sec: Number(Math.max(duration, 999).toFixed(3)),
                x_pct: 50,
                y_pct: 50,
                width_pct: 100,
                height_pct: 100,
                fit: 'cover',
                opacity: 0.92,
                entrance: 'zoom',
                scale_from: 0.96,
                scale_to: 1.06,
            };
        }),
    };
}
function crystalLensRevealParams(anchor, assets) {
    const duration = anchorDuration(anchor);
    const revealAsset = visualAssets(assets).find((asset) => asset.id !== anchor.match.asset_id);
    return {
        lens_style: 'crystal',
        ...(revealAsset ? { reveal_asset_id: revealAsset.id } : {}),
        mask: {
            shape: 'circle',
            radius_pct_keyframes: [
                { time: 0, value: 4 },
                { time: Number((duration * 0.55).toFixed(3)), value: 34 },
                { time: Number(duration.toFixed(3)), value: 130 },
            ],
            position_keyframes: [
                { time: 0, x_pct: 50, y_pct: 50 },
                { time: Number(duration.toFixed(3)), x_pct: 50, y_pct: 50 },
            ],
            beat_reactive_scale: false,
        },
    };
}
function directionalRevealParams(anchor, recipe) {
    const duration = anchorDuration(anchor);
    const text = evidenceText(anchor, recipe);
    const fromBottom = /rise|bottom|升起|下方/.test(text);
    const centerX = /left|左/.test(text) ? 38 : /right|右/.test(text) ? 62 : 50;
    const centerY = fromBottom ? 62 : /top|上方/.test(text) ? 38 : 50;
    return {
        base_filter: 'grayscale(100%) contrast(1.18) brightness(0.94)',
        portal: {
            shape: 'circle',
            beat_reactive_scale: true,
            position_keyframes: [
                { time: 0, x_pct: centerX, y_pct: fromBottom ? 108 : centerY },
                { time: Number(Math.min(0.72, duration * 0.34).toFixed(3)), x_pct: centerX, y_pct: centerY },
                { time: Number(duration.toFixed(3)), x_pct: centerX + 4, y_pct: centerY - 2 },
            ],
            radius_pct_keyframes: [
                { time: 0, value: 8 },
                { time: Number(Math.min(0.48, duration * 0.28).toFixed(3)), value: 22 },
                { time: Number(Math.min(duration * 0.72, 1.1).toFixed(3)), value: 58 },
                { time: Number(duration.toFixed(3)), value: 118 },
            ],
        },
    };
}
function circularMaskRevealParams(anchor, recipe) {
    const legacy = directionalRevealParams(anchor, recipe);
    const portal = isRecord(legacy.portal) ? legacy.portal : {};
    return {
        mask: {
            shape: 'circle',
            ...portal,
        },
    };
}
function grayscaleTransformParams() {
    return {
        base_filter: 'grayscale(100%) contrast(1.18) brightness(0.94)',
    };
}
function directionalWaveRevealParams(anchor, parentRecipe) {
    const duration = anchorDuration(anchor);
    const timing = localAudioTiming(parentRecipe, anchor);
    const trigger = timing.strongBeats[0] ?? timing.energyPeaks[0]?.time ?? timing.beats[0] ?? Math.min(0.72, duration * 0.32);
    return {
        reveal_events: [
            {
                id: 'reveal_001',
                mode: 'ripple',
                trigger_time: Number(Math.min(duration - 0.06, Math.max(0, trigger)).toFixed(3)),
                origin: { x_pct: 50, y_pct: 50 },
                direction_from_motion: true,
                duration_sec: Number(Math.min(0.62, Math.max(0.28, duration * 0.34)).toFixed(3)),
                wave_count: 5,
                wave_spacing_pct: 5.6,
                wave_width_pct: 4.2,
                propagation_speed_pct_per_sec: 240,
                color_unlock: 0.72,
            },
        ],
    };
}
function rippleParams(anchor, parentRecipe) {
    const duration = anchorDuration(anchor);
    const timing = localAudioTiming(parentRecipe, anchor);
    const start = Math.min(duration * 0.28, timing.strongBeats[0] ?? timing.beats[0] ?? 0.2);
    const rippleDuration = Math.min(Math.max(0.36, duration * 0.6), Math.max(0.24, duration - start));
    return {
        base_filter: 'contrast(1.08) saturate(1.05) brightness(0.96)',
        ripple: {
            origin: { x_pct: 50, y_pct: 50 },
            start_sec: Number(start.toFixed(3)),
            duration_sec: Number(rippleDuration.toFixed(3)),
            radius_pct_keyframes: [
                { time: 0, value: 0 },
                { time: Number(start.toFixed(3)), value: 0 },
                { time: Number((start + rippleDuration * 0.28).toFixed(3)), value: 28 },
                { time: Number((start + rippleDuration * 0.68).toFixed(3)), value: 78 },
                { time: Number((start + rippleDuration).toFixed(3)), value: 128 },
            ],
            amplitude_px: 34,
            frequency: 9.4,
            decay: 0.76,
            width_pct: 10,
        },
    };
}
function windowMaskParams(anchor) {
    const duration = Math.min(anchorDuration(anchor), 0.9);
    return {
        start_sec: 0,
        duration_sec: Number(duration.toFixed(3)),
        slice_count: 6,
        direction: 'horizontal',
        mode: 'reveal',
        stagger_sec: 0.035,
        slide_distance_pct: 18,
    };
}
function manifestParams(input) {
    const { manifest, anchor, recipe, parentRecipe, assets } = input;
    const duration = anchorDuration(anchor);
    const text = evidenceText(anchor, recipe);
    let generated = {};
    if (manifest.id === 'circle_mask_reveal') {
        generated = circularMaskRevealParams(anchor, recipe);
    }
    else if (manifest.id === 'grayscale_to_color_transform') {
        generated = grayscaleTransformParams();
    }
    else if (manifest.id === 'directional_wave_reveal') {
        generated = directionalWaveRevealParams(anchor, parentRecipe);
    }
    else if (manifest.id === 'water_ripple_distortion_overlay') {
        generated = rippleParams(anchor, parentRecipe);
    }
    else if (manifest.id === 'split_collage_layout') {
        generated = panelParams({
            assets,
            duration,
            evidenceText: text,
            params: recipe.params,
        });
    }
    else if (manifest.id === 'radial_triangle_prism_collage') {
        generated = radialTrianglePanelParams(assets, duration);
    }
    else if (manifest.id === 'crystal_lens_reveal_transition') {
        generated = crystalLensRevealParams(anchor, assets);
    }
    else if (manifest.id === 'layout_window_mask') {
        generated = windowMaskParams(anchor);
    }
    else if (manifest.id === 'cinematic_texture_grade') {
        generated = {
            base_filter: /night|夜|蓝调/.test(text)
                ? 'saturate(1.12) contrast(1.16) brightness(0.9)'
                : 'saturate(1.16) contrast(1.12) brightness(0.94)',
        };
    }
    return mergeRecords(manifest.defaultParams, generated);
}
function missingDecision(input) {
    return {
        capability_id: input.capabilityId,
        segment_ids: [input.segmentId],
        decision: 'fallback',
        reason: input.reason,
    };
}
function resolveManifest(recipe) {
    return resolvePluginManifest({
        plugin_id: recipe.plugin_id,
        effect_id: recipe.effect_id,
        preset: recipe.preset,
        layer: recipe.layer,
    });
}
function resolvePreset(input) {
    const fromManifest = input.manifest?.fallbackPreset;
    if (fromManifest && isKnownFallbackPreset(fromManifest))
        return fromManifest;
    if (input.recipe.preset && isKnownFallbackPreset(input.recipe.preset)) {
        return input.recipe.preset;
    }
    return undefined;
}
function legacyCompositePluginId(preset) {
    switch (preset) {
        case 'color_portal_spotlight':
            return 'circle_mask_reveal';
        case 'kinetic_color_ripple':
            return 'orb_motion_driver';
        case 'cinematic_grade_pack':
        case 'cinematic_light_sweep':
            return 'cinematic_texture_grade';
        case 'audio_reactive_cut_driver':
            return 'beat_cut_driver';
        case 'mask_slice_transition':
            return 'layout_window_mask';
        case 'ripple_displacement':
            return 'water_ripple_distortion_overlay';
        case 'editorial_split_collage':
            return 'split_collage_layout';
        default:
            return undefined;
    }
}
export function compileSceneEffectRecipe(input) {
    const capabilityId = input.recipe.plugin_id ??
        input.recipe.effect_id ??
        input.recipe.preset ??
        'unknown_capability';
    const manifest = resolveManifest(input.recipe);
    if (input.recipe.preset && !isKnownFallbackPreset(input.recipe.preset) && !manifest) {
        return {
            resolution: missingDecision({
                capabilityId,
                segmentId: input.recipe.segment_id,
                reason: `Unknown preset "${input.recipe.preset}" is not registered in effect registry.`,
            }),
        };
    }
    if (manifest && isOverlayCapability(manifest)) {
        return {
            overlay: {
                segment_id: input.recipe.segment_id,
                plugin_id: manifest.id,
                layerKind: 'overlay',
                params: mergeRecords(manifest.defaultParams, input.recipe.params),
                reason: `Overlay capability ${manifest.id} routed away from visual effect stack.`,
            },
            resolution: {
                capability_id: manifest.id,
                segment_ids: [input.recipe.segment_id],
                decision: 'reuse',
                target_layer: 'overlay',
                reason: 'Subtitle/watermark/badge capabilities belong to overlay, not visual effect.',
            },
        };
    }
    const preset = resolvePreset({ manifest, recipe: input.recipe });
    if (!preset) {
        return {
            resolution: missingDecision({
                capabilityId,
                segmentId: input.recipe.segment_id,
                reason: manifest
                    ? `Plugin ${manifest.id} has unknown fallbackPreset; preset=${input.recipe.preset ?? 'none'}.`
                    : `Unknown scene effect capability; preset=${input.recipe.preset ?? 'none'}, plugin_id=${input.recipe.plugin_id ?? input.recipe.effect_id ?? 'none'}.`,
            }),
        };
    }
    const resolvedManifest = manifest ??
        getRenderPluginManifest(pluginIdForPreset(preset)) ??
        resolvePluginManifest({ preset, layer: input.recipe.layer });
    const pluginId = resolvedManifest?.id ??
        input.recipe.plugin_id ??
        input.recipe.effect_id ??
        pluginIdForPreset(preset) ??
        legacyCompositePluginId(preset);
    if (!pluginId) {
        return {
            resolution: missingDecision({
                capabilityId,
                segmentId: input.recipe.segment_id,
                reason: `Known preset "${preset}" has no mapped plugin_id in capability registry.`,
            }),
        };
    }
    const layerKind = resolvedManifest?.layerKind ?? input.recipe.layer ?? 'composite';
    const manifestDefaults = resolvedManifest
        ? manifestParams({
            manifest: resolvedManifest,
            anchor: input.anchor,
            recipe: input.recipe,
            parentRecipe: input.parentRecipe,
            assets: input.assets,
        })
        : {};
    const usedFallback = !manifest || !isKnownEffectPreset(input.recipe.preset ?? '');
    return {
        effect: {
            segment_id: input.recipe.segment_id,
            preset,
            plugin_id: pluginId,
            layerKind,
            targetLayer: 'effect',
            phenomenon: input.recipe.phenomenon,
            evidence_refs: input.recipe.evidence_refs,
            confidence: input.recipe.confidence,
            params: mergeRecords(manifestDefaults, input.recipe.params),
            reason: resolvedManifest
                ? `Compiled via capability registry plugin ${resolvedManifest.id}.`
                : `Compiled legacy preset ${preset} via registry fallback mapping.`,
            resolution: usedFallback ? 'fallback' : 'compiled',
        },
        ...(usedFallback
            ? {
                resolution: {
                    capability_id: capabilityId,
                    segment_ids: [input.recipe.segment_id],
                    decision: 'fallback',
                    preset,
                    fallback_preset: preset,
                    reason: resolvedManifest
                        ? `Resolved ${capabilityId} to plugin ${pluginId} (${preset}).`
                        : `Resolved unknown capability to registered preset ${preset}.`,
                },
            }
            : {}),
    };
}
export function compileSceneEffectRecipesForAnchor(input) {
    const effects = [];
    const overlays = [];
    const resolutions = [];
    for (const recipe of input.recipes.filter((item) => item.segment_id === input.anchor.anchor_id)) {
        const outcome = compileSceneEffectRecipe({
            recipe,
            anchor: input.anchor,
            parentRecipe: input.parentRecipe,
            assets: input.assets,
        });
        if (outcome.effect)
            effects.push(outcome.effect);
        if (outcome.overlay)
            overlays.push(outcome.overlay);
        if (outcome.resolution)
            resolutions.push(outcome.resolution);
    }
    return { effects, overlays, resolutions };
}
export function shouldAddAudioReactiveFallback(input) {
    return Boolean(input.forceAudioReactive && !input.hasAudioDriverLayer && !input.hasAudioTimingInSegment);
}
//# sourceMappingURL=render-recipe-compiler.js.map