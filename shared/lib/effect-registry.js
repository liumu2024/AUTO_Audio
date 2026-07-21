export const DEFAULT_COLOR_PORTAL_EFFECT = {
    preset: 'color_portal_spotlight',
    base_filter: 'grayscale(100%) contrast(1.12) brightness(0.92)',
    portal: {
        shape: 'circle',
        radius_pct_keyframes: [
            { time: 0, value: 14 },
            { time: 1.8, value: 21 },
            { time: 4.5, value: 18 },
            { time: 7.2, value: 24 },
            { time: 9, value: 16 },
        ],
        position_keyframes: [
            { time: 0, x_pct: 30, y_pct: 42 },
            { time: 2, x_pct: 60, y_pct: 36 },
            { time: 4.8, x_pct: 48, y_pct: 58 },
            { time: 7.2, x_pct: 72, y_pct: 50 },
            { time: 9, x_pct: 38, y_pct: 66 },
        ],
        beat_reactive_scale: true,
    },
    ring: {
        enabled: true,
        stroke_px: 5,
        colors: ['#ffffff', '#a78bfa', '#22d3ee'],
        glow: {
            outer_blur_px: 34,
            outer_spread_px: 14,
            inner_blur_px: 20,
        },
        blend_mode: 'screen',
        chromatic_aberration: {
            enabled: true,
            offset_px: 4,
        },
    },
};
export const DEFAULT_PRIMITIVE_COLOR_TRANSFORM_EFFECT = {
    preset: 'primitive_color_transform',
    transform: 'grayscale_to_color_base',
    base_filter: 'grayscale(100%) contrast(1.08)',
};
export const DEFAULT_PRIMITIVE_MASK_REVEAL_EFFECT = {
    preset: 'primitive_mask_reveal',
    mask: {
        shape: 'circle',
        radius_pct_keyframes: [
            { time: 0, value: 0 },
            { time: 1, value: 28 },
        ],
        position_keyframes: [
            { time: 0, x_pct: 50, y_pct: 50 },
            { time: 1, x_pct: 50, y_pct: 50 },
        ],
        beat_reactive_scale: false,
    },
};
export const DEFAULT_PRIMITIVE_RING_OVERLAY_EFFECT = {
    preset: 'primitive_ring_overlay',
    ring: DEFAULT_COLOR_PORTAL_EFFECT.ring,
    mask: DEFAULT_PRIMITIVE_MASK_REVEAL_EFFECT.mask,
};
export const DEFAULT_CINEMATIC_SWEEP_EFFECT = {
    preset: 'cinematic_light_sweep',
    base_filter: 'saturate(1.08) contrast(1.12) brightness(0.96)',
    color_grade: {
        saturate: 1.08,
        contrast: 1.08,
        brightness: 0.98,
        hue_rotate_deg: -2,
    },
    vignette: {
        enabled: true,
        opacity: 0.58,
        radius_pct: 58,
    },
    sweep: {
        angle_deg: -18,
        width_pct: 24,
        opacity_keyframes: [
            { time: 0, value: 0 },
            { time: 0.7, value: 0.34 },
            { time: 4.8, value: 0.42 },
            { time: 9, value: 0 },
        ],
        position_keyframes: [
            { time: 0, x_pct: -8, y_pct: 38 },
            { time: 2.2, x_pct: 35, y_pct: 34 },
            { time: 4.8, x_pct: 72, y_pct: 48 },
            { time: 9, x_pct: 118, y_pct: 68 },
        ],
        colors: [
            'rgba(255,255,255,0)',
            'rgba(125,211,252,0.5)',
            'rgba(216,180,254,0.74)',
            'rgba(255,255,255,0)',
        ],
        blur_px: 24,
        blend_mode: 'screen',
    },
    grain: {
        enabled: true,
        opacity: 0.08,
        size_px: 5,
    },
    letterbox: {
        enabled: true,
        height_pct: 7,
    },
};
export const DEFAULT_RIPPLE_EFFECT = {
    preset: 'ripple_displacement',
    base_filter: 'contrast(1.08) saturate(1.05) brightness(0.96)',
    ripple: {
        origin: {
            x_pct: 52,
            y_pct: 44,
        },
        start_sec: 0.45,
        duration_sec: 4.2,
        radius_pct_keyframes: [
            { time: 0, value: 0 },
            { time: 0.45, value: 0 },
            { time: 1.15, value: 18 },
            { time: 2.2, value: 42 },
            { time: 3.45, value: 72 },
            { time: 4.65, value: 102 },
        ],
        amplitude_px: 30,
        frequency: 8.5,
        decay: 0.76,
        width_pct: 9,
    },
    lighting: {
        highlight_color: 'rgba(255,255,255,0.62)',
        shadow_color: 'rgba(0,0,0,0.32)',
        glow_color: 'rgba(125,211,252,0.42)',
        ring_opacity: 0.82,
    },
};
export const DEFAULT_KINETIC_COLOR_RIPPLE_EFFECT = {
    preset: 'kinetic_color_ripple',
    base_filter: 'grayscale(100%) contrast(1.34) brightness(0.94)',
    color_layer: {
        saturate: 1.35,
        contrast: 1.08,
        brightness: 1,
        accumulate: false,
    },
    orb: {
        radius_pct: 3.4,
        colors: ['#6d5cff', '#ff5fd7', '#22d3ee'],
        glow_px: 34,
        trail_enabled: true,
        trail_decay: 0.72,
        path_keyframes: [
            { time: 0, x_pct: 50, y_pct: 108, easing: 'ease-out' },
            { time: 0.72, x_pct: 50, y_pct: 48, easing: 'ease-out' },
            { time: 1.25, x_pct: 50, y_pct: 48, hold: true },
            { time: 1.55, x_pct: 24, y_pct: 28, easing: 'ease-in-out' },
            { time: 2.15, x_pct: 72, y_pct: 38, easing: 'ease-in-out' },
        ],
    },
    ring: {
        enabled: true,
        follow_target: 'orb',
        lag_frames: 5,
        radius_multiplier: 2.28,
        stroke_px: 4,
        colors: ['#ffffff', '#ff55dd', '#22d3ee'],
        glow_px: 26,
        chromatic_aberration_px: 3,
    },
    reveal_events: [
        {
            id: 'reveal_001',
            trigger_time: 0.72,
            origin: { x_pct: 50, y_pct: 48 },
            direction_from_motion: true,
            duration_sec: 0.42,
            wave_count: 4,
            wave_spacing_pct: 6,
            wave_width_pct: 4,
            propagation_speed_pct_per_sec: 190,
            color_unlock: 0.48,
        },
        {
            id: 'reveal_002',
            trigger_time: 1.55,
            origin: { x_pct: 24, y_pct: 28 },
            direction_from_motion: true,
            duration_sec: 0.36,
            wave_count: 5,
            wave_spacing_pct: 5,
            wave_width_pct: 3.5,
            propagation_speed_pct_per_sec: 230,
            color_unlock: 0.76,
        },
    ],
};
export const DEFAULT_PRIMITIVE_ORB_MOTION_EFFECT = {
    preset: 'primitive_orb_motion',
    orb: DEFAULT_KINETIC_COLOR_RIPPLE_EFFECT.orb,
};
export const DEFAULT_PRIMITIVE_ORB_RING_OVERLAY_EFFECT = {
    preset: 'primitive_orb_ring_overlay',
    orb: DEFAULT_KINETIC_COLOR_RIPPLE_EFFECT.orb,
    ring: DEFAULT_KINETIC_COLOR_RIPPLE_EFFECT.ring,
};
export const DEFAULT_PRIMITIVE_DIRECTIONAL_WAVE_REVEAL_EFFECT = {
    preset: 'primitive_directional_wave_reveal',
    color_layer: DEFAULT_KINETIC_COLOR_RIPPLE_EFFECT.color_layer,
    reveal_events: DEFAULT_KINETIC_COLOR_RIPPLE_EFFECT.reveal_events,
};
export const DEFAULT_EDITORIAL_SPLIT_COLLAGE_EFFECT = {
    preset: 'editorial_split_collage',
    base_filter: 'saturate(1.18) contrast(1.12) brightness(0.94)',
    color_grade: {
        saturate: 1.18,
        contrast: 1.08,
        brightness: 0.96,
    },
    vignette: {
        enabled: true,
        opacity: 0.56,
        radius_pct: 58,
    },
    letterbox: {
        enabled: true,
        height_pct: 6.5,
    },
    grain: {
        enabled: true,
        opacity: 0.08,
        size_px: 5,
    },
    panel_style: {
        shadow: true,
        border_px: 0,
        border_color: 'rgba(255,255,255,0.16)',
        chromatic_aberration_px: 1.5,
    },
    panels: [
        {
            id: 'center_slice',
            asset_id: 'asset_panel_001',
            start_sec: 0.18,
            end_sec: 1.25,
            x_pct: 50,
            y_pct: 50,
            width_pct: 58,
            height_pct: 22,
            fit: 'cover',
            entrance: 'slide_left',
            scale_from: 0.96,
            scale_to: 1,
        },
    ],
};
export const DEFAULT_CINEMATIC_GRADE_PACK_EFFECT = {
    preset: 'cinematic_grade_pack',
    base_filter: 'saturate(1.16) contrast(1.12) brightness(0.94)',
    color_grade: {
        saturate: 1.16,
        contrast: 1.1,
        brightness: 0.96,
        hue_rotate_deg: -2,
        sepia: 0.04,
    },
    vignette: {
        enabled: true,
        opacity: 0.58,
        radius_pct: 58,
    },
    letterbox: {
        enabled: true,
        height_pct: 6.5,
    },
    grain: {
        enabled: true,
        opacity: 0.08,
        size_px: 5,
    },
    bloom: {
        enabled: true,
        opacity: 0.18,
        blur_px: 18,
    },
    chromatic_aberration: {
        enabled: true,
        offset_px: 1.5,
        opacity: 0.12,
    },
};
export const DEFAULT_AUDIO_REACTIVE_CUT_DRIVER_EFFECT = {
    preset: 'audio_reactive_cut_driver',
    base_filter: 'saturate(1.12) contrast(1.1) brightness(0.96)',
    beat_times: [0.48, 0.96, 1.44, 1.92, 2.4, 2.88],
    strong_beats: [0.96, 1.92, 2.88],
    energy_peaks: [
        { time: 0.96, intensity: 0.72, duration_sec: 0.18 },
        { time: 1.92, intensity: 0.86, duration_sec: 0.2 },
    ],
    pulse: {
        scale: 0.045,
        duration_sec: 0.18,
    },
    flash: {
        enabled: true,
        color: 'rgba(255,255,255,1)',
        opacity: 0.24,
        duration_sec: 0.12,
    },
    shake: {
        enabled: true,
        amplitude_px: 5,
        duration_sec: 0.14,
    },
};
export const DEFAULT_MASK_SLICE_TRANSITION_EFFECT = {
    preset: 'mask_slice_transition',
    base_filter: 'saturate(1.14) contrast(1.1) brightness(0.94)',
    start_sec: 0.18,
    duration_sec: 0.55,
    slice_count: 6,
    direction: 'vertical',
    mode: 'shuffle',
    stagger_sec: 0.035,
    slide_distance_pct: 28,
    slice_style: {
        gap_px: 2,
        shadow: true,
        chromatic_aberration_px: 1.5,
    },
};
export const DEFAULT_PRIMITIVE_TEXTURE_GRADE_EFFECT = {
    preset: 'primitive_texture_grade',
    base_filter: DEFAULT_CINEMATIC_GRADE_PACK_EFFECT.base_filter,
    color_grade: DEFAULT_CINEMATIC_GRADE_PACK_EFFECT.color_grade,
};
export const DEFAULT_PRIMITIVE_BLOOM_OVERLAY_EFFECT = {
    preset: 'primitive_bloom_overlay',
    bloom: DEFAULT_CINEMATIC_GRADE_PACK_EFFECT.bloom,
};
export const DEFAULT_PRIMITIVE_VIGNETTE_OVERLAY_EFFECT = {
    preset: 'primitive_vignette_overlay',
    vignette: DEFAULT_CINEMATIC_GRADE_PACK_EFFECT.vignette,
};
export const DEFAULT_PRIMITIVE_GRAIN_OVERLAY_EFFECT = {
    preset: 'primitive_grain_overlay',
    grain: DEFAULT_CINEMATIC_GRADE_PACK_EFFECT.grain,
};
export const DEFAULT_PRIMITIVE_LETTERBOX_OVERLAY_EFFECT = {
    preset: 'primitive_letterbox_overlay',
    letterbox: DEFAULT_CINEMATIC_GRADE_PACK_EFFECT.letterbox,
};
export const DEFAULT_PRIMITIVE_CHROMATIC_ABERRATION_OVERLAY_EFFECT = {
    preset: 'primitive_chromatic_aberration_overlay',
    chromatic_aberration: DEFAULT_CINEMATIC_GRADE_PACK_EFFECT.chromatic_aberration,
};
export const DEFAULT_PRIMITIVE_LIGHT_SWEEP_OVERLAY_EFFECT = {
    preset: 'primitive_light_sweep_overlay',
    sweep: DEFAULT_CINEMATIC_SWEEP_EFFECT.sweep,
};
export const DEFAULT_PRIMITIVE_BEAT_PULSE_EFFECT = {
    preset: 'primitive_beat_pulse',
    base_filter: DEFAULT_AUDIO_REACTIVE_CUT_DRIVER_EFFECT.base_filter,
    beat_times: DEFAULT_AUDIO_REACTIVE_CUT_DRIVER_EFFECT.beat_times,
    strong_beats: DEFAULT_AUDIO_REACTIVE_CUT_DRIVER_EFFECT.strong_beats,
    energy_peaks: DEFAULT_AUDIO_REACTIVE_CUT_DRIVER_EFFECT.energy_peaks,
    pulse: DEFAULT_AUDIO_REACTIVE_CUT_DRIVER_EFFECT.pulse,
    shake: DEFAULT_AUDIO_REACTIVE_CUT_DRIVER_EFFECT.shake,
};
export const DEFAULT_PRIMITIVE_BEAT_FLASH_OVERLAY_EFFECT = {
    preset: 'primitive_beat_flash_overlay',
    strong_beats: DEFAULT_AUDIO_REACTIVE_CUT_DRIVER_EFFECT.strong_beats,
    energy_peaks: DEFAULT_AUDIO_REACTIVE_CUT_DRIVER_EFFECT.energy_peaks,
    flash: DEFAULT_AUDIO_REACTIVE_CUT_DRIVER_EFFECT.flash,
};
export const DEFAULT_PRIMITIVE_BEAT_COLOR_UNLOCK_EFFECT = {
    preset: 'primitive_beat_color_unlock',
    base_filter: 'grayscale(100%) contrast(1.12) brightness(0.94)',
    color_filter: 'saturate(1.22) contrast(1.08) brightness(1)',
    reveal_mode: 'soft_wave',
    trigger_times: [0.72],
    duration_sec: 0.62,
    origin: { x_pct: 50, y_pct: 50 },
    direction: 'center_out',
    feather_pct: 9,
    hold_after: true,
};
export const DEFAULT_PRIMITIVE_COLOR_HINT_OVERLAY_EFFECT = {
    preset: 'primitive_color_hint_overlay',
    cues: [
        {
            id: 'hint_001',
            label: '色',
            color: '#22c55e',
            start_sec: 0,
            end_sec: 0.72,
            x_pct: 50,
            y_pct: 42,
        },
    ],
    square_size_pct: 5.4,
    gap_px: 10,
    font_size_px: 42,
    text_color: '#ffffff',
    fade_sec: 0.12,
};
export const DEFAULT_PRIMITIVE_FADE_OVERLAY_EFFECT = {
    preset: 'primitive_fade_overlay',
    color: '#000000',
    start_sec: 1.65,
    duration_sec: 0.45,
    direction: 'out',
    hold: true,
};
export const DEFAULT_PRIMITIVE_TRANSITION_ACCENT_OVERLAY_EFFECT = {
    preset: 'primitive_transition_accent_overlay',
    style: 'light_leak',
    start_sec: 0,
    duration_sec: 0.42,
    color: 'rgba(255,255,255,1)',
    secondary_color: 'rgba(251,191,36,0.88)',
    intensity: 0.62,
    direction: 'left_to_right',
};
export const DEFAULT_PRIMITIVE_SLICE_REVEAL_EFFECT = {
    preset: 'primitive_slice_reveal',
    start_sec: DEFAULT_MASK_SLICE_TRANSITION_EFFECT.start_sec,
    duration_sec: DEFAULT_MASK_SLICE_TRANSITION_EFFECT.duration_sec,
    slice_count: DEFAULT_MASK_SLICE_TRANSITION_EFFECT.slice_count,
    direction: DEFAULT_MASK_SLICE_TRANSITION_EFFECT.direction,
    mode: DEFAULT_MASK_SLICE_TRANSITION_EFFECT.mode,
    stagger_sec: DEFAULT_MASK_SLICE_TRANSITION_EFFECT.stagger_sec,
    slide_distance_pct: DEFAULT_MASK_SLICE_TRANSITION_EFFECT.slide_distance_pct,
    slice_style: DEFAULT_MASK_SLICE_TRANSITION_EFFECT.slice_style,
};
export const DEFAULT_PRIMITIVE_RIPPLE_DISPLACEMENT_EFFECT = {
    preset: 'primitive_ripple_displacement',
    ripple: DEFAULT_RIPPLE_EFFECT.ripple,
};
export const DEFAULT_PRIMITIVE_RIPPLE_RING_OVERLAY_EFFECT = {
    preset: 'primitive_ripple_ring_overlay',
    ripple: DEFAULT_RIPPLE_EFFECT.ripple,
    lighting: DEFAULT_RIPPLE_EFFECT.lighting,
};
export const DEFAULT_PRIMITIVE_COLLAGE_LAYOUT_EFFECT = {
    preset: 'primitive_collage_layout',
    base_filter: DEFAULT_EDITORIAL_SPLIT_COLLAGE_EFFECT.base_filter,
    color_grade: DEFAULT_EDITORIAL_SPLIT_COLLAGE_EFFECT.color_grade,
    panels: DEFAULT_EDITORIAL_SPLIT_COLLAGE_EFFECT.panels,
    panel_style: DEFAULT_EDITORIAL_SPLIT_COLLAGE_EFFECT.panel_style,
};
export const EFFECT_PRESET_REGISTRY = [
    {
        id: 'primitive_color_transform',
        label: 'Primitive Color Transform',
        description: 'Atomic color transform layer, usually used as a base grayscale or grade filter.',
        supportedAssetTypes: ['image', 'video', 'generated_video'],
        defaultEffect: DEFAULT_PRIMITIVE_COLOR_TRANSFORM_EFFECT,
        sampleUseCases: ['grayscale base', 'masked color unlock'],
        fields: [
            { path: 'base_filter', label: 'Base filter', kind: 'text' },
            { path: 'transform', label: 'Transform', kind: 'select', options: [{ value: 'grayscale_to_color_base', label: 'Grayscale base' }, { value: 'grade_filter', label: 'Grade filter' }] },
        ],
    },
    {
        id: 'primitive_mask_reveal',
        label: 'Primitive Mask Reveal',
        description: 'Atomic geometric mask reveal layer.',
        supportedAssetTypes: ['image', 'video', 'generated_video'],
        defaultEffect: DEFAULT_PRIMITIVE_MASK_REVEAL_EFFECT,
        sampleUseCases: ['circle reveal', 'rectangular reveal'],
        fields: [
            { path: 'mask.radius_pct_keyframes', label: 'Mask radius', kind: 'keyframes' },
            { path: 'mask.position_keyframes', label: 'Mask position', kind: 'keyframes' },
            { path: 'mask.beat_reactive_scale', label: 'Beat breathing', kind: 'toggle' },
        ],
    },
    {
        id: 'primitive_ring_overlay',
        label: 'Primitive Ring Overlay',
        description: 'Atomic glow ring layer that follows a mask boundary.',
        supportedAssetTypes: ['image', 'video', 'generated_video'],
        defaultEffect: DEFAULT_PRIMITIVE_RING_OVERLAY_EFFECT,
        sampleUseCases: ['portal ring', 'glowing reveal boundary'],
        fields: [
            { path: 'ring.stroke_px', label: 'Ring stroke', kind: 'number', min: 1, max: 16, step: 1 },
            { path: 'ring.colors', label: 'Ring colors', kind: 'text' },
        ],
    },
    {
        id: 'primitive_orb_motion',
        label: 'Primitive Orb Motion',
        description: 'Atomic glowing orb path layer.',
        supportedAssetTypes: ['image', 'video', 'generated_video'],
        defaultEffect: DEFAULT_PRIMITIVE_ORB_MOTION_EFFECT,
        sampleUseCases: ['orb scanner', 'probe motion'],
        fields: [
            { path: 'orb.path_keyframes', label: 'Orb path', kind: 'keyframes' },
            { path: 'orb.radius_pct', label: 'Orb radius', kind: 'number', min: 1, max: 12, step: 0.1 },
        ],
    },
    {
        id: 'primitive_orb_ring_overlay',
        label: 'Primitive Orb Ring Overlay',
        description: 'Atomic lagging ring layer that follows an orb path.',
        supportedAssetTypes: ['image', 'video', 'generated_video'],
        defaultEffect: DEFAULT_PRIMITIVE_ORB_RING_OVERLAY_EFFECT,
        sampleUseCases: ['orb follow ring', 'lagging neon ring'],
        fields: [
            { path: 'ring.lag_frames', label: 'Ring lag frames', kind: 'number', min: 0, max: 24, step: 1 },
            { path: 'ring.radius_multiplier', label: 'Ring radius multiplier', kind: 'number', min: 1, max: 5, step: 0.05 },
        ],
    },
    {
        id: 'primitive_directional_wave_reveal',
        label: 'Primitive Directional Wave Reveal',
        description: 'Atomic wave reveal layer driven by reveal events.',
        supportedAssetTypes: ['image', 'video', 'generated_video'],
        defaultEffect: DEFAULT_PRIMITIVE_DIRECTIONAL_WAVE_REVEAL_EFFECT,
        sampleUseCases: ['directional color unlock', 'burst reveal wave'],
        fields: [
            { path: 'reveal_events', label: 'Reveal events', kind: 'keyframes' },
            { path: 'color_layer.accumulate', label: 'Accumulate color', kind: 'toggle' },
        ],
    },
    {
        id: 'primitive_texture_grade',
        label: 'Primitive Texture Grade',
        description: 'Atomic color grade and base filter layer.',
        supportedAssetTypes: ['image', 'video', 'generated_video'],
        defaultEffect: DEFAULT_PRIMITIVE_TEXTURE_GRADE_EFFECT,
        sampleUseCases: ['film grade', 'scene color balance'],
        fields: [
            { path: 'base_filter', label: 'Base filter', kind: 'text' },
            { path: 'color_grade.saturate', label: 'Saturation', kind: 'number', min: 0, max: 2.5, step: 0.01 },
        ],
    },
    {
        id: 'primitive_bloom_overlay',
        label: 'Primitive Bloom Overlay',
        description: 'Atomic bloom glow overlay.',
        supportedAssetTypes: ['image', 'video', 'generated_video'],
        defaultEffect: DEFAULT_PRIMITIVE_BLOOM_OVERLAY_EFFECT,
        sampleUseCases: ['soft glow', 'highlight bloom'],
        fields: [{ path: 'bloom.opacity', label: 'Bloom opacity', kind: 'number', min: 0, max: 1, step: 0.01 }],
    },
    {
        id: 'primitive_vignette_overlay',
        label: 'Primitive Vignette Overlay',
        description: 'Atomic vignette darkening overlay.',
        supportedAssetTypes: ['image', 'video', 'generated_video'],
        defaultEffect: DEFAULT_PRIMITIVE_VIGNETTE_OVERLAY_EFFECT,
        sampleUseCases: ['cinematic vignette', 'edge darkening'],
        fields: [{ path: 'vignette.opacity', label: 'Vignette opacity', kind: 'number', min: 0, max: 1, step: 0.01 }],
    },
    {
        id: 'primitive_grain_overlay',
        label: 'Primitive Grain Overlay',
        description: 'Atomic film grain overlay.',
        supportedAssetTypes: ['image', 'video', 'generated_video'],
        defaultEffect: DEFAULT_PRIMITIVE_GRAIN_OVERLAY_EFFECT,
        sampleUseCases: ['film grain', 'texture noise'],
        fields: [{ path: 'grain.opacity', label: 'Grain opacity', kind: 'number', min: 0, max: 0.4, step: 0.01 }],
    },
    {
        id: 'primitive_letterbox_overlay',
        label: 'Primitive Letterbox Overlay',
        description: 'Atomic cinematic letterbox bars.',
        supportedAssetTypes: ['image', 'video', 'generated_video'],
        defaultEffect: DEFAULT_PRIMITIVE_LETTERBOX_OVERLAY_EFFECT,
        sampleUseCases: ['widescreen bars', 'film aspect ratio'],
        fields: [{ path: 'letterbox.height_pct', label: 'Letterbox height', kind: 'number', min: 0, max: 14, step: 0.5 }],
    },
    {
        id: 'primitive_chromatic_aberration_overlay',
        label: 'Primitive Chromatic Aberration Overlay',
        description: 'Atomic RGB edge split overlay.',
        supportedAssetTypes: ['image', 'video', 'generated_video'],
        defaultEffect: DEFAULT_PRIMITIVE_CHROMATIC_ABERRATION_OVERLAY_EFFECT,
        sampleUseCases: ['lens aberration', 'glitch edges'],
        fields: [{ path: 'chromatic_aberration.offset_px', label: 'Chroma offset', kind: 'number', min: 0, max: 8, step: 0.5 }],
    },
    {
        id: 'primitive_light_sweep_overlay',
        label: 'Primitive Light Sweep Overlay',
        description: 'Atomic moving light sweep overlay.',
        supportedAssetTypes: ['image', 'video', 'generated_video'],
        defaultEffect: DEFAULT_PRIMITIVE_LIGHT_SWEEP_OVERLAY_EFFECT,
        sampleUseCases: ['cinematic sweep', 'ambient light pass'],
        fields: [
            { path: 'sweep.position_keyframes', label: 'Sweep path', kind: 'keyframes' },
            { path: 'sweep.width_pct', label: 'Sweep width', kind: 'number', min: 4, max: 60, step: 1 },
        ],
    },
    {
        id: 'primitive_beat_pulse',
        label: 'Primitive Beat Pulse',
        description: 'Atomic beat-driven scale and shake transform.',
        supportedAssetTypes: ['image', 'video', 'generated_video'],
        defaultEffect: DEFAULT_PRIMITIVE_BEAT_PULSE_EFFECT,
        sampleUseCases: ['beat zoom', 'pulse shake'],
        fields: [
            { path: 'beat_times', label: 'Beat times', kind: 'keyframes' },
            { path: 'pulse.scale', label: 'Pulse scale', kind: 'number', min: 0, max: 0.2, step: 0.005 },
        ],
    },
    {
        id: 'primitive_beat_flash_overlay',
        label: 'Primitive Beat Flash Overlay',
        description: 'Atomic beat-triggered flash overlay.',
        supportedAssetTypes: ['image', 'video', 'generated_video'],
        defaultEffect: DEFAULT_PRIMITIVE_BEAT_FLASH_OVERLAY_EFFECT,
        sampleUseCases: ['drop flash', 'strong beat accent'],
        fields: [{ path: 'flash.opacity', label: 'Flash opacity', kind: 'number', min: 0, max: 1, step: 0.01 }],
    },
    {
        id: 'primitive_beat_color_unlock',
        label: 'Primitive Beat Color Unlock',
        description: 'Beat-triggered grayscale-to-color reveal for landscape and travel montage clips.',
        supportedAssetTypes: ['image', 'video', 'generated_video'],
        defaultEffect: DEFAULT_PRIMITIVE_BEAT_COLOR_UNLOCK_EFFECT,
        sampleUseCases: ['black-white to color on beat', 'landscape color wake-up', 'soft radial color reveal'],
        fields: [
            { path: 'trigger_times', label: 'Trigger times', kind: 'keyframes' },
            { path: 'duration_sec', label: 'Reveal duration', kind: 'number', min: 0.05, max: 3, step: 0.01 },
            { path: 'reveal_mode', label: 'Reveal mode', kind: 'select', options: [{ value: 'radial', label: 'Radial' }, { value: 'directional_wipe', label: 'Directional wipe' }, { value: 'soft_wave', label: 'Soft wave' }] },
            { path: 'origin.x_pct', label: 'Origin X', kind: 'number', min: 0, max: 100, step: 1 },
            { path: 'origin.y_pct', label: 'Origin Y', kind: 'number', min: 0, max: 100, step: 1 },
        ],
    },
    {
        id: 'primitive_color_hint_overlay',
        label: 'Primitive Color Hint Overlay',
        description: 'Small color swatch and label cue that can disappear before a color unlock.',
        supportedAssetTypes: ['image', 'video', 'generated_video'],
        defaultEffect: DEFAULT_PRIMITIVE_COLOR_HINT_OVERLAY_EFFECT,
        sampleUseCases: ['color square prompt', 'Chinese color label cue', 'beat-synced scenic hint'],
        fields: [
            { path: 'cues', label: 'Cues', kind: 'keyframes' },
            { path: 'square_size_pct', label: 'Square size', kind: 'number', min: 1, max: 16, step: 0.1 },
            { path: 'font_size_px', label: 'Font size', kind: 'number', min: 12, max: 120, step: 1 },
        ],
    },
    {
        id: 'primitive_fade_overlay',
        label: 'Primitive Fade Overlay',
        description: 'Reusable fade-to-color or fade-from-color overlay for segment endings.',
        supportedAssetTypes: ['image', 'video', 'generated_video'],
        defaultEffect: DEFAULT_PRIMITIVE_FADE_OVERLAY_EFFECT,
        sampleUseCases: ['fade to black ending', 'section fade in', 'music outro'],
        fields: [
            { path: 'start_sec', label: 'Start time', kind: 'number', min: 0, max: 60, step: 0.01 },
            { path: 'duration_sec', label: 'Duration', kind: 'number', min: 0.05, max: 5, step: 0.01 },
            { path: 'color', label: 'Color', kind: 'color' },
            { path: 'direction', label: 'Direction', kind: 'select', options: [{ value: 'in', label: 'Fade in' }, { value: 'out', label: 'Fade out' }] },
        ],
    },
    {
        id: 'primitive_transition_accent_overlay',
        label: 'Primitive Transition Accent Overlay',
        description: 'Reusable flash, light leak, color wash, or zoom-blur accent near a scene boundary.',
        supportedAssetTypes: ['image', 'video', 'generated_video'],
        defaultEffect: DEFAULT_PRIMITIVE_TRANSITION_ACCENT_OVERLAY_EFFECT,
        sampleUseCases: ['flash cut', 'light leak transition', 'color wash between travel shots'],
        fields: [
            { path: 'style', label: 'Style', kind: 'select', options: [{ value: 'flash', label: 'Flash' }, { value: 'light_leak', label: 'Light leak' }, { value: 'color_wash', label: 'Color wash' }, { value: 'zoom_blur', label: 'Zoom blur' }] },
            { path: 'start_sec', label: 'Start time', kind: 'number', min: 0, max: 60, step: 0.01 },
            { path: 'duration_sec', label: 'Duration', kind: 'number', min: 0.05, max: 3, step: 0.01 },
            { path: 'intensity', label: 'Intensity', kind: 'number', min: 0, max: 1, step: 0.01 },
            { path: 'color', label: 'Color', kind: 'color' },
        ],
    },
    {
        id: 'primitive_slice_reveal',
        label: 'Primitive Slice Reveal',
        description: 'Atomic masked slice transition reveal.',
        supportedAssetTypes: ['image', 'video', 'generated_video'],
        defaultEffect: DEFAULT_PRIMITIVE_SLICE_REVEAL_EFFECT,
        sampleUseCases: ['editorial slice', 'staggered reveal'],
        fields: [
            { path: 'slice_count', label: 'Slice count', kind: 'number', min: 1, max: 24, step: 1 },
            { path: 'direction', label: 'Direction', kind: 'select', options: [{ value: 'horizontal', label: 'Horizontal' }, { value: 'vertical', label: 'Vertical' }] },
        ],
    },
    {
        id: 'primitive_ripple_displacement',
        label: 'Primitive Ripple Displacement',
        description: 'Atomic SVG displacement ripple layer.',
        supportedAssetTypes: ['image', 'video', 'generated_video'],
        defaultEffect: DEFAULT_PRIMITIVE_RIPPLE_DISPLACEMENT_EFFECT,
        sampleUseCases: ['water ripple', 'point activation'],
        fields: [{ path: 'ripple.amplitude_px', label: 'Amplitude', kind: 'number', min: 0, max: 80, step: 1 }],
    },
    {
        id: 'primitive_ripple_ring_overlay',
        label: 'Primitive Ripple Ring Overlay',
        description: 'Atomic ripple ring lighting overlay.',
        supportedAssetTypes: ['image', 'video', 'generated_video'],
        defaultEffect: DEFAULT_PRIMITIVE_RIPPLE_RING_OVERLAY_EFFECT,
        sampleUseCases: ['ripple glow ring', 'energy wave highlight'],
        fields: [{ path: 'lighting.ring_opacity', label: 'Ring opacity', kind: 'number', min: 0, max: 1, step: 0.01 }],
    },
    {
        id: 'primitive_collage_layout',
        label: 'Primitive Collage Layout',
        description: 'Atomic multi-panel collage layout layer.',
        supportedAssetTypes: ['image', 'video', 'generated_video'],
        defaultEffect: DEFAULT_PRIMITIVE_COLLAGE_LAYOUT_EFFECT,
        sampleUseCases: ['split collage', 'triptych panels'],
        fields: [{ path: 'panels', label: 'Panels', kind: 'keyframes' }],
    },
    {
        id: 'audio_reactive_cut_driver',
        label: 'Audio Reactive Cut Driver',
        description: 'Beat and energy timing driver that adds pulse zoom, flash, and shake to clips.',
        supportedAssetTypes: ['image', 'video', 'generated_video'],
        defaultEffect: DEFAULT_AUDIO_REACTIVE_CUT_DRIVER_EFFECT,
        sampleUseCases: ['beat-synced montage', 'music video cuts', 'drop accent'],
        fields: [
            { path: 'beat_times', label: 'Beat times', kind: 'keyframes' },
            { path: 'strong_beats', label: 'Strong beats', kind: 'keyframes' },
            { path: 'energy_peaks', label: 'Energy peaks', kind: 'keyframes' },
            { path: 'pulse.scale', label: 'Pulse scale', kind: 'number', min: 0, max: 0.2, step: 0.005 },
            { path: 'shake.amplitude_px', label: 'Shake amplitude', kind: 'number', min: 0, max: 40, step: 1 },
        ],
    },
    {
        id: 'cinematic_grade_pack',
        label: 'Cinematic Grade Pack',
        description: 'Reusable film grade layer with vignette, grain, letterbox, bloom, and chromatic edges.',
        supportedAssetTypes: ['image', 'video', 'generated_video'],
        defaultEffect: DEFAULT_CINEMATIC_GRADE_PACK_EFFECT,
        sampleUseCases: ['travel montage grade', 'film look', 'unified visual style'],
        fields: [
            { path: 'color_grade.saturate', label: 'Saturation', kind: 'number', min: 0, max: 2.5, step: 0.01 },
            { path: 'color_grade.contrast', label: 'Contrast', kind: 'number', min: 0, max: 2, step: 0.01 },
            { path: 'vignette.opacity', label: 'Vignette opacity', kind: 'number', min: 0, max: 1, step: 0.01 },
            { path: 'bloom.opacity', label: 'Bloom opacity', kind: 'number', min: 0, max: 1, step: 0.01 },
            { path: 'letterbox.height_pct', label: 'Letterbox height', kind: 'number', min: 0, max: 14, step: 0.5 },
        ],
    },
    {
        id: 'mask_slice_transition',
        label: 'Mask Slice Transition',
        description: 'Horizontal or vertical masked slices with staggered slide motion and chromatic edges.',
        supportedAssetTypes: ['image', 'video', 'generated_video'],
        defaultEffect: DEFAULT_MASK_SLICE_TRANSITION_EFFECT,
        sampleUseCases: ['editorial slice reveal', 'triptych lead-in', 'music-video cut'],
        fields: [
            { path: 'start_sec', label: 'Start time', kind: 'number', min: 0, max: 30, step: 0.01 },
            { path: 'duration_sec', label: 'Duration', kind: 'number', min: 0.05, max: 3, step: 0.01 },
            { path: 'slice_count', label: 'Slice count', kind: 'number', min: 1, max: 24, step: 1 },
            { path: 'direction', label: 'Direction', kind: 'select', options: [{ value: 'horizontal', label: 'Horizontal' }, { value: 'vertical', label: 'Vertical' }] },
            { path: 'mode', label: 'Mode', kind: 'select', options: [{ value: 'reveal', label: 'Reveal' }, { value: 'cover', label: 'Cover' }, { value: 'shuffle', label: 'Shuffle' }] },
        ],
    },
    {
        id: 'editorial_split_collage',
        label: 'Editorial Split Collage',
        description: 'Cinematic landscape base with horizontal slice panels, vertical triptych panels, vignette, grain, and subtle chromatic edges.',
        supportedAssetTypes: ['image', 'video', 'generated_video'],
        defaultEffect: DEFAULT_EDITORIAL_SPLIT_COLLAGE_EFFECT,
        sampleUseCases: ['landscape montage', 'travel editorial', 'west-lake collage'],
        fields: [
            { path: 'panels', label: 'Panels', kind: 'keyframes' },
            { path: 'panel_style.chromatic_aberration_px', label: 'Panel chroma offset', kind: 'number', min: 0, max: 8, step: 0.5 },
            { path: 'vignette.opacity', label: 'Vignette opacity', kind: 'number', min: 0, max: 1, step: 0.01 },
            { path: 'grain.opacity', label: 'Grain opacity', kind: 'number', min: 0, max: 0.4, step: 0.01 },
            { path: 'letterbox.height_pct', label: 'Letterbox height', kind: 'number', min: 0, max: 14, step: 0.5 },
        ],
    },
    {
        id: 'color_portal_spotlight',
        label: 'Color Portal Spotlight',
        description: 'Black-and-white base footage with a moving color portal and neon ring.',
        supportedAssetTypes: ['video', 'generated_video'],
        defaultEffect: DEFAULT_COLOR_PORTAL_EFFECT,
        sampleUseCases: ['landscape reveal', 'music-video portal', 'dreamy comparison'],
        fields: [
            { path: 'portal.position_keyframes', label: 'Portal path', kind: 'keyframes' },
            { path: 'portal.radius_pct_keyframes', label: 'Portal radius', kind: 'keyframes' },
            { path: 'portal.beat_reactive_scale', label: 'Beat breathing', kind: 'toggle' },
            { path: 'ring.stroke_px', label: 'Ring stroke', kind: 'number', min: 1, max: 16, step: 1 },
            { path: 'ring.colors', label: 'Ring colors', kind: 'text' },
        ],
    },
    {
        id: 'cinematic_light_sweep',
        label: 'Cinematic Light Sweep',
        description: 'Color grade, soft moving light sweep, vignette, grain, and letterbox.',
        supportedAssetTypes: ['video', 'generated_video'],
        defaultEffect: DEFAULT_CINEMATIC_SWEEP_EFFECT,
        sampleUseCases: ['cinematic intro', 'landscape opener', 'ambient transition'],
        fields: [
            { path: 'sweep.position_keyframes', label: 'Sweep path', kind: 'keyframes' },
            { path: 'sweep.width_pct', label: 'Sweep width', kind: 'number', min: 4, max: 60, step: 1 },
            { path: 'sweep.angle_deg', label: 'Sweep angle', kind: 'number', min: -90, max: 90, step: 1 },
            { path: 'vignette.opacity', label: 'Vignette opacity', kind: 'number', min: 0, max: 1, step: 0.01 },
            { path: 'grain.opacity', label: 'Grain opacity', kind: 'number', min: 0, max: 0.4, step: 0.01 },
        ],
    },
    {
        id: 'ripple_displacement',
        label: 'Ripple Displacement',
        description: 'SVG displacement wave expanding from a point with layered ring lighting.',
        supportedAssetTypes: ['image', 'video', 'generated_video'],
        defaultEffect: DEFAULT_RIPPLE_EFFECT,
        sampleUseCases: ['point activation', 'energy wave', 'surreal transition'],
        fields: [
            { path: 'ripple.origin.x_pct', label: 'Origin X', kind: 'number', min: 0, max: 100, step: 1 },
            { path: 'ripple.origin.y_pct', label: 'Origin Y', kind: 'number', min: 0, max: 100, step: 1 },
            { path: 'ripple.amplitude_px', label: 'Amplitude', kind: 'number', min: 0, max: 80, step: 1 },
            { path: 'ripple.width_pct', label: 'Wave width', kind: 'number', min: 2, max: 30, step: 1 },
            { path: 'ripple.radius_pct_keyframes', label: 'Radius keyframes', kind: 'keyframes' },
        ],
    },
    {
        id: 'kinetic_color_ripple',
        label: 'Kinetic Color Ripple',
        description: 'A glowing orb drives a lagging neon ring and directional ripple waves that unlock color from black-and-white footage.',
        supportedAssetTypes: ['image', 'video', 'generated_video'],
        defaultEffect: DEFAULT_KINETIC_COLOR_RIPPLE_EFFECT,
        sampleUseCases: ['orb scanner reveal', 'directional color unlock', 'magic landscape montage'],
        fields: [
            { path: 'orb.path_keyframes', label: 'Orb path', kind: 'keyframes' },
            { path: 'orb.radius_pct', label: 'Orb radius', kind: 'number', min: 1, max: 12, step: 0.1 },
            { path: 'ring.lag_frames', label: 'Ring lag frames', kind: 'number', min: 0, max: 24, step: 1 },
            { path: 'ring.radius_multiplier', label: 'Ring radius multiplier', kind: 'number', min: 1, max: 5, step: 0.05 },
            { path: 'reveal_events', label: 'Reveal events', kind: 'keyframes' },
            { path: 'color_layer.accumulate', label: 'Accumulate color', kind: 'toggle' },
        ],
    },
];
export function getEffectPresetDefinition(preset) {
    return EFFECT_PRESET_REGISTRY.find((item) => item.id === preset);
}
export function createDefaultEffect(preset) {
    const definition = getEffectPresetDefinition(preset);
    if (!definition)
        return undefined;
    return structuredClone(definition.defaultEffect);
}
export function isKnownEffectPreset(preset) {
    if (!preset)
        return false;
    return EFFECT_PRESET_REGISTRY.some((item) => item.id === preset);
}
//# sourceMappingURL=effect-registry.js.map