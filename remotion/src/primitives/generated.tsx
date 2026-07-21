import { AbsoluteFill } from 'remotion'

import { getGeneratedComponent } from '../component-registry'
import type { GeneratedComponentEffects, RemotionSceneProps, RenderAsset } from '../types'
import { assetById, mediaSource } from './utils/assets'

export function GeneratedComponentLayerOverlay({
  effects,
  scene,
  assets,
}: {
  effects: GeneratedComponentEffects
  scene: RemotionSceneProps
  assets: RenderAsset[]
}) {
  const asset = assetById(assets, scene.visual.asset_id)
  const src = mediaSource(asset)
  if (!asset || asset.type === 'audio') return null
  const registryItem = getGeneratedComponent(effects.component_id)
  const GeneratedComponent = registryItem?.component
  if (!GeneratedComponent) return null
  return (
    <AbsoluteFill>
      <GeneratedComponent
        src={src}
        assetType={asset.type}
        visual={scene.visual}
        effects={effects}
        assets={assets}
        scene={scene}
      />
    </AbsoluteFill>
  )
}
