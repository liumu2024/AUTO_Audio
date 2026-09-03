const visualSceneTypes = new Set([
    'user_video',
    'ai_video',
    'image_motion',
]);
const supportedOverlayAnimations = new Set([
    'none',
    'fade',
    'slide_up_fade',
    'pop',
    'pulse',
    'sweep',
]);
function nonBlank(value) {
    const text = value?.trim();
    return text || undefined;
}
function sceneCreativeIntent(scene) {
    const title = nonBlank(scene.creative_intent?.title) ?? nonBlank(scene.title);
    const description = nonBlank(scene.creative_intent?.description) ?? nonBlank(scene.body);
    const material_label = nonBlank(scene.creative_intent?.material_label) ?? nonBlank(scene.subtitle);
    if (!title && !description && !material_label)
        return undefined;
    return { title, description, material_label };
}
function isFiniteNumber(value) {
    return typeof value === 'number' && Number.isFinite(value);
}
function normalizeCaptionPercent(value, fallback) {
    if (!isFiniteNumber(value))
        return fallback;
    return value > 0 && value <= 1 ? value * 100 : value;
}
function sceneForOverlay(overlay, scenes) {
    if (overlay.scene_id)
        return scenes.find((scene) => scene.id === overlay.scene_id);
    if (isFiniteNumber(overlay.start_sec)) {
        return scenes.find((scene) => overlay.start_sec >= scene.start_sec &&
            overlay.start_sec < scene.start_sec + scene.duration_sec);
    }
    return undefined;
}
/**
 * Normalizes two invariants at the V2 protocol seam:
 * - visual-scene planning fields stay separate from on-screen text;
 * - a model-supplied text overlay with omitted layout numbers receives stable
 *   geometry from its owning scene instead of discarding the whole plan;
 * - legacy 0-1 caption geometry is converted to the protocol's 0-100 percentage points.
 */
export function normalizeV2TimelineTextOwnership(spec) {
    const scenes = spec.scenes.map((scene) => {
        if (!visualSceneTypes.has(scene.type))
            return scene;
        const creative_intent = sceneCreativeIntent(scene);
        const normalized = { ...scene };
        delete normalized.title;
        delete normalized.subtitle;
        delete normalized.body;
        if (creative_intent)
            normalized.creative_intent = creative_intent;
        return normalized;
    });
    const overlays = spec.overlays.map((overlay) => {
        if (!['caption', 'title', 'label'].includes(overlay.type))
            return overlay;
        const scene = sceneForOverlay(overlay, scenes);
        const start_sec = isFiniteNumber(overlay.start_sec)
            ? overlay.start_sec
            : scene?.start_sec ?? 0;
        const sceneEnd = scene ? scene.start_sec + scene.duration_sec : start_sec + 2;
        const end_sec = isFiniteNumber(overlay.end_sec) && overlay.end_sec > start_sec
            ? overlay.end_sec
            : Math.max(start_sec + 0.4, sceneEnd - 0.12);
        return {
            ...overlay,
            scene_id: overlay.scene_id ?? scene?.id,
            start_sec,
            end_sec,
            x_pct: overlay.type === 'caption'
                ? normalizeCaptionPercent(overlay.x_pct, 50)
                : isFiniteNumber(overlay.x_pct) ? overlay.x_pct : 50,
            y_pct: overlay.type === 'caption'
                ? normalizeCaptionPercent(overlay.y_pct, 80)
                : isFiniteNumber(overlay.y_pct) ? overlay.y_pct : 18,
            width_pct: overlay.type === 'caption'
                ? normalizeCaptionPercent(overlay.width_pct, 84)
                : isFiniteNumber(overlay.width_pct) ? overlay.width_pct : 84,
            // A creative animation alias must not invalidate a whole timeline. The
            // stable fade is deliberately chosen over inventing an unsupported effect.
            animation: overlay.animation && !supportedOverlayAnimations.has(overlay.animation)
                ? 'fade'
                : overlay.animation,
        };
    });
    const caption_tracks = spec.caption_tracks?.map((track) => ({
        ...track,
        x_pct: normalizeCaptionPercent(track.x_pct, 50),
        y_pct: normalizeCaptionPercent(track.y_pct, 80),
        ...(track.width_pct === undefined
            ? {}
            : { width_pct: normalizeCaptionPercent(track.width_pct, 84) }),
    }));
    return {
        ...spec,
        scenes,
        overlays,
        ...(caption_tracks ? { caption_tracks } : {}),
    };
}
//# sourceMappingURL=remotion-timeline-text-ownership.js.map