import { EFFECT_INTENT_SCHEMA_VERSION } from '../types/effect-intent.v1.js';
const MOTIF_TO_INTENT = {
    color_portal_unlock: 'grayscale_color_unlock',
    kinetic_orb_reveal: 'orb_driven_color_wave',
    layout_collage: 'layout_collage',
    cinematic_texture_grade: 'cinematic_texture_grade',
    beat_sync_montage: 'beat_sync_montage',
};
function intentFromSegment(segment) {
    const motif = segment.motif;
    const intentId = MOTIF_TO_INTENT[motif.family] ?? motif.family;
    const mustMatch = motif.must_match ?? {};
    const motionSubject = intentId === 'orb_driven_color_wave'
        ? 'orb'
        : intentId === 'grayscale_color_unlock' && motif.atom_ids.some((id) => id.includes('ring'))
            ? 'ring'
            : 'none';
    const unlockMode = mustMatch['geometry.reveal_mode'] === 'directional_wave'
        ? 'directional_wave'
        : mustMatch['geometry.mask_shape'] === 'circle'
            ? 'radial_reveal'
            : undefined;
    const syncPoints = motif.shared_timeline?.sync_points ?? [];
    const hasBeatSync = syncPoints.some((point) => point.sync.startsWith('strong_beat'));
    return {
        intent_id: intentId,
        segment_id: segment.segment_id,
        evidence_refs: motif.evidence_refs,
        style: mustMatch['style.color_transform'] === 'grayscale_to_color'
            ? 'beat_synced_reveal'
            : undefined,
        motion_subject: motionSubject,
        motion_pattern: intentId === 'orb_driven_color_wave' ? 'continuous_probe' : undefined,
        unlock_mode: unlockMode,
        reveal_mode: typeof mustMatch['geometry.reveal_mode'] === 'string'
            ? mustMatch['geometry.reveal_mode']
            : undefined,
        geometry: Object.fromEntries(Object.entries(mustMatch).map(([key, value]) => [
            key.replace(/^geometry\./, ''),
            Array.isArray(value) ? value.map(String) : value,
        ])),
        sync: hasBeatSync
            ? { driver: 'audio_beat', peak_policy: 'unlock_on_strong_beat' }
            : undefined,
        description: motif.description,
    };
}
export function effectIntentsFromRoadmap(input) {
    return {
        schema_version: EFFECT_INTENT_SCHEMA_VERSION,
        task_id: input.taskId,
        intents: input.effectRoadmap.segments.map(intentFromSegment),
    };
}
export function intentIdFromMotifFamily(family) {
    return MOTIF_TO_INTENT[family] ?? family;
}
//# sourceMappingURL=effect-intent-from-roadmap.js.map