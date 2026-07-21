import { Img, Video, useVideoConfig } from 'remotion'

import type { RemotionSceneProps, RenderAsset } from '../types'
import { assetById, mediaSource } from './utils/assets'

export function SceneMedia({
  scene,
  assets,
  filter,
}: {
  scene: RemotionSceneProps
  assets: RenderAsset[]
  filter?: string
}) {
  const { fps } = useVideoConfig()
  const asset = assetById(assets, scene.visual.asset_id)
  const src = mediaSource(asset)
  if (!src || !asset || asset.type === 'audio') return null
  const fit = scene.visual.fit === 'contain' ? 'contain' : 'cover'
  const style = { filter, height: '100%', objectFit: fit, width: '100%' } as const
  if (asset.type === 'image') return <Img src={src} style={style} />
  return (
    <Video
      src={src}
      muted
      startFrom={scene.visual.trim ? Math.round(scene.visual.trim.start_sec * fps) : 0}
      style={style}
    />
  )
}

export function PanelMedia({
  asset,
  fit,
  filter,
  trimStartSec,
}: {
  asset: RenderAsset
  fit: 'cover' | 'contain'
  filter?: string
  trimStartSec?: number
}) {
  const { fps } = useVideoConfig()
  const src = mediaSource(asset)
  if (!src || asset.type === 'audio') return null
  const style = { filter, height: '100%', objectFit: fit, width: '100%' } as const
  if (asset.type === 'image') return <Img src={src} style={style} />
  return (
    <Video
      src={src}
      muted
      startFrom={trimStartSec ? Math.round(trimStartSec * fps) : 0}
      style={style}
    />
  )
}
