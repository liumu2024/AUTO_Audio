import type { CapabilityPluginManifest } from '../../../types/capability-registry.v1.js'

export const BEAT_COLOR_UNLOCK_REVEAL_PLUGINS: CapabilityPluginManifest[] = [
  {
    id: 'beat_color_unlock_reveal',
    label: 'Beat Color Unlock Reveal',
    status: 'verified',
    targetLayer: 'effect',
    layerKind: 'mask_reveal',
    atomicity: 'atomic',
    family: 'color_unlock',
    primaryLayer: 'mask_reveal',
    secondaryLayers: ['color_transform', 'audio_driver'],
    fallbackPreset: 'primitive_beat_color_unlock',
    capabilities: [
      'beat color unlock',
      'grayscale to color reveal',
      'black white to color on beat',
      'directional wave color reveal',
      'soft radial color reveal',
      'color wake-up',
      '风景黑白转彩',
      '节拍色彩唤醒',
      '卡点转彩',
    ],
    requiredParams: [],
    defaultParams: {
      reveal_mode: 'soft_wave',
      duration_sec: 0.62,
      direction: 'center_out',
      feather_pct: 9,
    },
    compatibleLayers: ['color_transform', 'texture_grade', 'audio_driver', 'overlay', 'motion_driver'],
    acceptedAssetTypes: ['image', 'video', 'generated_video'],
    negativeKeywords: ['collage', 'triangle layout', 'water ripple only', 'text only'],
    boundary: {
      supports: {
        'style.color_transform': ['grayscale_to_color'],
        'style.scope': ['full_frame', 'masked_region'],
        'mask.motion': ['radial', 'directional_wave', 'soft_wave', 'wipe'],
        'sync.driver': ['audio_beat', 'manual'],
      },
      cannotSupport: ['geometry.layout=collage', 'geometry.primitive=triangle'],
      forbiddenLayers: ['layout', 'distortion'],
      requiresCompositionFor: ['color_hint_overlay', 'cinematic_grade', 'beat_flash'],
      adaptability: {
        style: 'high',
        timing: 'high',
        geometry: 'medium',
        assets: 'high',
      },
    },
    description:
      'Generic scenic montage reveal that unlocks color from grayscale on beats using radial, wipe, or soft-wave masks.',
  },
]
