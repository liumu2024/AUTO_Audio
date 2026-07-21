export const validKineticOrbRevealRoadmapFixture = {
    schema_version: 'effect_roadmap.v1',
    task_id: 'fixture_kinetic_orb_reveal',
    segments: [
        {
            segment_id: 'seg_001',
            start_sec: 0,
            end_sec: 3.2,
            motif: {
                id: 'motif_kinetic_001',
                family: 'kinetic_orb_reveal',
                evidence_refs: ['phen_kinetic_001'],
                confidence: 0.89,
                must_match: {
                    'geometry.reveal_mode': 'directional_wave',
                    'style.color_transform': 'grayscale_to_color',
                },
                can_adapt: ['duration', 'asset_crop', 'color_grade'],
                shared_timeline: {
                    sync_points: [
                        { id: 'sync_beat_0', at_sec: 0.48, sync: 'strong_beat:0', atom_ids: ['atom_orb', 'atom_wave'] },
                    ],
                    phases: [
                        {
                            id: 'phase_base',
                            start_sec: 0,
                            end_sec: 0.4,
                            active_atom_ids: ['atom_gray'],
                        },
                        {
                            id: 'phase_reveal',
                            start_sec: 0.2,
                            end_sec: 3.2,
                            active_atom_ids: ['atom_orb', 'atom_wave', 'atom_ring'],
                            sync: 'strong_beat:0',
                        },
                    ],
                },
                shared_geometry: {
                    effect_group_id: 'grp_kinetic_001',
                    origin: { x_pct: 28, y_pct: 34 },
                    center_path_ref: 'atom_orb.path_keyframes',
                },
                atom_ids: ['atom_gray', 'atom_wave', 'atom_orb', 'atom_ring'],
                segment_ids: ['seg_001'],
                description: 'Grayscale base with orb-driven wave color unlock.',
            },
            atoms: [
                {
                    id: 'atom_gray',
                    layerKind: 'color_transform',
                    capability_query: 'Hold the scene in grayscale until the first color unlock wave.',
                    required_params: ['transform', 'base_filter'],
                    boundary: {
                        cannot_support: ['geometry.layout=collage'],
                    },
                },
                {
                    id: 'atom_wave',
                    layerKind: 'mask_reveal',
                    capability_query: 'Directional color unlock waves triggered near the orb path.',
                    required_params: ['reveal_events'],
                },
                {
                    id: 'atom_orb',
                    layerKind: 'motion_driver',
                    capability_query: 'Traveling orb that leads the color unlock across the frame.',
                    required_params: ['orb.path_keyframes'],
                },
                {
                    id: 'atom_ring',
                    layerKind: 'motion_driver',
                    capability_query: 'Ring overlay following the orb center path.',
                    required_params: ['ring.radius_pct', 'orb.path_keyframes'],
                },
            ],
            bindings: [
                {
                    id: 'bind_orb_to_wave_origin',
                    source: 'orb.path_keyframes',
                    target: 'reveal_events[].origin',
                    source_atom_id: 'atom_orb',
                    target_atom_id: 'atom_wave',
                },
                {
                    id: 'bind_orb_to_ring_center',
                    source: 'orb.path_keyframes',
                    target: 'ring.center_path',
                    source_atom_id: 'atom_orb',
                    target_atom_id: 'atom_ring',
                },
            ],
        },
    ],
    loss_ledger: [],
};
export const validColorPortalUnlockRoadmapFixture = {
    schema_version: 'effect_roadmap.v1',
    task_id: 'fixture_color_portal_unlock',
    segments: [
        {
            segment_id: 'seg_002',
            motif: {
                id: 'motif_portal_001',
                family: 'color_portal_unlock',
                evidence_refs: ['phen_portal_001'],
                confidence: 0.88,
                must_match: {
                    'geometry.mask_shape': 'circle',
                    'style.color_transform': 'grayscale_to_color',
                },
                can_adapt: ['duration', 'color_grade'],
                shared_geometry: {
                    effect_group_id: 'grp_portal_001',
                    origin: { x_pct: 50, y_pct: 50 },
                },
                atom_ids: ['atom_gray', 'atom_mask', 'atom_ring'],
            },
            atoms: [
                {
                    id: 'atom_gray',
                    layerKind: 'color_transform',
                    capability_query: 'Grayscale base before portal color unlock.',
                },
                {
                    id: 'atom_mask',
                    layerKind: 'mask_reveal',
                    capability_query: 'Circular portal mask expanding from center.',
                    required_params: ['mask.radius_pct_keyframes', 'mask.position_keyframes'],
                },
                {
                    id: 'atom_ring',
                    layerKind: 'motion_driver',
                    capability_query: 'Portal ring aligned to the mask center path.',
                    required_params: ['ring.center_path', 'ring.radius_pct_keyframes'],
                },
            ],
            bindings: [
                {
                    source: 'mask.center_path',
                    target: 'ring.center_path',
                    source_atom_id: 'atom_mask',
                    target_atom_id: 'atom_ring',
                },
                {
                    source: 'mask.radius_pct_keyframes',
                    target: 'ring.radius_pct_keyframes',
                    source_atom_id: 'atom_mask',
                    target_atom_id: 'atom_ring',
                },
            ],
        },
    ],
};
export const validLayoutCollageRoadmapFixture = {
    schema_version: 'effect_roadmap.v1',
    task_id: 'fixture_layout_collage',
    segments: [
        {
            segment_id: 'seg_003',
            motif: {
                id: 'motif_collage_001',
                family: 'layout_collage',
                evidence_refs: ['phen_collage_001'],
                confidence: 0.9,
                must_match: {
                    'geometry.panel_count': 3,
                    'geometry.arrangement': 'vertical_triptych',
                    'geometry.cell_shape': 'rectangle',
                },
                can_adapt: ['asset_crop', 'duration'],
                atom_ids: ['atom_collage'],
            },
            atoms: [
                {
                    id: 'atom_collage',
                    layerKind: 'layout',
                    capability_query: 'Three-panel editorial collage with staggered panel entrances.',
                    required_params: ['panels'],
                    boundary: {
                        forbidden_layers: ['mask_reveal', 'motion_driver'],
                    },
                },
            ],
            bindings: [],
        },
    ],
};
export const invalidMissingAtomIdFixture = {
    schema_version: 'effect_roadmap.v1',
    task_id: 'fixture_invalid_missing_atom_id',
    segments: [
        {
            segment_id: 'seg_001',
            motif: {
                id: 'motif_bad',
                family: 'kinetic_orb_reveal',
                evidence_refs: ['phen_bad'],
                confidence: 0.5,
                must_match: {},
                can_adapt: [],
                atom_ids: ['atom_orb'],
            },
            atoms: [
                {
                    layerKind: 'motion_driver',
                    capability_query: 'Orb without id should fail validation.',
                },
            ],
            bindings: [],
        },
    ],
};
export const invalidMissingLayerKindFixture = {
    schema_version: 'effect_roadmap.v1',
    task_id: 'fixture_invalid_missing_layer_kind',
    segments: [
        {
            segment_id: 'seg_001',
            motif: {
                id: 'motif_bad',
                family: 'kinetic_orb_reveal',
                evidence_refs: ['phen_bad'],
                confidence: 0.5,
                must_match: {},
                can_adapt: [],
                atom_ids: ['atom_orb'],
            },
            atoms: [
                {
                    id: 'atom_orb',
                    capability_query: 'Missing layerKind should fail validation.',
                },
            ],
            bindings: [],
        },
    ],
};
export const invalidForbiddenPluginFieldFixture = {
    schema_version: 'effect_roadmap.v1',
    task_id: 'fixture_invalid_forbidden_plugin_field',
    segments: [
        {
            segment_id: 'seg_001',
            motif: {
                id: 'motif_bad',
                family: 'kinetic_orb_reveal',
                evidence_refs: ['phen_bad'],
                confidence: 0.5,
                must_match: {},
                can_adapt: [],
                atom_ids: ['atom_orb'],
            },
            atoms: [
                {
                    id: 'atom_orb',
                    layerKind: 'motion_driver',
                    capability_query: 'Orb with forbidden preset field.',
                    preset: 'primitive_orb_motion',
                },
            ],
            bindings: [],
        },
    ],
};
export const invalidBindingTargetFixture = {
    schema_version: 'effect_roadmap.v1',
    task_id: 'fixture_invalid_binding_target',
    segments: [
        {
            segment_id: 'seg_001',
            motif: {
                id: 'motif_bad',
                family: 'color_portal_unlock',
                evidence_refs: ['phen_bad'],
                confidence: 0.5,
                must_match: { 'geometry.mask_shape': 'circle' },
                can_adapt: ['duration'],
                atom_ids: ['atom_mask', 'atom_ring'],
            },
            atoms: [
                {
                    id: 'atom_mask',
                    layerKind: 'mask_reveal',
                    capability_query: 'Mask reveal layer.',
                },
                {
                    id: 'atom_ring',
                    layerKind: 'motion_driver',
                    capability_query: 'Ring overlay layer.',
                },
            ],
            bindings: [
                {
                    source: 'mask.center_path',
                    target: 'ring.center_path',
                    source_atom_id: 'atom_mask',
                    target_atom_id: 'atom_missing',
                },
            ],
        },
    ],
};
//# sourceMappingURL=effect-roadmap.fixtures.js.map