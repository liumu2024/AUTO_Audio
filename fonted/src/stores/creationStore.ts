import { create } from 'zustand'
import type { DirectorAspectRatio } from '@shared/types/director-context'

export type AttachmentSource = 'upload' | 'library'

export interface InputAttachment {
  id: string
  name: string
  type: 'video' | 'image' | 'audio'
  url: string
  source: AttachmentSource
  materialId?: string
  tags?: string[]
}

interface CreationState {
  sampleUrl: string
  sampleName: string
  inputText: string
  attachments: InputAttachment[]
  aspectRatio: DirectorAspectRatio
  durationSec?: number
  styleIntensity: 'light' | 'medium' | 'strong'
  isAnalyzing: boolean
  /** 样例视频是否已完成结构拆解（有 pipeline 结果） */
  isSampleParsed: boolean
  setSampleUrl: (url: string, name?: string) => void
  setInputText: (text: string) => void
  addAttachment: (item: InputAttachment) => void
  removeAttachment: (id: string) => void
  setAspectRatio: (aspectRatio: DirectorAspectRatio) => void
  setDurationSec: (durationSec?: number) => void
  setStyleIntensity: (styleIntensity: 'light' | 'medium' | 'strong') => void
  setAnalyzing: (v: boolean) => void
  setSampleParsed: (v: boolean) => void
  clearSample: () => void
  restoreFromServer: (input: {
    sampleUrl: string
    sampleName?: string
    inputText?: string
    isSampleParsed?: boolean
  }) => void
}

export const useCreationStore = create<CreationState>((set, get) => ({
  sampleUrl: '',
  sampleName: '',
  inputText: '',
  attachments: [],
  aspectRatio: '9:16',
  durationSec: undefined,
  styleIntensity: 'medium',
  isAnalyzing: false,
  isSampleParsed: false,

  setSampleUrl: (sampleUrl, name) =>
    set({
      sampleUrl,
      sampleName: name ?? get().sampleName,
    }),
  setInputText: (inputText) => set({ inputText }),
  addAttachment: (item) => {
    if (get().attachments.some((a) => a.id === item.id)) return
    set((s) => ({ attachments: [...s.attachments, item] }))
  },
  removeAttachment: (id) =>
    set((s) => ({ attachments: s.attachments.filter((a) => a.id !== id) })),
  setAspectRatio: (aspectRatio) => set({ aspectRatio }),
  setDurationSec: (durationSec) => set({ durationSec }),
  setStyleIntensity: (styleIntensity) => set({ styleIntensity }),
  setAnalyzing: (isAnalyzing) => set({ isAnalyzing }),
  setSampleParsed: (isSampleParsed) => set({ isSampleParsed }),
  clearSample: () => set({ sampleUrl: '', sampleName: '' }),
  restoreFromServer: ({ sampleUrl, sampleName, inputText, isSampleParsed }) =>
    set({
      sampleUrl,
      sampleName: sampleName ?? '',
      inputText: inputText ?? '',
      isSampleParsed: isSampleParsed ?? false,
    }),
}))
