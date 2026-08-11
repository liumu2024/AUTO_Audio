import type { RemotionTimelineSpecV1 } from '../../../shared/types/remotion-timeline-spec.v1.js'
import type { V2PlannerInput, V2PlannerMaterialInput } from './v2-input.js'

function matchingMaterials(
  asset: RemotionTimelineSpecV1['assets'][number],
  materials: readonly V2PlannerMaterialInput[],
): V2PlannerMaterialInput[] {
  const compatible = materials.filter((material) => material.type === asset.type)
  const matches = compatible.filter((material) => {
    const idMatch = asset.id === material.id || asset.id.endsWith(`_${material.id}`)
    const sourceMatch = asset.src === material.src || asset.src === material.publicUrl
    return idMatch || sourceMatch
  })
  if (matches.length) return matches
  return asset.id === 'planner_image_asset' && compatible.length === 1 ? compatible : []
}

/**
 * Reads legacy planner-owned asset IDs into the current server-owned material
 * identity space. Ambiguous legacy assets are intentionally left untouched.
 */
export function hydrateV2TimelineAssetIds(
  spec: RemotionTimelineSpecV1,
  plannerInput: Pick<V2PlannerInput, 'materials'>,
): RemotionTimelineSpecV1 {
  const materials = plannerInput.materials ?? []
  if (!materials.length) return spec

  const replacements = new Map<string, V2PlannerMaterialInput>()
  for (const asset of spec.assets) {
    if (asset.source !== 'user_asset') continue
    const matches = matchingMaterials(asset, materials)
    if (matches.length === 1 && matches[0]!.id !== asset.id) {
      replacements.set(asset.id, matches[0]!)
    }
  }
  if (!replacements.size) return spec

  const replaceId = (id: string | undefined): string | undefined => (
    id ? replacements.get(id)?.id ?? id : undefined
  )
  const assetsById = new Map<string, RemotionTimelineSpecV1['assets'][number]>()
  for (const asset of spec.assets) {
    const material = replacements.get(asset.id)
    const id = material?.id ?? asset.id
    const authoritative = material
      ? { ...asset, id, type: material.type, src: material.src, source: 'user_asset' as const }
      : asset
    if (!assetsById.has(id) || asset.id === id) assetsById.set(id, authoritative)
  }

  return {
    ...spec,
    assets: [...assetsById.values()],
    creative_brief: spec.creative_brief
      ? {
          ...spec.creative_brief,
          image_references: spec.creative_brief.image_references.map((reference) => ({
            ...reference,
            asset_id: replaceId(reference.asset_id)!,
          })),
        }
      : undefined,
    scenes: spec.scenes.map((scene) => ({ ...scene, asset_id: replaceId(scene.asset_id) })),
    overlays: spec.overlays.map((overlay) => ({ ...overlay, asset_id: replaceId(overlay.asset_id) })),
    material_jobs: spec.material_jobs.map((job) => ({
      ...job,
      input_asset_id: replaceId(job.input_asset_id),
      output_asset_id: replaceId(job.output_asset_id),
      fallback_asset_id: replaceId(job.fallback_asset_id),
    })),
    audio: spec.audio?.map((clip) => ({ ...clip, asset_id: replaceId(clip.asset_id)! })),
  }
}
