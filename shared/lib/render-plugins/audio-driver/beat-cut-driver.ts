import type { CapabilityPluginManifest } from '../../../types/capability-registry.v1.js'

export const AUDIO_DRIVER_PLUGINS: CapabilityPluginManifest[] = [
  {
    id: 'beat_cut_driver',
    label: 'Beat Cut Driver',
    status: 'verified',
    targetLayer: 'effect',
    layerKind: 'audio_driver',
    atomicity: 'atomic',
    family: 'beat_sync',
    primaryLayer: 'audio_driver',
    secondaryLayers: [],
    fallbackPreset: 'primitive_beat_pulse',
    capabilities: ['beat cut', 'audio reactive', 'pulse', '节拍', '卡点'],
    requiredParams: ['beat_times'],
    defaultParams: {},
    compatibleLayers: ['motion_driver', 'mask_reveal', 'distortion', 'color_transform', 'texture_grade', 'layout'],
    acceptedAssetTypes: ['image', 'video', 'generated_video', 'audio'],
    boundary: {
      supports: {
        'temporal.trigger': ['beat', 'energy_peak'],
        'temporal.sync': ['cut', 'pulse', 'transition_trigger'],
      },
      cannotSupport: [
        'geometry.layout=collage',
        'geometry.mask_shape=circle',
        'style.color_transform=grayscale_to_color',
        'distortion.family=water_ripple',
      ],
      forbiddenLayers: ['layout', 'mask_reveal', 'motion_driver', 'distortion', 'color_transform', 'texture_grade', 'color_grade', 'overlay'],
      requiresCompositionFor: ['any_visual_effect'],
      adaptability: {
        timing: 'high',
        style: 'none',
        geometry: 'none',
        assets: 'medium',
      },
    },
  },
]
