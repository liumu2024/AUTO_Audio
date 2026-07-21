import path from 'node:path'

import { assertValidRemotionTimelineSpec } from '../../../shared/lib/remotion-timeline-validator.js'
import type {
  RemotionTimelineAsset,
  RemotionTimelineMaterialJob,
  RemotionTimelineSpecV1,
} from '../../../shared/types/remotion-timeline-spec.v1.js'
import { standardizeGeneratedVideoAsset } from './media-standardizer.js'
import {
  createNoopMaterialGenerationAdapter,
  type V2MaterialGenerationAdapter,
} from './material-generation-adapter.js'

export interface V2TimelineMaterialResolutionReport {
  schema_version: 'v2_timeline_material_resolution.v1'
  ok: boolean
  fulfilled_jobs: string[]
  failed_jobs: Array<{
    id: string
    reason: string
  }>
  resolved_assets: RemotionTimelineAsset[]
  generation_trace: Array<{
    id: string
    scene_id: string
    type: string
    prompt?: string
    input_image_url?: string
    output_asset_id?: string
    provider_task_id?: string
    status: 'fulfilled' | 'fallback' | 'failed'
    elapsed_ms: number
    standardized_src?: string
    error?: string
  }>
}

function assetById(assets: RemotionTimelineAsset[], id: string | undefined) {
  if (!id) return undefined
  return assets.find((asset) => asset.id === id)
}

function convertGeneratedAsset(input: {
  id: string
  type: 'video' | 'image'
  src: string
  label?: string
}): RemotionTimelineAsset {
  return {
    id: input.id,
    type: input.type,
    src: input.src,
    source: 'generated_asset',
    label: input.label,
  }
}

function fallbackAsset(input: {
  job: RemotionTimelineMaterialJob
  currentAssets: RemotionTimelineAsset[]
}): RemotionTimelineAsset | undefined {
  if (!input.job.output_asset_id) return undefined
  if (!input.job.fallback_asset_id) return undefined
  const source = assetById(input.currentAssets, input.job.fallback_asset_id)
  if (!source) return undefined
  return {
    ...source,
    id: input.job.output_asset_id,
    source: 'fallback_asset',
    label: `Fallback for ${input.job.id}`,
  }
}

async function standardizeIfVideo(input: {
  asset: RemotionTimelineAsset
  outputDir?: string
  width: number
  height: number
  fps: number
}): Promise<{
  asset: RemotionTimelineAsset
  standardizedSrc?: string
}> {
  if (input.asset.type !== 'video' || input.asset.source !== 'generated_asset' || !input.outputDir) {
    return { asset: input.asset }
  }
  const standardized = await standardizeGeneratedVideoAsset({
    src: input.asset.src,
    assetId: input.asset.id,
    outputDir: path.join(input.outputDir, 'timeline-generated-materials'),
    width: input.width,
    height: input.height,
    fps: input.fps,
  })
  return {
    asset: {
      ...input.asset,
      src: standardized.src,
    },
    standardizedSrc: standardized.src,
  }
}

function mergeAssets(input: {
  existing: RemotionTimelineAsset[]
  resolved: RemotionTimelineAsset[]
}): RemotionTimelineAsset[] {
  const resolvedById = new Map(input.resolved.map((asset) => [asset.id, asset]))
  const merged = input.existing.map((asset) => resolvedById.get(asset.id) ?? asset)
  const ids = new Set(merged.map((asset) => asset.id))
  for (const asset of input.resolved) {
    if (!ids.has(asset.id)) merged.push(asset)
  }
  return merged
}

