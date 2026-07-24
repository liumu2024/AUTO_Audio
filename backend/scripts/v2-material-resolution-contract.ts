import assert from 'node:assert/strict'

import type { RemotionTimelineSpecV1 } from '../../shared/types/remotion-timeline-spec.v1.js'
import type { V2TimelineMaterialResolutionReport } from '../src/pipeline-v2/remotion-timeline-material-resolver.js'

export function assertV2MaterialResolutionContract(input: {
  spec: RemotionTimelineSpecV1
  report: V2TimelineMaterialResolutionReport
  expectedGeneratedJobCount?: number
}) {
  const generatedJobs = input.spec.material_jobs.filter((job) => job.type === 'generate_video')
  if (input.expectedGeneratedJobCount !== undefined) {
    assert.equal(generatedJobs.length, input.expectedGeneratedJobCount)
  }

  const traceByJobId = new Map(input.report.generation_trace.map((entry) => [entry.id, entry]))
  const assetsById = new Map(input.spec.assets.map((asset) => [asset.id, asset]))
  const scenesById = new Map(input.spec.scenes.map((scene) => [scene.id, scene]))

  assert.equal(input.report.ok, true, JSON.stringify(input.report.failed_jobs, null, 2))
  assert.equal(input.report.failed_jobs.length, 0)
  assert.equal(input.report.generation_trace.length, generatedJobs.length)

  for (const job of generatedJobs) {
    const trace = traceByJobId.get(job.id)
    const scene = scenesById.get(job.scene_id)
    assert.ok(trace, `Missing generation trace for ${job.id}`)
    assert.ok(scene, `Missing scene for ${job.id}`)
    assert.ok(input.report.fulfilled_jobs.includes(job.id), `Job was not fulfilled: ${job.id}`)
    assert.equal(job.status, 'fulfilled')

    if (trace.status === 'fulfilled') {
      assert.ok(trace.output_asset_id, `Provider fulfillment needs an output asset: ${job.id}`)
      const asset = assetsById.get(trace.output_asset_id)
      assert.ok(asset, `Missing fulfilled asset: ${trace.output_asset_id}`)
      assert.equal(asset.source, 'generated_asset')
      assert.equal(scene.type, 'ai_video')
      assert.equal(scene.asset_id, trace.output_asset_id)
      continue
    }

    if (trace.status === 'fallback' && job.fallback_kind === 'blank_card') {
      assert.equal(scene.type, 'remotion_card')
      assert.equal(scene.asset_id, undefined)
      assert.equal(job.output_asset_id, undefined)
      continue
    }

    if (trace.status === 'fallback' && job.fallback_asset_id) {
      assert.ok(job.output_asset_id, `Fallback asset needs an output id: ${job.id}`)
      const asset = assetsById.get(job.output_asset_id)
      assert.ok(asset, `Missing fallback asset: ${job.output_asset_id}`)
      assert.equal(asset.source, 'fallback_asset')
      assert.equal(scene.type, 'ai_video')
      assert.equal(scene.asset_id, job.output_asset_id)
      continue
    }

    assert.fail(`Unexpected material terminal state for ${job.id}: ${JSON.stringify(trace)}`)
  }
}
