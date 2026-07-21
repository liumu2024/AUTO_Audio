import type { DirectorGroundingResult } from '../sample-understanding/director-grounding/director-grounding.schema.js'
import type { AudioVisualUnderstandingHints } from '../../../../shared/types/sample-understanding-skills.js'
import type { EffectRoadmap } from '../../../../shared/types/effect-roadmap.v1.js'

const baseGrounding = (
  partial: Partial<DirectorGroundingResult> & Pick<DirectorGroundingResult, 'task_id'>,
): DirectorGroundingResult =>
  ({
    schema_version: 'director_grounding.v1',
    content_domain: 'landscape_montage',
    source: {
      sample_video: { id: 'sample', name: 'sample.mp4', role: 'structure_source' },
      reference_materials: [],
    },
    intent: {
      raw_text: '',
      goal: 'replicate_structure',
      style_keywords: [],
      must_keep: [],
      must_change: [],
      generation_directive: 'Replicate sample structure.',
    },
    audio_visual_evidence: {
      duration_sec: 4,
      fps: 30,
      key_observations: [],
      beat_summary: '',
    },
    temporal_events: [],
    style_summary: {
      style_family: 'sample',
      editing_pattern: 'cut',
      audio_sync_logic: 'none',
      visual_style: 'cinematic',
      pace: 'medium',
    },
    remotion_capability_plan: {
      matched_plugins: [],
      capability_layers: [],
      missing_capabilities: [],
      plugin_authoring_skill: {
        enabled: false,
        purpose: 'disabled',
        candidate_plugin_ids: [],
      },
    },
    render_recipe: {
      global_effects: [],
      scene_effects: [],
    },
    critique: {
      likely_failure_points: [],
      repair_notes: [],
      final_decision: 'usable',
    },
    ...partial,
  }) as DirectorGroundingResult

export const portalRingDirectorGroundingFixture = baseGrounding({
  task_id: 'fixture_portal_ring',
  visual_phenomena: [
    {
      id: 'phen_portal_001',
      start_sec: 0,
      end_sec: 3.2,
      type: 'grayscale_portal_color_unlock',
      mechanism: 'mask_reveal',
      description: '黑白画面通过圆形 portal 解锁彩色，外圈有发光圆环。',
      evidence: 'Center circular reveal with glowing ring on grayscale base.',
      confidence: 0.91,
    },
  ],
  temporal_events: [
    {
      id: 'seg_001',
      start_sec: 0,
      end_sec: 3.2,
      creative_role: 'opening',
      description: 'Portal color unlock opening.',
      visual_prompt: 'Grayscale lake scene with circular color portal.',
      overlay_text: '',
      emotion_vibe: 'cinematic',
      camera: 'wide',
      motion: 'push in',
      evidence_refs: ['phen_portal_001'],
      confidence: 0.9,
      visual_motion: { preset: 'push_in', intensity: 0.3, driver: 'useCurrentFrame' },
      slot_tags: ['opening'],
      accepted_material_types: ['video', 'image'],
    },
  ],
})

export const orbRippleDirectorGroundingFixture = baseGrounding({
  task_id: 'fixture_orb_ripple',
  visual_phenomena: [
    {
      id: 'phen_orb_001',
      start_sec: 0,
      end_sec: 4,
      type: 'kinetic_orb_color_ripple',
      mechanism: 'motion_driver',
      description: '光球运动触发方向性彩色 ripple 解锁。',
      evidence: 'Orb travels across frame; color unlock waves follow orb path.',
      confidence: 0.89,
    },
  ],
  temporal_events: [
    {
      id: 'seg_001',
      start_sec: 0,
      end_sec: 4,
      creative_role: 'build',
      description: 'Orb-led kinetic color ripple.',
      visual_prompt: 'Grayscale base with orb and directional color waves.',
      overlay_text: '',
      emotion_vibe: 'energetic',
      camera: 'medium',
      motion: 'track',
      evidence_refs: ['phen_orb_001'],
      confidence: 0.88,
      visual_motion: { preset: 'push_in', intensity: 0.35, driver: 'useCurrentFrame' },
      slot_tags: ['build'],
      accepted_material_types: ['video', 'image'],
    },
  ],
})

