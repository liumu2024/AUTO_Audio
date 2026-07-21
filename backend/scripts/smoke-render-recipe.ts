import assert from 'node:assert/strict'

import { compileSceneEffectRecipe } from '../../shared/lib/render-recipe-compiler.js'
import { buildRenderPlanFromStructure } from '../../shared/lib/render-plan-builder.js'
import type { MigrationProtocolV12 } from '../../shared/types/migration-protocol.v1.2.js'
import type { UserMaterialDto } from '../../shared/types/pipeline.js'

function baseStructure(input: {
  taskId: string
  duration: number
  anchors: Array<{ id: string; start: number; end: number; role: string }>
  renderRecipe: MigrationProtocolV12['render_recipe']
}): MigrationProtocolV12 {
  return {
    version: '1.2',
    metadata: {
      video_id: input.taskId,
      duration_sec: input.duration,
    },
    source_video: {
      url: '',
      duration: input.duration,
    },
    generated_video: {
      url: '',
      duration: input.duration,
    },
    semantic_anchors: input.anchors.map((anchor) => ({
      anchor_id: anchor.id,
      start_sec: anchor.start,
      end_sec: anchor.end,
      sequence: {
        from_sec: anchor.start,
        duration_sec: anchor.end - anchor.start,
        layout: 'fill',
        premount_sec: 0.5,
      },
      logic_intent: {
        marketing_role: anchor.role,
        emotion_vibe: 'cinematic',
      },
      match: {
        status: 'gap',
        asset_name: null,
        asset_id: `slot_${anchor.id}`,
      },
      replication_instructions: {
        visual_generation_prompt: `${anchor.role} visual`,
        overlay_rewrite_instruction: '',
        visual_motion: {
          preset: 'push_in',
          intensity: 0.2,
          easing: 'ease-out',
          driver: 'useCurrentFrame',
        },
      },
    })),
    transitions: [],
    render_recipe: input.renderRecipe,
  }
}

function assertEffect(
  plan: ReturnType<typeof buildRenderPlanFromStructure>,
  anchorId: string,
  preset: string,
): void {
  const scene = plan.scenes.find((item) => item.source_anchor_id === anchorId)
  assert.ok(scene, `scene for ${anchorId} should exist`)
  assert.equal(scene.effects?.preset, preset)
}

function assertEffectLayers(
  plan: ReturnType<typeof buildRenderPlanFromStructure>,
  anchorId: string,
  presets: string[],
): void {
  const scene = plan.scenes.find((item) => item.source_anchor_id === anchorId)
  assert.ok(scene, `scene for ${anchorId} should exist`)
  const actual = new Set((scene.effect_layers ?? []).map((layer) => layer.preset))
  for (const preset of presets) {
    assert.ok(actual.has(preset), `scene ${anchorId} should include layer ${preset}; got ${[...actual].join(', ')}`)
  }
}

const kinetic = baseStructure({
  taskId: 'smoke_kinetic',
  duration: 9.75,
  anchors: [
    { id: 'seg_001', start: 0, end: 3, role: 'orb_rise_intro' },
    { id: 'seg_002', start: 3, end: 6, role: 'orb_fast_probe' },
  ],
  renderRecipe: {
    style_family: 'orb_portal_color_ripple',
    scene_effects: [
      {
        segment_id: 'seg_001',
        plugin_id: 'grayscale_to_color_transform',
        layer: 'color_transform',
        preset: 'primitive_color_transform',
      },
      {
        segment_id: 'seg_001',
        plugin_id: 'directional_wave_reveal',
        layer: 'mask_reveal',
        preset: 'primitive_directional_wave_reveal',
        params: {
          reveal_events: [
            {
              id: 'reveal_001',
              trigger_time: 0.72,
              origin: { x_pct: 50, y_pct: 48 },
              direction_from_motion: true,
              duration_sec: 0.62,
              wave_count: 7,
              wave_spacing_pct: 7,
              wave_width_pct: 5,
              propagation_speed_pct_per_sec: 330,
              color_unlock: 1,
            },
          ],
        },
      },
      {
        segment_id: 'seg_001',
        plugin_id: 'orb_motion_driver',
        layer: 'motion_driver',
        preset: 'primitive_orb_motion',
      },
      {
        segment_id: 'seg_001',
        plugin_id: 'orb_ring_follow_overlay',
        layer: 'motion_driver',
        preset: 'primitive_orb_ring_overlay',
      },
    ],
  },
})

