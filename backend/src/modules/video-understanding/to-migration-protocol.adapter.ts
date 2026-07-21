import type { MigrationProtocolV12 } from '../../../../shared/types/migration-protocol.v1.2.js'
import type { UserMaterialDto } from '../../../../shared/types/pipeline.js'
import type { VideoUnderstandingResult } from './schemas/video-understanding.schema.js'
import {
  defaultVisualForRole,
  pickVisualPrompt,
} from './resolve-visual-prompt.js'

export interface MigrationAdapterInput {
  taskId: string
  videoUrl: string
  globalPrompt?: string
  materials?: UserMaterialDto[]
}

/** Video-IR 理解结果 → 主链路 MigrationProtocolV12 */
export function toMigrationProtocolV12(
  result: VideoUnderstandingResult,
  input: MigrationAdapterInput,
): MigrationProtocolV12 {
  const duration =
    result.metadata.duration_sec > 0 ? result.metadata.duration_sec : 15

  const anchors = result.semantic_anchors.map((anchor, index) => {
    const anchorId = `anchor_${anchor.anchor_id ?? index + 1}`
    const material = findMaterialForAnchor(input.materials, anchorId, index)

    let matchStatus: 'matched' | 'gap' | 'pending' = 'pending'
    let assetName: string | null = null
    let assetId: string | undefined

    if (material) {
      matchStatus = 'matched'
      assetName = material.label
      assetId = material.id
    }

    const visualPrompt = pickVisualPrompt(
      anchor.replication_instructions.visual_generation_prompt,
      anchor.visual_summary,
      anchor.replication_instructions.overlay_rewrite_instruction,
      anchor.replication_instructions.content_rewrite_instruction,
      index === 0 ? input.globalPrompt : undefined,
      defaultVisualForRole(anchor.logic_intent.marketing_role),
    )

    let overlay =
      anchor.replication_instructions.overlay_rewrite_instruction ||
      anchor.replication_instructions.content_rewrite_instruction ||
      ''

    if (index === 0 && input.globalPrompt?.trim()) {
      overlay = overlay
        ? `${overlay}\n[用户创作指令] ${input.globalPrompt.trim()}`
        : input.globalPrompt.trim()
    }

    const startSec = anchor.start_sec
    const endSec = anchor.end_sec > startSec ? anchor.end_sec : startSec + 1
    const visualMotionPreset = index === 0 ? ('zoom_in' as const) : ('static' as const)

    return {
      anchor_id: anchorId,
      start_sec: startSec,
      end_sec: endSec,
      sequence: {
        from_sec: startSec,
        duration_sec: Math.max(0.1, endSec - startSec),
        layout: 'fill' as const,
        premount_sec: 0.5,
      },
      logic_intent: {
        marketing_role: mapMarketingRole(anchor.logic_intent.marketing_role),
        emotion_vibe: mapEmotionVibe(anchor.logic_intent.emotion_vibe),
      },
      match: {
        status: matchStatus,
        asset_name: assetName,
        asset_id: assetId,
      },
      replication_instructions: {
        visual_generation_prompt: visualPrompt,
        overlay_rewrite_instruction: overlay,
        visual_motion: {
          preset: visualMotionPreset,
          intensity: index === 0 ? 0.45 : 0,
          easing: 'ease-out',
          driver: 'useCurrentFrame' as const,
        },
      },
    }
  })

  return {
    version: '1.2',
    metadata: {
      video_id: result.metadata.video_id || input.taskId,
      duration_sec: duration,
    },
    source_video: { url: input.videoUrl, duration },
    generated_video: { url: '', duration },
    semantic_anchors: anchors,
  }
}

function findMaterialForAnchor(
  materials: UserMaterialDto[] | undefined,
  anchorId: string,
  index: number,
): UserMaterialDto | undefined {
  if (!materials?.length) return undefined
  return (
    materials.find((m) => m.id === `mat_${anchorId}`) ??
    materials[index] ??
    undefined
  )
}

function mapMarketingRole(role: string): string {
  if (role === 'CTA') return 'cta'
  if (role === 'pain_point') return 'pain_amplify'
  return role
}

function mapEmotionVibe(vibe: string): string {
  const map: Record<string, string> = {
    anxiety: 'urgent',
    urgency: 'urgent',
    trust: 'trustworthy',
    desire: 'inspiring',
    relief: 'warm',
    curiosity: 'tech',
    authority: 'trustworthy',
    humor: 'humorous',
    neutral: 'warm',
  }
  return map[vibe] ?? vibe
}
