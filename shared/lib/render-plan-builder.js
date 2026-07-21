import { buildRenderCanvas } from './render-canvas.js';
import { createDefaultEffect, isKnownEffectPreset } from './effect-registry.js';
import { compileSceneEffectRecipesForAnchor, shouldAddAudioReactiveFallback, } from './render-recipe-compiler.js';
import { getRenderPluginManifest, } from './render-plugin-manifest.js';
import { splitEffectLayer } from './legacy-preset-split.js';
import { detailPrimitiveEffectForAnchor, normalizePrimitiveEffectForAnchor, } from './primitive-effect-detail.js';
function mapAssetType(materialType) {
    if (materialType === 'VIDEO')
        return 'video';
    if (materialType === 'AUDIO')
        return 'audio';
    return 'image';
}
function directorGroundingRecord(structure) {
    const grounding = structure.director_grounding;
    return isRecord(grounding) && grounding.schema_version === 'director_grounding.v1'
        ? grounding
        : null;
}
function readGroundingShotEvents(structure) {
    const grounding = directorGroundingRecord(structure);
    const shots = grounding?.shot_events;
    if (!Array.isArray(shots))
        return [];
    return shots
        .filter((shot) => {
        if (!isRecord(shot))
            return false;
        return (typeof shot.id === 'string' &&
            typeof shot.start_sec === 'number' &&
            typeof shot.end_sec === 'number' &&
            shot.end_sec > shot.start_sec);
    })
        .slice()
        .sort((a, b) => a.start_sec - b.start_sec);
}
function readGroundingTransitionObservations(structure) {
    const grounding = directorGroundingRecord(structure);
    const transitions = grounding?.transition_observations;
    if (!Array.isArray(transitions))
        return [];
    return transitions
        .filter((transition) => {
        if (!isRecord(transition))
            return false;
        return (typeof transition.id === 'string' &&
            typeof transition.at_sec === 'number' &&
            typeof transition.type === 'string');
    })
        .slice()
        .sort((a, b) => a.at_sec - b.at_sec);
}
function findParentAnchorForShot(shot, anchors) {
    if (shot.linked_temporal_event_id) {
        const linked = anchors.find((anchor) => anchor.anchor_id === shot.linked_temporal_event_id);
        if (linked)
            return linked;
    }
    const midpoint = (shot.start_sec + shot.end_sec) / 2;
    return (anchors.find((anchor) => midpoint >= anchor.start_sec && midpoint <= anchor.end_sec) ??
        anchors.find((anchor) => shot.start_sec < anchor.end_sec && shot.end_sec > anchor.start_sec) ??
        anchors[0]);
}
function clampShotTime(value, duration) {
    if (!Number.isFinite(value))
        return 0;
    return Number(Math.min(Math.max(value, 0), duration).toFixed(3));
}
function buildPlanningAnchors(input) {
    const baseAnchors = input.structure.semantic_anchors;
    const visualMaterialCount = input.materials.filter((material) => material.material_type !== 'AUDIO').length;
    const shots = readGroundingShotEvents(input.structure);
    if (shots.length <= baseAnchors.length || visualMaterialCount <= 1) {
        return { anchors: baseAnchors, usingShotEvents: false };
    }
    const duration = input.structure.metadata.duration_sec;
    const shotAnchors = shots.slice(0, 24).flatMap((shot, index) => {
        const parent = findParentAnchorForShot(shot, baseAnchors);
        if (!parent)
            return [];
        const start = clampShotTime(shot.start_sec, duration);
        const end = clampShotTime(Math.max(shot.end_sec, start + 0.1), duration);
        if (end <= start)
            return [];
        const durationSec = Number((end - start).toFixed(3));
        return [
            {
                ...parent,
                anchor_id: shot.id || `shot_${String(index + 1).padStart(3, '0')}`,
                start_sec: start,
                end_sec: end,
                sequence: {
                    from_sec: start,
                    duration_sec: durationSec,
                    layout: parent.sequence?.layout ?? 'fill',
                    premount_sec: parent.sequence?.premount_sec ?? 0.2,
                },
                match: {
                    status: 'pending',
                    asset_name: null,
                },
                replication_instructions: {
                    ...parent.replication_instructions,
                    visual_generation_prompt: shot.visual_summary || parent.replication_instructions.visual_generation_prompt,
                    visual_motion: {
                        preset: parent.replication_instructions.visual_motion?.preset ??
                            (shot.camera_motion?.toLowerCase().includes('pan') ? 'pan' : 'static'),
                        intensity: shot.visual_change_intensity ??
                            parent.replication_instructions.visual_motion?.intensity ??
                            0.35,
                        easing: parent.replication_instructions.visual_motion?.easing,
                        driver: 'useCurrentFrame',
                    },
                },
                source_anchor_id: parent.anchor_id,
                shot_event_id: shot.id,
            },
        ];
    });
    return shotAnchors.length > baseAnchors.length
        ? { anchors: shotAnchors, usingShotEvents: true }
        : { anchors: baseAnchors, usingShotEvents: false };
}
function findTransitionObservationForBoundary(input) {
    const byShotId = input.observations.find((observation) => observation.from_shot_id === input.fromAnchor.shot_event_id &&
        observation.to_shot_id === input.toAnchor.shot_event_id);
    if (byShotId)
        return byShotId;
    return input.observations
        .slice()
        .sort((a, b) => Math.abs(a.at_sec - input.fromAnchor.end_sec) -
        Math.abs(b.at_sec - input.fromAnchor.end_sec))[0];
}
function mapObservedTransition(input) {
    const observedType = input.observation?.type.toLowerCase() ?? 'cut';
    const isFade = observedType.includes('fade') || observedType.includes('dissolve');
    const isSlide = observedType.includes('slide');
    const isWipe = observedType.includes('wipe') || observedType.includes('mask');
    const isFlash = observedType.includes('flash');
    const durationSec = input.observation?.duration_sec && input.observation.duration_sec > 0
        ? Math.min(input.observation.duration_sec, 0.8)
        : isFade || isSlide || isWipe
            ? 0.28
            : 0;
    return {
        id: `tr_${String(input.index + 1).padStart(3, '0')}`,
        from_anchor_id: input.fromAnchor.anchor_id,
        to_anchor_id: input.toAnchor.anchor_id,
        at_sec: input.fromAnchor.end_sec,
        presentation: isFade ? 'fade' : isSlide ? 'slide' : isWipe ? 'wipe' : 'cut',
        duration_sec: Number(durationSec.toFixed(3)),
        timing: { type: 'linear' },
        ...(isSlide || isWipe ? { direction: 'from-right' } : {}),
        overlay: isFlash
            ? {
                type: 'flash',
                duration_sec: Math.max(0.08, durationSec || 0.16),
                intensity: 0.55,
            }
            : { type: 'none' },
        reason: input.observation?.visual_mechanism ||
            input.observation?.sync ||
            `Observed transition style: ${observedType}`,
    };
}
function buildTransitionsForPlanningAnchors(input) {
    if (!input.usingShotEvents)
        return input.structure.transitions ?? [];
    const observations = readGroundingTransitionObservations(input.structure);
    return input.anchors.slice(0, -1).map((anchor, index) => {
        const next = input.anchors[index + 1];
        return mapObservedTransition({
            observation: findTransitionObservationForBoundary({
                observations,
                fromAnchor: anchor,
                toAnchor: next,
            }),
            fromAnchor: anchor,
            toAnchor: next,
            index,
        });
    });
}
function isLandscapeMontageStyle(structure) {
    const recipeText = [
        structure?.render_recipe?.style_family,
        ...(structure?.render_recipe?.global_effects ?? []),
        ...((structure?.semantic_anchors ?? []).flatMap((anchor) => [
            anchor.logic_intent.marketing_role,
            anchor.logic_intent.emotion_vibe,
            anchor.replication_instructions.visual_generation_prompt,
        ])),
    ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
    return [
        'landscape',
        'travel',
        'montage',
        'aerial',
        'scenery',
        'cinematic',
        '风景',
        '旅行',
        '混剪',
        '航拍',
        '山',
        '湖',
    ].some((keyword) => recipeText.includes(keyword));
}
function inferStrategy(materials, structure) {
    const videoCount = materials.filter((m) => m.material_type === 'VIDEO').length;
    const imageCount = materials.filter((m) => m.material_type === 'IMAGE').length;
    if (isLandscapeMontageStyle(structure) && videoCount + imageCount >= 2) {
        return 'montage';
    }
    if (videoCount >= 3)
        return 'montage';
    if (imageCount >= 4)
        return 'montage';
    if (videoCount > 0 && imageCount > 0)
        return 'hybrid';
    return 'motion_graphics';
}
function roleKeywords(role) {
    const normalized = role.toLowerCase();
    if (normalized.includes('hook')) {
        return ['hook', 'face', 'talking_head', 'close_up', 'product'];
    }
    if (normalized.includes('demo') || normalized.includes('product')) {
        return ['demo', 'product', 'close_up', 'screen_recording'];
    }
    if (normalized.includes('pain')) {
        return ['face', 'lifestyle', 'empty_scene', 'urgent'];
    }
    if (normalized.includes('proof')) {
        return ['trustworthy', 'product', 'screen_recording'];
    }
    if (normalized.includes('cta')) {
        return ['cta', 'product', 'logo', 'brand'];
    }
    return ['broll', 'lifestyle', 'product'];
}
function segmentMatchScore(segment, role) {
    const keywords = roleKeywords(role);
    const segmentTags = new Set([
        ...segment.tags.map((tag) => tag.toLowerCase()),
        ...(segment.emotion_tags ?? []).map((tag) => tag.toLowerCase()),
        segment.shot_type?.toLowerCase(),
        segment.motion?.toLowerCase(),
    ]);
    const keywordHits = keywords.filter((keyword) => segmentTags.has(keyword)).length;
    return segment.score + keywordHits * 0.13;
}
function selectMaterialSegment(input) {
    const { anchor, materials, reservedMaterialIds, anchorIndex = 0, forceSequentialFallback = false, } = input;
    const visualMaterials = materials.filter((m) => m.material_type !== 'AUDIO');
    const exact = visualMaterials.find((m) => m.id === anchor.match.asset_id);
    if (exact) {
        const segment = exact.asset_analysis?.segments
            ?.slice()
            .sort((a, b) => segmentMatchScore(b, anchor.logic_intent.marketing_role) -
            segmentMatchScore(a, anchor.logic_intent.marketing_role))[0];
        return { material: exact, segment };
    }
    const candidates = visualMaterials
        .filter((material) => !reservedMaterialIds?.has(material.id))
        .flatMap((material) => (material.asset_analysis?.segments ?? []).map((segment) => ({
        material,
        segment,
        score: segmentMatchScore(segment, anchor.logic_intent.marketing_role),
    })));
    const best = candidates.sort((a, b) => b.score - a.score)[0];
    if (best && best.score >= 0.66 && !forceSequentialFallback) {
        return { material: best.material, segment: best.segment };
    }
    const fallbackPool = visualMaterials.filter((material) => !reservedMaterialIds?.has(material.id)) ??
        visualMaterials;
    const fallback = (fallbackPool.length ? fallbackPool : visualMaterials)[anchorIndex % Math.max(1, (fallbackPool.length ? fallbackPool : visualMaterials).length)];
    if (fallback && (forceSequentialFallback || visualMaterials.length > 0)) {
        const segment = fallback.asset_analysis?.segments
            ?.slice()
            .sort((a, b) => segmentMatchScore(b, anchor.logic_intent.marketing_role) -
            segmentMatchScore(a, anchor.logic_intent.marketing_role))[0];
        return { material: fallback, segment };
    }
    if (!best)
        return null;
    return { material: best.material, segment: best.segment };
}
function buildVisualLayer(anchor, strategy, materials, reservedMaterialIds, anchorIndex, forceMaterialMontage) {
    const selection = selectMaterialSegment({
        anchor,
        materials,
        reservedMaterialIds,
        anchorIndex,
        forceSequentialFallback: forceMaterialMontage,
    });
    const hasMaterial = Boolean(selection);
    const mode = hasMaterial
        ? 'material_clip'
        : strategy === 'motion_graphics'
            ? 'image_motion'
            : 'ai_generated';
    return {
        mode,
        asset_id: selection?.material.id,
        material_source: hasMaterial ? 'user_material' : undefined,
        trim: selection?.segment
            ? {
                start_sec: selection.segment.start_sec,
                end_sec: selection.segment.end_sec,
            }
            : undefined,
        fit: 'cover',
        motion: {
            preset: anchor.replication_instructions.visual_motion?.preset ??
                (selection?.segment?.motion === 'shake'
                    ? 'shake'
                    : anchor.logic_intent.marketing_role === 'hook'
                        ? 'zoom_in'
                        : 'static'),
            intensity: anchor.replication_instructions.visual_motion?.intensity ??
                (anchor.logic_intent.marketing_role === 'hook' ? 0.8 : 0.3),
            easing: anchor.replication_instructions.visual_motion?.easing,
            driver: anchor.replication_instructions.visual_motion?.driver ??
                'useCurrentFrame',
        },
        visual_prompt: anchor.replication_instructions.visual_generation_prompt ||
            `鐢熸垚 ${anchor.logic_intent.marketing_role} 鐢婚潰娈佃惤`,
    };
}
const COLOR_HINT_PALETTE = [
    {
        token: 'red',
        label: '红',
        color: '#ef4444',
        aliases: ['red', 'sunset', 'rose', 'crimson', '红', '赤', '晚霞', '日落'],
    },
    {
        token: 'green',
        label: '绿',
        color: '#22c55e',
        aliases: ['green', 'forest', 'grass', 'meadow', 'emerald', '绿', '森林', '草地'],
    },
    {
        token: 'blue',
        label: '蓝',
        color: '#38bdf8',
        aliases: ['blue', 'sky', 'sea', 'lake', 'ocean', 'cyan', '蓝', '海', '湖', '天空'],
    },
    {
        token: 'yellow',
        label: '黄',
        color: '#facc15',
        aliases: ['yellow', 'gold', 'warm', 'amber', '黄', '金', '暖'],
    },
    {
        token: 'white',
        label: '白',
        color: '#e5e7eb',
        aliases: ['white', 'snow', 'ice', '白', '雪', '冰'],
    },
];
function firstStringParam(params, keys) {
    for (const key of keys) {
        const value = params[key];
        if (typeof value === 'string' && value.trim())
            return value.trim();
    }
    return undefined;
}
function resolvePaletteEntry(input) {
    const explicitToken = firstStringParam(input.params, ['color_token', 'color_name', 'hue']);
    if (explicitToken) {
        const normalized = explicitToken.toLowerCase();
        const explicitMatch = COLOR_HINT_PALETTE.find((item) => item.token === normalized || item.aliases.includes(normalized));
        if (explicitMatch)
            return explicitMatch;
    }
    return COLOR_HINT_PALETTE.find((item) => item.aliases.some((alias) => input.evidenceText.includes(alias)));
}
function resolveColorHintCue(anchor, params) {
    const explicitColor = firstStringParam(params, ['square_color', 'color']);
    const explicitLabel = firstStringParam(params, ['label', 'text_content', 'text']);
    const text = [
        explicitLabel,
        anchor.logic_intent.marketing_role,
        anchor.logic_intent.emotion_vibe,
        anchor.replication_instructions.visual_generation_prompt,
        anchor.replication_instructions.overlay_rewrite_instruction,
    ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
    const palette = resolvePaletteEntry({ params, evidenceText: text });
    return {
        label: explicitLabel ?? palette?.label ?? '色',
        color: explicitColor ?? palette?.color ?? '#22d3ee',
    };
}
function buildOverlayFromCapabilityRecipe(anchor, recipe) {
    const manifest = getRenderPluginManifest(recipe.plugin_id);
    const defaults = manifest?.defaultParams ?? {};
    const params = {
        ...defaults,
        ...(recipe.params ?? {}),
    };
    const text = typeof params.text_content === 'string'
        ? params.text_content
        : typeof params.text === 'string'
            ? params.text
            : anchor.replication_instructions.overlay_rewrite_instruction?.trim() || recipe.plugin_id;
    const position = params.position === 'center' ||
        params.position === 'top' ||
        params.position === 'bottom' ||
        params.position === 'left' ||
        params.position === 'right'
        ? params.position
        : 'bottom';
    const fontWeight = params.font_weight === 'black' || params.font_weight === 'bold' || params.font_weight === 'regular'
        ? params.font_weight
        : 'regular';
    const animationIn = params.animation_in === 'pop' ||
        params.animation_in === 'slide_up' ||
        params.animation_in === 'bounce' ||
        params.animation_in === 'fade_in'
        ? params.animation_in
        : 'fade_in';
    const emphasis = params.emphasis === 'shake' || params.emphasis === 'flash' || params.emphasis === 'scale_pulse'
        ? params.emphasis
        : undefined;
    const isColorHint = recipe.plugin_id.includes('color_hint');
    const colorHintCue = isColorHint ? resolveColorHintCue(anchor, params) : null;
    const hintDuration = Math.max(0.28, Math.min(0.95, (anchor.end_sec - anchor.start_sec) * 0.36));
    return {
        id: `overlay_${anchor.anchor_id}_${recipe.plugin_id}`,
        type: isColorHint
            ? 'sticker'
            : recipe.plugin_id.includes('title') || position === 'center'
                ? 'big_caption'
                : recipe.plugin_id.includes('watermark') || recipe.plugin_id.includes('signature')
                    ? 'sticker'
                    : 'subtitle',
        start_sec: anchor.start_sec,
        end_sec: isColorHint ? Number((anchor.start_sec + hintDuration).toFixed(3)) : anchor.end_sec,
        text: colorHintCue?.label ?? text,
        layout: {
            position: isColorHint ? 'center' : position,
            align: 'center',
            max_width_pct: typeof params.max_width_pct === 'number' ? params.max_width_pct : isColorHint ? 28 : 92,
        },
        style: {
            font_size: typeof params.font_size === 'number' ? params.font_size : isColorHint ? 42 : 24,
            font_weight: isColorHint ? 'black' : fontWeight,
            font_family: typeof params.font_family === 'string' ? params.font_family : undefined,
            letter_spacing_px: typeof params.letter_spacing_px === 'number' ? params.letter_spacing_px : undefined,
            color: typeof params.color === 'string' ? params.color : '#ffffff',
            background: typeof params.background === 'string' ? params.background : undefined,
            border_radius_px: typeof params.border_radius_px === 'number' ? params.border_radius_px : undefined,
            backdrop_blur_px: typeof params.backdrop_blur_px === 'number' ? params.backdrop_blur_px : undefined,
            stroke: typeof params.stroke === 'string' ? params.stroke : '#111111',
            shadow: typeof params.shadow === 'boolean' ? params.shadow : isColorHint,
            opacity: typeof params.opacity === 'number' ? params.opacity : isColorHint ? 1 : 0.72,
            ...(colorHintCue
                ? {
                    color_label: {
                        square_color: colorHintCue.color,
                        square_size_px: typeof params.square_size_px === 'number' ? params.square_size_px : 64,
                        gap_px: typeof params.gap_px === 'number' ? params.gap_px : 10,
                    },
                }
                : {}),
        },
        animation: {
            in: animationIn,
            out: 'fade_out',
            emphasis,
        },
    };
}
function buildOverlayLayer(anchor, overlayRecipes = []) {
    const capabilityOverlay = overlayRecipes[0];
    if (capabilityOverlay) {
        return buildOverlayFromCapabilityRecipe(anchor, capabilityOverlay);
    }
    const text = anchor.replication_instructions.overlay_rewrite_instruction?.trim();
    if (!text)
        return null;
    const isHook = anchor.logic_intent.marketing_role === 'hook';
    return {
        id: `overlay_${anchor.anchor_id}`,
        type: isHook ? 'big_caption' : 'subtitle',
        start_sec: anchor.start_sec,
        end_sec: anchor.end_sec,
        text,
        layout: {
            position: isHook ? 'center' : 'bottom',
            align: 'center',
            max_width_pct: isHook ? 86 : 92,
        },
        style: {
            font_size: isHook ? 72 : 38,
            font_weight: isHook ? 'black' : 'bold',
            color: '#ffffff',
            background: isHook ? '#ef4444' : undefined,
            stroke: '#111111',
            shadow: true,
        },
        animation: {
            in: isHook ? 'pop' : 'fade_in',
            out: 'fade_out',
            emphasis: isHook ? 'scale_pulse' : undefined,
        },
    };
}
function buildSfxAudioLayer(anchor) {
    const isHook = anchor.logic_intent.marketing_role === 'hook';
    const isCta = anchor.logic_intent.marketing_role === 'cta';
    return {
        id: `audio_${anchor.anchor_id}`,
        type: 'sfx',
        start_sec: anchor.start_sec,
        end_sec: Math.min(anchor.start_sec + 1, anchor.end_sec),
        emotion_vibe: anchor.logic_intent.emotion_vibe,
        sfx_type: isHook ? 'hit' : isCta ? 'ding' : 'whoosh',
        volume: isHook ? 0.9 : 0.55,
        ducking: false,
        sync_target: {
            overlay_id: `overlay_${anchor.anchor_id}`,
            visual_cut: true,
            offset_sec: 0,
        },
    };
}
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function mergeRecords(base, patch) {
    if (!patch)
        return base;
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
function createEffectFromRecipe(preset, params) {
    if (!preset || !isKnownEffectPreset(preset))
        return undefined;
    const base = createDefaultEffect(preset);
    if (!base)
        return undefined;
    try {
        return mergeRecords(base, params);
    }
    catch {
        return undefined;
    }
}
const BEAT_CUT_DRIVER_ENABLED = false;
const BEAT_CUT_DRIVER_PRESETS = new Set([
    'primitive_beat_pulse',
    'primitive_beat_flash_overlay',
]);
function isBeatCutDriverRecipe(input) {
    return (input.plugin_id === 'beat_cut_driver' ||
        Boolean(input.preset && BEAT_CUT_DRIVER_PRESETS.has(input.preset)) ||
        input.layerKind === 'audio_driver');
}
function getEnabledBeatCutDriverManifest() {
    return BEAT_CUT_DRIVER_ENABLED
        ? getRenderPluginManifest('beat_cut_driver')
        : undefined;
}
function buildBgmAudioLayer(anchor, audioAssetId) {
    return {
        id: `bgm_${anchor.anchor_id}`,
        type: 'bgm',
        start_sec: anchor.start_sec,
        end_sec: anchor.end_sec,
        asset_id: audioAssetId,
        emotion_vibe: anchor.logic_intent.emotion_vibe ?? 'cinematic',
        sfx_type: 'none',
        volume: 1,
        ducking: false,
        sync_target: {
            visual_cut: true,
            offset_sec: 0,
        },
    };
}
function buildAudioLayers(anchor, audioAssetId) {
    if (audioAssetId)
        return [buildBgmAudioLayer(anchor, audioAssetId)];
    return [buildSfxAudioLayer(anchor)];
}
function primaryEffectPriority(layerKind) {
    const scores = {
        composite: 100,
        motion_driver: 92,
        mask_reveal: 86,
        distortion: 82,
        layout: 76,
        color_transform: 42,
        texture_grade: 30,
        color_grade: 30,
        audio_driver: 24,
        overlay: 0,
    };
    return scores[layerKind] ?? 0;
}
function appendBeatPrimitiveLayers(layers, input) {
    const pulse = detailPrimitiveEffectForAnchor({
        effect: normalizePrimitiveEffectForAnchor(createEffectFromRecipe('primitive_beat_pulse', input.beatParams), input.anchor),
        anchor: input.anchor,
        recipe: input.recipe,
    });
    if (!pulse)
        return;
    layers.push({
        id: `effect_${input.anchor.anchor_id}_${input.idSuffix}_pulse`,
        layerKind: input.beatPlugin.layerKind,
        kind: input.beatPlugin.layerKind,
        plugin_id: input.beatPlugin.id,
        preset: pulse.preset,
        effects: pulse,
        source: input.source,
        is_primary: false,
        resolution: input.resolution,
        reason: `${input.reason} Beat pulse transform layer.`,
    });
    const flash = createEffectFromRecipe('primitive_beat_flash_overlay', {
        strong_beats: input.beatParams.strong_beats,
        energy_peaks: input.beatParams.energy_peaks,
    });
    if (flash?.preset === 'primitive_beat_flash_overlay') {
        layers.push({
            id: `effect_${input.anchor.anchor_id}_${input.idSuffix}_flash`,
            layerKind: input.beatPlugin.layerKind,
            kind: input.beatPlugin.layerKind,
            plugin_id: input.beatPlugin.id,
            preset: flash.preset,
            effects: flash,
            source: input.source,
            is_primary: false,
            resolution: input.resolution,
            reason: `${input.reason} Beat flash overlay layer.`,
        });
    }
}
const GLOBAL_TEXTURE_PRIMITIVES = [
    'primitive_texture_grade',
    'primitive_vignette_overlay',
    'primitive_grain_overlay',
    'primitive_letterbox_overlay',
    'primitive_bloom_overlay',
    'primitive_chromatic_aberration_overlay',
    'primitive_light_sweep_overlay',
];
function expandGlobalEffectPresets(globalEffects) {
    const presets = globalEffects ?? [];
    if (presets.includes('cinematic_grade_pack')) {
        return [
            'primitive_texture_grade',
            'primitive_bloom_overlay',
            'primitive_vignette_overlay',
            'primitive_grain_overlay',
            'primitive_letterbox_overlay',
        ];
    }
    return presets.filter((preset) => GLOBAL_TEXTURE_PRIMITIVES.includes(preset));
}
function appendGlobalPrimitiveLayers(layers, input) {
    const plugin = getRenderPluginManifest('cinematic_texture_grade');
    if (!plugin)
        return;
    const existingPresets = new Set(layers.map((layer) => layer.preset));
    const globalPresets = expandGlobalEffectPresets(input.recipe?.global_effects)
        .filter((preset) => !existingPresets.has(preset));
    for (const preset of globalPresets) {
        const effect = detailPrimitiveEffectForAnchor({
            effect: normalizePrimitiveEffectForAnchor(createEffectFromRecipe(preset, undefined), input.anchor),
            anchor: input.anchor,
            recipe: input.recipe,
        });
        if (!effect)
            continue;
        layers.push({
            id: `effect_${input.anchor.anchor_id}_global_${preset}`,
            layerKind: plugin.layerKind,
            kind: plugin.layerKind,
            plugin_id: plugin.id,
            preset: effect.preset,
            effects: effect,
            source: 'global_effect',
            is_primary: false,
            resolution: 'compiled',
            reason: `Global primitive effect ${preset}.`,
        });
    }
}
function buildEffectLayers(input) {
    const recipe = input.structure.render_recipe;
    const layers = [];
    const recipeAnchor = input.anchor.source_anchor_id
        ? {
            ...input.anchor,
            anchor_id: input.anchor.source_anchor_id,
        }
        : input.anchor;
    const compiled = compileSceneEffectRecipesForAnchor({
        recipes: recipe?.scene_effects ?? [],
        anchor: recipeAnchor,
        parentRecipe: recipe,
        assets: input.assets,
    });
    input.resolutions.push(...compiled.resolutions);
    compiled.effects.forEach((sceneRecipe, index) => {
        if (!BEAT_CUT_DRIVER_ENABLED && isBeatCutDriverRecipe(sceneRecipe))
            return;
        const effect = detailPrimitiveEffectForAnchor({
            effect: normalizePrimitiveEffectForAnchor(createEffectFromRecipe(sceneRecipe.preset, sceneRecipe.params), input.anchor),
            anchor: input.anchor,
            recipe,
        });
        if (!effect)
            return;
        const baseLayer = {
            id: `effect_${input.anchor.anchor_id}_${index + 1}`,
            layerKind: sceneRecipe.layerKind,
            kind: sceneRecipe.layerKind,
            plugin_id: sceneRecipe.plugin_id,
            preset: effect.preset,
            effects: effect,
            source: 'scene_recipe',
            is_primary: false,
            resolution: sceneRecipe.resolution,
            reason: `Matched render_recipe.scene_effects[${index}] via ${sceneRecipe.plugin_id}. ${sceneRecipe.reason}`,
        };
        layers.push(...splitEffectLayer(baseLayer));
    });
    appendGlobalPrimitiveLayers(layers, { anchor: input.anchor, recipe });
    const audioDriver = recipe?.audio_driver;
    let hasAudioDriverLayer = false;
    let hasBeatInSegment = false;
    if (audioDriver) {
        hasBeatInSegment = [
            ...(audioDriver.strong_beats ?? []),
            ...audioDriver.beat_times,
            ...(audioDriver.energy_peaks ?? []).map((peak) => peak.time),
        ].some((time) => time >= input.anchor.start_sec && time <= input.anchor.end_sec);
        if (hasBeatInSegment) {
            const beatPlugin = getEnabledBeatCutDriverManifest();
            if (beatPlugin) {
                appendBeatPrimitiveLayers(layers, {
                    anchor: input.anchor,
                    recipe,
                    beatPlugin,
                    idSuffix: 'audio_driver',
                    source: 'audio_driver',
                    reason: 'Audio beat/energy evidence exists inside this segment.',
                    resolution: 'compiled',
                    beatParams: {
                        beat_times: audioDriver.beat_times
                            .filter((time) => time >= input.anchor.start_sec && time < input.anchor.end_sec)
                            .map((time) => time - input.anchor.start_sec),
                        strong_beats: (audioDriver.strong_beats ?? [])
                            .filter((time) => time >= input.anchor.start_sec && time < input.anchor.end_sec)
                            .map((time) => time - input.anchor.start_sec),
                        energy_peaks: (audioDriver.energy_peaks ?? [])
                            .filter((peak) => peak.time >= input.anchor.start_sec && peak.time < input.anchor.end_sec)
                            .map((peak) => ({
                            ...peak,
                            time: peak.time - input.anchor.start_sec,
                        })),
                        waveform: (audioDriver.waveform ?? [])
                            .filter((sample) => sample.time >= input.anchor.start_sec && sample.time < input.anchor.end_sec)
                            .map((sample) => ({
                            ...sample,
                            time: sample.time - input.anchor.start_sec,
                        })),
                    },
                });
                hasAudioDriverLayer = layers.some((layer) => layer.preset === 'primitive_beat_pulse');
            }
        }
        if (shouldAddAudioReactiveFallback({
            forceAudioReactive: input.forceAudioReactive,
            hasAudioDriverLayer,
            hasAudioTimingInSegment: hasBeatInSegment,
        })) {
            const beatPlugin = getEnabledBeatCutDriverManifest();
            if (beatPlugin) {
                appendBeatPrimitiveLayers(layers, {
                    anchor: input.anchor,
                    recipe,
                    beatPlugin,
                    idSuffix: 'audio_fallback',
                    source: 'audio_driver',
                    reason: 'Montage strategy requested an audio-reactive fallback driver.',
                    resolution: 'fallback',
                    beatParams: {
                        beat_times: [0],
                        strong_beats: [0],
                        energy_peaks: [],
                    },
                });
                input.resolutions.push({
                    capability_id: 'beat_cut_driver',
                    segment_ids: [input.anchor.anchor_id],
                    decision: 'fallback',
                    preset: 'primitive_beat_pulse',
                    fallback_preset: 'primitive_beat_pulse',
                    reason: 'Injected beat driver fallback for montage segment without explicit recipe.',
                });
            }
        }
    }
    else if (shouldAddAudioReactiveFallback({
        forceAudioReactive: input.forceAudioReactive,
        hasAudioDriverLayer: false,
        hasAudioTimingInSegment: false,
    })) {
        const beatPlugin = getEnabledBeatCutDriverManifest();
        if (beatPlugin) {
            appendBeatPrimitiveLayers(layers, {
                anchor: input.anchor,
                recipe,
                beatPlugin,
                idSuffix: 'audio_fallback',
                source: 'audio_driver',
                reason: 'Montage strategy requested an audio-reactive fallback driver.',
                resolution: 'fallback',
                beatParams: {
                    beat_times: [0],
                    strong_beats: [0],
                    energy_peaks: [],
                },
            });
        }
    }
    if (!layers.length)
        return { layers: [], overlays: compiled.overlays };
    const primaryIndex = layers
        .map((layer, index) => ({ index, score: primaryEffectPriority(layer.layerKind) }))
        .sort((a, b) => b.score - a.score)[0]?.index ?? 0;
    return {
        overlays: compiled.overlays,
        layers: layers.map((layer, index) => ({
            ...layer,
            is_primary: index === primaryIndex,
            reason: index === primaryIndex
                ? `${layer.reason ?? ''} Selected as executable primary effect for current Remotion compatibility.`.trim()
                : layer.reason,
        })),
    };
}
function selectBackingAudioAsset(input) {
    const userAudio = input.assets.find((asset) => asset.type === 'audio');
    if (userAudio)
        return userAudio.id;
    if (input.sampleReference?.use_audio && input.sampleReference.url)
        return 'sample_reference_audio';
    return undefined;
}
function buildSampleReferenceAudioAsset(sampleReference) {
    if (!sampleReference?.use_audio || !sampleReference.url)
        return undefined;
    return {
        id: 'sample_reference_audio',
        type: 'audio',
        name: sampleReference.name ?? sampleReference.id ?? 'sample reference audio',
        url: sampleReference.url,
        duration_sec: sampleReference.duration_sec,
        source: 'system',
    };
}
export function buildRenderPlanFromStructure(input) {
    const { taskId, structure, materials } = input;
    const strategy = inferStrategy(materials, structure);
    const forceMaterialMontage = strategy === 'montage' && materials.some((m) => m.material_type !== 'AUDIO');
    const duration = structure.metadata.duration_sec;
    const assets = materials.map((m) => ({
        id: m.id,
        type: mapAssetType(m.material_type),
        name: m.label || m.id,
        url: m.oss_url,
        source: 'user_material',
    }));
    const sampleReferenceAudio = buildSampleReferenceAudioAsset(input.sampleReference);
    if (sampleReferenceAudio)
        assets.push(sampleReferenceAudio);
    const backingAudioAssetId = selectBackingAudioAsset({
        assets,
        sampleReference: input.sampleReference,
    });
    const materialIds = new Set(materials.map((m) => m.id));
    const reservedMaterialIds = new Set(structure.semantic_anchors
        .map((anchor) => anchor.match.asset_id)
        .filter((id) => Boolean(id && materialIds.has(id))));
    const planning = buildPlanningAnchors({ structure, materials });
    const visualReservedMaterialIds = planning.usingShotEvents
        ? new Set()
        : reservedMaterialIds;
    const componentResolutions = [];
    const scenes = planning.anchors.map((anchor, anchorIndex) => {
        const { layers: effectLayers, overlays: overlayRecipes } = buildEffectLayers({
            anchor,
            structure,
            assets,
            forceAudioReactive: strategy === 'montage',
            resolutions: componentResolutions,
        });
        const overlay = buildOverlayLayer(anchor, overlayRecipes);
        return {
            id: `scene_${anchor.anchor_id}`,
            source_anchor_id: anchor.source_anchor_id ?? anchor.anchor_id,
            name: anchor.logic_intent.marketing_role,
            start_sec: anchor.start_sec,
            end_sec: anchor.end_sec,
            sequence: anchor.sequence,
            role: anchor.logic_intent.marketing_role,
            intent: {
                marketing_role: anchor.logic_intent.marketing_role,
                emotion_vibe: anchor.logic_intent.emotion_vibe ?? 'warm',
                purpose: anchor.replication_instructions.overlay_rewrite_instruction ||
                    anchor.logic_intent.marketing_role,
            },
            visual: buildVisualLayer(anchor, strategy, materials, visualReservedMaterialIds, anchorIndex, forceMaterialMontage),
            effects: effectLayers.find((layer) => layer.is_primary)?.effects,
            effect_layers: effectLayers.length ? effectLayers : undefined,
            overlays: overlay ? [overlay] : [],
            audio: buildAudioLayers(anchor, backingAudioAssetId),
        };
    });
    return {
        version: '1.0',
        task_id: taskId,
        plan_revision: 1,
        updated_at: new Date().toISOString(),
        strategy,
        duration_sec: duration,
        canvas: buildRenderCanvas(input.aspectRatio),
        scenes,
        transitions: buildTransitionsForPlanningAnchors({
            structure,
            anchors: planning.anchors,
            usingShotEvents: planning.usingShotEvents,
        }),
        assets,
        ...(componentResolutions.length
            ? {
                component_resolution: {
                    enabled: true,
                    authoring_enabled: false,
                    decisions: componentResolutions,
                },
            }
            : {}),
    };
}
//# sourceMappingURL=render-plan-builder.js.map