import type { CapabilityPluginManifest } from '../../../types/capability-registry.v1.js'

export const SCENIC_FILM_GRADE_PLUGINS: CapabilityPluginManifest[] = [
  {
    id: 'scenic_film_grade',
    label: 'Scenic Film Grade',
    status: 'verified',
    targetLayer: 'effect',
    layerKind: 'texture_grade',
    atomicity: 'atomic',
    family: 'cinematic_grade',
    primaryLayer: 'texture_grade',
    secondaryLayers: [],
    fallbackPreset: 'primitive_texture_grade',
    capabilities: [
      'scenic film grade',
      'landscape cinematic grade',
      'travel montage grade',
      'warm sunset grade',
      'clean nature grade',
      '风景电影感调色',
      '旅拍调色',
      '治愈风景质感',
    ],
    requiredParams: [],
    defaultParams: {
      base_filter: 'saturate(1.16) contrast(1.1) brightness(0.96)',
      color_grade: {
        saturate: 1.16,
        contrast: 1.1,
        brightness: 0.96,
        hue_rotate_deg: -2,
        sepia: 0.03,
      },
    },
    compatibleLayers: ['color_transform', 'mask_reveal', 'audio_driver', 'overlay', 'layout'],
    acceptedAssetTypes: ['image', 'video', 'generated_video'],
    negativeKeywords: ['watermark only', 'layout only', 'hard mask shape'],
    boundary: {
      supports: {
        'style.texture': ['cinematic', 'film', 'travel', 'landscape', 'natural'],
        'style.grade': ['warm', 'clean', 'high_saturation', 'sunset', 'nature'],
      },
      cannotSupport: [],
      forbiddenLayers: [],
      requiresCompositionFor: ['grain', 'vignette', 'letterbox', 'bloom'],
      adaptability: {
        style: 'high',
        timing: 'high',
        geometry: 'high',
        assets: 'high',
      },
    },
    description:
      'Stable scenic/travel film grade manifest mapped to the texture-grade primitive, avoiding generated TSX for common landscape grading.',
  },
]
