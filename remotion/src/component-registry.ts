// Provides runtime lookup for verified Remotion capability plugins (layered registry).
import type { ComponentType } from 'react'

import type {
  GeneratedComponentEffects,
  RenderAsset,
  RemotionSceneProps,
  VisualLayer,
} from './types'
import { BUILTIN_CAPABILITY_REGISTRY } from './builtin-components/capability-registry'
import { GENERATED_COMPONENT_REGISTRY } from './generated-components/registry.generated'

export interface GeneratedComponentRenderProps {
  src?: string
  assetType?: RenderAsset['type']
  visual: VisualLayer
  effects: GeneratedComponentEffects
  assets: RenderAsset[]
  scene: RemotionSceneProps
}

export interface CapabilityRegistryItem {
  id: string
  label: string
  status: 'verified' | 'experimental'
  layerKind:
    | 'motion_driver'
    | 'mask_reveal'
    | 'distortion'
    | 'color_transform'
    | 'texture_grade'
    | 'color_grade'
    | 'layout'
    | 'overlay'
    | 'audio_driver'
    | 'composite'
  targetLayer: 'effect' | 'overlay'
  fallbackPreset?: string
  capabilities: string[]
  requiredParams: string[]
  defaultParams: Record<string, unknown>
  compatibleLayers: string[]
  acceptedAssetTypes: RenderAsset['type'][]
  atomicity?: 'atomic' | 'composite_legacy'
  family?: string
  primaryLayer?: CapabilityRegistryItem['layerKind']
  secondaryLayers?: CapabilityRegistryItem['layerKind'][]
  boundary?: Record<string, unknown>
  component?: ComponentType<GeneratedComponentRenderProps>
}

/** @deprecated use CapabilityRegistryItem */
export type GeneratedComponentRegistryItem = CapabilityRegistryItem & {
  component: ComponentType<GeneratedComponentRenderProps>
  fallbackPreset?: string
  supportedAssetTypes?: RenderAsset['type'][]
}

export function getCapabilityRegistryItem(
  id: string | undefined,
): CapabilityRegistryItem | undefined {
  if (!id) return undefined
  const generated = GENERATED_COMPONENT_REGISTRY.find((item) => item.id === id)
  if (generated) {
    return {
      id: generated.id,
      label: generated.label,
      status: generated.status,
      layerKind: generated.layerKind,
      targetLayer: generated.targetLayer,
      fallbackPreset: generated.fallbackPreset,
      capabilities: [],
      requiredParams: [],
      defaultParams: {},
      compatibleLayers: [],
      acceptedAssetTypes: generated.supportedAssetTypes ?? ['image', 'video', 'generated_video'],
      component: generated.component,
    }
  }
  return BUILTIN_CAPABILITY_REGISTRY.find((item) => item.id === id)
}

export function getGeneratedComponent(
  componentId: string | undefined,
): GeneratedComponentRegistryItem | undefined {
  const item = getCapabilityRegistryItem(componentId)
  if (!item?.component) return undefined
  return item as GeneratedComponentRegistryItem
}

export function listCapabilityRegistry(): CapabilityRegistryItem[] {
  return [
    ...BUILTIN_CAPABILITY_REGISTRY,
    ...GENERATED_COMPONENT_REGISTRY.map((item) => ({
      id: item.id,
      label: item.label,
      status: item.status,
      layerKind: item.layerKind,
      targetLayer: item.targetLayer,
      fallbackPreset: item.fallbackPreset,
      capabilities: [],
      requiredParams: [],
      defaultParams: {},
      compatibleLayers: [],
      acceptedAssetTypes: item.supportedAssetTypes ?? ['image', 'video', 'generated_video'],
      component: item.component,
    })),
  ]
}
