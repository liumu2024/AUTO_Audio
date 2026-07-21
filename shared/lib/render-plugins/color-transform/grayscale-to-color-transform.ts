import type { CapabilityPluginManifest } from '../../../types/capability-registry.v1.js'

export const COLOR_TRANSFORM_PLUGINS: CapabilityPluginManifest[] = [
  {
    id: 'grayscale_to_color_transform',
    label: 'Grayscale To Color Transform',
    status: 'verified',
    targetLayer: 'effect',
    layerKind: 'color_transform',
    atomicity: 'atomic',
    family: 'color_unlock',
    primaryLayer: 'color_transform',
    secondaryLayers: [],
    fallbackPreset: 'primitive_color_transform',
    capabilities: ['grayscale to color', 'black white to color', 'color unlock', '黑白转彩', '灰度转彩'],
    requiredParams: [],
    defaultParams: {
      base_filter: 'grayscale(100%) contrast(1.08)',
    },
    compatibleLayers: ['mask_reveal', 'motion_driver', 'audio_driver', 'texture_grade'],
    acceptedAssetTypes: ['image', 'video', 'generated_video'],
    negativeKeywords: ['orb only', 'split collage', 'water ripple'],
    boundary: {
      supports: {
        'style.color_transform': ['grayscale_to_color'],
        'style.scope': ['full_frame', 'masked_region'],
      },
      cannotSupport: [
        'geometry.mask_shape=circle',
        'motion.object=orb',
        'geometry.layout=collage',
        'distortion.family=water_ripple',
      ],
      forbiddenLayers: ['mask_reveal', 'motion_driver', 'layout', 'distortion', 'overlay'],
      requiresCompositionFor: ['mask_reveal', 'orb_motion', 'collage_layout'],
      adaptability: {
        style: 'high',
        timing: 'low',
        geometry: 'none',
        assets: 'medium',
      },
    },
    description: 'Atomic color transform for grayscale base and color unlock. It does not provide the reveal mask or ring motion.',
  },
]
