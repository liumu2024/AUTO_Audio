import { staticFile } from 'remotion'

import type { RenderAsset } from '../../types'

export function assetById(assets: RenderAsset[], id: string | undefined) {
  if (!id) return undefined
  return assets.find((asset) => asset.id === id)
}

export function mediaSource(asset: RenderAsset | undefined) {
  if (!asset?.url) return undefined
  if (
    /^https?:\/\//.test(asset.url) ||
    asset.url.startsWith('data:') ||
    asset.url.startsWith('file://')
  ) {
    return asset.url
  }
  return staticFile(asset.url.replace(/^\/+/, ''))
}
