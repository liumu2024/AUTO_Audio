import { create } from 'zustand'

import {
  createDefaultDirectorSlots,
  mergeDirectorSlots,
} from '@shared/lib/director-understanding'
import type {
  DirectorContext,
  DirectorContextSlots,
  DirectorIntentResult,
  DirectorMaterialContext,
  DirectorSampleVideoContext,
  DirectorUserIntent,
} from '@shared/types/director-context'

interface DirectorContextState {
  context: DirectorContext
  replaceContext: (context: DirectorContext) => void
  setSampleVideo: (sampleVideo?: DirectorSampleVideoContext) => void
  setMaterials: (materials: DirectorMaterialContext[]) => void
  setUserIntent: (patch: Partial<DirectorUserIntent>) => void
  patchSlots: (patch: Partial<DirectorContextSlots>) => void
  applyIntentResult: (result: DirectorIntentResult) => void
  reset: () => void
}

const initialContext: DirectorContext = {
  materials: [],
  userIntent: {},
  slots: createDefaultDirectorSlots(),
}

export const useDirectorContextStore = create<DirectorContextState>((set) => ({
  context: initialContext,

  replaceContext: (context) => set({ context }),

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

  reset: () => set({ context: initialContext }),
}))
