import { createHash } from 'node:crypto'
import path from 'node:path'

import type { RemotionTimelineAsset } from '../../../shared/types/remotion-timeline-spec.v1.js'
import type { V2PlannerInput } from './v2-input.js'

export interface V2RemotionTimelinePlannerInput extends V2PlannerInput {
  imageSrc?: string
}

function resolveRepoPath(value: string): string {
  if (/^https?:\/\//i.test(value) || value.startsWith('static:')) return value
  if (path.isAbsolute(value)) return value
  return path.resolve(process.cwd(), '..', value)
}

function legacyImageAssetId(source: string): string {
  return `mat_${createHash('sha256').update(source).digest('hex').slice(0, 16)}`
}

function materialLabel(input: { name?: string; id: string; type: string }): string {
  return input.name?.trim() || `${input.type} ${input.id}`
}

export function buildPlannerAssets(input: V2RemotionTimelinePlannerInput): RemotionTimelineAsset[] {
  if (input.materials?.length) {
    return input.materials.map((material) => ({
      id: material.id,
      type: material.type,
      src: resolveRepoPath(material.src),
      source: 'user_asset',
      label: materialLabel(material),
    }))
  }

  const assets: RemotionTimelineAsset[] = []
  if (input.mainVideoPath) {
    assets.push({
      id: 'main_video_asset',
      type: 'video',
      src: resolveRepoPath(input.mainVideoPath),
      source: 'user_asset',
      label: 'User main video',
    })
  }
  if (input.imageSrc || input.inputImageUrl) {
    assets.push({
      id: legacyImageAssetId(input.imageSrc ?? input.inputImageUrl as string),
      type: 'image',
      src: input.imageSrc ? resolveRepoPath(input.imageSrc) : input.inputImageUrl as string,
      source: input.imageSrc ? 'user_asset' : 'stock_asset',
      label: 'Planner image asset',
    })
  }
  return assets
}
