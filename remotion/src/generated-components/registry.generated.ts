// Registers verified AI-authored Remotion components for runtime lookup.
import type { GeneratedComponentRegistryItem } from '../component-registry'

import Component0 from './gen_cap_001/component'

export const GENERATED_COMPONENT_REGISTRY: GeneratedComponentRegistryItem[] = [
  {
    id: "gen_cap_001",
    label: "cap_001",
    status: 'verified',
    layerKind: "composite",
    targetLayer: "effect",
    component: Component0,
    fallbackPreset: "primitive_ripple_displacement",
    capabilities: ["静态参考素材动态运动模拟组件，为静态图片添加适配原片节奏的缓动运动轨迹，补足静态素材动态属性不足的问题"],
    requiredParams: [],
    defaultParams: {},
    compatibleLayers: [],
    supportedAssetTypes: ["image","video"],
    acceptedAssetTypes: ["image","video"],
  },
]
