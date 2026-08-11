import type { RemotionTimelineSpecV1 } from '../../../shared/types/remotion-timeline-spec.v1.js'

function referencedAssetIds(spec: RemotionTimelineSpecV1): Set<string> {
  const ids = new Set<string>()
  for (const reference of spec.creative_brief?.image_references ?? []) ids.add(reference.asset_id)
  for (const scene of spec.scenes) if (scene.asset_id) ids.add(scene.asset_id)
  for (const overlay of spec.overlays) if (overlay.asset_id) ids.add(overlay.asset_id)
  for (const clip of spec.audio ?? []) ids.add(clip.asset_id)
  for (const job of spec.material_jobs) {
    if (job.input_asset_id) ids.add(job.input_asset_id)
    if (job.output_asset_id) ids.add(job.output_asset_id)
    if (job.fallback_asset_id) ids.add(job.fallback_asset_id)
  }
  return ids
}

/**
 * Keeps the persisted resource graph closed after a scoped merge. Existing
 * assets are never guessed away; only assets introduced by the candidate and
 * left unreferenced by the merged spec are discarded.
 */
export function retainV2TimelineResourceClosure(input: {
  baseSpec: RemotionTimelineSpecV1
  candidateSpec: RemotionTimelineSpecV1
  mergedSpec: RemotionTimelineSpecV1
}): RemotionTimelineSpecV1 {
  const baseAssetIds = new Set(input.baseSpec.assets.map((asset) => asset.id))
  const referenced = referencedAssetIds(input.mergedSpec)
  const candidateAssets = new Map(input.candidateSpec.assets.map((asset) => [asset.id, asset]))
  const assets = input.mergedSpec.assets.filter((asset) =>
    baseAssetIds.has(asset.id) || referenced.has(asset.id))
  const present = new Set(assets.map((asset) => asset.id))
  for (const id of referenced) {
    if (present.has(id) || baseAssetIds.has(id)) continue
    const asset = candidateAssets.get(id)
    if (asset) {
      assets.push(asset)
      present.add(id)
    }
  }
  return { ...input.mergedSpec, assets }
}
