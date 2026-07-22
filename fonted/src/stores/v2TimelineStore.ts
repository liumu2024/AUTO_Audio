import { create } from 'zustand'

import type {
  V2TimelinePreviewResult,
  V2TimelineRunResult,
} from '@/lib/api'
import type { RemotionTimelineSpecV1 } from '@shared/types/remotion-timeline-spec.v1'

interface V2TimelineState {
  taskId: string | null
  spec: RemotionTimelineSpecV1 | null
  preview: V2TimelinePreviewResult | null
  result: V2TimelineRunResult | null
  traceDir: string | null
  lastPrompt: string | null
  setPreview: (preview: V2TimelinePreviewResult, prompt: string) => void
  setResult: (result: V2TimelineRunResult, prompt: string) => void
  clear: () => void
}

export const useV2TimelineStore = create<V2TimelineState>((set) => ({
  taskId: null,
  spec: null,
  preview: null,
  result: null,
  traceDir: null,
  lastPrompt: null,

  setPreview: (preview, prompt) =>
    set({
      taskId: preview.taskId,
      spec: preview.spec,
      preview,
      result: null,
      traceDir: preview.traceDir,
      lastPrompt: prompt,
    }),

  setResult: (result, prompt) =>
    set({
      taskId: result.taskId,
      spec: result.spec,
      result,
      traceDir: result.traceDir,
      lastPrompt: prompt,
    }),

  clear: () =>
    set({
      taskId: null,
      spec: null,
      preview: null,
      result: null,
      traceDir: null,
      lastPrompt: null,
    }),
}))
