import { REMOTION_TIMELINE_SPEC_SCHEMA_VERSION, } from '../types/remotion-timeline-spec.v1.js';
export function createRemotionTimelineFixture(input) {
    const durationSec = input.durationSec ?? 6;
    const firstSceneDuration = durationSec * 0.38;
    const secondSceneDuration = durationSec * 0.3;
    const thirdSceneDuration = durationSec - firstSceneDuration - secondSceneDuration;
    return {
        schema_version: REMOTION_TIMELINE_SPEC_SCHEMA_VERSION,
        task_id: input.taskId ?? `v2_timeline_fixture_${Date.now()}`,
        canvas: {
            width: input.width ?? 720,
            height: input.height ?? 1280,
            fps: input.fps ?? 24,
            duration_sec: durationSec,
            background: '#09090b',
        },
        assets: [
            {
                id: 'main_video_asset',
                type: 'video',
                src: input.mainVideoSrc,
                source: 'local_fixture',
                label: 'Fixture user video',
            },
            {
                id: 'hero_image_asset',
                type: 'image',
                src: input.imageSrc,
                source: 'local_fixture',
                label: 'Fixture image',
            },
        ],
        scenes: [
            {
                id: 'scene_001',
                type: 'user_video',
                start_sec: 0,
                duration_sec: firstSceneDuration,
                asset_id: 'main_video_asset',
                fit: 'cover',
                title: 'Reference motion',
                visual_role: 'hook',
            },
            {
                id: 'scene_002',
                type: 'image_motion',
                start_sec: firstSceneDuration,
                duration_sec: secondSceneDuration,
                asset_id: 'hero_image_asset',
                fit: 'cover',
                motion: 'slow_zoom_in',
                title: 'Image motion',
                subtitle: 'Remotion controlled movement',
                visual_role: 'feature',
            },
            {
                id: 'scene_003',
                type: 'remotion_card',
                start_sec: firstSceneDuration + secondSceneDuration,
                duration_sec: thirdSceneDuration,
                title: 'Timeline-first V2',
                subtitle: 'Scenes, transitions, captions',
                body: 'Video models create realistic content. Remotion controls the timeline.',
                accent_color: '#38bdf8',
                visual_role: 'cta',
            },
        ],
        transitions: [
            {
                id: 'transition_001',
                from_scene_id: 'scene_001',
                to_scene_id: 'scene_002',
                type: 'fade',
                duration_sec: 0.35,
            },
            {
                id: 'transition_002',
                from_scene_id: 'scene_002',
                to_scene_id: 'scene_003',
                type: 'slide',
                direction: 'from-right',
                duration_sec: 0.4,
            },
        ],
        overlays: [
            {
                id: 'caption_001',
                type: 'caption',
                scene_id: 'scene_001',
                start_sec: 0.3,
                end_sec: 1.8,
                text: 'Scene 1: user or generated video',
                x_pct: 50,
                y_pct: 86,
                width_pct: 78,
                background: 'rgba(15, 23, 42, 0.64)',
                animation: 'slide_up_fade',
            },
            {
                id: 'label_002',
                type: 'label',
                scene_id: 'scene_002',
                start_sec: firstSceneDuration + 0.2,
                end_sec: firstSceneDuration + secondSceneDuration - 0.15,
                text: 'Image motion scene',
                x_pct: 50,
                y_pct: 18,
                width_pct: 72,
                color: '#f8fafc',
                animation: 'pop',
            },
            {
                id: 'sweep_003',
                type: 'light_sweep',
                start_sec: firstSceneDuration + secondSceneDuration + 0.25,
                end_sec: durationSec - 0.2,
                x_pct: 50,
                y_pct: 50,
                width_pct: 120,
                height_pct: 100,
                opacity: 0.55,
                animation: 'sweep',
            },
        ],
        material_jobs: [
            {
                id: 'job_reuse_main_video',
                scene_id: 'scene_001',
                type: 'reuse_asset',
                status: 'fulfilled',
                output_asset_id: 'main_video_asset',
                provider: 'none',
                fallback_kind: 'none',
            },
        ],
        render_policy: {
            renderer: 'remotion_timeline',
            fallback_renderer: 'overlay_compose',
        },
        notes: [
            'Fixture covers video scene, image motion scene, Remotion card scene, transitions, and overlays.',
        ],
    };
}
//# sourceMappingURL=remotion-timeline-fixtures.js.map