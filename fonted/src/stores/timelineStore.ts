import { create } from 'zustand'

import { emptyTimelineProject } from '@/data/emptyProject'
import { usePropertyEditorStore } from '@/stores/propertyEditorStore'
import type { TimelineClip, TimelineProject } from '@/types/timeline'
import type { SemanticAnchor } from '@/types/migration-protocol'

interface TimelineState {
  project: TimelineProject
  selectedClipId: string | null

  setProject: (project: TimelineProject) => void
  selectClip: (id: string | null) => void
  updateClipTime: (id: string, start_sec: number, end_sec: number) => void
  updateClipField: (
    id: string,
    field: 'content_rewrite_instruction' | 'visual_generation_prompt',
    value: string,
  ) => void
  updateClipForAnchor: (
    anchorId: string,
    patch: Partial<Pick<TimelineClip, 'label' | 'content_rewrite_instruction' | 'visual_generation_prompt'>>,
  ) => void
  addAigcClipForAnchor: (anchor: SemanticAnchor) => void
  syncPropertyEditorFromClip: (clip: TimelineClip) => void
  getSelectedClip: () => TimelineClip | undefined
}

export const useTimelineStore = create<TimelineState>((set, get) => ({
  project: emptyTimelineProject,
  selectedClipId: null,

  setProject: (project) => set({ project }),

  syncPropertyEditorFromClip: (clip) => {
    const title = clip.anchor_id
      ? `编辑锚点: ${clip.anchor_id}`
      : clip.label
    if (clip.anchor_id) {
      usePropertyEditorStore.getState().requestLoad(clip.anchor_id, title)
    } else {
      usePropertyEditorStore
        .getState()
        .requestLoad(`clip-${clip.id}`, title)
    }
  },

  selectClip: (selectedClipId) => {
    const clip = selectedClipId
      ? get().project.clips.find((c) => c.id === selectedClipId)
      : undefined

    if (clip) {
      const loaded = usePropertyEditorStore
        .getState()
        .requestLoad(
          clip.anchor_id ?? `clip-${clip.id}`,
          clip.anchor_id ? `编辑锚点: ${clip.anchor_id}` : clip.label,
          selectedClipId,
        )
      if (!loaded) return
    }

    set({ selectedClipId })
  },

  updateClipTime: (id, start_sec, end_sec) =>
    set((state) => ({
      project: {
        ...state.project,
        clips: state.project.clips.map((c) =>
          c.id === id ? { ...c, start_sec, end_sec } : c,
        ),
      },
    })),

  updateClipField: (id, field, value) =>
    set((state) => ({
      project: {
        ...state.project,
        clips: state.project.clips.map((c) =>
          c.id === id ? { ...c, [field]: value } : c,
        ),
      },
    })),

  updateClipForAnchor: (anchorId, patch) =>
    set((state) => ({
      project: {
        ...state.project,
        clips: state.project.clips.map((c) =>
          c.anchor_id === anchorId ? { ...c, ...patch } : c,
        ),
      },
    })),

  addAigcClipForAnchor: (anchor) =>
    set((state) => {
      const existing = state.project.clips.find(
        (c) => c.anchor_id === anchor.anchor_id && c.track_id === 'video',
      )
      const aigcClip: TimelineClip = {
        id: `clip-aigc-${anchor.anchor_id}`,
        track_id: 'video',
        start_sec: anchor.start_sec,
        end_sec: anchor.end_sec,
        label: 'AIGC生成片段.mp4',
        anchor_id: anchor.anchor_id,
        content_rewrite_instruction:
          anchor.replication_instructions.overlay_rewrite_instruction,
        visual_generation_prompt:
          anchor.replication_instructions.visual_generation_prompt,
      }

      const clips = existing
        ? state.project.clips.map((c) =>
            c.anchor_id === anchor.anchor_id && c.track_id === 'video'
              ? { ...aigcClip, id: c.id }
              : c,
          )
        : [...state.project.clips, aigcClip]

      return { project: { ...state.project, clips } }
    }),

  getSelectedClip: () => {
    const { project, selectedClipId } = get()
    return project.clips.find((c) => c.id === selectedClipId)
  },
}))
