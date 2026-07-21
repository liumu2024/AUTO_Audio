import { create } from 'zustand'

import { useMigrationProjectStore } from '@/stores/migrationProjectStore'
import { usePipelineStore } from '@/stores/pipelineStore'
import type {
  AnchorEditorProperties,
  EmotionVibe,
  MarketingRole,
} from '@/types/anchor-editor'
import type { SemanticAnchor } from '@/types/migration-protocol'

type DraftField = keyof Omit<
  AnchorEditorProperties,
  'anchor_id' | 'segment_label'
>

interface PendingLoad {
  anchorId: string
  segmentLabel?: string
  clipId?: string | null
}

interface PropertyEditorState {
  saved: AnchorEditorProperties
  draft: AnchorEditorProperties
  isDirty: boolean
  lastSavedAt: string | null
  unsavedDialogOpen: boolean
  pendingLoad: PendingLoad | null

  loadAnchor: (anchorId: string, segmentLabel?: string) => void
  requestLoad: (
    anchorId: string,
    segmentLabel?: string,
    clipId?: string | null,
  ) => boolean
  confirmDiscardAndLoad: () => void
  cancelPendingLoad: () => void
  updateDraft: (field: DraftField, value: string) => void
  save: () => void
  resetDraft: () => void
  propertiesFromAnchor: (anchor: SemanticAnchor) => AnchorEditorProperties
}

const emptyEditorProperties: AnchorEditorProperties = {
  anchor_id: '',
  segment_label: '未选择锚点',
  marketing_role: 'hook',
  emotion_vibe: 'urgent',
  visual_generation_prompt: '',
  overlay_rewrite_instruction: '',
}

function cloneProps(p: AnchorEditorProperties): AnchorEditorProperties {
  return { ...p }
}

function mapRole(role: string): MarketingRole {
  if (role === 'product_demo') return 'product_demo'
  return role as MarketingRole
}

export const usePropertyEditorStore = create<PropertyEditorState>((set, get) => ({
  saved: cloneProps(emptyEditorProperties),
  draft: cloneProps(emptyEditorProperties),
  isDirty: false,
  lastSavedAt: null,
  unsavedDialogOpen: false,
  pendingLoad: null,

  propertiesFromAnchor: (anchor) => {
    const role = anchor.logic_intent.marketing_role
    return {
      anchor_id: anchor.anchor_id,
      segment_label: `编辑锚点: ${anchor.anchor_id}`,
      marketing_role: mapRole(role),
      emotion_vibe: (anchor.logic_intent.emotion_vibe ??
        'urgent') as EmotionVibe,
      visual_generation_prompt:
        anchor.replication_instructions.visual_generation_prompt,
      overlay_rewrite_instruction:
        anchor.replication_instructions.overlay_rewrite_instruction,
    }
  },

  loadAnchor: (anchorId, segmentLabel) => {
    const migrationAnchor =
      useMigrationProjectStore.getState().getAnchor(anchorId)

    let base: AnchorEditorProperties
    if (migrationAnchor) {
      base = get().propertiesFromAnchor(migrationAnchor)
      if (segmentLabel) base.segment_label = segmentLabel
    } else {
      base = {
        ...emptyEditorProperties,
        anchor_id: anchorId,
        segment_label: segmentLabel ?? `编辑锚点: ${anchorId}`,
      }
    }

    set({
      saved: cloneProps(base),
      draft: cloneProps(base),
      isDirty: false,
      unsavedDialogOpen: false,
      pendingLoad: null,
    })
  },

  requestLoad: (anchorId, segmentLabel, clipId = null) => {
    if (get().isDirty) {
      set({
        unsavedDialogOpen: true,
        pendingLoad: { anchorId, segmentLabel, clipId },
      })
      return false
    }
    get().loadAnchor(anchorId, segmentLabel)
    return true
  },

  confirmDiscardAndLoad: () => {
    const pending = get().pendingLoad
    if (!pending) {
      set({ unsavedDialogOpen: false })
      return
    }
    get().loadAnchor(pending.anchorId, pending.segmentLabel)
  },

  cancelPendingLoad: () =>
    set({ unsavedDialogOpen: false, pendingLoad: null }),

  updateDraft: (field, value) => {
    const { draft } = get()
    set({
      draft: {
        ...draft,
        [field]:
          field === 'marketing_role'
            ? (value as MarketingRole)
            : field === 'emotion_vibe'
              ? (value as EmotionVibe)
              : value,
      },
      isDirty: true,
    })
  },

  save: () => {
    const { draft } = get()
    set({
      saved: cloneProps(draft),
      isDirty: false,
      lastSavedAt: new Date().toLocaleTimeString('zh-CN', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      }),
    })

    const anchor = useMigrationProjectStore.getState().getAnchor(draft.anchor_id)
    if (anchor) {
      useMigrationProjectStore.setState((state) => ({
        project: {
          ...state.project,
          semantic_anchors: state.project.semantic_anchors.map((a) =>
            a.anchor_id === draft.anchor_id
              ? {
                  ...a,
                  logic_intent: {
                    ...a.logic_intent,
                    marketing_role: draft.marketing_role,
                    emotion_vibe: draft.emotion_vibe,
                  },
                  replication_instructions: {
                    ...a.replication_instructions,
                    visual_generation_prompt: draft.visual_generation_prompt,
                    overlay_rewrite_instruction:
                      draft.overlay_rewrite_instruction,
                  },
                }
              : a,
          ),
        },
      }))
    }

    const project = useMigrationProjectStore.getState().project
    usePipelineStore.getState().applyStructure(project)
  },

  resetDraft: () => {
    const { saved } = get()
    set({ draft: cloneProps(saved), isDirty: false })
  },
}))