export async function resolveRemotionTimelineMaterialJobs(input: {
  spec: RemotionTimelineSpecV1
  adapter?: V2MaterialGenerationAdapter
  outputDir?: string
}): Promise<{
  spec: RemotionTimelineSpecV1
  report: V2TimelineMaterialResolutionReport
}> {
  const spec = assertValidRemotionTimelineSpec(input.spec)
  const adapter = input.adapter ?? createNoopMaterialGenerationAdapter()
  const fulfilledJobs: string[] = []
  const failedJobs: V2TimelineMaterialResolutionReport['failed_jobs'] = []
  const resolvedAssets: RemotionTimelineAsset[] = []
  const generationTrace: V2TimelineMaterialResolutionReport['generation_trace'] = []

  for (const job of spec.material_jobs) {
    const startedAt = Date.now()
    if (job.status === 'fulfilled' || job.type === 'reuse_asset') {
      fulfilledJobs.push(job.id)
      continue
    }
    if (job.type === 'request_user_material') {
      failedJobs.push({ id: job.id, reason: 'User material is required.' })
      generationTrace.push({
        id: job.id,
        scene_id: job.scene_id,
        type: job.type,
        status: 'failed',
        elapsed_ms: Date.now() - startedAt,
        error: 'User material is required.',
      })
      continue
    }
    if (job.type !== 'generate_video') {
      failedJobs.push({ id: job.id, reason: `Unsupported timeline material job type: ${job.type}` })
      continue
    }
    if (!job.prompt || !job.output_asset_id) {
      failedJobs.push({ id: job.id, reason: 'generate_video jobs require prompt and output_asset_id.' })
      continue
    }

    const generated = await adapter.generate({
      jobId: job.id,
      shotId: job.scene_id,
      type: 'generate_video',
      prompt: job.prompt,
      inputImageUrl: job.input_image_url,
      outputAssetId: job.output_asset_id,
    })

    if (generated.ok && generated.asset) {
      const normalized = await standardizeIfVideo({
        asset: convertGeneratedAsset({
          id: job.output_asset_id,
          type: generated.asset.type === 'image' ? 'image' : 'video',
          src: generated.asset.src,
          label: `Generated asset for ${job.scene_id}`,
        }),
        outputDir: input.outputDir,
        width: spec.canvas.width,
        height: spec.canvas.height,
        fps: spec.canvas.fps,
      })
      fulfilledJobs.push(job.id)
      resolvedAssets.push(normalized.asset)
      generationTrace.push({
        id: job.id,
        scene_id: job.scene_id,
        type: job.type,
        prompt: job.prompt,
        input_image_url: job.input_image_url,
        output_asset_id: job.output_asset_id,
        provider_task_id: generated.providerTaskId,
        status: 'fulfilled',
        elapsed_ms: Date.now() - startedAt,
        standardized_src: normalized.standardizedSrc,
      })
      continue
    }

    const fallback = fallbackAsset({ job, currentAssets: spec.assets })
    if (fallback) {
      fulfilledJobs.push(job.id)
      resolvedAssets.push(fallback)
      generationTrace.push({
        id: job.id,
        scene_id: job.scene_id,
        type: job.type,
        prompt: job.prompt,
        input_image_url: job.input_image_url,
        output_asset_id: job.output_asset_id,
        provider_task_id: generated.providerTaskId,
        status: 'fallback',
        elapsed_ms: Date.now() - startedAt,
        error: generated.error ?? 'Generation failed; used fallback asset.',
      })
      continue
    }

    failedJobs.push({ id: job.id, reason: generated.error ?? 'Material generation failed.' })
    generationTrace.push({
      id: job.id,
      scene_id: job.scene_id,
      type: job.type,
      prompt: job.prompt,
      input_image_url: job.input_image_url,
      output_asset_id: job.output_asset_id,
      provider_task_id: generated.providerTaskId,
      status: 'failed',
      elapsed_ms: Date.now() - startedAt,
      error: generated.error ?? 'Material generation failed.',
    })
  }

  const mergedAssets = mergeAssets({ existing: spec.assets, resolved: resolvedAssets })
  const resolvedAssetIds = new Set(resolvedAssets.map((asset) => asset.id))
  const nextSpec: RemotionTimelineSpecV1 = {
    ...spec,
    assets: mergedAssets,
    scenes: spec.scenes.map((scene) => {
      const job = spec.material_jobs.find((item) => item.scene_id === scene.id && item.output_asset_id)
      if (!job?.output_asset_id || !resolvedAssetIds.has(job.output_asset_id)) return scene
      return {
        ...scene,
        type: 'ai_video',
        asset_id: job.output_asset_id,
      }
    }),
    material_jobs: spec.material_jobs.map((job) =>
      fulfilledJobs.includes(job.id)
        ? {
            ...job,
            status: 'fulfilled',
          }
        : job,
    ),
  }

  return {
    spec: assertValidRemotionTimelineSpec(nextSpec),
    report: {
      schema_version: 'v2_timeline_material_resolution.v1',
      ok: failedJobs.length === 0,
      fulfilled_jobs: fulfilledJobs,
      failed_jobs: failedJobs,
      resolved_assets: resolvedAssets,
      generation_trace: generationTrace,
    },
  }
}

export async function standardizeRemotionTimelineVideoAssets(input: {
  spec: RemotionTimelineSpecV1
  outputDir: string
}): Promise<{
  spec: RemotionTimelineSpecV1
  standardized_assets: Array<{
    id: string
    src: string
  }>
}> {
  const spec = assertValidRemotionTimelineSpec(input.spec)
  const standardizedAssets: Array<{ id: string; src: string }> = []
  const assets: RemotionTimelineAsset[] = []

  for (const asset of spec.assets) {
    if (asset.type !== 'video' || asset.src.startsWith('static:')) {
      assets.push(asset)
      continue
    }
    const standardized = await standardizeGeneratedVideoAsset({
      src: asset.src,
      assetId: asset.id,
      outputDir: path.join(input.outputDir, 'timeline-standardized-assets'),
      width: spec.canvas.width,
      height: spec.canvas.height,
      fps: spec.canvas.fps,
    })
    assets.push({
      ...asset,
      src: standardized.src,
    })
    standardizedAssets.push({
      id: asset.id,
      src: standardized.src,
    })
  }

  return {
    spec: assertValidRemotionTimelineSpec({
      ...spec,
      assets,
    }),
    standardized_assets: standardizedAssets,
  }
}
