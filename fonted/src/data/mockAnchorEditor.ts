import type {
  AnchorEditorProperties,
  EmotionVibe,
} from '@/types/anchor-editor'
import { mockProjectData } from '@/data/mockMigrationProject'

function fromAnchor(anchorId: string): AnchorEditorProperties | undefined {
  const anchor = mockProjectData.semantic_anchors.find(
    (a) => a.anchor_id === anchorId,
  )
  if (!anchor) return undefined
  const role = anchor.logic_intent.marketing_role
  const mappedRole =
    role === 'product_demo'
      ? 'demo'
      : (role as AnchorEditorProperties['marketing_role'])

  return {
    anchor_id: anchor.anchor_id,
    segment_label: `${anchor.anchor_id} · ${role}`,
    marketing_role: mappedRole,
    emotion_vibe: (anchor.logic_intent.emotion_vibe ?? 'urgent') as EmotionVibe,
    visual_generation_prompt:
      anchor.replication_instructions.visual_generation_prompt,
    overlay_rewrite_instruction:
      anchor.replication_instructions.overlay_rewrite_instruction,
  }
}

export const mockAnchorEditorById: Record<string, AnchorEditorProperties> = {
  anchor_1: fromAnchor('anchor_1')!,
  anchor_2: fromAnchor('anchor_2')!,
}

export const defaultAnchorEditorMock: AnchorEditorProperties =
  mockAnchorEditorById.anchor_1
