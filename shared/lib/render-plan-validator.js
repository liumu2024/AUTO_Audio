const EPSILON = 0.001;
const VALID_RATIOS = new Set(['9:16', '16:9', '4:3', '1:1']);
const VISUAL_MODES_REQUIRING_ASSET = new Set(['material_clip', 'image_motion']);
const SUPPORTED_EFFECT_PRESETS = new Set([
    'color_portal_spotlight',
    'primitive_color_transform',
    'primitive_mask_reveal',
    'primitive_ring_overlay',
    'primitive_orb_motion',
    'primitive_orb_ring_overlay',
    'primitive_directional_wave_reveal',
    'primitive_texture_grade',
    'primitive_bloom_overlay',
    'primitive_vignette_overlay',
    'primitive_grain_overlay',
    'primitive_letterbox_overlay',
    'primitive_chromatic_aberration_overlay',
    'primitive_light_sweep_overlay',
    'primitive_beat_pulse',
    'primitive_beat_flash_overlay',
    'primitive_beat_color_unlock',
    'primitive_color_hint_overlay',
    'primitive_fade_overlay',
    'primitive_transition_accent_overlay',
    'primitive_slice_reveal',
    'primitive_ripple_displacement',
    'primitive_ripple_ring_overlay',
    'primitive_collage_layout',
    'cinematic_light_sweep',
    'ripple_displacement',
    'kinetic_color_ripple',
    'editorial_split_collage',
    'cinematic_grade_pack',
    'audio_reactive_cut_driver',
    'mask_slice_transition',
    'generated_component',
]);
function isFiniteNumber(value) {
    return typeof value === 'number' && Number.isFinite(value);
}
function isPositiveNumber(value) {
    return isFiniteNumber(value) && value > 0;
}
function isNonEmptyString(value) {
    return typeof value === 'string' && value.trim().length > 0;
}
function issue(issues, input) {
    issues.push({
        severity: 'error',
        recoverable: input.code !== 'UNKNOWN',
        ...input,
    });
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
function validateTimeRange(issues, input) {
    const code = input.code ?? 'PLAN_SCHEMA_INVALID';
    if (!isFiniteNumber(input.start) || !isFiniteNumber(input.end)) {
        issue(issues, {
            code,
            path: input.path,
            message: 'time range requires finite start and end values',
        });
        return;
    }
    if (input.start < (input.min ?? 0) - EPSILON) {
        issue(issues, {
            code,
            path: `${input.path}.start_sec`,
            message: `start_sec ${input.start} is before the allowed minimum`,
        });
    }
    if (input.end <= input.start + EPSILON) {
        issue(issues, {
            code,
            path: input.path,
            message: `end_sec ${input.end} must be greater than start_sec ${input.start}`,
        });
    }
    if (input.max != null && input.end > input.max + EPSILON) {
        issue(issues, {
            code,
            path: `${input.path}.end_sec`,
            message: `end_sec ${input.end} exceeds allowed maximum ${input.max}`,
        });
    }
}
function validateAsset(issues, asset, index, phase, allowPlaceholderUrls) {
    const path = `assets[${index}]`;
    if (!isNonEmptyString(asset.id)) {
        issue(issues, {
            code: 'PLAN_SCHEMA_INVALID',
            path: `${path}.id`,
            message: 'asset id is required',
        });
    }
    if (!isNonEmptyString(asset.url)) {
        issue(issues, {
            code: 'RESOURCE_NOT_FOUND',
            path: `${path}.url`,
            message: `asset ${asset.id || index} has no url`,
        });
    }
    else if (!isRenderableUrl(asset.url)) {
        issue(issues, {
            code: 'RESOURCE_NOT_FOUND',
            path: `${path}.url`,
            message: `asset ${asset.id} url is not renderable: ${asset.url}`,
        });
    }
    else if (phase === 'before_render' && !allowPlaceholderUrls && isPlaceholderUrl(asset.url)) {
        issue(issues, {
            code: 'RESOURCE_NOT_FOUND',
            path: `${path}.url`,
            message: `asset ${asset.id} still points to placeholder url ${asset.url}`,
        });
    }
    if (asset.duration_sec != null && !isPositiveNumber(asset.duration_sec)) {
        issue(issues, {
            code: 'PLAN_SCHEMA_INVALID',
            path: `${path}.duration_sec`,
            message: 'asset duration_sec must be positive when present',
            severity: 'warning',
        });
    }
}
function validateAssetRef(issues, input) {
    if (!isNonEmptyString(input.assetId)) {
        if (input.required) {
            issue(issues, {
                code: 'RESOURCE_NOT_FOUND',
                path: input.path,
                message: 'asset_id is required for this layer',
            });
        }
        return;
    }
    if (!input.assetsById.has(input.assetId)) {
        issue(issues, {
            code: 'RESOURCE_NOT_FOUND',
            path: input.path,
            message: `asset_id ${input.assetId} does not exist in renderPlan.assets`,
        });
    }
}
function validateEffectPreset(issues, effects, path) {
    if (!effects)
        return;
    const preset = effects.preset;
    if (!isNonEmptyString(preset)) {
        issue(issues, {
            code: 'PLAN_SCHEMA_INVALID',
            path: `${path}.preset`,
            message: 'effect preset is required',
        });
        return;
    }
    if (!SUPPORTED_EFFECT_PRESETS.has(preset)) {
        issue(issues, {
            code: 'UNSUPPORTED_COMPONENT',
            path: `${path}.preset`,
            message: `unsupported effect preset: ${preset}`,
        });
    }
    if (preset === 'generated_component') {
        const componentId = effects.component_id;
        const fallbackPreset = effects.fallback_preset;
        if (!isNonEmptyString(componentId) && !isNonEmptyString(fallbackPreset)) {
            issue(issues, {
                code: 'UNSUPPORTED_COMPONENT',
                path,
                message: 'generated_component requires component_id or fallback_preset',
            });
        }
    }
}
function validateScene(issues, scene, index, planDuration, assetsById) {
    const path = `scenes[${index}]`;
    if (!scene || typeof scene !== 'object') {
        issue(issues, {
            code: 'PLAN_SCHEMA_INVALID',
            path,
            message: 'scene must be an object',
        });
        return;
    }
    if (!isNonEmptyString(scene.id)) {
        issue(issues, {
            code: 'PLAN_SCHEMA_INVALID',
            path: `${path}.id`,
            message: 'scene id is required',
        });
    }
    validateTimeRange(issues, {
        path,
        start: scene.start_sec,
        end: scene.end_sec,
        max: planDuration,
    });
    const visualPath = `${path}.visual`;
    if (!scene.visual || typeof scene.visual !== 'object') {
        issue(issues, {
            code: 'PLAN_SCHEMA_INVALID',
            path: visualPath,
            message: 'scene visual layer is required',
        });
    }
    else {
        const requiresAsset = VISUAL_MODES_REQUIRING_ASSET.has(scene.visual.mode);
        validateAssetRef(issues, {
            assetId: scene.visual.asset_id,
            path: `${visualPath}.asset_id`,
            assetsById,
            required: requiresAsset,
        });
        if (scene.visual.trim) {
            validateTimeRange(issues, {
                path: `${visualPath}.trim`,
                start: scene.visual.trim.start_sec,
                end: scene.visual.trim.end_sec,
            });
        }
    }
    validateEffectPreset(issues, scene.effects, `${path}.effects`);
    const effectLayers = Array.isArray(scene.effect_layers) ? scene.effect_layers : [];
    if (scene.effect_layers != null && !Array.isArray(scene.effect_layers)) {
        issue(issues, {
            code: 'PLAN_SCHEMA_INVALID',
            path: `${path}.effect_layers`,
            message: 'effect_layers must be an array when present',
        });
    }
    for (const [layerIndex, layer] of effectLayers.entries()) {
        const layerPath = `${path}.effect_layers[${layerIndex}]`;
        if (!layer || typeof layer !== 'object') {
            issue(issues, {
                code: 'PLAN_SCHEMA_INVALID',
                path: layerPath,
                message: 'effect layer must be an object',
            });
            continue;
        }
        if (!isNonEmptyString(layer.id)) {
            issue(issues, {
                code: 'PLAN_SCHEMA_INVALID',
                path: `${layerPath}.id`,
                message: 'effect layer id is required',
            });
        }
        if (!isNonEmptyString(layer.plugin_id)) {
            issue(issues, {
                code: 'UNSUPPORTED_COMPONENT',
                path: `${layerPath}.plugin_id`,
                message: 'effect layer plugin_id is required',
            });
        }
        if (layer.resolution === 'missing') {
            issue(issues, {
                code: 'UNSUPPORTED_COMPONENT',
                path: `${layerPath}.resolution`,
                message: `effect layer ${layer.id} has missing component resolution`,
            });
        }
        if (layer.effects?.preset && layer.preset !== layer.effects.preset) {
            issue(issues, {
                code: 'PLAN_SCHEMA_INVALID',
                path: `${layerPath}.preset`,
                message: `layer preset ${layer.preset} does not match effects preset ${layer.effects.preset}`,
                severity: 'warning',
            });
        }
        validateEffectPreset(issues, layer.effects, `${layerPath}.effects`);
    }
    const overlays = Array.isArray(scene.overlays) ? scene.overlays : [];
    if (!Array.isArray(scene.overlays)) {
        issue(issues, {
            code: 'PLAN_SCHEMA_INVALID',
            path: `${path}.overlays`,
            message: 'overlays must be an array',
        });
    }
    for (const [overlayIndex, overlay] of overlays.entries()) {
        const overlayPath = `${path}.overlays[${overlayIndex}]`;
        if (!overlay || typeof overlay !== 'object') {
            issue(issues, {
                code: 'PLAN_SCHEMA_INVALID',
                path: overlayPath,
                message: 'overlay must be an object',
            });
            continue;
        }
        validateTimeRange(issues, {
            path: overlayPath,
            start: overlay.start_sec,
            end: overlay.end_sec,
            min: scene.start_sec,
            max: scene.end_sec,
        });
        if (!isNonEmptyString(overlay.text)) {
            issue(issues, {
                code: 'PLAN_SCHEMA_INVALID',
                path: `${overlayPath}.text`,
                message: 'overlay text is empty',
                severity: 'warning',
            });
        }
    }
    const audioLayers = Array.isArray(scene.audio) ? scene.audio : [];
    if (!Array.isArray(scene.audio)) {
        issue(issues, {
            code: 'PLAN_SCHEMA_INVALID',
            path: `${path}.audio`,
            message: 'audio must be an array',
        });
    }
    for (const [audioIndex, audio] of audioLayers.entries()) {
        const audioPath = `${path}.audio[${audioIndex}]`;
        if (!audio || typeof audio !== 'object') {
            issue(issues, {
                code: 'PLAN_SCHEMA_INVALID',
                path: audioPath,
                message: 'audio layer must be an object',
            });
            continue;
        }
        if (audio.end_sec != null) {
            validateTimeRange(issues, {
                path: audioPath,
                start: audio.start_sec,
                end: audio.end_sec,
                min: 0,
                max: planDuration,
            });
        }
        else if (!isFiniteNumber(audio.start_sec) || audio.start_sec < -EPSILON) {
            issue(issues, {
                code: 'PLAN_SCHEMA_INVALID',
                path: `${audioPath}.start_sec`,
                message: 'audio start_sec must be finite and non-negative',
            });
        }
        validateAssetRef(issues, {
            assetId: audio.asset_id,
            path: `${audioPath}.asset_id`,
            assetsById,
            required: false,
        });
        if (!isFiniteNumber(audio.volume) || audio.volume < 0 || audio.volume > 2) {
            issue(issues, {
                code: 'PLAN_SCHEMA_INVALID',
                path: `${audioPath}.volume`,
                message: 'audio volume must be between 0 and 2',
                severity: 'warning',
            });
        }
    }
}
function toToolError(issue) {
    return {
        code: issue.code,
        message: `${issue.path}: ${issue.message}`,
        recoverable: issue.recoverable,
        stepId: 'validate_render_plan',
        tool: 'render_plan.validate',
    };
}
export function validateRenderPlanHard(input) {
    const phase = input.phase ?? 'before_render';
    const issues = [];
    const plan = input.renderPlan;
    if (!plan) {
        issue(issues, {
            code: 'MISSING_RENDER_PLAN',
            path: 'renderPlan',
            message: 'RenderPlan is required',
        });
        const report = {
            phase,
            valid: false,
            sceneCount: 0,
            assetCount: 0,
            issues,
        };
        return {
            ok: false,
            data: report,
            warnings: [],
            errors: issues.map(toToolError),
        };
    }
    if (plan.version !== '1.0') {
        issue(issues, {
            code: 'PLAN_SCHEMA_INVALID',
            path: 'version',
            message: 'RenderPlan version must be 1.0',
        });
    }
    if (!isNonEmptyString(plan.task_id)) {
        issue(issues, {
            code: 'PLAN_SCHEMA_INVALID',
            path: 'task_id',
            message: 'task_id is required',
        });
    }
    if (!isPositiveNumber(plan.duration_sec)) {
        issue(issues, {
            code: 'PLAN_SCHEMA_INVALID',
            path: 'duration_sec',
            message: 'duration_sec must be positive',
        });
    }
    if (!plan.canvas || typeof plan.canvas !== 'object') {
        issue(issues, {
            code: 'PLAN_SCHEMA_INVALID',
            path: 'canvas',
            message: 'canvas is required',
        });
    }
    else {
        if (!isPositiveNumber(plan.canvas.width) || !isPositiveNumber(plan.canvas.height)) {
            issue(issues, {
                code: 'PLAN_SCHEMA_INVALID',
                path: 'canvas',
                message: 'canvas width and height must be positive',
            });
        }
        if (!isPositiveNumber(plan.canvas.fps)) {
            issue(issues, {
                code: 'PLAN_SCHEMA_INVALID',
                path: 'canvas.fps',
                message: 'canvas fps must be positive',
            });
        }
        if (!VALID_RATIOS.has(plan.canvas.ratio)) {
            issue(issues, {
                code: 'PLAN_SCHEMA_INVALID',
                path: 'canvas.ratio',
                message: `unsupported canvas ratio: ${plan.canvas.ratio}`,
            });
        }
    }
    if (!Array.isArray(plan.scenes) || plan.scenes.length === 0) {
        issue(issues, {
            code: 'PLAN_SCHEMA_INVALID',
            path: 'scenes',
            message: 'RenderPlan requires at least one scene',
        });
    }
    if (!Array.isArray(plan.assets)) {
        issue(issues, {
            code: 'PLAN_SCHEMA_INVALID',
            path: 'assets',
            message: 'assets must be an array',
        });
    }
    const assets = Array.isArray(plan.assets) ? plan.assets : [];
    const assetsById = new Map();
    for (const [index, asset] of assets.entries()) {
        if (isNonEmptyString(asset.id)) {
            if (assetsById.has(asset.id)) {
                issue(issues, {
                    code: 'PLAN_SCHEMA_INVALID',
                    path: `assets[${index}].id`,
                    message: `duplicate asset id: ${asset.id}`,
                });
            }
            assetsById.set(asset.id, asset);
        }
        validateAsset(issues, asset, index, phase, input.allowPlaceholderUrls ?? phase === 'before_save');
    }
    const planDuration = isPositiveNumber(plan.duration_sec) ? plan.duration_sec : 0;
    const scenes = Array.isArray(plan.scenes) ? plan.scenes : [];
    for (const [index, scene] of scenes.entries()) {
        validateScene(issues, scene, index, planDuration, assetsById);
        const previous = scenes[index - 1];
        if (previous && scene.start_sec < previous.end_sec - 0.25) {
            issue(issues, {
                code: 'PLAN_SCHEMA_INVALID',
                path: `scenes[${index}].start_sec`,
                message: `scene overlaps previous scene by more than 0.25s`,
                severity: 'warning',
            });
        }
    }
    const errors = issues.filter((item) => item.severity === 'error');
    const warnings = issues.filter((item) => item.severity === 'warning');
    const report = {
        phase,
        valid: errors.length === 0,
        durationSec: plan.duration_sec,
        sceneCount: scenes.length,
        assetCount: assets.length,
        issues,
    };
    return {
        ok: errors.length === 0,
        data: report,
        warnings: warnings.map((item) => `${item.path}: ${item.message}`),
        errors: errors.map(toToolError),
    };
}
export function formatRenderPlanValidationFailure(result) {
    const first = result.errors[0];
    if (!first)
        return 'PLAN_SCHEMA_INVALID: RenderPlan validation failed';
    return `${first.code}: ${first.message}`;
}
export function assertRenderPlanValid(input) {
    const result = validateRenderPlanHard(input);
    if (!result.ok) {
        throw new Error(formatRenderPlanValidationFailure(result));
    }
    return result.data;
}
//# sourceMappingURL=render-plan-validator.js.map