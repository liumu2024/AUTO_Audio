/**
 * TemplateSchemaV1 — 样例理解层最终产物
 *
 * 目标：爆款样例 → 可编辑、可复用、可填槽（slot-filling）的结构化导演脚本
 */
import type { CapabilityLayerPlan, ContentDomain, VisualPhenomenonMechanism } from './director-grounding.v1.js';
export type { ContentDomain, VisualPhenomenonMechanism, CapabilityLayerPlan };
export type TemplateSlotType = 'video' | 'image' | 'audio' | 'text';
export type TemplateSourceAssetKind = 'sample_video' | 'reference_material';
export type CreativeGoal = 'replicate_structure' | 'generate_variant' | 'product_ad' | 'brand_story' | 'unknown' | string;
export type ViralPointType = 'emotion_peak' | 'beat_sync' | 'hook_punchline' | 'visual_surprise' | string;
export type TemplateTransitionPresentation = 'cut' | 'fade' | 'slide' | 'wipe' | 'flip' | 'clock_wipe';
export type TemplateTransitionTimingType = 'linear' | 'spring';
export type TemplateTransitionDirection = 'from-left' | 'from-right' | 'from-top' | 'from-bottom';
export type TemplateTransitionOverlayType = 'none' | 'light_leak' | 'flash' | 'color_wash';
export type TemplateSequenceLayout = 'fill' | 'none';
export type TemplateVisualMotionPreset = 'static' | 'zoom_in' | 'push_in' | 'pan' | 'shake';
export interface TemplateSlot {
    id: string;
    type: TemplateSlotType;
    required: boolean;
    tags: string[];
    description?: string;
    /** 样例视频只用于理解；reference_material 才能被填入槽位 */
    source?: TemplateSourceAssetKind;
    accepted_material_types?: TemplateSlotType[];
    default_material_id?: string;
}
export interface TemplateSequenceSpec {
    from_sec: number;
    duration_sec: number;
    layout: TemplateSequenceLayout;
    premount_sec: number;
}
export interface TemplateVisualMotion {
    preset: TemplateVisualMotionPreset;
    intensity: number;
    easing?: string;
    driver: 'useCurrentFrame';
}
export interface TemplateSegment {
    id: string;
    name: string;
    /** 可执行叙事/剪辑角色（opening/build/climax 或 hook/demo/cta） */
    creative_role?: string;
    start: number;
    end: number;
    sequence: TemplateSequenceSpec;
    purpose: string;
    emotion?: string;
    subtitle?: string;
    camera?: string;
    motion?: string;
    visual_motion: TemplateVisualMotion;
    /** 关联 slots[].id，供填槽与素材匹配 */
    slot: string;
    /** 该段在左侧结构拆解中展示的意图摘要 */
    intent_summary?: string;
    evidence_refs?: string[];
    confidence?: number;
}
export interface ViralPoint {
    time: number;
    type: ViralPointType;
    reason: string;
    mechanism?: VisualPhenomenonMechanism;
    evidence_refs?: string[];
    confidence?: number;
}
export interface TemplateTransitionTiming {
    type: TemplateTransitionTimingType;
    easing?: string;
    damping?: number;
    stiffness?: number;
}
export interface TemplateTransitionOverlay {
    type: TemplateTransitionOverlayType;
    duration_sec?: number;
    offset_sec?: number;
    intensity?: number;
}
export interface TemplateTransition {
    id: string;
    from_segment_id: string;
    to_segment_id: string;
    at_sec: number;
    presentation: TemplateTransitionPresentation;
    duration_sec: number;
    timing: TemplateTransitionTiming;
    direction?: TemplateTransitionDirection;
    overlay?: TemplateTransitionOverlay;
    reason?: string;
}
export interface TemplateStyleFeatures {
    subtitle_style?: string;
    transition?: string;
    transition_style?: string;
    bgm?: string;
    pace?: string;
    [key: string]: string | undefined;
}
export interface TemplateSampleVideoRef {
    id: string;
    name?: string;
    url?: string;
    duration?: number;
}
export interface TemplateReferenceMaterialRef {
    id: string;
    name: string;
    type: Exclude<TemplateSlotType, 'text'>;
    url?: string;
    tags?: string[];
    used_by_slots?: string[];
}
export interface ParsedCreativeIntent {
    raw_text: string;
    goal: CreativeGoal;
    product_or_topic?: string;
    target_audience?: string;
    style_keywords: string[];
    must_keep: string[];
    must_change: string[];
    generation_directive: string;
}
export interface SampleUnderstandingSummary {
    hook_formula: string;
    narrative_arc: string;
    conversion_logic: string;
    audience_trigger: string;
    reusable_pattern: string;
}
export type TemplateRenderEffectPreset = 'primitive_color_transform' | 'primitive_mask_reveal' | 'primitive_ring_overlay' | 'primitive_orb_motion' | 'primitive_orb_ring_overlay' | 'primitive_directional_wave_reveal' | 'primitive_texture_grade' | 'primitive_bloom_overlay' | 'primitive_vignette_overlay' | 'primitive_grain_overlay' | 'primitive_letterbox_overlay' | 'primitive_chromatic_aberration_overlay' | 'primitive_light_sweep_overlay' | 'primitive_beat_pulse' | 'primitive_beat_flash_overlay' | 'primitive_slice_reveal' | 'primitive_ripple_displacement' | 'primitive_ripple_ring_overlay' | 'primitive_collage_layout' | string;
export interface TemplateRenderSceneEffectRecipe {
    segment_id: string;
    /** 编译 preset；优先通过 plugin_id / effect_id 解析 */
    preset?: TemplateRenderEffectPreset;
    effect_id?: string;
    plugin_id?: string;
    layer?: VisualPhenomenonMechanism;
    phenomenon?: string;
    evidence_refs?: string[];
    confidence?: number;
    params?: Record<string, unknown>;
}
export interface TemplateRenderAudioDriverRecipe {
    beat_times: number[];
    strong_beats?: number[];
    energy_peaks?: Array<{
        time: number;
        intensity: number;
        duration_sec?: number;
    }>;
    waveform?: Array<{
        time: number;
        value: number;
    }>;
}
export interface TemplateRenderRecipe {
    style_family?: string;
    global_effects?: TemplateRenderEffectPreset[];
    scene_effects?: TemplateRenderSceneEffectRecipe[];
    audio_driver?: TemplateRenderAudioDriverRecipe;
}
export interface TemplateSchemaV1 {
    schema_version: '1.0';
    id: string;
    title: string;
    duration: number;
    style: string;
    content_domain?: ContentDomain;
    sample_video?: TemplateSampleVideoRef;
    reference_materials?: TemplateReferenceMaterialRef[];
    creative_intent?: ParsedCreativeIntent;
    sample_understanding?: SampleUnderstandingSummary;
    structure: TemplateSegment[];
    slots: TemplateSlot[];
    transitions: TemplateTransition[];
    style_features: TemplateStyleFeatures;
    viral_points: ViralPoint[];
    render_recipe?: TemplateRenderRecipe;
    /** Remotion 能力分层规划（来自 director grounding） */
    capability_layers?: CapabilityLayerPlan[];
    /** 可选：来源样例视频引用 */
    source_video_id?: string;
}
//# sourceMappingURL=template-schema.v1.d.ts.map