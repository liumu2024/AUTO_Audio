import type { CapabilityRegistryItem } from '../component-registry'
import {
  BeatCutDriverPlugin,
  CinematicTextureGradePlugin,
  FinalBurstRevealPlugin,
  LayoutWindowMaskPlugin,
  OrbMotionDriverPlugin,
  SplitCollageLayoutPlugin,
  TextSignatureWatermarkPlugin,
  WaterRippleDistortionOverlayPlugin,
} from './core-visual-plugins'
import { RENDER_PLUGIN_MANIFESTS } from '../../../shared/lib/render-plugin-manifest'

const COMPONENT_BY_ID = {
  orb_motion_driver: OrbMotionDriverPlugin,
  water_ripple_distortion_overlay: WaterRippleDistortionOverlayPlugin,
  final_burst_reveal: FinalBurstRevealPlugin,
  beat_cut_driver: BeatCutDriverPlugin,
  cinematic_texture_grade: CinematicTextureGradePlugin,
  layout_window_mask: LayoutWindowMaskPlugin,
  split_collage_layout: SplitCollageLayoutPlugin,
  text_signature_watermark: TextSignatureWatermarkPlugin,
} as const

function toRegistryItem(
  manifest: (typeof RENDER_PLUGIN_MANIFESTS)[number],
): CapabilityRegistryItem {
  const component =
    manifest.id in COMPONENT_BY_ID
      ? COMPONENT_BY_ID[manifest.id as keyof typeof COMPONENT_BY_ID]
      : undefined
  return {
    id: manifest.id,
    label: manifest.label,
    status: manifest.status,
    layerKind: manifest.layerKind,
    targetLayer: manifest.targetLayer,
    fallbackPreset: manifest.fallbackPreset,
    capabilities: manifest.capabilities,
    requiredParams: manifest.requiredParams,
    defaultParams: manifest.defaultParams,
    compatibleLayers: manifest.compatibleLayers,
    acceptedAssetTypes: manifest.acceptedAssetTypes as CapabilityRegistryItem['acceptedAssetTypes'],
    atomicity: manifest.atomicity,
    family: manifest.family,
    primaryLayer: manifest.primaryLayer,
    secondaryLayers: manifest.secondaryLayers,
    boundary: manifest.boundary as Record<string, unknown> | undefined,
    ...(component ? { component } : {}),
  }
}

export const BUILTIN_CAPABILITY_REGISTRY: CapabilityRegistryItem[] =
  RENDER_PLUGIN_MANIFESTS.map((manifest) => toRegistryItem(manifest))

/** @deprecated use BUILTIN_CAPABILITY_REGISTRY */
export const BUILTIN_COMPONENT_REGISTRY = BUILTIN_CAPABILITY_REGISTRY.filter(
  (item): item is CapabilityRegistryItem & { component: NonNullable<CapabilityRegistryItem['component']> } =>
    Boolean(item.component),
)