const editorial = baseStructure({
  taskId: 'smoke_editorial',
  duration: 9.6,
  anchors: [
    { id: 'seg_001', start: 0, end: 1.2, role: 'cinematic_open' },
    { id: 'seg_002', start: 1.2, end: 2.3, role: 'horizontal_collage' },
    { id: 'seg_003', start: 6.2, end: 7.3, role: 'triptych_collage' },
  ],
  renderRecipe: {
    style_family: 'landscape_editorial_montage',
    global_effects: [
      'primitive_texture_grade',
      'primitive_bloom_overlay',
      'primitive_vignette_overlay',
      'primitive_grain_overlay',
      'primitive_letterbox_overlay',
    ],
    scene_effects: [
      {
        segment_id: 'seg_002',
        plugin_id: 'layout_window_mask',
        layer: 'mask_reveal',
        preset: 'primitive_slice_reveal',
        params: {
          direction: 'horizontal',
          slice_count: 5,
        },
      },
      {
        segment_id: 'seg_003',
        plugin_id: 'cinematic_texture_grade',
        layer: 'texture_grade',
        preset: 'primitive_texture_grade',
      },
      {
        segment_id: 'seg_003',
        plugin_id: 'split_collage_layout',
        layer: 'layout',
        preset: 'primitive_collage_layout',
        params: {
          panels: [],
        },
      },
    ],
    audio_driver: {
      beat_times: [0.48, 0.96, 1.44, 1.92],
      strong_beats: [0.96, 1.92],
      energy_peaks: [{ time: 1.92, intensity: 0.92, duration_sec: 0.18 }],
    },
  },
})

const kineticPlan = buildRenderPlanFromStructure({
  taskId: 'smoke_kinetic',
  structure: kinetic,
  materials: [],
  aspectRatio: '4:3',
})
assertEffectLayers(kineticPlan, 'seg_001', [
  'primitive_color_transform',
  'primitive_directional_wave_reveal',
  'primitive_orb_motion',
  'primitive_orb_ring_overlay',
])
assert.equal(kineticPlan.scenes[0]?.effects?.preset, 'primitive_orb_motion')

const editorialPlan = buildRenderPlanFromStructure({
  taskId: 'smoke_editorial',
  structure: editorial,
  materials: [],
  aspectRatio: '16:9',
})
assertEffect(editorialPlan, 'seg_001', 'primitive_texture_grade')
assertEffect(editorialPlan, 'seg_002', 'primitive_slice_reveal')
assertEffect(editorialPlan, 'seg_003', 'primitive_collage_layout')
assert.ok(editorialPlan.scenes[0]?.effect_layers?.some((layer) => layer.preset === 'primitive_beat_pulse'))
assert.ok(editorialPlan.scenes[1]?.effect_layers?.some((layer) => layer.preset === 'primitive_texture_grade'))
assertEffectLayers(editorialPlan, 'seg_001', [
  'primitive_texture_grade',
  'primitive_bloom_overlay',
  'primitive_vignette_overlay',
  'primitive_grain_overlay',
  'primitive_letterbox_overlay',
])
assertEffectLayers(editorialPlan, 'seg_002', ['primitive_slice_reveal'])
assertEffectLayers(editorialPlan, 'seg_003', ['primitive_collage_layout', 'primitive_texture_grade'])