export const triangleCollageDirectorGroundingFixture = baseGrounding({
  task_id: 'fixture_triangle_collage',
  content_domain: 'landscape_montage',
  visual_phenomena: [
    {
      id: 'phen_tri_001',
      start_sec: 0,
      end_sec: 2.8,
      type: 'triangle_panel_collage',
      mechanism: 'layout',
      description: '三张三角形裁切的风景拼贴，硬边拼接。',
      evidence: 'Three triangular panels arranged as mosaic; cell shape is triangle not rectangle.',
      confidence: 0.93,
    },
  ],
  temporal_events: [
    {
      id: 'seg_001',
      start_sec: 0,
      end_sec: 2.8,
      creative_role: 'climax',
      description: 'Triangle collage montage.',
      visual_prompt: 'Three triangular landscape panels in editorial collage.',
      overlay_text: '',
      emotion_vibe: 'bold',
      camera: 'mixed',
      motion: 'static panels',
      evidence_refs: ['phen_tri_001'],
      confidence: 0.92,
      visual_motion: { preset: 'static', intensity: 0.1, driver: 'useCurrentFrame' },
      slot_tags: ['collage'],
      accepted_material_types: ['video', 'image'],
    },
  ],
  remotion_capability_plan: {
    matched_plugins: [],
    capability_layers: [],
    missing_capabilities: [
      {
        id: 'triangle_panel_layout',
        description: 'Triangle cell collage layout',
        suggested_contract: {
          target_layer: 'effect',
          segment_ids: ['seg_001'],
        },
      },
    ],
    plugin_authoring_skill: {
      enabled: false,
      purpose: 'disabled',
      candidate_plugin_ids: [],
    },
  },
})

export const portalRingSampleHintsFixture = {
  metadata: { video_duration: 3.2, fps: 30, frame_count: 96 },
  visual_keyframes: [],
  audio_features: {
    beats: [1, 2, 3],
    strong_beats: [2],
    energy_peaks: [{ time: 2, intensity: 0.8, duration_sec: 0.2 }],
    waveform: [],
    sections: [],
  },
} satisfies AudioVisualUnderstandingHints

export const expectedPortalRingRoadmapFixture: EffectRoadmap = {
  schema_version: 'effect_roadmap.v1',
  task_id: 'fixture_portal_ring',
  segments: [
    {
      segment_id: 'seg_001',
      start_sec: 0,
      end_sec: 3.2,
      motif: {
        id: 'motif_portal_001',
        family: 'color_portal_unlock',
        evidence_refs: ['phen_portal_001'],
        confidence: 0.91,
        must_match: {
          'geometry.mask_shape': 'circle',
          'style.color_transform': 'grayscale_to_color',
        },
        can_adapt: ['duration', 'color_grade', 'asset_crop'],
        atom_ids: ['atom_color_transform', 'atom_mask_reveal', 'atom_ring_overlay'],
        description: '黑白圆环 portal 彩色解锁',
      },
      atoms: [
        {
          id: 'atom_color_transform',
          layerKind: 'color_transform',
          capability_query: '保持黑白底，等待 portal 解锁后再呈现彩色',
          required_params: ['transform', 'base_filter'],
          evidence_refs: ['phen_portal_001'],
        },
        {
          id: 'atom_mask_reveal',
          layerKind: 'mask_reveal',
          capability_query: '圆形 mask 从中心扩张，露出下方彩色内容',
          required_params: ['mask.radius_pct_keyframes', 'mask.position_keyframes'],
        },
        {
          id: 'atom_ring_overlay',
          layerKind: 'motion_driver',
          capability_query: 'portal 发光圆环 overlay，跟随 mask 中心路径',
          required_params: ['ring.center_path', 'ring.radius_pct_keyframes'],
        },
      ],
      bindings: [
        {
          source: 'mask.center_path',
          target: 'ring.center_path',
          source_atom_id: 'atom_mask_reveal',
          target_atom_id: 'atom_ring_overlay',
        },
      ],
    },
  ],
  loss_ledger: [],
}

