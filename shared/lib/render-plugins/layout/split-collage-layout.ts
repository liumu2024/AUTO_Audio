import type { CapabilityPluginManifest } from '../../../types/capability-registry.v1.js'
import { RADIAL_TRIANGLE_PRISM_COLLAGE_PLUGIN } from './radial-triangle-prism-collage.js'

export const LAYOUT_PLUGINS: CapabilityPluginManifest[] = [
  {
    id: 'split_collage_layout',
    label: 'Split Collage Layout',
    status: 'verified',
    targetLayer: 'effect',
    layerKind: 'layout',
    atomicity: 'atomic',
    family: 'layout_collage',
    primaryLayer: 'layout',
    secondaryLayers: [],
    fallbackPreset: 'primitive_collage_layout',
    capabilities: ['split collage', 'triptych', 'multi panel', '分屏', '三联画', '拼贴'],
    requiredParams: ['panels'],
    defaultParams: { layout: 'vertical_triptych' },
    compatibleLayers: ['texture_grade', 'audio_driver'],
    acceptedAssetTypes: ['image', 'video', 'generated_video'],
    negativeKeywords: ['triangle', 'radial polygon', 'circle portal', 'grayscale reveal'],
    boundary: {
      supports: {
        'geometry.primitive': ['rectangle', 'strip'],
        'geometry.layout': ['collage', 'split_screen'],
        'geometry.arrangement.type': ['triptych', 'vertical_triptych', 'horizontal_split'],
        'geometry.panel_count': { min: 2, max: 4 },
        'geometry.boundary.type': ['hard_clip'],
      },
      cannotSupport: [
        'geometry.primitive_sides=3',
        'geometry.primitive=triangle',
        'geometry.primitive=circle',
        'geometry.arrangement.type=radial',
        'geometry.arrangement.type=polygon_mosaic',
        'style.color_transform=grayscale_to_color',
      ],
      forbiddenLayers: ['mask_reveal', 'motion_driver', 'distortion', 'overlay', 'color_transform', 'texture_grade', 'color_grade'],
      requiresCompositionFor: ['texture_grade', 'audio_driver', 'mask_reveal'],
      adaptability: {
        geometry: 'low',
        timing: 'medium',
        style: 'low',
        assets: 'high',
      },
    },
  },
  RADIAL_TRIANGLE_PRISM_COLLAGE_PLUGIN,
]
