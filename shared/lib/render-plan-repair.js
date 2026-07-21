import { createDefaultEffect, isKnownEffectPreset } from './effect-registry.js';
import { validateRenderPlanHard, } from './render-plan-validator.js';
const DEFAULT_MAX_ACTIONS = 64;
const EPSILON = 0.001;
const VISUAL_MODES_REQUIRING_ASSET = new Set(['material_clip', 'image_motion']);
function isFiniteNumber(value) {
    return typeof value === 'number' && Number.isFinite(value);
}
function isPositiveNumber(value) {
    return isFiniteNumber(value) && value > 0;
}
function isNonEmptyString(value) {
    return typeof value === 'string' && value.trim().length > 0;
}
function clonePlan(plan) {
    return structuredClone(plan);
}
function isPlaceholderUrl(url) {
    try {
        const parsed = new URL(url);
        const hostname = parsed.hostname.toLowerCase();
        return hostname === 'example.com' || hostname.endsWith('.example.com');
    }
    catch {
        return false;
    }
}
function isRenderableUrl(url) {
    if (!isNonEmptyString(url))
        return false;
    if (/^(blob:|data:|file:|https?:)/i.test(url))
        return true;
    return url.startsWith('/') || url.startsWith('./') || url.startsWith('../');
}
function isRenderableAsset(asset, phase, allowPlaceholderUrls) {
    if (!isNonEmptyString(asset.id) || !isRenderableUrl(asset.url))
        return false;
    if (phase === 'before_render' && !allowPlaceholderUrls && isPlaceholderUrl(asset.url)) {
        return false;
    }
    return true;
}
function recordRepair(actions, maxActions, input, apply) {
    if (actions.length >= maxActions)
        return false;
    apply();
    actions.push({
        id: `repair_${actions.length + 1}`,
        applied: true,
        ...input,
    });
    return true;
}
function solidVisual(existing) {
    return {
        mode: 'solid_bg',
        fit: existing?.fit ?? 'cover',
        visual_prompt: existing?.visual_prompt ??
            'Fallback solid background because no renderable material asset is available.',
        motion: existing?.motion,
    };
}
function modeForAsset(asset) {
    return asset.type === 'image' ? 'image_motion' : 'material_clip';
}
function materialSourceForAsset(asset) {
    return asset.source === 'system' ? undefined : asset.source;
}
function clampTimeRange(input) {
    const boundedMin = Math.max(0, input.min);
    const boundedMax = Math.max(boundedMin + EPSILON, input.max);
    let start = isFiniteNumber(input.start) ? input.start : boundedMin;
    let end = isFiniteNumber(input.end) ? input.end : start + input.fallbackDuration;
    start = Math.max(boundedMin, Math.min(start, boundedMax - EPSILON));
    end = Math.max(start + EPSILON, Math.min(end, boundedMax));
    if (end <= start + EPSILON) {
        start = Math.max(boundedMin, boundedMax - Math.max(input.fallbackDuration, 0.5));
        end = boundedMax;
    }
    return { start, end };
}
function isSceneObject(scene) {
    return Boolean(scene && typeof scene === 'object');
}
function normalizePlanShape(plan, actions, maxActions) {
    const mutable = plan;
    if (!Array.isArray(mutable.assets)) {
        recordRepair(actions, maxActions, {
            code: 'PLAN_SCHEMA_INVALID',
            path: 'assets',
            message: 'normalized missing assets list to an empty array',
        }, () => {
            mutable.assets = [];
        });
    }
    if (!Array.isArray(mutable.scenes)) {
        return;
    }
    const validScenes = mutable.scenes.filter(isSceneObject);
    if (validScenes.length !== mutable.scenes.length) {
        recordRepair(actions, maxActions, {
            code: 'PLAN_SCHEMA_INVALID',
            path: 'scenes',
            message: 'removed non-object scene entries',
        }, () => {
            mutable.scenes = validScenes;
        });
    }
    if (!isPositiveNumber(mutable.duration_sec)) {
        const derivedDuration = validScenes.reduce((max, scene) => {
            return isFiniteNumber(scene.end_sec) ? Math.max(max, scene.end_sec) : max;
        }, 0) || 1;
        recordRepair(actions, maxActions, {
            code: 'PLAN_SCHEMA_INVALID',
            path: 'duration_sec',
            message: `derived positive duration_sec ${derivedDuration}`,
        }, () => {
            mutable.duration_sec = derivedDuration;
        });
    }
}
function repairSceneTiming(plan, actions, maxActions) {
    if (!Array.isArray(plan.scenes) || !isPositiveNumber(plan.duration_sec))
        return;
    let cursor = 0;
    plan.scenes.forEach((scene, index) => {
        const originalStart = scene.start_sec;
        const originalEnd = scene.end_sec;
        const fallbackDuration = Math.max(0.5, isFiniteNumber(originalEnd) && isFiniteNumber(originalStart)
            ? originalEnd - originalStart
            : 1);
        const nextRange = clampTimeRange({
            start: originalStart,
            end: originalEnd,
            min: 0,
            max: plan.duration_sec,
            fallbackDuration,
        });
        cursor = Math.max(cursor, nextRange.end);
        if (!isFiniteNumber(originalStart) ||
            !isFiniteNumber(originalEnd) ||
            Math.abs(nextRange.start - originalStart) > EPSILON ||
            Math.abs(nextRange.end - originalEnd) > EPSILON) {
            recordRepair(actions, maxActions, {
                code: 'PLAN_SCHEMA_INVALID',
                path: `scenes[${index}]`,
                message: `clamped scene time range to ${nextRange.start}-${nextRange.end}`,
            }, () => {
                scene.start_sec = nextRange.start;
                scene.end_sec = nextRange.end;
            });
        }
    });
    if (cursor > plan.duration_sec + EPSILON) {
        recordRepair(actions, maxActions, {
            code: 'PLAN_SCHEMA_INVALID',
            path: 'duration_sec',
            message: `expanded duration_sec to cover scene timeline ${cursor}`,
        }, () => {
            plan.duration_sec = cursor;
        });
    }
}
function findVisualAsset(assets, index) {
    const visualAssets = assets.filter((asset) => asset.type !== 'audio');
    if (!visualAssets.length)
        return undefined;
    return visualAssets[index % visualAssets.length];
}
function repairVisualLayer(input) {
    const { scene, sceneIndex, validAssetsById, validAssets, actions, maxActions } = input;
    if (!scene.visual || typeof scene.visual !== 'object') {
        recordRepair(actions, maxActions, {
            code: 'PLAN_SCHEMA_INVALID',
            path: `scenes[${sceneIndex}].visual`,
            message: 'created solid visual layer for missing scene visual',
        }, () => {
            scene.visual = solidVisual();
        });
        return;
    }
    const visual = scene.visual;
    const modeRequiresAsset = VISUAL_MODES_REQUIRING_ASSET.has(visual.mode);
    const hasInvalidAssetRef = isNonEmptyString(visual.asset_id) && !validAssetsById.has(visual.asset_id);
    const needsAssetFallback = modeRequiresAsset && !validAssetsById.has(visual.asset_id ?? '');
    if (hasInvalidAssetRef || needsAssetFallback) {
        const replacement = findVisualAsset(validAssets, sceneIndex);
        if (replacement) {
            recordRepair(actions, maxActions, {
                code: 'RESOURCE_NOT_FOUND',
                path: `scenes[${sceneIndex}].visual.asset_id`,
                message: `rebound visual layer to renderable asset ${replacement.id}`,
            }, () => {
                scene.visual = {
                    ...visual,
                    mode: modeForAsset(replacement),
                    asset_id: replacement.id,
                    material_source: materialSourceForAsset(replacement),
                    fit: visual.fit ?? 'cover',
                    trim: replacement.type === 'video'
                        ? {
                            start_sec: 0,
                            end_sec: Math.max(0.5, scene.end_sec - scene.start_sec),
                        }
                        : undefined,
                };
            });
        }
        else {
            recordRepair(actions, maxActions, {
                code: 'RESOURCE_NOT_FOUND',
                path: `scenes[${sceneIndex}].visual`,
                message: 'downgraded visual layer to solid background',
            }, () => {
                scene.visual = solidVisual(visual);
            });
        }
        return;
    }
    if (visual.trim) {
        const originalStart = visual.trim.start_sec;
        const originalEnd = visual.trim.end_sec;
        const asset = isNonEmptyString(visual.asset_id)
            ? validAssetsById.get(visual.asset_id)
            : undefined;
        const max = isPositiveNumber(asset?.duration_sec)
            ? asset.duration_sec
            : Math.max(0.5, scene.end_sec - scene.start_sec);
        const nextRange = clampTimeRange({
            start: originalStart,
            end: originalEnd,
            min: 0,
            max,
            fallbackDuration: Math.max(0.5, scene.end_sec - scene.start_sec),
        });
        if (!isFiniteNumber(originalStart) ||
            !isFiniteNumber(originalEnd) ||
            Math.abs(nextRange.start - originalStart) > EPSILON ||
            Math.abs(nextRange.end - originalEnd) > EPSILON) {
            recordRepair(actions, maxActions, {
                code: 'PLAN_SCHEMA_INVALID',
                path: `scenes[${sceneIndex}].visual.trim`,
                message: `clamped visual trim to ${nextRange.start}-${nextRange.end}`,
            }, () => {
                visual.trim = {
                    start_sec: nextRange.start,
                    end_sec: nextRange.end,
                };
            });
        }
    }
}
function repairEffect(input) {
    const { effect, path, actions, maxActions, apply } = input;
    const preset = effect?.preset;
    if (!isNonEmptyString(preset)) {
        if (effect) {
            recordRepair(actions, maxActions, {
                code: 'PLAN_SCHEMA_INVALID',
                path,
                message: 'removed effect without preset',
            }, () => apply(undefined));
        }
        return;
    }
    if (preset === 'generated_component') {
        const componentId = effect.component_id;
        const fallbackPreset = effect.fallback_preset;
        if (isNonEmptyString(componentId))
            return;
        if (isNonEmptyString(fallbackPreset) && isKnownEffectPreset(fallbackPreset)) {
            const fallback = createDefaultEffect(fallbackPreset);
            if (fallback) {
                recordRepair(actions, maxActions, {
                    code: 'UNSUPPORTED_COMPONENT',
                    path,
                    message: `replaced generated_component with fallback preset ${fallbackPreset}`,
                }, () => apply(fallback));
            }
            return;
        }
        recordRepair(actions, maxActions, {
            code: 'UNSUPPORTED_COMPONENT',
            path,
            message: 'removed generated_component effect without component or fallback preset',
        }, () => apply(undefined));
        return;
    }
    if (!isKnownEffectPreset(preset)) {
        recordRepair(actions, maxActions, {
            code: 'UNSUPPORTED_COMPONENT',
            path,
            message: `removed unsupported effect preset ${preset}`,
        }, () => apply(undefined));
    }
}
function repairEffects(scene, sceneIndex, actions, maxActions) {
    repairEffect({
        effect: scene.effects,
        path: `scenes[${sceneIndex}].effects`,
        actions,
        maxActions,
        apply: (effect) => {
            scene.effects = effect;
        },
    });
    if (scene.effect_layers != null && !Array.isArray(scene.effect_layers)) {
        recordRepair(actions, maxActions, {
            code: 'PLAN_SCHEMA_INVALID',
            path: `scenes[${sceneIndex}].effect_layers`,
            message: 'reset invalid effect_layers value to an empty array',
        }, () => {
            scene.effect_layers = [];
        });
        return;
    }
    if (!Array.isArray(scene.effect_layers))
        return;
    const nextLayers = scene.effect_layers
        .map((layer, layerIndex) => {
        if (!layer || typeof layer !== 'object')
            return undefined;
        if (!isNonEmptyString(layer.plugin_id) || layer.resolution === 'missing') {
            return undefined;
        }
        let nextEffects = layer.effects;
        repairEffect({
            effect: nextEffects,
            path: `scenes[${sceneIndex}].effect_layers[${layerIndex}].effects`,
            actions,
            maxActions,
            apply: (effect) => {
                nextEffects = effect;
            },
        });
        if (!nextEffects)
            return undefined;
        const resolvedEffects = nextEffects;
        if (layer.preset !== resolvedEffects.preset) {
            recordRepair(actions, maxActions, {
                code: 'PLAN_SCHEMA_INVALID',
                path: `scenes[${sceneIndex}].effect_layers[${layerIndex}].preset`,
                message: `aligned effect layer preset to ${resolvedEffects.preset}`,
            }, () => {
                layer.preset = resolvedEffects.preset;
            });
        }
        return { ...layer, effects: resolvedEffects };
    })
        .filter((layer) => Boolean(layer));
    if (nextLayers.length !== scene.effect_layers.length) {
        recordRepair(actions, maxActions, {
            code: 'UNSUPPORTED_COMPONENT',
            path: `scenes[${sceneIndex}].effect_layers`,
            message: 'removed unresolved or unsupported effect layers',
        }, () => {
            scene.effect_layers = nextLayers;
        });
    }
}
function repairOverlays(scene, sceneIndex, actions, maxActions) {
    if (!Array.isArray(scene.overlays)) {
        recordRepair(actions, maxActions, {
            code: 'PLAN_SCHEMA_INVALID',
            path: `scenes[${sceneIndex}].overlays`,
            message: 'reset invalid overlays value to an empty array',
        }, () => {
            scene.overlays = [];
        });
        return;
    }
    scene.overlays.forEach((overlay, overlayIndex) => {
        const originalStart = overlay.start_sec;
        const originalEnd = overlay.end_sec;
        const nextRange = clampTimeRange({
            start: originalStart,
            end: originalEnd,
            min: scene.start_sec,
            max: scene.end_sec,
            fallbackDuration: Math.max(0.5, scene.end_sec - scene.start_sec),
        });
        if (!isFiniteNumber(originalStart) ||
            !isFiniteNumber(originalEnd) ||
            Math.abs(nextRange.start - originalStart) > EPSILON ||
            Math.abs(nextRange.end - originalEnd) > EPSILON) {
            recordRepair(actions, maxActions, {
                code: 'PLAN_SCHEMA_INVALID',
                path: `scenes[${sceneIndex}].overlays[${overlayIndex}]`,
                message: `clamped overlay time range to ${nextRange.start}-${nextRange.end}`,
            }, () => {
                overlay.start_sec = nextRange.start;
                overlay.end_sec = nextRange.end;
            });
        }
    });
}
function repairAudio(input) {
    const { scene, sceneIndex, validAssetsById, actions, maxActions, planDuration } = input;
    if (!Array.isArray(scene.audio)) {
        recordRepair(actions, maxActions, {
            code: 'PLAN_SCHEMA_INVALID',
            path: `scenes[${sceneIndex}].audio`,
            message: 'reset invalid audio value to an empty array',
        }, () => {
            scene.audio = [];
        });
        return;
    }
    scene.audio.forEach((audio, audioIndex) => {
        if (isNonEmptyString(audio.asset_id) && !validAssetsById.has(audio.asset_id)) {
            recordRepair(actions, maxActions, {
                code: 'RESOURCE_NOT_FOUND',
                path: `scenes[${sceneIndex}].audio[${audioIndex}].asset_id`,
                message: `removed missing audio asset reference ${audio.asset_id}`,
            }, () => {
                delete audio.asset_id;
            });
        }
        if (audio.end_sec != null) {
            const originalStart = audio.start_sec;
            const originalEnd = audio.end_sec;
            const nextRange = clampTimeRange({
                start: originalStart,
                end: originalEnd,
                min: 0,
                max: planDuration,
                fallbackDuration: Math.max(0.5, scene.end_sec - scene.start_sec),
            });
            if (!isFiniteNumber(originalStart) ||
                !isFiniteNumber(originalEnd) ||
                Math.abs(nextRange.start - originalStart) > EPSILON ||
                Math.abs(nextRange.end - originalEnd) > EPSILON) {
                recordRepair(actions, maxActions, {
                    code: 'PLAN_SCHEMA_INVALID',
                    path: `scenes[${sceneIndex}].audio[${audioIndex}]`,
                    message: `clamped audio time range to ${nextRange.start}-${nextRange.end}`,
                }, () => {
                    audio.start_sec = nextRange.start;
                    audio.end_sec = nextRange.end;
                });
            }
        }
        else if (!isFiniteNumber(audio.start_sec) || audio.start_sec < -EPSILON) {
            recordRepair(actions, maxActions, {
                code: 'PLAN_SCHEMA_INVALID',
                path: `scenes[${sceneIndex}].audio[${audioIndex}].start_sec`,
                message: 'reset invalid audio start_sec to 0',
            }, () => {
                audio.start_sec = 0;
            });
        }
        if (!isFiniteNumber(audio.volume) || audio.volume < 0 || audio.volume > 2) {
            recordRepair(actions, maxActions, {
                code: 'PLAN_SCHEMA_INVALID',
                path: `scenes[${sceneIndex}].audio[${audioIndex}].volume`,
                message: 'clamped audio volume into 0-2 range',
            }, () => {
                audio.volume = isFiniteNumber(audio.volume)
                    ? Math.max(0, Math.min(audio.volume, 2))
                    : 1;
            });
        }
    });
}
function pruneAssets(input) {
    const { plan, phase, allowPlaceholderUrls, actions, maxActions } = input;
    if (!Array.isArray(plan.assets))
        return;
    const seen = new Set();
    const nextAssets = [];
    for (const asset of plan.assets) {
        if (!asset || typeof asset !== 'object' || !isNonEmptyString(asset.id))
            continue;
        if (seen.has(asset.id))
            continue;
        seen.add(asset.id);
        if (!isRenderableAsset(asset, phase, allowPlaceholderUrls)) {
            continue;
        }
        nextAssets.push(asset);
    }
    if (nextAssets.length !== plan.assets.length) {
        recordRepair(actions, maxActions, {
            code: 'RESOURCE_NOT_FOUND',
            path: 'assets',
            message: 'removed duplicate, invalid, or unused non-renderable assets',
        }, () => {
            plan.assets = nextAssets;
        });
    }
}
export function repairRenderPlanDeterministically(input) {
    const phase = input.phase ?? 'before_render';
    const allowPlaceholderUrls = input.allowPlaceholderUrls ?? phase === 'before_save';
    const before = input.validation ??
        validateRenderPlanHard({
            renderPlan: input.renderPlan,
            phase,
            allowPlaceholderUrls,
        });
    if (!input.renderPlan) {
        return {
            validation: before,
            report: {
                phase,
                repaired: false,
                before: before.data,
                actions: [],
            },
        };
    }
    if (before.ok) {
        return {
            plan: input.renderPlan,
            validation: before,
            report: {
                phase,
                repaired: false,
                before: before.data,
                after: before.data,
                actions: [],
            },
        };
    }
    const actions = [];
    const maxActions = input.maxActions ?? DEFAULT_MAX_ACTIONS;
    const next = clonePlan(input.renderPlan);
    normalizePlanShape(next, actions, maxActions);
    repairSceneTiming(next, actions, maxActions);
    const validAssets = Array.isArray(next.assets)
        ? next.assets.filter((asset) => isRenderableAsset(asset, phase, allowPlaceholderUrls))
        : [];
    const validAssetsById = new Map(validAssets.map((asset) => [asset.id, asset]));
    if (Array.isArray(next.scenes)) {
        next.scenes.forEach((scene, sceneIndex) => {
            repairVisualLayer({
                scene,
                sceneIndex,
                validAssets,
                validAssetsById,
                actions,
                maxActions,
            });
            repairEffects(scene, sceneIndex, actions, maxActions);
            repairOverlays(scene, sceneIndex, actions, maxActions);
            repairAudio({
                scene,
                sceneIndex,
                validAssetsById,
                actions,
                maxActions,
                planDuration: isPositiveNumber(next.duration_sec) ? next.duration_sec : 1,
            });
        });
    }
    pruneAssets({
        plan: next,
        phase,
        allowPlaceholderUrls,
        actions,
        maxActions,
    });
    const validation = validateRenderPlanHard({
        renderPlan: next,
        phase,
        allowPlaceholderUrls,
    });
    return {
        plan: next,
        validation,
        report: {
            phase,
            repaired: actions.length > 0,
            before: before.data,
            after: validation.data,
            actions,
        },
    };
}
//# sourceMappingURL=render-plan-repair.js.map