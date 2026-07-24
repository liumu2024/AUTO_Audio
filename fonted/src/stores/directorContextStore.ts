import { create } from 'zustand'

import {
  createDefaultDirectorSlots,
  mergeDirectorSlots,
} from '@shared/lib/director-understanding'
import {
  createInitialDirectorSessionState,
} from '@shared/lib/director-state-machine'
import type {
  DirectorContext,
  DirectorContextSlots,
  DirectorIntentResult,
  DirectorMaterialContext,
  DirectorSampleVideoContext,
  DirectorUserIntent,
} from '@shared/types/director-context'
import type { DirectorSessionState } from '@shared/types/director-state'

interface DirectorContextState {
  context: DirectorContext
  setSampleVideo: (sampleVideo?: DirectorSampleVideoContext) => void
  setMaterials: (materials: DirectorMaterialContext[]) => void
  setUserIntent: (patch: Partial<DirectorUserIntent>) => void
  patchSlots: (patch: Partial<DirectorContextSlots>) => void
  applyIntentResult: (result: DirectorIntentResult) => void
  setDirectorState: (directorState?: DirectorSessionState) => void
  updateDirectorState: (
    updater: (state: DirectorSessionState) => DirectorSessionState,
  ) => void
  setConversationSummary: (conversationSummary?: string) => void
  reset: () => void
}

const initialContext: DirectorContext = {
  materials: [],
  userIntent: {
    goal: 'analyze_sample',
    aspectRatio: '9:16',
    styleIntensity: 'medium',
  },
  slots: createDefaultDirectorSlots(),
  directorState: createInitialDirectorSessionState(),
}

export const useDirectorContextStore = create<DirectorContextState>((set) => ({
  context: initialContext,

  setSampleVideo: (sampleVideo) =>
    set((state) => ({
      context: {
        ...state.context,
        sampleVideo,
        slots: mergeDirectorSlots(state.context.slots, {
          sampleVideoStatus: sampleVideo?.url ? 'attached' : 'missing',
        }),
      },
    })),

  setMaterials: (materials) =>
    set((state) => {
      const hasVisual = materials.some(
        (item) => item.type === 'video' || item.type === 'image',
      )
      return {
        context: {
          ...state.context,
          materials,
          slots: mergeDirectorSlots(state.context.slots, {
            materialStatus: hasVisual ? 'ready' : materials.length ? 'partial' : 'missing',
          }),
        },
      }
    }),

  setUserIntent: (patch) =>
    set((state) => ({
      context: {
        ...state.context,
        userIntent: {
          ...state.context.userIntent,
          ...patch,
        },
        slots: mergeDirectorSlots(state.context.slots, {
          aspectRatio: patch.aspectRatio,
          durationSec: patch.durationSec,
          styleIntensity: patch.styleIntensity,
        }),
      },
    })),

  patchSlots: (patch) =>
    set((state) => ({
      context: {
        ...state.context,
        slots: mergeDirectorSlots(state.context.slots, patch),
      },
    })),

  applyIntentResult: (result) =>
    set((state) => ({
      context: {
        ...state.context,
        slots: mergeDirectorSlots(state.context.slots, {
          ...result.slotsPatch,
          contentDomain: result.contentDomain,
          pendingConfirmation: result.requiresConfirmation
            ? {
                intent: result.intent,
                summary: result.assistantMessage,
                slotsPatch: result.slotsPatch,
              }
            : undefined,
        }),
      },
    })),

  setDirectorState: (directorState) =>
    set((state) => ({
      context: {
        ...state.context,
        directorState,
      },
    })),

  updateDirectorState: (updater) =>
    set((state) => {
      const previous =
        state.context.directorState ?? createInitialDirectorSessionState()
      return {
        context: {
          ...state.context,
          directorState: updater(previous),
        },
      }
    }),

  setConversationSummary: (conversationSummary) =>
    set((state) => ({
      context: {
        ...state.context,
        conversationSummary,
      },
    })),

  reset: () => set({ context: initialContext }),
}))
