export declare const REMOTION_TIMELINE_SPEC_SCHEMA_VERSION: "remotion_timeline_spec.v1";
export type RemotionTimelineAssetType = 'video' | 'image' | 'audio';
export type RemotionTimelineAssetSource = 'user_asset' | 'generated_asset' | 'stock_asset' | 'local_fixture' | 'fallback_asset';
export interface RemotionTimelineCanvas {
    width: number;
    height: number;
    fps: number;
    duration_sec: number;
    background?: string;
}
export interface RemotionTimelineAsset {
    id: string;
    type: RemotionTimelineAssetType;
    src: string;
    source: RemotionTimelineAssetSource;
    label?: string;
}
export type RemotionTimelineSceneType = 'user_video' | 'ai_video' | 'image_motion' | 'remotion_card' | 'caption_scene' | 'data_viz';
export type RemotionTimelineFit = 'cover' | 'contain';
export type RemotionImageMotion = 'none' | 'slow_zoom_in' | 'slow_zoom_out' | 'pan_left' | 'pan_right';
/**
 * Human-readable plan data for the editor and trace. It never renders as video
 * text. This keeps a material filename or shot explanation separate from a
 * caption the audience is meant to see.
 */
export interface RemotionTimelineSceneCreativeIntent {
    title?: string;
    description?: string;
    material_label?: string;
}
export interface RemotionTimelineScene {
    id: string;
    type: RemotionTimelineSceneType;
    start_sec: number;
    duration_sec: number;
    asset_id?: string;
    fit?: RemotionTimelineFit;
    background?: string;
    /** On-screen copy for Remotion-only text/card scenes. */
    title?: string;
    subtitle?: string;
    body?: string;
    accent_color?: string;
    motion?: RemotionImageMotion;
    visual_role?: 'hook' | 'proof' | 'feature' | 'transition' | 'cta';
    /** Editor-only shot plan; never rendered as a caption. */
    creative_intent?: RemotionTimelineSceneCreativeIntent;
    note?: string;
    /** Model-authored sandboxed render override; takes precedence over type. */
    custom_render?: RemotionCustomRenderRef;
}
export declare const REMOTION_TIMELINE_TRANSITION_TYPES: readonly ["cut", "fade", "slide", "wipe", "light_flash", "blur"];
export type RemotionTimelineTransitionType = typeof REMOTION_TIMELINE_TRANSITION_TYPES[number];
export type RemotionTimelineTransitionDirection = 'from-left' | 'from-right' | 'from-top' | 'from-bottom';
export interface RemotionTimelineTransition {
    id: string;
    from_scene_id: string;
    to_scene_id: string;
    type: RemotionTimelineTransitionType;
    duration_sec: number;
    direction?: RemotionTimelineTransitionDirection;
    /** Model-authored sandboxed transition override (single presentation component). */
    custom_render?: RemotionTransitionCustomRender;
}
/** Reference to a sandboxed, model-authored render component. */
export interface RemotionCustomRenderRef {
    component_id: string;
    /** Server-bound display label captured from the registered component. */
    display_name?: string;
    params?: Record<string, unknown>;
}
export type RemotionTransitionCustomRender = RemotionCustomRenderRef;
export type RemotionTimelineOverlayType = 'caption' | 'title' | 'label' | 'shape' | 'image_badge' | 'light_sweep';
export type RemotionTimelineOverlayAnimation = 'none' | 'fade' | 'slide_up_fade' | 'pop' | 'pulse' | 'sweep';
/** Defaults shared by caption overlays in the same V2 subtitle track. */
export interface RemotionTimelineCaptionTrack {
    id: string;
    x_pct: number;
    y_pct: number;
    width_pct?: number;
    max_lines?: number;
    z_index?: number;
    enter_animation?: RemotionTimelineOverlayAnimation;
    exit_animation?: RemotionTimelineOverlayAnimation;
    /** Captions on this track may overlap only when the author explicitly opts in. */
    overlap_policy?: 'forbid' | 'allow_crossfade';
}
export interface RemotionTimelineOverlay {
    id: string;
    type: RemotionTimelineOverlayType;
    start_sec: number;
    end_sec: number;
    scene_id?: string;
    /** Caption overlays may inherit placement and animation defaults from this track. */
    track_id?: string;
    text?: string;
    asset_id?: string;
    x_pct: number;
    y_pct: number;
    width_pct?: number;
    height_pct?: number;
    /** Maximum visible text lines for caption-like overlays. */
    max_lines?: number;
    z_index?: number;
    color?: string;
    background?: string;
    opacity?: number;
    animation?: RemotionTimelineOverlayAnimation;
    enter_animation?: RemotionTimelineOverlayAnimation;
    exit_animation?: RemotionTimelineOverlayAnimation;
}
export interface RemotionTimelineMaterialJob {
    id: string;
    scene_id: string;
    type: 'reuse_asset' | 'generate_video' | 'request_user_material';
    status: 'planned' | 'fulfilled' | 'failed';
    prompt?: string;
    /** Server-resolved image asset used to condition a generation job. */
    input_asset_id?: string;
    /** @deprecated Historical persisted jobs only. New planners must use input_asset_id. */
    input_image_url?: string;
    output_asset_id?: string;
    fallback_asset_id?: string;
    fallback_kind?: 'reuse_asset' | 'static_image' | 'blank_card' | 'none';
    provider?: 'ark_seedance' | 'manual' | 'none';
}
export interface RemotionTimelineAudioClip {
    id: string;
    asset_id: string;
    start_sec: number;
    end_sec: number;
    volume?: number;
}
export interface RemotionTimelineRenderPolicy {
    renderer: 'remotion_timeline';
    fallback_renderer?: 'overlay_compose';
}
export interface V2CreativePlanningGap {
    area: 'image_understanding' | 'scene_plan' | 'sample_transfer';
    message: string;
    affected_scene_ids?: string[];
}
export interface V2CreativeBrief {
    direction: string;
    image_references: Array<{
        asset_id: string;
        observed_facts: string[];
        intended_use: string;
    }>;
    sample_methods: string[];
    /** Recalled user preferences the planner actually adopted for this plan. */
    applied_preferences: string[];
    /** Server-maintained recovery state; model output cannot write this field. */
    planning_gaps?: V2CreativePlanningGap[];
}
export interface RemotionTimelineSpecV1 {
    schema_version: typeof REMOTION_TIMELINE_SPEC_SCHEMA_VERSION;
    task_id: string;
    creative_brief?: V2CreativeBrief;
    canvas: RemotionTimelineCanvas;
    assets: RemotionTimelineAsset[];
    scenes: RemotionTimelineScene[];
    transitions: RemotionTimelineTransition[];
    /** Configuration only. Visible caption text remains in overlays. */
    caption_tracks?: RemotionTimelineCaptionTrack[];
    overlays: RemotionTimelineOverlay[];
    material_jobs: RemotionTimelineMaterialJob[];
    audio?: RemotionTimelineAudioClip[];
    render_policy: RemotionTimelineRenderPolicy;
    notes?: string[];
}
//# sourceMappingURL=remotion-timeline-spec.v1.d.ts.map