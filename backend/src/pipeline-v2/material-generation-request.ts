import { createHash } from 'node:crypto'

import type {
  RemotionTimelineMaterialJob,
  RemotionTimelineSpecV1,
} from '../../../shared/types/remotion-timeline-spec.v1.js'
import type { V2MaterialGenerationRequest } from './material-generation-adapter.js'

export function prepareV2MaterialGenerationRequest(input: {
  spec: RemotionTimelineSpecV1
  job: RemotionTimelineMaterialJob
  inputImageUrl?: string
}): { request: V2MaterialGenerationRequest; fingerprint: string } {
  if (!input.job.output_asset_id) throw new Error('generate_video job requires output_asset_id.')
  const scene = input.spec.scenes.find((candidate) => candidate.id === input.job.scene_id)
  if (!scene) throw new Error(`generate_video job references missing scene: ${input.job.scene_id}`)
  const durationSec = scene.duration_sec
  if (!(durationSec > 0)) throw new Error(`generate_video scene duration must be positive: ${scene.id}`)
  const imageReference = input.spec.creative_brief?.image_references.find(
    (reference) => reference.asset_id === input.job.input_asset_id,
  )
  const prompt = [
    input.spec.creative_brief?.direction,
    input.job.prompt,
    imageReference?.observed_facts.length
      ? `Verified source-image facts: ${imageReference.observed_facts.join('; ')}`
      : undefined,
    imageReference?.intended_use
      ? `Source-image use: ${imageReference.intended_use}`
      : undefined,
    input.spec.creative_brief?.sample_methods.length
      ? `Adopted sample methods: ${input.spec.creative_brief.sample_methods.join('; ')}`
      : undefined,
    input.spec.creative_brief?.applied_preferences.length
      ? `Adopted user preferences: ${input.spec.creative_brief.applied_preferences.join('; ')}`
      : undefined,
  ].filter((value): value is string => Boolean(value?.trim())).join('\n')
  const request: V2MaterialGenerationRequest = {
    jobId: input.job.id,
    shotId: input.job.scene_id,
    type: 'generate_video',
    durationSec,
    prompt,
    inputImageUrl: input.inputImageUrl,
    outputAssetId: input.job.output_asset_id,
  }
  return {
    request,
    fingerprint: createHash('sha256').update(JSON.stringify(request)).digest('hex'),
  }
}
