import { validateRenderPlanHard, } from './render-plan-validator.js';
const VISUAL_MODES_REQUIRING_ASSET = new Set(['material_clip', 'image_motion']);
function clonePlan(plan) {
    return structuredClone(plan);
}
function isRenderableVisualAsset(asset) {
    return asset.type !== 'audio' && Boolean(asset.id && asset.url);
}
function materialSourceForAsset(asset) {
    return asset.source === 'system' ? undefined : asset.source;
}
function isMontagePrompt(prompt) {
    const lower = prompt.toLowerCase();
    return (lower.includes('montage') ||
        lower.includes('landscape') ||
        lower.includes('travel') ||
        prompt.includes('混剪') ||
        prompt.includes('风景') ||
        prompt.includes('旅行') ||
        prompt.includes('卡点'));
}
function isProductPrompt(prompt) {
    const lower = prompt.toLowerCase();
    return (lower.includes('product') ||
        lower.includes('ad') ||
        lower.includes('marketing') ||
        prompt.includes('产品') ||
        prompt.includes('广告') ||
        prompt.includes('卖点'));
}
function visualModeForAsset(asset) {
    return asset.type === 'image' ? 'image_motion' : 'material_clip';
}
function sceneDuration(scene) {
    return Math.max(0.5, scene.end_sec - scene.start_sec);
}
function buildAssetRotationCandidate(plan) {
    const visualAssets = plan.assets.filter(isRenderableVisualAsset);
    if (visualAssets.length < 2 || plan.scenes.length < 2)
        return undefined;
    const trimCursors = new Map();
    return {
        ...clonePlan(plan),
        strategy: 'montage',
        scenes: plan.scenes.map((scene, index) => {
            const asset = visualAssets[index % visualAssets.length];
            const duration = sceneDuration(scene);
            const trimStart = trimCursors.get(asset.id) ?? 0;
            trimCursors.set(asset.id, trimStart + duration);
            return {
                ...scene,
                visual: {
                    ...scene.visual,
                    mode: visualModeForAsset(asset),
                    asset_id: asset.id,
                    material_source: materialSourceForAsset(asset),
                    fit: scene.visual.fit ?? 'cover',
                    trim: asset.type === 'video'
                        ? {
                            start_sec: trimStart,
                            end_sec: trimStart + duration,
                        }
                        : undefined,
                    motion: scene.visual.motion ??
                        {
                            preset: index % 2 === 0 ? 'push_in' : 'pan',
                            intensity: 0.18,
                        },
                },
            };
        }),
    };
}
function buildStabilizedMotionCandidate(plan) {
    if (!plan.scenes.some((scene) => scene.visual.motion))
        return undefined;
    return {
        ...clonePlan(plan),
        strategy: plan.strategy === 'montage' ? 'hybrid' : plan.strategy,
        scenes: plan.scenes.map((scene) => {
            const motion = scene.visual.motion;
            if (!motion)
                return scene;
            return {
                ...scene,
                visual: {
                    ...scene.visual,
                    motion: {
                        ...motion,
                        preset: motion.preset === 'shake' ? 'static' : motion.preset,
                        intensity: typeof motion.intensity === 'number'
                            ? Math.min(motion.intensity, 0.28)
                            : 0.22,
                    },
                },
            };
        }),
    };
}
function countVisualSceneCoverage(plan) {
    const visualAssets = plan.assets.filter(isRenderableVisualAsset);
    const visualAssetIds = new Set(visualAssets.map((asset) => asset.id));
    const visualScenes = plan.scenes.filter((scene) => {
        return (VISUAL_MODES_REQUIRING_ASSET.has(scene.visual.mode) ||
            Boolean(scene.visual.asset_id));
    });
    if (!visualScenes.length)
        return { assetCoverage: 1, uniqueAssetCoverage: 1 };
    const referenced = visualScenes
        .map((scene) => scene.visual.asset_id)
        .filter((id) => Boolean(id && visualAssetIds.has(id)));
    const assetCoverage = referenced.length / visualScenes.length;
    const expectedUnique = Math.max(1, Math.min(visualAssets.length, visualScenes.length));
    const uniqueAssetCoverage = visualAssets.length > 0 ? new Set(referenced).size / expectedUnique : 1;
    return { assetCoverage, uniqueAssetCoverage };
}
function effectLayerReadiness(plan) {
    const layers = plan.scenes.flatMap((scene) => scene.effect_layers ?? []);
    if (!layers.length)
        return 1;
    const ready = layers.filter((layer) => layer.plugin_id && layer.resolution !== 'missing' && layer.effects?.preset).length;
    return ready / layers.length;
}
function timelineFit(plan) {
    if (!plan.scenes.length || plan.duration_sec <= 0)
        return 0;
    const maxEnd = Math.max(...plan.scenes.map((scene) => scene.end_sec));
    const delta = Math.abs(maxEnd - plan.duration_sec);
    return Math.max(0, 1 - delta / Math.max(1, plan.duration_sec));
}
function promptFit(plan, prompt) {
    if (!prompt.trim())
        return 0.5;
    let score = 0.5;
    if (isMontagePrompt(prompt)) {
        score += plan.strategy === 'montage' ? 0.35 : -0.15;
    }
    if (isProductPrompt(prompt)) {
        score += plan.strategy === 'montage' ? -0.1 : 0.25;
    }
    return Math.max(0, Math.min(1, score));
}
function scoreCandidate(input) {
    const validation = validateRenderPlanHard({
        renderPlan: input.plan,
        phase: input.phase,
    });
    const coverage = countVisualSceneCoverage(input.plan);
    const metrics = {
        ...coverage,
        effectLayerReadiness: effectLayerReadiness(input.plan),
        timelineFit: timelineFit(input.plan),
        promptFit: promptFit(input.plan, input.prompt),
        validationPenalty: validation.errors.length * 30 + validation.warnings.length * 3,
    };
    const score = (validation.ok ? 60 : 0) +
        metrics.assetCoverage * 18 +
        metrics.uniqueAssetCoverage * 10 +
        metrics.effectLayerReadiness * 8 +
        metrics.timelineFit * 6 +
        metrics.promptFit * 8 -
        metrics.validationPenalty;
    return {
        id: input.id,
        label: input.label,
        plan: input.plan,
        score: Number(score.toFixed(3)),
        metrics,
        validationOk: validation.ok,
        warnings: validation.warnings,
        errors: validation.errors.map((error) => error.message),
    };
}
export function selectRenderPlanCandidate(input) {
    const phase = input.phase ?? 'before_save';
    const prompt = input.prompt ?? '';
    const rawCandidates = [
        {
            id: 'base',
            label: 'Preserve semantic material matches',
            plan: input.plan,
        },
        {
            id: 'asset_rotation',
            label: 'Maximize visual material coverage',
            plan: isMontagePrompt(prompt) ? buildAssetRotationCandidate(input.plan) : undefined,
        },
        {
            id: 'stabilized_motion',
            label: 'Reduce motion for product readability',
            plan: isProductPrompt(prompt) ? buildStabilizedMotionCandidate(input.plan) : undefined,
        },
    ];
    const candidates = rawCandidates
        .filter((candidate) => Boolean(candidate.plan))
        .map((candidate) => scoreCandidate({
        ...candidate,
        prompt,
        phase,
    }));
    const selected = candidates
        .map((candidate, index) => ({ candidate, index }))
        .sort((a, b) => b.candidate.score - a.candidate.score || a.index - b.index)[0]
        .candidate;
    return {
        selected,
        candidates,
        summary: {
            selectedId: selected.id,
            candidates: candidates.map(({ plan: _plan, ...candidate }) => candidate),
        },
    };
}
//# sourceMappingURL=render-plan-candidates.js.map