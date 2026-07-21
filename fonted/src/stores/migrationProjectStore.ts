import { create } from 'zustand'

import { emptyMigrationProject } from '@/data/emptyProject'
import type {
  MigrationProtocolV12,
  SemanticAnchor,
  TimelineTransition,
} from '@/types/migration-protocol'

interface MigrationProjectState {
  project: MigrationProtocolV12
  setProject: (project: MigrationProtocolV12) => void
  updateAnchor: (anchorId: string, patch: Partial<SemanticAnchor>) => void
  updateTransition: (
    transitionId: string,
    patch: Partial<TimelineTransition>,
  ) => void
  resolveGapAnchor: (anchorId: string, assetName: string) => void
  getAnchor: (anchorId: string) => SemanticAnchor | undefined
}

export const useMigrationProjectStore = create<MigrationProjectState>((set, get) => ({
  project: structuredClone(emptyMigrationProject),

  setProject: (project) => set({ project: structuredClone(project) }),

  getAnchor: (anchorId) =>
    get().project.semantic_anchors.find((a) => a.anchor_id === anchorId),

  updateAnchor: (anchorId, patch) =>
    set((state) => ({
      project: {
        ...state.project,
        semantic_anchors: state.project.semantic_anchors.map((anchor) =>
          anchor.anchor_id === anchorId ? { ...anchor, ...patch } : anchor,
        ),
      },
    })),

  updateTransition: (transitionId, patch) =>
    set((state) => ({
      project: {
        ...state.project,
        transitions: (state.project.transitions ?? []).map((transition) =>
          transition.id === transitionId
            ? { ...transition, ...patch }
            : transition,
        ),
      },
    })),

  resolveGapAnchor: (anchorId, assetName) =>
    set((state) => ({
      project: {
        ...state.project,
        semantic_anchors: state.project.semantic_anchors.map((a) =>
          a.anchor_id === anchorId
            ? {
                ...a,
                match: {
                  status: 'matched',
                  asset_name: assetName,
                  asset_id: `aigc_${anchorId}`,
                },
              }
            : a,
        ),
      },
    })),
}))
