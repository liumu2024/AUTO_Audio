export const PRIMITIVE_PRESET_IDS = [
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
];
const PRIMITIVE_PRESET_SET = new Set(PRIMITIVE_PRESET_IDS);
export function isPrimitivePreset(preset) {
    if (!preset)
        return false;
    return PRIMITIVE_PRESET_SET.has(preset);
}
/** Legacy composite presets that compile into primitive layers at build/render time. */
export const LEGACY_COMPOSITE_PRESET_IDS = [
    'color_portal_spotlight',
    'kinetic_color_ripple',
    'cinematic_grade_pack',
    'cinematic_light_sweep',
    'audio_reactive_cut_driver',
    'mask_slice_transition',
    'ripple_displacement',
    'editorial_split_collage',
];
export function isLegacyCompositePreset(preset) {
    if (!preset)
        return false;
    return LEGACY_COMPOSITE_PRESET_IDS.includes(preset);
}
//# sourceMappingURL=primitive-presets.js.map