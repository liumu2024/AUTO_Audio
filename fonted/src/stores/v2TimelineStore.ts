import { create } from 'zustand'

import type {
  V2TimelineDraftDto,
  V2TimelineDraftRunResult,
  V2TimelineDraftRunSummaryDto,
} from '@/lib/api'
import type { RemotionTimelineSpecV1 } from '@shared/types/remotion-timeline-spec.v1'

interface V2TimelineState {
  taskId: string | null
  draftId: string | null
  draftRevision: number | null
  spec: RemotionTimelineSpecV1 | null
  result: V2TimelineDraftRunResult | null
  renderedOutputUrl: string | null
  traceDir: string | null
  selectedClipId: string | null
  hasLocalEdits: boolean
  pendingTimelineRevisions: Array<{ instruction: string; callId: string; baseRevision: number }>
  setResult: (result: V2TimelineDraftRunResult) => void
  setPersistedDraft: (draft: V2TimelineDraftDto) => void
  openPersistedDraft: (draft: Pick<V2TimelineDraftDto, 'draftId' | 'revision' | 'spec' | 'traceDir' | 'pendingTimelineRevisions'> & {
    latestRun?: V2TimelineDraftRunSummaryDto
  }) => void
  updateSpec: (update: (spec: RemotionTimelineSpecV1) => RemotionTimelineSpecV1) => void
  selectClip: (clipId: string | null) => void
  setPendingTimelineRevisions: (value: V2TimelineState['pendingTimelineRevisions']) => void
  clear: () => void
}

export const useV2TimelineStore = create<V2TimelineState>((set) => ({
  taskId: null,
  draftId: null,
  draftRevision: null,
  spec: null,
  result: null,
  renderedOutputUrl: null,
  traceDir: null,
  selectedClipId: null,
  hasLocalEdits: false,
  pendingTimelineRevisions: [],

  setResult: (result) =>
    set((state) => ({
      taskId: state.taskId,
      draftId: result.draftId,
      draftRevision: result.draftRevision,
      // The current spec is the editable draft. A run's resolved spec belongs
      // to that RenderRun and must never replace the draft in the editor.
      spec: state.spec,
      result,
      renderedOutputUrl: result.outputUrl ?? null,
      traceDir: result.traceDir,
      selectedClipId: state.selectedClipId,
      hasLocalEdits: state.hasLocalEdits,
    })),

  setPersistedDraft: (draft) =>
    set((state) => ({
      draftId: draft.draftId,
      draftRevision: draft.revision,
      spec: draft.spec,
      result: state.result?.draftRevision === draft.revision ? state.result : null,
      renderedOutputUrl: state.result?.draftRevision === draft.revision
        ? state.renderedOutputUrl
        : null,
      hasLocalEdits: false,
      pendingTimelineRevisions: draft.pendingTimelineRevisions ?? state.pendingTimelineRevisions,
    })),

  openPersistedDraft: (draft) =>
    set((state) => ({
      taskId: draft.spec.task_id,
      draftId: draft.draftId,
      draftRevision: draft.revision,
      spec: draft.spec,
      result: null,
      renderedOutputUrl: draft.latestRun?.status === 'completed'
        && draft.latestRun.sourceRevision === draft.revision
        ? draft.latestRun.outputUrl ?? null
        : null,
      traceDir: draft.traceDir ?? null,
      selectedClipId: null,
      hasLocalEdits: false,
      pendingTimelineRevisions: draft.pendingTimelineRevisions ?? state.pendingTimelineRevisions,
    })),

  updateSpec: (update) =>
    set((state) => {
      if (!state.spec) return state
      const spec = update(state.spec)
      return {
        spec,
        hasLocalEdits: true,
      }
    }),

  selectClip: (selectedClipId) => set({ selectedClipId }),
  setPendingTimelineRevisions: (pendingTimelineRevisions) => set({ pendingTimelineRevisions }),

  clear: () =>
    set({
      taskId: null,
      draftId: null,
      draftRevision: null,
      spec: null,
      result: null,
      renderedOutputUrl: null,
      traceDir: null,
      selectedClipId: null,
      hasLocalEdits: false,
      pendingTimelineRevisions: [],
    }),
}))