const legacyCompat = baseStructure({
  taskId: 'smoke_legacy_compat',
  duration: 3,
  anchors: [{ id: 'seg_001', start: 0, end: 3, role: 'legacy_slice' }],
  renderRecipe: {
    scene_effects: [
      {
        segment_id: 'seg_001',
        preset: 'mask_slice_transition',
        params: { direction: 'vertical', slice_count: 4 },
      },
    ],
  },
})
const legacyPlan = buildRenderPlanFromStructure({
  taskId: 'smoke_legacy_compat',
  structure: legacyCompat,
  materials: [],
})
assertEffect(legacyPlan, 'seg_001', 'primitive_slice_reveal')

const montageMaterials: UserMaterialDto[] = [
  {
    id: 'mat_001',
    material_type: 'IMAGE',
    oss_url: 'http://localhost:3001/uploads/mat_001.jpg',
    label: 'alpine meadow',
    ai_tags: ['landscape'],
    status: 'READY',
  },
  {
    id: 'mat_002',
    material_type: 'IMAGE',
    oss_url: 'http://localhost:3001/uploads/mat_002.jpg',
    label: 'blue lake',
    ai_tags: ['landscape'],
    status: 'READY',
  },
]
const groundedMontagePlan = buildRenderPlanFromStructure({
  taskId: 'smoke_grounded_montage',
  structure: editorial,
  materials: montageMaterials,
  aspectRatio: '16:9',
  sampleReference: {
    id: 'sample_001',
    name: 'sample.mp4',
    url: 'http://localhost:3001/uploads/sample.mp4',
    duration_sec: editorial.metadata.duration_sec,
  },
})
assert.equal(groundedMontagePlan.strategy, 'montage')
assert.equal(groundedMontagePlan.scenes[0]?.visual.asset_id, 'mat_001')
assert.equal(groundedMontagePlan.scenes[1]?.visual.asset_id, 'mat_002')
assert.equal(
  groundedMontagePlan.assets.some((asset) => asset.id === 'sample_reference_audio'),
  false,
)
assert.equal(
  groundedMontagePlan.scenes[0]?.audio[0]?.asset_id,
  undefined,
)

const unknownCompile = compileSceneEffectRecipe({
  recipe: {
    segment_id: 'seg_001',
    preset: 'totally_unknown_preset',
  },
  anchor: editorial.semantic_anchors[0]!,
  parentRecipe: editorial.render_recipe,
  assets: [],
})
assert.ok(unknownCompile.resolution, 'unknown preset should produce component_resolution entry')
assert.match(unknownCompile.resolution?.reason ?? '', /Unknown preset/i)
assert.equal(unknownCompile.effect, undefined)

const unknownPlan = buildRenderPlanFromStructure({
  taskId: 'smoke_unknown_preset',
  structure: {
    ...editorial,
    render_recipe: {
      scene_effects: [{ segment_id: 'seg_001', preset: 'totally_unknown_preset' }],
    },
  },
  materials: [],
})
assert.equal(unknownPlan.scenes[0]?.effects, undefined)
assert.ok(
  unknownPlan.component_resolution?.decisions.some((item) =>
    /Unknown preset/i.test(item.reason),
  ),
)

console.info('[smoke-render-recipe] OK')
console.info(
  JSON.stringify(
    {
      kinetic: kineticPlan.scenes.map((scene) => ({
        id: scene.id,
        preset: scene.effects?.preset ?? null,
        layers: (scene.effect_layers ?? []).map((layer) => layer.preset),
      })),
      editorial: editorialPlan.scenes.map((scene) => ({
        id: scene.id,
        preset: scene.effects?.preset ?? null,
      })),
      groundedMontage: groundedMontagePlan.scenes.map((scene) => ({
        id: scene.id,
        assetId: scene.visual.asset_id ?? null,
        audioAssetId: scene.audio[0]?.asset_id ?? null,
      })),
    },
    null,
    2,
  ),
)