export const expectedOrbRippleRoadmapFixture: EffectRoadmap = {
  schema_version: 'effect_roadmap.v1',
  task_id: 'fixture_orb_ripple',
  segments: [
    {
      segment_id: 'seg_001',
      start_sec: 0,
      end_sec: 4,
      motif: {
        id: 'motif_orb_001',
        family: 'kinetic_orb_reveal',
        evidence_refs: ['phen_orb_001'],
        confidence: 0.89,
        must_match: {
          'geometry.reveal_mode': 'directional_wave',
          'style.color_transform': 'grayscale_to_color',
        },
        can_adapt: ['duration', 'asset_crop', 'color_grade'],
        atom_ids: [
          'atom_color_transform',
          'atom_wave_reveal',
          'atom_orb_motion',
          'atom_orb_ring',
        ],
      },
      atoms: [
        {
          id: 'atom_color_transform',
          layerKind: 'color_transform',
          capability_query: '黑白底，等待 orb 触发的彩色 ripple 解锁',
        },
        {
          id: 'atom_wave_reveal',
          layerKind: 'mask_reveal',
          capability_query: '方向性 wave reveal，在 orb 路径附近解锁彩色',
          required_params: ['reveal_events'],
        },
        {
          id: 'atom_orb_motion',
          layerKind: 'motion_driver',
          capability_query: 'Traveling orb 运动驱动 ripple 触发点',
          required_params: ['orb.path_keyframes'],
        },
        {
          id: 'atom_orb_ring',
          layerKind: 'motion_driver',
          capability_query: 'orb 跟随圆环 overlay',
          required_params: ['ring.center_path', 'orb.path_keyframes'],
        },
      ],
      bindings: [
        {
          source: 'orb.path_keyframes',
          target: 'reveal_events[].origin',
          source_atom_id: 'atom_orb_motion',
          target_atom_id: 'atom_wave_reveal',
        },
        {
          source: 'orb.path_keyframes',
          target: 'ring.center_path',
          source_atom_id: 'atom_orb_motion',
          target_atom_id: 'atom_orb_ring',
        },
      ],
    },
  ],
}

export const expectedTriangleCollageRoadmapFixture: EffectRoadmap = {
  schema_version: 'effect_roadmap.v1',
  task_id: 'fixture_triangle_collage',
  segments: [
    {
      segment_id: 'seg_001',
      start_sec: 0,
      end_sec: 2.8,
      motif: {
        id: 'motif_tri_collage_001',
        family: 'layout_collage',
        evidence_refs: ['phen_tri_001'],
        confidence: 0.93,
        must_match: {
          'geometry.cell_shape': 'triangle',
          'geometry.panel_count': 3,
          'geometry.arrangement': 'triangle_mosaic',
        },
        can_adapt: ['duration', 'asset_crop'],
        loss_risk: [
          {
            id: 'risk_triangle_unsupported',
            reason: '本地 registry 暂无 triangle cell layout 插件，禁止改写为 rectangle。',
            evidence_refs: ['phen_tri_001'],
            requested_grammar: 'geometry.cell_shape=triangle',
            severity: 'high',
          },
        ],
        atom_ids: ['atom_layout_collage'],
      },
      atoms: [
        {
          id: 'atom_layout_collage',
          layerKind: 'layout',
          capability_query: '三张三角形裁切面板的 editorial collage 布局',
          required_params: ['panels', 'geometry.cell_shape'],
          boundary: {
            cannot_support: ['geometry.cell_shape=rectangle-only'],
          },
        },
      ],
      bindings: [],
    },
  ],
  loss_ledger: [
    {
      id: 'loss_001',
      source_stage: 'roadmap_agent',
      reason: 'Triangle cell collage requested but local registry lacks triangle layout capability.',
      evidence_refs: ['phen_tri_001'],
      fallback_used: null,
      severity: 'high',
    },
  ],
}
