import { materialJobMissingRequiredOutput } from '../../../shared/lib/remotion-timeline-validator.js'
import type { RemotionTimelineSpecV1 } from '../../../shared/types/remotion-timeline-spec.v1.js'
import { env } from '../config/env.js'
import { evaluateExternalPublicationReadiness } from '../modules/upload/asset-publisher.js'

export interface V2TimelineDeliveryReadiness {
  status: 'ready' | 'blocked'
  missing: Array<{ code: string; description: string }>
  alternatives: string[]
  generationJobCount: number
}

/** Single deterministic preflight used by UI, Agent readiness and the formal RenderRun boundary. */
export function evaluateV2TimelineDeliveryReadiness(input: {
  timelineSpec: RemotionTimelineSpecV1
  pendingTimelineRevisions?: Array<{ instruction: string }>
  videoGenerationAvailable?: boolean
}): V2TimelineDeliveryReadiness {
  const generationJobCount = input.timelineSpec.material_jobs.filter((job) =>
    job.type === 'generate_video' && job.status !== 'fulfilled').length
  if (input.pendingTimelineRevisions?.length) {
    return {
      status: 'blocked',
      missing: [{
        code: 'timeline_revision_pending',
        description: `仍有 ${input.pendingTimelineRevisions.length} 项方案修改尚未落实。`,
      }],
      alternatives: ['继续完成待处理修改', '明确放弃该修改后再导出'],
      generationJobCount,
    }
  }

  const missing: V2TimelineDeliveryReadiness['missing'] = []
  const assetById = new Map(input.timelineSpec.assets.map((asset) => [asset.id, asset]))
  const assetIds = new Set(assetById.keys())
  const generationAvailable = input.videoGenerationAvailable
    ?? env.v2VideoGenerationProvider === 'ark-seedance'
  const sceneLabel = (sceneId: string) => {
    const index = input.timelineSpec.scenes.findIndex((scene) => scene.id === sceneId)
    const scene = index >= 0 ? input.timelineSpec.scenes[index] : undefined
    const title = scene?.creative_intent?.title?.trim() || scene?.title?.trim()
    return index >= 0 ? `第 ${index + 1} 个镜头${title ? `（${title}）` : ''}` : '目标镜头'
  }
  for (const job of input.timelineSpec.material_jobs) {
    if (materialJobMissingRequiredOutput(job, assetIds)) {
      missing.push({ code: 'material_output_missing', description: `${sceneLabel(job.scene_id)}没有可用产物。` })
      continue
    }
    if (job.status === 'failed') {
      missing.push({ code: 'material_generation_failed', description: `${sceneLabel(job.scene_id)}的素材准备失败，需要修订或重新规划后再执行。` })
      continue
    }
    if (job.status === 'fulfilled') continue
    if (job.type === 'request_user_material') {
      missing.push({ code: 'user_material_required', description: `${sceneLabel(job.scene_id)}仍需要用户素材。` })
      continue
    }
    if (job.type !== 'generate_video') continue
    if (!generationAvailable) {
      missing.push({ code: 'generation_provider_unavailable', description: `${sceneLabel(job.scene_id)}需要生成视频，但当前视频生成服务不可用。` })
    }
    if (!job.input_asset_id) continue
    const asset = assetById.get(job.input_asset_id)
    if (!asset) {
      missing.push({ code: 'generation_input_missing', description: `${sceneLabel(job.scene_id)}缺少生成所需的参考素材。` })
      continue
    }
    const publication = evaluateExternalPublicationReadiness(asset.src)
    if (!publication.ready) {
      missing.push({ code: 'generation_input_unreachable', description: `${sceneLabel(job.scene_id)}的参考素材暂时无法用于视频生成，请重新上传或检查素材后再试。` })
    }
  }
  return {
    status: missing.length ? 'blocked' : 'ready',
    missing,
    alternatives: missing.length ? ['修改方案中的素材生成方式', '重新上传可用于生成的素材后重试'] : [],
    generationJobCount,
  }
}
