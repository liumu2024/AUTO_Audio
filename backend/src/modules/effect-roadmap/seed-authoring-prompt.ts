import type { SeedPluginAuthoringRequestPayload } from './seed-plugin-mapper.js'

const LAYER_FALLBACK_EXAMPLES: Record<string, string> = {
  color_transform: 'primitive_color_transform',
  mask_reveal: 'primitive_mask_reveal',
  motion_driver: 'primitive_orb_motion',
  audio_driver: 'primitive_beat_pulse',
  texture_grade: 'primitive_texture_grade',
  layout: 'primitive_collage_layout',
  overlay: 'primitive_vignette_overlay',
  distortion: 'primitive_ripple_displacement',
}

export function buildSeedAuthoringPrompt(
  taskId: string,
  request: SeedPluginAuthoringRequestPayload,
): string {
  return [
    'You are SeedPluginAuthoringAgent for Remotion effect plugins.',
    'Return ONLY JSON. No Markdown.',
    'Schema:',
    JSON.stringify(
      {
        proposals: [
          {
            atom_id: 'atom_layout_collage',
            missing_atom_id: 'missing_atom_layout_collage',
            plugin_id: 'triangle_collage_layout',
            plugin_family: 'layout',
            target_layer: 'effect',
            must_match: { 'geometry.cell_shape': 'triangle' },
            can_adapt: ['duration', 'asset_crop'],
            fallback: null,
            loss_risk: [],
            manifest: {
              id: 'triangle_collage_layout',
              layerKind: 'layout',
              fallbackPreset: 'primitive_collage_layout',
              visual_grammar: ['geometry.cell_shape=triangle', 'geometry.panel_count=3'],
            },
            component_summary: 'Draft plugin proposal only; do not mutate RenderPlan.',
          },
        ],
      },
      null,
      2,
    ),
    'Rules:',
    '- Each proposal MUST preserve atom_id, target_layer, plugin_family, must_match, can_adapt, fallback, loss_risk.',
    '- manifest MUST include layerKind and fallbackPreset (primitive preset id).',
    `- fallbackPreset must be one of the known primitive presets, e.g. ${Object.values(LAYER_FALLBACK_EXAMPLES).join(', ')}.`,
    '- Do NOT rewrite must_match geometry constraints to easier shapes.',
    '- fallback must stay null unless an existing registry plugin is explicitly compatible.',
    '- If unsure, set fallbackPreset from layerKind defaults:',
    JSON.stringify(LAYER_FALLBACK_EXAMPLES, null, 2),
    `task_id=${taskId}`,
    `authoring_request=${JSON.stringify(request, null, 2)}`,
  ].join('\n\n')
}
