import { create } from 'zustand'

import type {
  V2SampleAnalyzeResult,
  V2TimelineDraftDto,
  V2TimelineDraftPreviewResult,
  V2TimelineDraftRunResult,
  V2TimelineDraftRunSummaryDto,
} from '@/lib/api'
import type { RemotionTimelineSpecV1 } from '@shared/types/remotion-timeline-spec.v1'
import type { V2SampleSession } from '@/lib/v2-sample-ui'

interface V2TimelineState {
  taskId: string | null
  draftId: string | null
  draftRevision: number | null
  spec: RemotionTimelineSpecV1 | null
  preview: V2TimelineDraftPreviewResult | null
  result: V2TimelineDraftRunResult | null
  renderedOutputUrl: string | null
  lastRunResolvedSpec: RemotionTimelineSpecV1 | null
  sampleSession: V2SampleSession | null
  previewAssetUrls: Record<string, string>
  traceDir: string | null
  lastPrompt: string | null
  selectedClipId: string | null
  hasLocalEdits: boolean
  setSampleSession: (input: {
    result: V2SampleAnalyzeResult
    prompt: string
    playbackUrl: string
    sampleName?: string
  }) => void
  setPreview: (
    preview: V2TimelineDraftPreviewResult,
    prompt: string,
    previewAssetUrls?: Record<string, string>,
  ) => void
  setResult: (
    result: V2TimelineDraftRunResult,
    prompt: string,
    previewAssetUrls?: Record<string, string>,
  ) => void
  setPersistedDraft: (draft: V2TimelineDraftDto) => void
  openPersistedDraft: (draft: Pick<V2TimelineDraftDto, 'draftId' | 'revision' | 'spec' | 'traceDir'> & {
    latestRun?: V2TimelineDraftRunSummaryDto
  }) => void
  updateSpec: (update: (spec: RemotionTimelineSpecV1) => RemotionTimelineSpecV1) => void
  selectClip: (clipId: string | null) => void
  clear: () => void
}

export const useV2TimelineStore = create<V2TimelineState>((set) => ({
  taskId: null,
  draftId: null,
  draftRevision: null,
  spec: null,
  preview: null,
  result: null,
  renderedOutputUrl: null,
  lastRunResolvedSpec: null,
  sampleSession: null,
  previewAssetUrls: {},
  traceDir: null,
  lastPrompt: null,
  selectedClipId: null,
  hasLocalEdits: false,

  setSampleSession: ({ result, prompt, playbackUrl, sampleName }) =>
    set({
      taskId: result.taskId,
      draftId: null,
      draftRevision: null,
      spec: null,
      preview: null,
      result: null,
      renderedOutputUrl: null,
      lastRunResolvedSpec: null,
      sampleSession: {
        reference: { playbackUrl, name: sampleName },
        understanding: result.understanding,
        traceDir: result.traceDir,
      },
      previewAssetUrls: {},
      traceDir: result.traceDir,
      lastPrompt: prompt,
      selectedClipId: null,
      hasLocalEdits: false,
    }),

  setPreview: (preview, prompt, previewAssetUrls) =>
    set((state) => ({
      taskId: preview.taskId,
      draftId: preview.draft?.draftId ?? state.draftId,
      draftRevision: preview.draft?.revision ?? state.draftRevision,
      spec: preview.spec,
      preview,
      result: null,
      renderedOutputUrl: null,
      lastRunResolvedSpec: null,
      sampleSession: state.sampleSession,
      previewAssetUrls: previewAssetUrls ?? state.previewAssetUrls,
      traceDir: preview.traceDir,
      lastPrompt: prompt,
      selectedClipId: null,
      hasLocalEdits: false,
    })),

  setResult: (result, prompt, previewAssetUrls) =>
    set((state) => ({
      taskId: state.taskId,
      draftId: result.draftId,
      draftRevision: result.draftRevision,
      // The current spec is the editable draft. A run's resolved spec belongs
      // to that RenderRun and must never replace the draft in the editor.
      spec: state.spec,
      result,
      renderedOutputUrl: result.outputUrl ?? null,
      lastRunResolvedSpec: result.resolvedSpec,
      sampleSession: state.sampleSession,
      previewAssetUrls: previewAssetUrls ?? state.previewAssetUrls,
      traceDir: result.traceDir,
      lastPrompt: prompt,
      selectedClipId: state.selectedClipId,
      hasLocalEdits: state.hasLocalEdits,
    })),

  setPersistedDraft: (draft) =>
    set((state) => ({
      draftId: draft.draftId,
      draftRevision: draft.revision,
      spec: draft.spec,
      preview: state.preview
        ? {
            ...state.preview,
            spec: draft.spec,
          }
        : state.preview,
      result: state.result?.draftRevision === draft.revision ? state.result : null,
      renderedOutputUrl: state.result?.draftRevision === draft.revision
        ? state.renderedOutputUrl
        : null,
      lastRunResolvedSpec: state.result?.draftRevision === draft.revision
        ? state.lastRunResolvedSpec
        : null,
      hasLocalEdits: false,
    })),

  openPersistedDraft: (draft) =>
    set({
      taskId: draft.spec.task_id,
      draftId: draft.draftId,
      draftRevision: draft.revision,
      spec: draft.spec,
      preview: null,
      result: null,
      renderedOutputUrl: draft.latestRun?.status === 'completed'
        && draft.latestRun.sourceRevision === draft.revision
        ? draft.latestRun.outputUrl ?? null
        : null,
      lastRunResolvedSpec: null,
      sampleSession: null,
      previewAssetUrls: {},
      traceDir: draft.traceDir ?? null,
      lastPrompt: null,
      selectedClipId: null,
      hasLocalEdits: false,
    }),

  updateSpec: (update) =>
    set((state) => {
      if (!state.spec) return state
      const spec = update(state.spec)
      return {
        spec,
        preview: state.preview
          ? {
              ...state.preview,
              spec,
            }
          : state.preview,
        hasLocalEdits: true,
      }
    }),

  selectClip: (selectedClipId) => set({ selectedClipId }),

  clear: () =>
    set({
      taskId: null,
      draftId: null,
      draftRevision: null,
      spec: null,
      preview: null,
      result: null,
      renderedOutputUrl: null,
      lastRunResolvedSpec: null,
      sampleSession: null,
      previewAssetUrls: {},
      traceDir: null,
      lastPrompt: null,
      selectedClipId: null,
      hasLocalEdits: false,
    }),
}))
