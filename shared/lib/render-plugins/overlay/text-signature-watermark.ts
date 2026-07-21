import type { CapabilityPluginManifest } from '../../../types/capability-registry.v1.js'
import { SCENIC_OVERLAY_PLUGINS } from './scenic-overlays.js'
import { TRANSITION_TYPOGRAPHY_PLUGINS } from './transition-typography.js'

export const OVERLAY_PLUGINS: CapabilityPluginManifest[] = [
  ...SCENIC_OVERLAY_PLUGINS,
  ...TRANSITION_TYPOGRAPHY_PLUGINS,
  {
    id: 'text_signature_watermark',
    label: 'Text Signature Watermark',
    status: 'verified',
    targetLayer: 'overlay',
    layerKind: 'overlay',
    atomicity: 'atomic',
    family: 'text_watermark',
    primaryLayer: 'overlay',
    secondaryLayers: [],
    capabilities: ['watermark', 'signature text', 'logo text', '水印', '署名', '角标', '字幕'],
    requiredParams: ['text_content'],
    defaultParams: {
      opacity: 0.18,
      position: 'bottom-center',
    },
    compatibleLayers: ['texture_grade'],
    acceptedAssetTypes: ['text'],
    negativeKeywords: ['full frame grade', 'ripple', 'portal'],
    boundary: {
      supports: {
        'overlay.type': ['watermark', 'signature', 'caption'],
        'overlay.content': ['text'],
      },
      cannotSupport: [
        'geometry.layout=collage',
        'geometry.mask_shape=circle',
        'style.color_transform=grayscale_to_color',
      ],
      forbiddenLayers: ['layout', 'mask_reveal', 'motion_driver', 'distortion', 'color_transform', 'texture_grade', 'color_grade'],
      requiresCompositionFor: ['texture_grade'],
      adaptability: {
        style: 'medium',
        timing: 'medium',
        geometry: 'none',
        assets: 'medium',
      },
    },
  },
]
