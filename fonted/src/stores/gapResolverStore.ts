import { create } from 'zustand'

import { useMigrationProjectStore } from '@/stores/migrationProjectStore'
import { usePlaybackStore } from '@/stores/playbackStore'
import { useTimelineStore } from '@/stores/timelineStore'
import type { SemanticAnchor } from '@/types/migration-protocol'

export type GapStrategy = 'restructure' | 'dynamic_packaging' | 'aigc'

interface GapResolverState {
  isOpen: boolean
  gapAnchor: SemanticAnchor | null
  selectedStrategy: GapStrategy | null
  /** 已触发过弹窗的 gap 锚点（播放进度触发） */
  promptedAnchorIds: string[]
  dismissedAnchorIds: string[]
  isApplying: boolean

  openGap: (anchor: SemanticAnchor) => void
  openDialog: (anchor: SemanticAnchor) => void
  closeGap: () => void
  dismissGap: () => void
  markPrompted: (anchorId: string) => void
  hasPromptedGap: (anchorId: string) => boolean
  selectStrategy: (strategy: GapStrategy) => void
  applyStrategy: () => Promise<void>
}

export const useGapResolverStore = create<GapResolverState>((set, get) => ({
  isOpen: false,
  gapAnchor: null,
  selectedStrategy: null,
  promptedAnchorIds: [],
  dismissedAnchorIds: [],
  isApplying: false,

  openGap: (anchor) => get().openDialog(anchor),

  openDialog: (anchor) => {
    if (anchor.match.status !== 'gap') return
    const { dismissedAnchorIds, gapAnchor, isOpen } = get()
    if (dismissedAnchorIds.includes(anchor.anchor_id)) return
    if (isOpen && gapAnchor?.anchor_id === anchor.anchor_id) return

    usePlaybackStore.getState().setPlaying(false)

    set({
      isOpen: true,
      gapAnchor: anchor,
      selectedStrategy: null,
    })
  },

  closeGap: () =>
    set({
      isOpen: false,
      selectedStrategy: null,
    }),

  dismissGap: () => {
    const { gapAnchor } = get()
    if (gapAnchor) {
      set((state) => ({
        isOpen: false,
        selectedStrategy: null,
        dismissedAnchorIds: [...state.dismissedAnchorIds, gapAnchor.anchor_id],
      }))
    } else {
      set({ isOpen: false, selectedStrategy: null })
    }
  },

  markPrompted: (anchorId) =>
    set((state) => ({
      promptedAnchorIds: state.promptedAnchorIds.includes(anchorId)
        ? state.promptedAnchorIds
        : [...state.promptedAnchorIds, anchorId],
    })),

  hasPromptedGap: (anchorId) => get().promptedAnchorIds.includes(anchorId),

  selectStrategy: (selectedStrategy) => set({ selectedStrategy }),

  applyStrategy: async () => {
    const { selectedStrategy, gapAnchor } = get()
    if (!selectedStrategy || !gapAnchor) return

    set({ isApplying: true })
    await new Promise((r) => setTimeout(r, 800))

    const assetName =
      selectedStrategy === 'aigc'
        ? 'AIGC生成片段.mp4'
        : selectedStrategy === 'dynamic_packaging'
          ? '动态包装补全.mp4'
          : '结构重排片段.mp4'

    useMigrationProjectStore
      .getState()
      .resolveGapAnchor(gapAnchor.anchor_id, assetName)

    if (selectedStrategy === 'aigc') {
      useTimelineStore.getState().addAigcClipForAnchor(gapAnchor)
    } else {
      useTimelineStore.getState().updateClipForAnchor(gapAnchor.anchor_id, {
        label: assetName,
      })
    }

    set({
      isApplying: false,
      isOpen: false,
      selectedStrategy: null,
      gapAnchor: null,
    })

    usePlaybackStore.getState().setPlaying(true)
  },
}))
