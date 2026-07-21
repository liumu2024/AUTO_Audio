import type { CompositionRecipe } from '../types/composition-recipe.v1.js'

export const COMPOSITION_RECIPES: CompositionRecipe[] = [
  {
    recipe_id: 'grayscale_color_unlock.v1',
    intent_id: 'grayscale_color_unlock',
    label: '灰度解锁',
    required_layers: [
      { layer: 'color_transform', provides: 'grayscale_base' },
      { layer: 'mask_reveal', provides: 'color_reveal' },
    ],
    optional_layers: [
      { layer: 'overlay', provides: 'color_hint_overlay', optional: true },
      { layer: 'motion_driver', provides: 'ring_overlay', optional: true },
      { layer: 'audio_driver', provides: 'beat_sync', optional: true },
      { layer: 'texture_grade', provides: 'cinematic_grade', optional: true },
    ],
    validation: [
      'must_have_color_base',
      'must_have_reveal_layer',
      'reveal_timing_within_segment',
    ],
    forbidden_fallbacks: ['rectangle_collage_for_triangle'],
  },
  {
    recipe_id: 'orb_driven_color_wave.v1',
    intent_id: 'orb_driven_color_wave',
    label: '光球驱动彩色波纹',
    required_layers: [
      { layer: 'color_transform', provides: 'grayscale_base' },
      { layer: 'motion_driver', provides: 'orb_motion' },
      { layer: 'mask_reveal', provides: 'directional_wave' },
    ],
    optional_layers: [
      { layer: 'motion_driver', provides: 'ring_overlay', optional: true },
      { layer: 'distortion', provides: 'ripple_displacement', optional: true },
      { layer: 'audio_driver', provides: 'beat_sync', optional: true },
    ],
    validation: [
      'must_have_color_base',
      'must_have_orb_motion',
      'must_have_wave_reveal',
      'orb_wave_origin_bound',
    ],
  },
  {
    recipe_id: 'layout_collage.v1',
    intent_id: 'layout_collage',
    label: '拼贴布局',
    required_layers: [{ layer: 'layout', provides: 'collage_layout' }],
    optional_layers: [
      { layer: 'texture_grade', provides: 'cinematic_grade', optional: true },
      { layer: 'audio_driver', provides: 'beat_sync', optional: true },
    ],
    validation: ['must_have_layout_layer', 'geometry_shape_supported'],
    forbidden_fallbacks: ['rectangle_collage_for_triangle'],
  },
  {
    recipe_id: 'cinematic_texture_grade.v1',
    intent_id: 'cinematic_texture_grade',
    label: '电影质感调色',
    required_layers: [{ layer: 'texture_grade', provides: 'cinematic_grade' }],
    optional_layers: [{ layer: 'overlay', provides: 'light_sweep', optional: true }],
    validation: ['must_have_texture_grade'],
  },
  {
    recipe_id: 'beat_sync_montage.v1',
    intent_id: 'beat_sync_montage',
    label: '节拍剪辑',
    required_layers: [{ layer: 'audio_driver', provides: 'beat_sync' }],
    optional_layers: [
      { layer: 'motion_driver', provides: 'beat_pulse', optional: true },
      { layer: 'overlay', provides: 'beat_flash', optional: true },
    ],
    validation: ['must_have_audio_driver'],
  },
]

export function recipeForIntent(intentId: string): CompositionRecipe | undefined {
  return COMPOSITION_RECIPES.find((recipe) => recipe.intent_id === intentId)
}

export function recipeLabel(intentId: string): string {
  return recipeForIntent(intentId)?.label ?? intentId
}
